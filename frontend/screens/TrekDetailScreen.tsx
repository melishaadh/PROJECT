import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { ArrowLeft, Heart, Mountain, Clock, Users, TrendingUp, Route } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import LoginPromptModal from '@/components/LoginPromptModal';
import { DESTINATIONS, Destination } from '@/data/destinations';
import { useAuth } from '@/context/AuthContext';
import { useLikes } from '@/hooks/useLikes';
import { C, DIFFICULTY_COLOR } from '@/constants/theme';

const { width } = Dimensions.get('window');

/**
 * Dead space under the last card, so the scroll can clear the pinned footer.
 *
 * The footer is absolutely positioned, so it covers the end of the body rather
 * than pushing it up, and this spacer is the only thing that lets the content
 * scroll out from under it. It measures roughly 127pt — 14 top padding, the
 * price row and its 12 margin, the ~47pt buttons, then 28 bottom padding — so
 * the previous 130 left about three points of daylight and the last card
 * finished flush against the bar. The surplus here is the gap.
 */
const FOOTER_CLEARANCE = 190;

/**
 * A keyword earns a place on the page only if it distinguishes this trek from
 * the others. Anything attached to more than half the catalogue does not:
 * "beautiful", "wonderful" and "sightseeing" are on all 31 entries, so as
 * highlights they say nothing, while "rhododendron" or "turquoise water" say
 * exactly what you came to read.
 *
 * Derived from the catalogue rather than written out as a stop-list, so filler
 * added to `keywords` later drops out on its own instead of quietly reappearing
 * here as a highlight.
 */
const GENERIC_KEYWORD_SHARE = 0.5;

const GENERIC_KEYWORDS: Set<string> = (() => {
  const count = new Map<string, number>();
  for (const trek of DESTINATIONS) {
    // Per trek, not per mention: several entries list the same word twice.
    for (const kw of new Set((trek.keywords ?? []).map(k => k.trim().toLowerCase()))) {
      count.set(kw, (count.get(kw) ?? 0) + 1);
    }
  }
  const ceiling = DESTINATIONS.length * GENERIC_KEYWORD_SHARE;
  return new Set([...count].filter(([, n]) => n > ceiling).map(([kw]) => kw));
})();

/**
 * The altitude band this route sits in, in plain words.
 *
 * The thresholds are `diff()`'s, from `data/destinations.ts` — the catalogue
 * grades every trek Easy/Moderate/Hard purely on `maxAltitude`, so quoting the
 * same boundaries keeps this text and the difficulty badge describing one fact
 * instead of two. Nothing here is a per-trek judgement; it is the grading rule
 * written out, which is what the badge alone never says.
 */
function altitudeBriefing(trek: Destination): string {
  const alt = trek.maxAltitude ?? 0;
  const peak = alt.toLocaleString();

  if (alt <= 3500) {
    return `The route stays at or below ${peak}m, under the 3,500m mark where altitude starts to tell on most walkers. Expect teahouse nights and steady hill walking rather than thin air.`;
  }
  if (alt <= 4500) {
    return `The route reaches ${peak}m. Above 3,500m the air is thin enough to be felt, so the days get shorter than the distance suggests and a rest day earns its place in the plan.`;
  }
  return `The route reaches ${peak}m, well above the 4,500m line. Acclimatisation days are part of the route rather than a luxury, and high passes can close at short notice in poor weather.`;
}

/** The distinguishing keywords for one trek, de-duplicated and title-cased. */
function highlightsFor(trek: Destination): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of trek.keywords ?? []) {
    const kw = raw.trim().toLowerCase();
    if (!kw || seen.has(kw) || GENERIC_KEYWORDS.has(kw)) continue;
    seen.add(kw);
    out.push(kw.replace(/\b\p{Ll}/gu, c => c.toUpperCase()));
  }
  return out;
}

export default function TrekDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoggedIn } = useAuth();
  const { liked, countFor, isPending, toggleLike } = useLikes();
  const trek = DESTINATIONS.find(t => t.id === id);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [likeError, setLikeError] = useState(false);

  if (!trek) {
    return (
      <View style={s.notFound}>
        <Text style={s.notFoundText}>Trek not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const diffColor = DIFFICULTY_COLOR[trek.difficulty] ?? C.textFaint;
  const isLiked = liked.has(trek.id);
  // Always the server's aggregate of unique user likes — never the catalogue
  // seed, which is what made the count jump on the first like.
  const likeCount = countFor(trek.id);
  const likeBusy = isPending(trek.id);
  const highlights = highlightsFor(trek);

  /*
    Read off the entry, or divided out of it — never estimated. The per-day
    figure is the one number here the catalogue does not carry directly, and it
    is what makes two treks at different lengths actually comparable: 22,000
    over ten days is a cheaper trip than 18,000 over seven.
  */
  const days = trek.durationDays ?? 0;
  const price = trek.priceNPR ?? 0;
  const facts = [
    { label: 'Region', value: trek.parentName },
    ...(trek.childRoute ? [{ label: 'Route', value: trek.childRoute }] : []),
    { label: 'Duration', value: `${days} days` },
    { label: 'Highest point', value: `${(trek.maxAltitude ?? 0).toLocaleString()} m` },
    ...(days > 0 && price > 0
      ? [{ label: 'Cost per day', value: `NPR ${Math.round(price / days).toLocaleString()}` }]
      : []),
    { label: 'Total per person', value: `NPR ${price.toLocaleString()}` },
  ].filter(f => !!f.value);

  /**
   * Persists through the shared likes store, so every other screen's heart and
   * count update at the same moment. Optimistic, with rollback handled by the
   * store if the write fails.
   */
  const handleLike = async () => {
    if (likeBusy) return;
    setLikeError(false);
    const outcome = await toggleLike(trek.id);
    if (outcome === 'unauthenticated') {
      setLoginMessage('Please log in to like this trek.');
      setLoginPrompt(true);
    } else if (outcome === 'error') {
      setLikeError(true);
    }
  };

  const handleCreateGroup = () => {
    if (!isLoggedIn) {
      setLoginMessage('Please log in to create a group for this trek.');
      setLoginPrompt(true);
      return;
    }
    // The destination is pre-filled and locked on the form since it's already
    // known here; the trek's name seeds the group name as a starting point.
    router.push({
      pathname: '/chat/new',
      params: { trekId: trek.id, trekName: trek.displayTitle || trek.parentName || 'Trek' },
    });
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ScrollView showsVerticalScrollIndicator={false} bounces>
        {/* Hero */}
        <View style={s.heroWrap}>
          <Image source={trek.image} style={s.heroImage} resizeMode="cover" />
          <View style={s.heroScrim} />

          <TouchableOpacity
            onPress={goBack}
            style={s.heroBackBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <ArrowLeft size={20} color={C.white} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleLike}
            disabled={likeBusy}
            style={[s.heroLikeBtn, likeBusy && s.heroLikeBusy]}
            accessibilityRole="button"
            accessibilityLabel={isLiked ? 'Unlike this trek' : 'Like this trek'}
            accessibilityState={{ selected: isLiked, busy: likeBusy, disabled: likeBusy }}>
            {likeBusy ? (
              <ActivityIndicator size="small" color={C.white} />
            ) : (
              <Heart
                size={20}
                color={isLiked ? C.red : C.white}
                fill={isLiked ? C.red : 'transparent'}
                strokeWidth={2}
              />
            )}
            <Text style={s.heroLikeCount}>{likeCount}</Text>
          </TouchableOpacity>

          <View style={[s.heroDiff, { backgroundColor: diffColor }]}>
            <Text style={s.heroDiffText}>{trek.difficulty}</Text>
          </View>
        </View>

        {/* Body */}
        <View style={s.body}>
          <Text style={s.trekTitle}>{trek.displayTitle || trek.parentName || 'Trek'}</Text>
          <Text style={s.trekParent}>{trek.parentName}</Text>

          {likeError && (
            <View style={s.likeErrorBox}>
              <Text style={s.likeErrorText}>
                Could not save that like. Check your connection and try again.
              </Text>
            </View>
          )}

          {/* Stats: Duration | Difficulty | Altitude */}
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Clock size={18} color={C.brand} strokeWidth={2} />
              <Text style={s.statVal}>{trek.durationDays ?? '—'} days</Text>
              <Text style={s.statLbl}>Duration</Text>
            </View>
            <View style={[s.statBox, s.statBoxBorder]}>
              <Mountain size={18} color={diffColor} strokeWidth={2} />
              <Text style={[s.statVal, { color: diffColor }]}>{trek.difficulty ?? '—'}</Text>
              <Text style={s.statLbl}>Difficulty</Text>
            </View>
            <View style={s.statBox}>
              <TrendingUp size={18} color={C.blue} strokeWidth={2} />
              <Text style={[s.statVal, { color: C.blue }]}>
                {(trek.maxAltitude ?? 0).toLocaleString()} m
              </Text>
              <Text style={s.statLbl}>Altitude</Text>
            </View>
          </View>

          {/* About */}
          {!!trek.description && (
            <>
              <Text style={s.heading}>About This Trek</Text>
              <Text style={s.description}>{trek.description}</Text>
            </>
          )}

          {/*
            What sets this route apart, in place of the day-by-day list that
            used to sit here. The full breakdown has its own screen behind
            "Generate Itinerary" below, so repeating it made the detail page
            long without telling the reader anything they could not get there.
          */}
          {highlights.length > 0 && (
            <>
              <Text style={s.heading}>Trek Highlights</Text>
              <View style={s.tagRow}>
                {highlights.map(tag => (
                  <View key={tag} style={s.tag}>
                    <Text style={s.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/*
            Every row is read straight off the catalogue entry or divided out of
            it — nothing here is estimated. The three tiles above are the glance;
            this is the reference, so it carries the facts they leave out.
          */}
          <Text style={s.heading}>Trip Facts</Text>
          <View style={s.factCard}>
            {facts.map((fact, i) => (
              <View key={fact.label} style={[s.factRow, i > 0 && s.factRowDivider]}>
                <Text style={s.factLabel}>{fact.label}</Text>
                <Text style={s.factValue} numberOfLines={2}>{fact.value}</Text>
              </View>
            ))}
          </View>

          {/*
            The altitude band this trek falls in, spelled out. The catalogue
            derives `difficulty` from `maxAltitude` alone (see `diff()` in
            `data/destinations.ts`), so the thresholds quoted here are the same
            ones that produced the badge on the photo — this explains that
            grading rather than adding a second opinion on top of it.
          */}
          <Text style={s.heading}>What to Expect</Text>
          <View style={s.expectCard}>
            <View style={s.expectIcon}>
              <Route size={16} color={C.brand} strokeWidth={2} />
            </View>
            <Text style={s.expectText}>{altitudeBriefing(trek)}</Text>
          </View>

          <View style={{ height: FOOTER_CLEARANCE }} />
        </View>
      </ScrollView>

      {/* Price + actions, pinned over the scrolling content. */}
      <View style={s.footerWrap}>
        <View style={s.footerBorder} />
        <View style={s.footerContent}>
          {/*
            Price and actions are stacked rather than side by side: two action
            buttons plus the price do not fit on one line on a narrow phone
            without shrinking the labels to the point of truncation.
          */}
          <View style={s.footerPriceRow}>
            <Text style={s.footerLabel}>Starting from</Text>
            <Text style={s.footerPrice}>NPR {(trek.priceNPR ?? 0).toLocaleString()}</Text>
          </View>
          <View style={s.footerActions}>
            {/*
              Sits beside Create Group rather than in the body: both are the
              "do something with this trek" actions, and the footer is where the
              user already looks for them. Secondary styling keeps Create Group
              the primary call to action.
            */}
            <TouchableOpacity
              onPress={() => router.push(`/trek/${trek.id}/itinerary`)}
              style={s.itineraryBtn}
              accessibilityRole="button"
              accessibilityLabel="Generate itinerary">
              <Text style={s.itineraryBtnText}>Generate Itinerary</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleCreateGroup}
              style={s.groupBtn}
              accessibilityRole="button"
              accessibilityLabel="Create Group">
              <Users size={18} color={C.white} strokeWidth={2} />
              <Text style={s.groupBtnText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <LoginPromptModal
        visible={loginPrompt}
        onClose={() => setLoginPrompt(false)}
        message={loginMessage}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  notFound: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: { color: C.white, fontSize: 18, marginBottom: 16 },
  backBtn: {
    backgroundColor: C.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: { color: C.white, fontWeight: '600' },

  /* Hero */
  heroWrap: { position: 'relative', height: 300 },
  heroImage: { width, height: 300 },
  heroScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  heroBackBtn: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLikeBtn: {
    position: 'absolute',
    top: 52,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 40,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  heroLikeBusy: { opacity: 0.7 },
  heroLikeCount: { color: C.white, fontSize: 13, fontWeight: '700' },

  likeErrorBox: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  likeErrorText: { color: C.red, fontSize: 12, lineHeight: 18 },
  heroDiff: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  heroDiffText: { color: C.white, fontSize: 12, fontWeight: '700' },

  /* Body */
  body: { paddingHorizontal: 20, paddingTop: 60 },
  trekTitle: { color: C.white, fontSize: 26, fontWeight: '700', lineHeight: 32 },
  trekParent: { color: C.textFaint, fontSize: 13, marginTop: 4, marginBottom: 16 },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 24,
    overflow: 'hidden',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  statBoxBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
  },
  statVal: { color: C.white, fontSize: 14, fontWeight: '700' },
  statLbl: { color: C.textFaint, fontSize: 11 },

  heading: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 4,
  },
  description: {
    color: C.textSub,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },

  /* Highlights */
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tag: {
    backgroundColor: 'rgba(15,82,56,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.4)',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  tagText: { color: C.brandLight, fontSize: 12, fontWeight: '600' },

  /* Trip facts */
  factCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
  },
  factRowDivider: { borderTopWidth: 1, borderTopColor: C.border },
  factLabel: { color: C.textFaint, fontSize: 13 },
  // Shrinks ahead of the label, so a long route name wraps instead of shoving
  // "Route" off its own row.
  factValue: {
    color: C.white, fontSize: 13, fontWeight: '600',
    flexShrink: 1, textAlign: 'right',
  },

  /* What to expect */
  expectCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
  },
  expectIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15,82,56,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expectText: { color: C.textSub, fontSize: 13, lineHeight: 20, flex: 1 },

  footerWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    /*
      Opaque, and painted by the footer itself. It used to have no background
      at all — a `BlurView` laid over it was the only thing separating the price
      and the two buttons from the trek photos scrolling underneath. `expo-blur`
      does not render reliably on Android, and where it degrades there is
      nothing left to paint the bar. See the matching note in `DrawerMenu`.
    */
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  footerBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  footerContent: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    paddingBottom: 28,
  },
  footerPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 12,
  },
  footerLabel: { color: C.textFaint, fontSize: 11 },
  footerPrice: { color: C.green, fontSize: 22, fontWeight: '700' },
  footerActions: { flexDirection: 'row', gap: 10 },
  itineraryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    borderRadius: 16,
  },
  itineraryBtnText: { color: C.textSub, fontSize: 15, fontWeight: '600' },
  groupBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.brand,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  groupBtnText: { color: C.white, fontSize: 15, fontWeight: '700' },
});
