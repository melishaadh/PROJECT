/* eslint-disable no-console */
/**
 * Test-user enrichment and behavioural seeding.
 *
 * Gives the synthetic accounts a realistic surface (bio, social link, completed
 * treks) and a real interaction history, so the For You engine has genuine
 * signal to cluster on instead of 500 identical blank profiles.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Synthetic accounts ONLY. An account qualifies when its email appears in
 * `scripts/data/*.json` (the generated dataset), matches a test-harness prefix,
 * or sits on a `@test.trekeasy.com` / `@test.com` style domain. Real accounts
 * are listed and skipped — this never writes a bio or a like onto a human's
 * profile.
 *
 * ── Coherence ───────────────────────────────────────────────────────────────
 * Nothing here is random noise. Each user gets a "home region" and their
 * completed treks and likes are drawn from it, filtered against what their
 * onboarding profile could plausibly have handled (a beginner with no altitude
 * history is never given Makalu). That is what makes the recommendation
 * engine's region affinity and peer clustering testable — random likes would
 * train it on nothing.
 *
 * Every choice is derived from a hash of the user's email, so the script is
 * deterministic: re-running produces byte-identical data and is a no-op.
 *
 * ── Effect on the trending leaderboard ──────────────────────────────────────
 * `trek-metadata.ts` documents that destinations start at exactly zero likes
 * and that only organic activity moves them. Seeding likes DOES move the
 * leaderboard — that is the point of the exercise, but it means Explore's
 * "Trending Now" will reflect simulated engagement. `--reset` undoes it.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * Dry-run by default; nothing is written without `--apply`.
 *
 *   npm run seed:test-users              # dry run, writes nothing
 *   npm run seed:test-users -- --apply   # commit
 *   npm run seed:test-users -- --apply --reset
 *                                        # remove seeded likes + enrichment
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connect, disconnect, model, Types } from 'mongoose';

import { TREK_METADATA, altitudeHistoryFor, TrekMeta } from '../data/trek-metadata';
import { UserSchema } from '@db/schemas/user.schema';
import { UserInteractionSchema } from '@db/schemas/user-interaction.schema';
import { DestinationSchema } from '@db/schemas/destination.schema';

// ─── Target selection ─────────────────────────────────────────────────────────

const HARNESS_PREFIX =
  /^(smoke_|verify_|rank_|hr_|fit_|raw_|alice_|bob_|difftest_|itinerary|e2e|test)/i;
const SYNTHETIC_DOMAIN = /@(test\.com|t\.com|example\.com|test\.trekeasy\.com)$/i;

function loadSeededEmails(): Set<string> {
  const set = new Set<string>();
  for (const file of ['trekeasy-users.json', 'trekeasy-users-100.json']) {
    try {
      const raw = JSON.parse(
        readFileSync(join(process.cwd(), '..', 'scripts', 'data', file), 'utf8'),
      );
      for (const u of Array.isArray(raw) ? raw : raw.users ?? []) {
        if (u?.email) set.add(String(u.email).toLowerCase());
      }
    } catch {
      // A missing dataset file just narrows the target set; the prefix and
      // domain rules still identify harness accounts on their own.
    }
  }
  return set;
}

// ─── Deterministic pseudo-randomness ──────────────────────────────────────────

/**
 * FNV-1a followed by an avalanche finalizer.
 *
 * The finalizer is not optional. Plain FNV-1a over a set of near-identical
 * strings (every address ends `@gmail.com`) leaves the low bits correlated,
 * and mulberry32's *first* output is a close function of its seed — so the
 * first draw came out strongly biased toward one end of the range. In practice
 * that meant one whole region was never selected as anyone's home region.
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // splitmix32 finalizer — spreads the influence of every input bit.
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Mulberry32, warmed up.
 *
 * The first few outputs of a freshly seeded mulberry32 still carry seed
 * structure; discarding them is what makes the very first `pick()` as uniform
 * as every later one. Cheap insurance, and it keeps the generator
 * deterministic.
 */
function rng(seed: number): () => number {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

const pick = <T>(arr: T[], r: () => number): T => arr[Math.floor(r() * arr.length) % arr.length];
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ─── Content ──────────────────────────────────────────────────────────────────

const REGIONS = Array.from(new Set(TREK_METADATA.map(t => t.region)));

const BIO_OPENERS = [
  'Weekend trekker based in Kathmandu.',
  'Pokhara-based, out on the trail most months.',
  'Grew up in the hills, still can’t stay away.',
  'Slow hiker, fast descender.',
  'Teahouse trekking is my whole personality.',
  'Here for the ridgelines and the dal bhat.',
  'Photographer first, trekker second.',
  'Trail runner turned long-haul trekker.',
];

const BIO_MIDDLE: Record<string, string[]> = {
  low: [
    'Still building up my altitude legs — taking the easier routes seriously first.',
    'Two seasons in and learning something on every trail.',
    'Prefer shorter routes with good lodges and a proper view at the end.',
  ],
  mid: [
    'Comfortable on multi-day routes and getting bolder about the passes.',
    'A few base camps in, working steadily toward the bigger circuits.',
    'Happiest on a week-long route with a real climb in the middle.',
  ],
  high: [
    'Done most of the classics; chasing the quieter high routes now.',
    'High passes and long approaches are the whole appeal.',
    'Comfortable above 5,000m and always planning the next one.',
  ],
};

const BIO_CLOSER = [
  'Always up for a group.',
  'Message me if you’re planning something.',
  'Happy to share route notes.',
  'Looking for people to share permits with.',
  'Tea breaks are non-negotiable.',
];

const SOCIAL_HOSTS = [
  (h: string) => `https://instagram.com/${h}`,
  (h: string) => `https://www.strava.com/athletes/${h}`,
  (h: string) => `https://instagram.com/${h}.treks`,
  (h: string) => `https://facebook.com/${h}`,
];

/** A plausible handle from the account name — lowercase, no separators. */
function handleFor(name: string, email: string, r: () => number): string {
  const base = (name || email.split('@')[0])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 14);
  const stem = base || 'trekker';
  return r() < 0.45 ? `${stem}${between(r, 2, 99)}` : stem;
}

function bioFor(experience: number, altitude: number, region: string, r: () => number): string {
  const band = altitude >= 2 || experience >= 3 ? 'high' : experience >= 1 ? 'mid' : 'low';
  return [
    pick(BIO_OPENERS, r),
    pick(BIO_MIDDLE[band], r),
    `${region} is home turf.`,
    pick(BIO_CLOSER, r),
  ].join(' ');
}

// ─── Trek selection ───────────────────────────────────────────────────────────

interface Capability { experienceLevel: number; altitudeHistory: number }

/**
 * Routes this profile could credibly have **completed**: nothing demanding more
 * altitude history than they have, and nothing above their experience. Without
 * this a "beginner, no altitude history" account ends up with Makalu Sherpani
 * Col in its history and the engine learns from a lie.
 */
function completedCandidates(profile: Capability): TrekMeta[] {
  return TREK_METADATA.filter(t => {
    if (altitudeHistoryFor(t.maxAltitude) > profile.altitudeHistory) return false;
    if (t.difficulty === 'Hard' && profile.experienceLevel < 2) return false;
    if (t.difficulty === 'Moderate' && profile.experienceLevel < 1) return false;
    return true;
  });
}

/**
 * Routes this profile might plausibly **like** — one tier beyond what they have
 * already earned.
 *
 * Liking is aspirational in a way that completing is not: people save routes
 * they are working towards. Modelling that is also what keeps the seeded signal
 * usable, because the completed-trek filter alone is far too narrow here. Only
 * three routes in the catalogue are Easy and all three are Annapurna, so the
 * ~209 accounts with no altitude history could otherwise never express interest
 * in anything outside one region — and a collaborative layer trained on that
 * has no cross-region overlap to learn from.
 */
function likeCandidates(profile: Capability): TrekMeta[] {
  return completedCandidates({
    experienceLevel: Math.min(3, profile.experienceLevel + 1),
    altitudeHistory: Math.min(3, profile.altitudeHistory + 1),
  });
}

interface Plan {
  email: string;
  name: string;
  bio: string;
  socialMediaLink: string;
  completedTrekIds: string[];
  likedTrekIds: string[];
  homeRegion: string;
  views: { trekId: string; count: number; dwellMs: number }[];
  dismissals: { trekId: string; count: number }[];
}

function planFor(user: any, seededEmails: Set<string>): Plan | null {
  const email = String(user.email ?? '').toLowerCase();
  if (!email) return null;

  const r = rng(hash(email));
  const profile = {
    experienceLevel: Number(user?.profile?.experienceLevel ?? 0),
    altitudeHistory: Number(user?.profile?.altitudeHistory ?? 0),
  };

  const doable = completedCandidates(profile);
  const wishlist = likeCandidates(profile);
  if (wishlist.length === 0) return null;

  const shuffle = (arr: TrekMeta[]) =>
    arr
      .map(t => ({ t, k: r() }))
      .sort((a, b) => a.k - b.k)
      .map(x => x.t);

  /*
    Home region is drawn from the wider wishlist, not from what they have
    already earned. Picking it from `doable` would pin every low-capability
    account to Annapurna (the only region with Easy routes) and collapse the
    region diversity the collaborative layer needs.
  */
  const regionsWithRoutes = REGIONS.filter(rg => wishlist.some(t => t.region === rg));
  const homeRegion = pick(regionsWithRoutes, r);

  const inHome = (t: TrekMeta) => t.region === homeRegion;

  // Completed history: whatever they could actually have walked, home region
  // first. May legitimately be empty for a true beginner.
  const completedCount = Math.min(between(r, 1, 4), doable.length);
  const completed: TrekMeta[] = [];
  for (const t of [...shuffle(doable.filter(inHome)), ...shuffle(doable.filter(t => !inHome(t)))]) {
    if (completed.length >= completedCount) break;
    completed.push(t);
  }

  const completedIds = new Set(completed.map(t => t.trekId));

  /*
    Likes: at least 2, because the behavioural layer only engages from the
    second like (BEHAVIOURAL_TRIGGER_LIKES). Drawn from routes they have NOT
    completed, weighted to the home region — which is exactly the "surface the
    unexplored remainder of a liked region" behaviour the engine is built to
    reward, so this produces a signal worth clustering on.
  */
  const unwalked = wishlist.filter(t => !completedIds.has(t.trekId));
  const likeCount = Math.min(between(r, 2, 6), Math.max(2, unwalked.length));
  const liked: TrekMeta[] = [];
  for (const t of [...shuffle(unwalked.filter(inHome)), ...shuffle(unwalked.filter(t => !inHome(t)))]) {
    if (liked.length >= likeCount) break;
    liked.push(t);
  }
  // Nothing left unexplored in range — fall back to re-liking a completed
  // route, which is honest behaviour (people do like routes they have walked).
  if (liked.length < 2) {
    for (const t of shuffle(wishlist)) {
      if (liked.length >= 2) break;
      if (!liked.some(l => l.trekId === t.trekId)) liked.push(t);
    }
  }

  /*
    Passive micro-interactions.

    Views land on the routes the account is plausibly browsing — its home region
    plus whatever it liked — with a dwell drawn from a realistic spread.
    Dismissals go to a region it has shown no interest in, which is what gives
    the negative-feedback layer something to actually downrank. Without these
    the sentiment layer has no data and silently contributes nothing.
  */
  const likedIds = new Set(liked.map(t => t.trekId));
  const viewed = shuffle(wishlist.filter(t => inHome(t) || likedIds.has(t.trekId)))
    .slice(0, between(r, 2, 5));
  const views = viewed.map(t => ({
    trekId: t.trekId,
    count: between(r, 1, 4),
    // 1.5s-14s per view: above the "meaningful dwell" floor, below the cap.
    dwellMs: between(r, 1500, 14000),
  }));

  const coldRegions = REGIONS.filter(rg => rg !== homeRegion);
  const coldRegion = pick(coldRegions, r);
  const dismissed = shuffle(
    TREK_METADATA.filter(t => t.region === coldRegion && !likedIds.has(t.trekId)),
  ).slice(0, between(r, 0, 2));
  const dismissals = dismissed.map(t => ({ trekId: t.trekId, count: between(r, 1, 5) }));

  const name = String(user.name ?? '').trim();
  const handle = handleFor(name, email, r);

  return {
    email,
    name,
    bio: bioFor(profile.experienceLevel, profile.altitudeHistory, homeRegion, r),
    socialMediaLink: pick(SOCIAL_HOSTS, r)(handle),
    completedTrekIds: completed.map(t => t.trekId),
    likedTrekIds: liked.map(t => t.trekId),
    homeRegion,
    views,
    dismissals,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply');
  const reset = process.argv.includes('--reset');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.error('MONGODB_URI is not set — add it to backend/.env before running.');
    process.exit(1);
  }

  const seededEmails = loadSeededEmails();

  await connect(uri);
  const UserModel = model('User', UserSchema, 'users');
  const InteractionModel = model('UserInteraction', UserInteractionSchema, 'userinteractions');
  const DestinationModel = model('Destination', DestinationSchema, 'destinations');

  const users = await UserModel.find({}, {
    email: 1, name: 1, bio: 1, socialMediaLink: 1,
    completedTrekIds: 1, likedTrekIds: 1, 'profile.experienceLevel': 1,
    'profile.altitudeHistory': 1,
  }).lean();

  const isSynthetic = (e: string) =>
    seededEmails.has(e) || HARNESS_PREFIX.test(e) || SYNTHETIC_DOMAIN.test(e);

  const targets: any[] = [];
  const skipped: string[] = [];
  for (const u of users as any[]) {
    const e = String(u.email ?? '').toLowerCase();
    (isSynthetic(e) ? targets : skipped).push(isSynthetic(e) ? u : e);
  }

  console.log(`\n${apply ? (reset ? 'APPLYING (reset)' : 'APPLYING') : 'DRY RUN — no writes'}`);
  console.log(`${users.length} users · ${targets.length} synthetic (targets) · ${skipped.length} real (skipped)\n`);

  if (reset) {
    console.log('Reset would clear seeded bios, social links, completed treks, likes and signals');
    console.log(`from ${targets.length} synthetic accounts, and recount destination likes.`);
    if (apply) {
      const ids = targets.map(t => t._id as Types.ObjectId);
      await UserModel.updateMany(
        { _id: { $in: ids } },
        { $set: { bio: '', socialMediaLink: '', completedTrekIds: [], likedTrekIds: [] } },
      );
      await InteractionModel.deleteMany({ userId: { $in: ids } });
      await recount(InteractionModel, DestinationModel);
      console.log('Reset complete.');
    } else {
      console.log('\nNothing was written. Re-run with --apply to commit.');
    }
    await disconnect();
    return;
  }

  const plans: Plan[] = [];
  for (const u of targets) {
    const plan = planFor(u, seededEmails);
    if (plan) plans.push(plan);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('Sample of what would be written:\n');
  for (const p of plans.slice(0, 4)) {
    console.log(`  ${p.email}  [${p.homeRegion}]`);
    console.log(`    bio      : ${p.bio}`);
    console.log(`    social   : ${p.socialMediaLink}`);
    console.log(`    completed: ${p.completedTrekIds.join(', ') || '—'}`);
    console.log(`    likes    : ${p.likedTrekIds.join(', ')}`);
    console.log('');
  }

  const totalLikes = plans.reduce((s, p) => s + p.likedTrekIds.length, 0);
  const totalCompleted = plans.reduce((s, p) => s + p.completedTrekIds.length, 0);
  console.log(`Totals: ${totalLikes} likes, ${totalCompleted} completed-trek entries across ${plans.length} accounts.`);
  console.log(`Average ${(totalLikes / Math.max(1, plans.length)).toFixed(1)} likes/user ` +
    `(the behavioural layer engages from 2).`);

  const totalViews = plans.reduce((s2, p) => s2 + p.views.length, 0);
  const totalDismissals = plans.reduce((s2, p) => s2 + p.dismissals.length, 0);
  console.log(`Passive signals: ${totalViews} view rows, ${totalDismissals} dismissal rows.`);

  const regionSpread = new Map<string, number>();
  for (const p of plans) regionSpread.set(p.homeRegion, (regionSpread.get(p.homeRegion) ?? 0) + 1);
  console.log('\nHome-region spread:');
  for (const [rg, n] of [...regionSpread].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rg.padEnd(12)} ${n}`);
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} real account(s) — untouched:`);
    for (const e of skipped.slice(0, 15)) console.log(`  • ${e}`);
    if (skipped.length > 15) console.log(`  … and ${skipped.length - 15} more`);
  }

  if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to commit these changes.');
    await disconnect();
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const byEmail = new Map(targets.map(t => [String(t.email).toLowerCase(), t._id as Types.ObjectId]));

  const userOps = plans.map(p => ({
    updateOne: {
      filter: { _id: byEmail.get(p.email) },
      update: {
        $set: {
          bio: p.bio,
          socialMediaLink: p.socialMediaLink,
          completedTrekIds: p.completedTrekIds,
          likedTrekIds: p.likedTrekIds,
        },
      },
    },
  }));
  if (userOps.length > 0) await UserModel.bulkWrite(userOps, { ordered: false });
  console.log(`\nUpdated ${userOps.length} user profiles.`);

  /*
    Interactions are the source of truth for the engine; `likedTrekIds` above is
    only the read mirror. Upserted rather than inserted so the compound unique
    index `{userId, trekId, type}` makes a re-run idempotent instead of throwing.
  */
  const interactionOps = plans.flatMap(p => {
    const userId = byEmail.get(p.email)!;
    return p.likedTrekIds.map(trekId => ({
      updateOne: {
        filter: { userId, trekId, type: 'like' as const },
        update: { $setOnInsert: { interactedAt: new Date(), ratingValue: null } },
        upsert: true,
      },
    }));
  });
  if (interactionOps.length > 0) {
    await InteractionModel.bulkWrite(interactionOps, { ordered: false });
  }
  console.log(`Upserted ${interactionOps.length} like interactions.`);

  /*
    Passive signals. Set (not incremented) so a re-run converges on the same
    numbers instead of doubling them each time — the whole script is meant to
    be idempotent, and $inc here would quietly break that.
  */
  const signalOps = plans.flatMap(p => {
    const userId = byEmail.get(p.email)!;
    return [
      ...p.views.map(v => ({
        updateOne: {
          filter: { userId, trekId: v.trekId, type: 'view' as const },
          update: {
            $set: { count: v.count, dwellMs: v.dwellMs * v.count },
            $setOnInsert: { interactedAt: new Date(), ratingValue: null },
          },
          upsert: true,
        },
      })),
      ...p.dismissals.map(d => ({
        updateOne: {
          filter: { userId, trekId: d.trekId, type: 'dismiss' as const },
          update: {
            $set: { count: d.count, dwellMs: 0 },
            $setOnInsert: { interactedAt: new Date(), ratingValue: null },
          },
          upsert: true,
        },
      })),
    ];
  });
  if (signalOps.length > 0) {
    await InteractionModel.bulkWrite(signalOps, { ordered: false });
  }
  console.log(`Upserted ${signalOps.length} passive signal rows (views + dismissals).`);

  const counts = await recount(InteractionModel, DestinationModel);
  console.log(`Recounted destination like totals (top: ${counts.slice(0, 3).map(c => `${c.trekId}=${c.likes}`).join(', ')}).`);

  await disconnect();
}

/**
 * Rebuild the denormalised `destination.likes` counter from the interaction
 * collection, mirroring `DestinationsService.syncLikeCounts`. Keeping the
 * counter derived means the trending leaderboard can never drift from the
 * interactions that justify it.
 */
async function recount(InteractionModel: any, DestinationModel: any) {
  const grouped: { _id: string; n: number }[] = await InteractionModel.aggregate([
    { $match: { type: 'like' } },
    { $group: { _id: '$trekId', n: { $sum: 1 } } },
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g._id] = g.n;

  await DestinationModel.bulkWrite(
    TREK_METADATA.map(t => ({
      updateOne: {
        filter: { trekId: t.trekId },
        update: { $set: { likes: Math.max(0, counts[t.trekId] ?? 0) } },
      },
    })),
    { ordered: false },
  );

  return TREK_METADATA.map(t => ({ trekId: t.trekId, likes: counts[t.trekId] ?? 0 }))
    .sort((a, b) => b.likes - a.likes);
}

main().catch(async err => {
  console.error('Enrichment failed:', err);
  await disconnect().catch(() => {});
  process.exit(1);
});
