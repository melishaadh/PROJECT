/**
 * Explain a user's For You feed.
 *
 * Read-only. Runs the real engine against a real account and prints every
 * input it used and every layer's contribution, so a feed can be checked
 * against the reasoning that produced it rather than taken on trust.
 *
 *   npm run explain:feed -- you@example.com
 *
 * Nothing is written. Safe to run at any point, including mid-session.
 */

import 'dotenv/config';
import { connect, disconnect, model } from 'mongoose';

import { CacheService } from '../common/cache.service';
import { ageGroupFromDob, calculateAge, ageBracketFor } from '../common/age';
import { TREK_BY_ID, TREK_METADATA } from '../data/trek-metadata';
import { RecommendationsService, BEHAVIOURAL_TRIGGER_LIKES } from '../modules/recommendations/recommendations.service';
import { UserSchema } from '@db/schemas/user.schema';
import { UserInteractionSchema } from '@db/schemas/user-interaction.schema';

const bar = (v: number, width = 24) =>
  '█'.repeat(Math.round(Math.max(0, Math.min(1, v)) * width)).padEnd(width, '·');

const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run explain:feed -- <email>');
    process.exit(1);
  }

  await connect(process.env.MONGODB_URI!);
  const UserModel = model('User', UserSchema, 'users');
  const InteractionModel = model('UserInteraction', UserInteractionSchema, 'userinteractions');

  const user = await UserModel.findOne({ email }).lean() as any;
  if (!user) {
    console.error(`No account found for ${email}`);
    await disconnect();
    process.exit(1);
  }

  const id = String(user._id);

  // ── The real service, against the real collections ────────────────────────
  const usersService = {
    async findById() { return user; },
    async getAllProfiles() {
      const all = await UserModel.find(
        { isOnboarded: true },
        { profile: 1, preferences: 1, dateOfBirth: 1 },
      ).lean();
      return (all as any[]).map(u => ({
        userId: String(u._id),
        profile: { ...u.profile, ageGroup: ageGroupFromDob(u.dateOfBirth, u.profile?.ageGroup ?? 1) },
        preferences: u.preferences,
      }));
    },
    async getAllInteractions() {
      const rows = await InteractionModel.find({ type: 'like' }).lean();
      return (rows as any[]).map(r => ({
        userId: String(r.userId), trekId: r.trekId, type: r.type, ratingValue: r.ratingValue,
      }));
    },
    async getAllLikeCounts() {
      const rows: any[] = await InteractionModel.aggregate([
        { $match: { type: 'like' } }, { $group: { _id: '$trekId', n: { $sum: 1 } } },
      ]);
      const counts: Record<string, number> = {};
      for (const t of TREK_METADATA) counts[t.trekId] = 0;
      for (const r of rows) counts[r._id] = r.n;
      return counts;
    },
    async getUserLikes() {
      const rows = await InteractionModel.find({ userId: user._id, type: 'like' })
        .sort({ interactedAt: -1 }).lean();
      return rows as any[];
    },
    async getUserSignals() {
      const rows = await InteractionModel.find(
        { userId: user._id, type: { $in: ['view', 'dismiss'] } },
      ).lean();
      return (rows as any[]).map(r => ({
        trekId: r.trekId, type: r.type, count: r.count ?? 0, dwellMs: r.dwellMs ?? 0,
      }));
    },
  };

  const service = new RecommendationsService(
    usersService as any,
    { async catalogue() { return [] as any[] } } as any,
    new CacheService(),
  );

  const feed = await service.getForYou(id);
  const age = calculateAge(user.dateOfBirth);
  const bracket = ageBracketFor(ageGroupFromDob(user.dateOfBirth, user.profile?.ageGroup ?? 1));
  const likes: string[] = user.likedTrekIds ?? [];
  const completed: string[] = user.completedTrekIds ?? [];
  const signals = await usersService.getUserSignals();

  const name = (t: string) => TREK_BY_ID.get(t)?.name ?? `#${t}`;
  const line = '─'.repeat(74);

  console.log(`\n${line}\nWHO THE ENGINE THINKS YOU ARE\n${line}`);
  console.log(`  account          ${user.email}`);
  console.log(`  age              ${age ?? '—'}  →  bracket [${bracket.index}] ${bracket.label} (${bracket.rangeLabel})`);
  console.log(`                   (used for peer clustering only — never shown in the app)`);
  console.log(`  onboarding       experience=${user.profile?.experienceLevel} cardio=${user.profile?.cardioFlag} joints=${user.profile?.jointFlag} altitude=${user.profile?.altitudeHistory}`);
  console.log(`  preferences      ≤${user.preferences?.maxDuration}d  ≤NPR ${user.preferences?.maxPrice?.toLocaleString()}  difficulty=${user.preferences?.difficulty}`);
  console.log(`  likes            ${likes.length ? likes.map(name).join(', ') : '(none)'}`);
  console.log(`  completed        ${completed.length ? completed.map(name).join(', ') : '(none)'}`);
  console.log(`  passive signals  ${signals.filter(s => s.type === 'view').length} viewed, ${signals.filter(s => s.type === 'dismiss').length} dismissed`);

  console.log(`\n${line}\nWHICH LAYERS ARE DRIVING THE RANKING\n${line}`);
  const w = feed.weights;
  console.log(`  L1 popularity    ${bar(w.popularity)} ${pct(w.popularity)}   trending leaderboard`);
  console.log(`  L2 attribute fit ${bar(w.attributeFit)} ${pct(w.attributeFit)}   your onboarding answers`);
  console.log(`  L3 behavioural   ${bar(w.affinity)} ${pct(w.affinity)}   learned from your likes + history`);
  console.log(`  L4 collaborative ${bar(w.collaborative)} ${pct(w.collaborative)}   peers in your bracket`);
  console.log(`\n  cold start       ${feed.coldStart ? 'YES — ranking is your form + your cohort' : 'no — your own behaviour now leads'}`);
  console.log(`  behavioural      ${feed.affinity.behaviouralTriggered
    ? `ENGAGED (${likes.length} likes ≥ ${BEHAVIOURAL_TRIGGER_LIKES})`
    : `dormant (${likes.length}/${BEHAVIOURAL_TRIGGER_LIKES} likes)`}`);
  if (feed.affinity.active) {
    console.log(`  learned regions  ${feed.affinity.affineRegions.join(', ') || '—'}`);
    console.log(`  learned bands    ~NPR ${Math.round(feed.affinity.meanPriceNPR ?? 0).toLocaleString()}, ~${(feed.affinity.meanDurationDays ?? 0).toFixed(1)} days, ${feed.affinity.dominantDifficulty ?? '—'}`);
    console.log(`  keywords         ${feed.affinity.labels.slice(0, 8).join(', ') || '—'}`);
  }

  console.log(`\n${line}\nPEER COHORT (strict age-bracket clustering)\n${line}`);
  const c = feed.cohort;
  console.log(`  candidates       ${c.candidates} onboarded accounts with likes`);
  console.log(`  same bracket     ${c.sameBracket}      adjacent ${c.adjacentBracket}`);
  console.log(`  EXCLUDED         ${c.excludedByAgeGap} peers, more than 1 bracket away — never consulted`);
  console.log(`  neighbours used  ${c.neighbours}  (mean similarity ${c.meanSimilarity.toFixed(3)})`);

  console.log(`\n${line}\nYOUR FEED, AND WHY\n${line}`);
  feed.recommended.forEach((r, i) => {
    const t = TREK_BY_ID.get(r.trekId);
    console.log(
      `  ${String(i + 1).padStart(2)}. ${(t?.name ?? r.trekId).slice(0, 30).padEnd(31)}` +
      `${(t?.region ?? '').padEnd(11)}${(t?.difficulty ?? '').padEnd(9)}score ${r.score.toFixed(3)}`
    );
    console.log(`      chip → "${r.reason ?? '(none)'}"`);
    console.log(`      fit ${bar(r.attributeFit, 12)} ${pct(r.attributeFit)}   ` +
      `affinity ${bar(r.affinityFit, 12)} ${pct(r.affinityFit)}   ` +
      `peers ${bar(r.collaborativeBoost, 12)} ${pct(r.collaborativeBoost)}`);
  });

  if (feed.excludedAsCompleted > 0) {
    console.log(`\n  ${feed.excludedAsCompleted} route(s) withheld — already completed.`);
  }
  if (feed.trendingPadding > 0) {
    console.log(`  ${feed.trendingPadding} slot(s) padded from the trending leaderboard.`);
  }
  if (feed.peerBracketSlots > 0) {
    console.log(`  ${feed.peerBracketSlots} slot(s) filled by what your own age bracket likes.`);
  }

  if (feed.filteredOut.length > 0) {
    console.log(`\n${line}\nHIDDEN BY THE SAFETY MATRIX (never shown to you in-app)\n${line}`);
    for (const f of feed.filteredOut.slice(0, 8)) {
      console.log(`  ${name(f.trekId).padEnd(32)} ${f.filterReason ?? ''}`);
    }
  }

  console.log('');
  await disconnect();
}

main().catch(async err => {
  console.error('explain-feed failed:', err);
  await disconnect().catch(() => {});
  process.exit(1);
});
