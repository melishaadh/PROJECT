/* eslint-disable no-console */
/**
 * Demo group-chat seeding.
 *
 * Final-project-demo prep: creates realistic-looking group chats across the
 * whole trek catalogue — varied capacity, varied fill level, varied member
 * casts spread broadly across the eligible account pool — plus a short
 * back-and-forth of messages with staggered timestamps and a deliberately
 * *partial* read state, so unread badges, the "seen by" avatar stack, and
 * the My Chats unread-sort all have real data instead of an empty inbox.
 *
 * Every seeded room having the same member count and the same difficulty
 * mix is exactly what makes seed data look like seed data — this
 * deliberately varies both per room, deterministically (see `makeRng`), so
 * re-running produces the same "random-looking" result rather than reshuffling
 * on every run.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * Synthetic accounts ONLY — the same qualification rules as
 * `enrich-test-users.ts` (email on a test-harness domain, a harness-prefixed
 * local part, or listed in `scripts/data/*.json`), **plus** a name-quality
 * filter on top: most synthetic accounts in this database have no
 * `profilePicture` at all, and a chunk of them have obviously-fake
 * batch-cohort names ("HighRiskHannah", "AliceTrekker"). Rather than surface
 * either — a blank avatar or a name that screams "test data" — this only
 * picks members from accounts with a real-looking name (a signup-time
 * Nepali name like "sumanshrestha", not a persona-cohort label); `Avatar`'s
 * initials fallback renders those cleanly with no picture needed. A
 * production account is never added to a demo room, never sent a demo
 * message, and never has its `lastReadAt` touched.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────────
 * Members are drawn from a single shuffle of the *entire* eligible pool,
 * walked forward room by room rather than a tight modulo rotation — that's
 * what keeps adjacent rooms from sharing most of their roster, and spreads
 * membership across as much of the pool as the room count allows, so
 * whichever demo account you happen to log into is much more likely to
 * already be in something.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * Each seeded room's `(trekId, roomName)` pair is generated the same way
 * every run, so re-running tops up membership/messages rather than
 * duplicating rooms. `--reset` recomputes that same name list rather than
 * pattern-matching on a visible tag — the whole point is that these read as
 * ordinary groups, not as marked demo data.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * Dry-run by default; nothing is written without `--apply`.
 *
 *   npm run seed:demo-chats              # dry run, writes nothing
 *   npm run seed:demo-chats -- --apply   # commit
 *   npm run seed:demo-chats -- --apply --reset
 *                                        # remove every seeded demo room
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { connect, disconnect, model, Types } from 'mongoose';

import { TREK_METADATA, TrekMeta } from '../data/trek-metadata';
import { UserSchema } from '@db/schemas/user.schema';
import { ChatRoomSchema } from '@db/schemas/chat-room.schema';
import { MessageSchema } from '@db/schemas/message.schema';

// ─── Synthetic-account qualification — identical rules to enrich-test-users.ts ─

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

/**
 * On top of "is this a synthetic account", is its *name* one worth showing
 * in a demo — a plausible human name rather than a harness artifact.
 *
 * The organically-created test signups in this database all share one
 * shape: an all-lowercase, unspaced Nepali first+last name ("sumanshrestha",
 * "govindakarki"). The batch-generated persona cohorts look nothing like
 * that — "HighRiskHannah", "FitFred", "AliceTrekker", "BobHiker" are
 * CamelCase (a lowercase letter directly followed by an uppercase one, which
 * no single real name ever is), and things like "verifyuser" or
 * "RenamedZeta1785300767" carry a harness word or a digit.
 */
function looksLikeARealName(name: string | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 4 || trimmed.length > 25) return false;
  if (/\d/.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[a-z][A-Z]/.test(trimmed)) return false;
  if (/test|verify|smoke|admin|sample|dummy|audit|alice|bob|fred|hannah|trekker/i.test(trimmed)) return false;
  return true;
}

// ─── Deterministic pseudo-randomness — same construction as enrich-test-users.ts ─

function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

function makeRng(seed: number): () => number {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 8; i++) next(); // warm up — see enrich-test-users.ts
  return next;
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Fisher-Yates, driven by the seeded rng so the "shuffle" is reproducible. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─── Demo content ───────────────────────────────────────────────────────────

/** Capacity range by difficulty — bigger, easier treks draw bigger groups. */
const CAPACITY_RANGE: Record<TrekMeta['difficulty'], [number, number]> = {
  Easy: [6, 12],
  Moderate: [5, 9],
  Hard: [3, 7],
};

const NAME_TEMPLATES = [
  (trek: string) => `${trek} Trekkers`,
  (trek: string) => `${trek} Crew`,
  (trek: string) => `${trek} Expedition`,
  (trek: string) => `${trek} Squad`,
  (trek: string) => `${trek} Group`,
];

function roomNameFor(trek: TrekMeta, index: number): string {
  return NAME_TEMPLATES[index % NAME_TEMPLATES.length](trek.name);
}

const SAMPLE_MESSAGES = [
  'Hey everyone! Hyped for this one 🏔️',
  'Anyone bringing extra trekking poles? Mine snapped last trip.',
  'Weather forecast looks clear for the whole window, fingers crossed.',
  'What time are we meeting at the trailhead?',
  'I heard the teahouse at the second stop has amazing dal bhat.',
  'Packing list check — down jacket, thermals, first aid kit, done.',
  'Does anyone have experience with altitude sickness meds?',
  'Just booked my flight, see you all there!',
  'Should we split gear to save weight? I can carry the stove.',
  "Can't wait, this is going to be incredible.",
  "Reminder: bring cash, most teahouses don't take cards.",
  "I'm bringing a water filter if anyone wants to share.",
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/** `YYYY-MM-DD`, matching how `NewExpeditionScreen` sends a date to `POST /chat/rooms`. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Roughly half of all rooms get a real date range — enough that the
 * "planned for X–Y" line actually shows up while browsing Explore, without
 * making every single card carry one (a self-created room's dates are
 * optional too, so an all-dated demo set would itself look artificial).
 * The span always covers at least the trek's own `durationDays` — the same
 * floor `ChatService.createRoom` enforces for a real submission — so the
 * seed data demonstrates the constraint rather than accidentally violating
 * it.
 */
function randomDateRange(rng: () => number, durationDays: number): { startDate: string; endDate: string } | null {
  if (rng() >= 0.5) return null;
  const today = new Date();
  const startInDays = randInt(rng, 5, 60);
  const start = addDays(today, startInDays);
  const end = addDays(start, durationDays - 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

interface SyntheticUser {
  _id: Types.ObjectId;
  name?: string;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reset = process.argv.includes('--reset');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — add it to backend/.env before running.');
    process.exit(1);
  }

  await connect(uri);
  const UserModel = model('User', UserSchema, 'users');
  const RoomModel = model('ChatRoom', ChatRoomSchema, 'chatrooms');
  const MessageModel = model('Message', MessageSchema, 'messages');

  console.log(`\n${apply ? (reset ? 'APPLYING (reset)' : 'APPLYING') : 'DRY RUN — no writes'}`);

  const treks = TREK_METADATA;
  const seededRoomNames = treks.map((t, i) => ({ trekId: t.trekId, roomName: roomNameFor(t, i) }));

  if (reset) {
    const existing = await RoomModel.find(
      { $or: seededRoomNames.map(({ trekId, roomName }) => ({ trekId, roomName })) },
      { _id: 1, roomName: 1 },
    ).lean();
    console.log(`Would remove ${existing.length} seeded demo room(s) and their messages:`);
    for (const r of existing) console.log(`  • ${r.roomName}`);
    if (apply && existing.length > 0) {
      const ids = existing.map((r: { _id: Types.ObjectId }) => r._id);
      const msgResult = await MessageModel.deleteMany({ chatRoomId: { $in: ids } });
      const roomResult = await RoomModel.deleteMany({ _id: { $in: ids } });
      console.log(`\nRemoved ${roomResult.deletedCount} room(s), ${msgResult.deletedCount} message(s).`);
    }
    await disconnect();
    return;
  }

  const users = await UserModel.find({}, { email: 1, name: 1 }).lean();
  const seededEmails = loadSeededEmails();
  const isSynthetic = (e: string) =>
    seededEmails.has(e) || HARNESS_PREFIX.test(e) || SYNTHETIC_DOMAIN.test(e);

  const eligible: SyntheticUser[] = users
    .filter(u => isSynthetic(String(u.email ?? '').toLowerCase()) && looksLikeARealName(u.name))
    .map(u => ({ _id: u._id as Types.ObjectId, name: u.name }));

  console.log(
    `${users.length} total users · ${eligible.length} synthetic with a demo-worthy name · ` +
      `${users.length - eligible.length} skipped (real, or synthetic without a presentable name)\n`,
  );

  const MIN_ROOM_MEMBERS = 2;
  const maxPossibleMembers = treks.reduce((sum, t) => sum + CAPACITY_RANGE[t.difficulty][1] - 1, 0);
  if (eligible.length < MIN_ROOM_MEMBERS) {
    console.log(`Need at least ${MIN_ROOM_MEMBERS} presentable synthetic accounts to seed a room; found ${eligible.length}. Nothing to do.`);
    await disconnect();
    return;
  }

  // One shuffle of the whole pool, walked forward (wrapping only if every
  // room together would need more people than exist) — this is what spreads
  // membership broadly instead of the same handful of names recurring in
  // every room.
  const rootRng = makeRng(hash('trekeasy-demo-seed-v2'));
  const shuffledPool = shuffle(eligible, rootRng);
  let cursor = 0;
  const nextMembers = (count: number): SyntheticUser[] => {
    const picked: SyntheticUser[] = [];
    for (let n = 0; n < count; n++) {
      picked.push(shuffledPool[cursor % shuffledPool.length]);
      cursor++;
    }
    return picked;
  };

  console.log(
    `Drawing from a shuffled pool of ${shuffledPool.length}; up to ${maxPossibleMembers} member-slots ` +
      `across ${treks.length} rooms means ${eligible.length < maxPossibleMembers ? 'some names will recur once the pool wraps' : 'no repeats needed'}.\n`,
  );

  let roomsTouched = 0;
  let messagesCreated = 0;
  const coveredIds = new Set<string>();

  for (let i = 0; i < treks.length; i++) {
    const trek = treks[i];
    const rng = makeRng(hash(`trekeasy-demo-seed-v2:${trek.trekId}`));

    const [minCap, maxCap] = CAPACITY_RANGE[trek.difficulty];
    const maxMembers = randInt(rng, minCap, maxCap);
    // ~15% of rooms land exactly full (great for demoing the "Full" state
    // and its deprioritised sort position); the rest leave real open room.
    const memberCount =
      rng() < 0.15 ? maxMembers : randInt(rng, MIN_ROOM_MEMBERS, Math.max(MIN_ROOM_MEMBERS, maxMembers - 1));

    const members = nextMembers(memberCount);
    members.forEach(m => coveredIds.add(m._id.toString()));

    const roomName = roomNameFor(trek, i);
    const dateRange = randomDateRange(rng, trek.durationDays);
    console.log(
      `${roomName} — ${memberCount}/${maxMembers} members: ${members.map(m => m.name).join(', ')} ` +
        `(trek "${trek.name}", ${trek.difficulty})` +
        (dateRange ? ` — planned ${dateRange.startDate} to ${dateRange.endDate}` : ' — no dates'),
    );

    if (!apply) continue;

    const room = await RoomModel.findOneAndUpdate(
      { trekId: trek.trekId, roomName },
      {
        $setOnInsert: {
          trekId: trek.trekId,
          roomName,
          destinationName: trek.name,
          location: trek.location,
          durationDays: trek.durationDays,
          difficulty: trek.difficulty,
          maxMembers,
        },
        // Plain `$set`, not `$setOnInsert` — this needs to retroactively land
        // on rooms this script already created in an earlier run (back when
        // dates weren't seeded at all), not just on brand-new ones. It's
        // still idempotent re-run to re-run: the same `(trek, seed)` pair
        // always derives the same range from `rng`, so this just re-writes
        // the same value rather than reshuffling it.
        $set: {
          startDate: dateRange ? new Date(dateRange.startDate) : null,
          endDate: dateRange ? new Date(dateRange.endDate) : null,
        },
        $addToSet: { members: { $each: members.map(m => m._id) } },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    roomsTouched++;

    // The conversation is only ever seeded once per room — without this
    // guard, re-running `--apply` (e.g. to pick up the date range added
    // above) would keep appending another full batch of messages on top of
    // the ones already there every single time, duplicating the entire
    // history instead of just topping up membership.
    const existingMessageCount = await MessageModel.countDocuments({ chatRoomId: room!._id });
    if (existingMessageCount > 0) {
      console.log(`  (already has ${existingMessageCount} message(s) — conversation left as-is)`);
    } else {
      // A short, staggered conversation — oldest message a few hours back,
      // newest just a few minutes ago, so "Today" separators and relative
      // timestamps in My Chats read naturally rather than all stacking at once.
      const messageCount = 4 + Math.floor(rng() * 4);
      const now = Date.now();
      const createdMessages: { senderId: Types.ObjectId; createdAt: Date }[] = [];
      let lastContent: string | null = null;
      for (let m = 0; m < messageCount; m++) {
        const sender = members[m % members.length];
        const minutesAgo = (messageCount - m) * (8 + Math.floor(rng() * 10));
        const createdAt = new Date(now - minutesAgo * 60_000);
        let content = pick(SAMPLE_MESSAGES, hash(`${trek.trekId}:${m}`));
        if (content === lastContent) {
          // The hash-based pick can land on the same line two messages in a
          // row (it happened — "rohitlama" saying the identical thing twice,
          // a minute apart, is exactly what a scripted seed looks like, not
          // a real conversation). Stepping to the next line is
          // deterministic — no extra `rng()` draw — so it doesn't perturb
          // any other field's already-applied value.
          const idx = SAMPLE_MESSAGES.indexOf(content);
          content = SAMPLE_MESSAGES[(idx + 1) % SAMPLE_MESSAGES.length];
        }
        lastContent = content;
        await MessageModel.create({
          chatRoomId: room!._id,
          senderId: sender._id,
          content,
          createdAt,
          updatedAt: createdAt,
        });
        createdMessages.push({ senderId: sender._id, createdAt });
        messagesCreated++;
      }

      // Partial read state: each member "catches up" to a different point in
      // the conversation — some to the very last message, others a few
      // behind — so the unread badge and the seen-by avatar row both have
      // real, varied data to render instead of either "all read" or "none
      // read".
      for (let m = 0; m < members.length; m++) {
        const caughtUpTo = createdMessages[Math.max(0, createdMessages.length - 1 - m)];
        if (!caughtUpTo) continue;
        await RoomModel.updateOne(
          { _id: room!._id },
          { $set: { [`lastReadAt.${members[m]._id.toString()}`]: caughtUpTo.createdAt } },
        );
      }
    }

    // One-off cleanup for conversations seeded before the anti-duplicate
    // check above existed: two consecutive messages from the same sender
    // with byte-identical content read as a scripted artifact, not a real
    // exchange, so the later one of each such pair is removed. Runs every
    // time (cheap on an already-clean room — the query just matches
    // nothing) rather than only for rooms just created above.
    const roomMessages = await MessageModel.find({ chatRoomId: room!._id }, { senderId: 1, content: 1 })
      .sort({ createdAt: 1 })
      .lean();
    const dupeIds: Types.ObjectId[] = [];
    for (let m = 1; m < roomMessages.length; m++) {
      const prevMsg = roomMessages[m - 1];
      const curMsg = roomMessages[m];
      if (curMsg.senderId.toString() === prevMsg.senderId.toString() && curMsg.content === prevMsg.content) {
        dupeIds.push(curMsg._id as Types.ObjectId);
      }
    }
    if (dupeIds.length > 0) {
      await MessageModel.deleteMany({ _id: { $in: dupeIds } });
      console.log(`  removed ${dupeIds.length} duplicate consecutive message(s)`);
    }
  }

  console.log(`\n${coveredIds.size} distinct account(s) now have at least one seeded room.`);
  if (!apply) {
    console.log('Nothing was written. Re-run with --apply to commit these changes.');
  } else {
    console.log(`Seeded/updated ${roomsTouched} room(s), created ${messagesCreated} message(s).`);
  }

  await disconnect();
}

main().catch(async err => {
  console.error('Seeding failed:', err);
  await disconnect().catch(() => {});
  process.exit(1);
});
