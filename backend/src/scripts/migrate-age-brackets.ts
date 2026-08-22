/* eslint-disable no-console */
/**
 * Legacy age-bracket migration.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * Accounts created before the tailored cohorts were introduced carry a
 * `profile.ageGroup` written under the OLD four-band scheme:
 *
 *     [0] Under 25   [1] 25–45   [2] 46–60   [3] Over 60
 *
 * The engine now clusters on five named cohorts (see `common/age.ts`):
 *
 *     [0] Gen-Z Explorers 18–23   [1] Young Professionals 24–29
 *     [2] Active Adventurers 30–35   [3] Experienced Trekkers 36–41
 *     [4] Seasoned Explorers 42–50+
 *
 * The indices overlap but mean different things, so a legacy record is not
 * merely out of date — it is actively wrong. A user stored as `2` meant
 * "46–60" and now reads as "Active Adventurers, 30–35", which places them
 * two brackets away from their real cohort. Because `MAX_PEER_BRACKET_GAP`
 * is 1, that silently swaps who they are matched against.
 *
 * ── How each record is resolved ─────────────────────────────────────────────
 *  • DOB on record  → recomputed exactly with `ageGroupFromDob`. Authoritative.
 *  • No DOB         → the legacy band is remapped to the new cohort its age
 *                     range best overlaps (see LEGACY_BAND_REMAP). Approximate
 *                     by necessity, and reported as such.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * Dry-run by default: it prints exactly what it would change and writes
 * nothing. Pass `--apply` to commit. Idempotent — a second run is a no-op.
 *
 *   npm run migrate:age-brackets              # dry run, writes nothing
 *   npm run migrate:age-brackets -- --apply   # commit the changes
 */

import 'dotenv/config';
import { connect, disconnect, model } from 'mongoose';

import {
  AGE_BRACKETS,
  DEFAULT_AGE_BRACKET,
  MAX_AGE_BRACKET_INDEX,
  ageBracketFor,
  ageGroupFromDob,
  calculateAge,
  clampBracket,
} from '../common/age';
import { UserSchema } from '@db/schemas/user.schema';

/** The pre-migration bands, purely for reporting and for the no-DOB remap. */
const LEGACY_BANDS = ['Under 25', '25–45', '46–60', 'Over 60'] as const;

/**
 * Best-fit new cohort for each legacy band, used only when there is no date of
 * birth to compute from. Chosen by where each old band's mass sits:
 *
 *   Under 25 → Gen-Z Explorers (18–23), the only cohort it substantially covers
 *   25–45    → Active Adventurers (30–35), the midpoint of that wide band
 *   46–60    → Seasoned Explorers (42+), the only cohort that contains it
 *   Over 60  → Seasoned Explorers (42+), likewise
 */
const LEGACY_BAND_REMAP: Record<number, number> = { 0: 0, 1: 2, 2: 4, 3: 4 };

interface Row {
  email: string;
  name: string;
  dob: string;
  age: number | null;
  from: number;
  fromLabel: string;
  to: number;
  toLabel: string;
  basis: 'date-of-birth' | 'legacy-band-remap' | 'default';
  changed: boolean;
}

function resolve(user: any): Row {
  const stored = clampBracket(user?.profile?.ageGroup ?? DEFAULT_AGE_BRACKET);
  const rawStored = user?.profile?.ageGroup;
  const age = calculateAge(user?.dateOfBirth);

  let to: number;
  let basis: Row['basis'];

  if (age !== null) {
    // Authoritative: the DOB decides, exactly as every read-path already does.
    to = ageGroupFromDob(user.dateOfBirth);
    basis = 'date-of-birth';
  } else if (typeof rawStored === 'number' && rawStored >= 0 && rawStored <= 3) {
    // No DOB — fall back to remapping whatever legacy band was recorded.
    to = LEGACY_BAND_REMAP[Math.round(rawStored)] ?? DEFAULT_AGE_BRACKET;
    basis = 'legacy-band-remap';
  } else {
    to = DEFAULT_AGE_BRACKET;
    basis = 'default';
  }

  const legacyLabel =
    typeof rawStored === 'number' && rawStored >= 0 && rawStored < LEGACY_BANDS.length
      ? LEGACY_BANDS[Math.round(rawStored)]
      : '(unset)';

  return {
    email: user?.email ?? '(no email)',
    name: user?.name ?? '',
    dob: user?.dateOfBirth ? new Date(user.dateOfBirth).toISOString().slice(0, 10) : '—',
    age,
    from: stored,
    // Shown as the OLD scheme's meaning, which is what the number actually meant
    // when it was written — that is the whole point of the migration.
    fromLabel: legacyLabel,
    to,
    toLabel: ageBracketFor(to).label,
    basis,
    changed: stored !== to,
  };
}

function pad(v: string | number, w: number) {
  return String(v).padEnd(w);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGODB_URI is not set — add it to backend/.env before running.');
    process.exit(1);
  }

  await connect(uri);
  const UserModel = model('User', UserSchema, 'users');

  const users = await UserModel.find({}, {
    email: 1, name: 1, dateOfBirth: 1, 'profile.ageGroup': 1,
  }).lean();

  const rows = users.map(resolve);
  const changed = rows.filter(r => r.changed);

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — no writes'}`);
  console.log(`${users.length} user record(s); ${changed.length} need recategorizing.\n`);

  console.log(
    pad('EMAIL', 30) + pad('DOB', 12) + pad('AGE', 5) +
    pad('WAS (old scheme)', 20) + pad('NOW (new cohort)', 24) + 'BASIS',
  );
  console.log('─'.repeat(112));
  for (const r of rows) {
    console.log(
      pad(r.email.slice(0, 29), 30) +
      pad(r.dob, 12) +
      pad(r.age ?? '—', 5) +
      pad(`${r.from} ${r.fromLabel}`, 20) +
      pad(`${r.to} ${r.toLabel}`, 24) +
      (r.changed ? r.basis : 'already correct'),
    );
  }

  const approximate = changed.filter(r => r.basis !== 'date-of-birth');
  if (approximate.length > 0) {
    console.log(
      `\n${approximate.length} record(s) have no date of birth, so their new cohort is a ` +
      'best-fit remap of the old band rather than an exact calculation:',
    );
    for (const r of approximate) console.log(`  • ${r.email} — ${r.fromLabel} → ${r.toLabel}`);
  }

  // Distribution across the new cohorts, so a bad mapping is obvious at a glance.
  console.log('\nResulting cohort distribution:');
  for (const b of AGE_BRACKETS) {
    const n = rows.filter(r => r.to === b.index).length;
    console.log(`  [${b.index}] ${pad(b.label, 22)} ${pad(b.rangeLabel, 10)} ${n}`);
  }

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to commit these changes.');
    await disconnect();
    return;
  }

  let written = 0;
  for (const r of changed) {
    const res = await UserModel.updateOne(
      { email: r.email },
      { $set: { 'profile.ageGroup': Math.min(r.to, MAX_AGE_BRACKET_INDEX) } },
    );
    if (res.modifiedCount > 0) written++;
  }

  console.log(`\nUpdated ${written} record(s).`);
  await disconnect();
}

main().catch(async err => {
  console.error('Migration failed:', err);
  await disconnect().catch(() => {});
  process.exit(1);
});
