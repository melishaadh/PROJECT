import React, { useEffect, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import {
  Mountain,
  Sparkles,
  MessageSquare,
  Compass,
  ArrowRight,
  Heart,
  TrendingUp,
  Clock,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { DESTINATIONS } from '@/data/destinations';
import { fetchPublicTrending, TrendingTrek } from '@/lib/recommendationApi';
import { setGuestMode } from '@/lib/guestMode';
import { C, DIFFICULTY_COLOR } from '@/constants/theme';
import { T } from '@/constants/testIDs';

const { width } = Dimensions.get('window');

/**
 * Feature strip.
 *
 * Titles only — the explanatory sub-paragraph under each one has been dropped.
 * Four stacked blocks of body copy is a wall of text on a phone, and none of it
 * said anything the title did not already carry. What is left reads as a scan
 * rather than a document, which is what a landing page is for.
 */
const FEATURES = [
  { icon: Sparkles, title: 'Adaptive recommendations' },
  { icon: MessageSquare, title: 'Group chat for every expedition' },
  { icon: Compass, title: '30 Himalayan routes, mapped day by day' },
];

/**
 * What the five onboarding questions actually ask for.
 *
 * The closing card used to end in a "Create free account" button and an
 * "Already a member? Log In" link — both of which the hero already offers a
 * screen higher up. Repeating them added nothing; showing what the profile is
 * built from answers the only question a reader still has at that point.
 */
const PROFILE_INPUTS = ['Fitness', 'Experience', 'Altitude history', 'Budget', 'Trip length'];

/** Hero backdrop. Fixed so the page opens on a stable image, not a flash. */
const HERO_TREK = DESTINATIONS.find(d => d.id === '8') ?? DESTINATIONS[0];

export default function LandingScreen() {
  const [trending, setTrending] = useState<TrendingTrek[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  /**
   * "Popular Right Now" reads the same live leaderboard the signed-in Explore
   * tab renders as "Trending Now" — the identical like aggregation, just via the
   * public endpoint — so the two can never disagree.
   */
  useEffect(() => {
    let active = true;
    fetchPublicTrending(5).then(t => {
      if (!active) return;
      setTrending(t);
      setTrendingLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Opt out of the auth gate for this session and go straight to Explore. */
  const browseAsGuest = () => {
    setGuestMode(true);
    router.replace('/(tabs)');
  };

  /** Previewing a trek is also guest browsing — don't bounce back to landing. */
  const previewTrek = (trekId: string) => {
    setGuestMode(true);
    router.push(`/trek/${trekId}`);
  };

  return (
    <View style={s.root} testID={T.landing.screen}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <View style={s.hero}>
          <Image source={HERO_TREK?.image} style={s.heroImage} resizeMode="cover" />
          {/* Two stacked scrims: one darkens the photo, one blends it into the
              page background so the hero has no visible seam. */}
          <LinearGradient
            colors={['rgba(18,18,18,0.20)', 'rgba(18,18,18,0.72)', 'rgba(18,18,18,0.97)', C.bg]}
            locations={[0, 0.45, 0.82, 1]}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(15,82,56,0.34)', 'transparent']}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={s.heroContent}>
            <View style={s.brandRow}>
              <View style={s.brandIcon}>
                <Mountain size={32} color={C.white} strokeWidth={2.5} />
              </View>
              <Text style={s.brandName}>TrekEasy</Text>
            </View>

            <Text style={s.heroTitle}>
              The Himalayas,{'\n'}matched to you.
            </Text>
            <Text style={s.heroSub}>
              A feed that learns what you actually like, a live trending board and group
              chats for every expedition, built around your fitness and safety profile.
            </Text>

            <View style={s.ctaRow}>
              <TouchableOpacity
                onPress={() => router.push('/signup')}
                style={s.primaryCta}
                testID={T.landing.getStarted}
                accessibilityRole="button"
                accessibilityLabel="Sign up for TrekEasy">
                <Text style={s.primaryCtaText}>Get Started</Text>
                <ArrowRight size={17} color={C.white} strokeWidth={2.5} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/login')}
                style={s.secondaryCta}
                testID={T.landing.logIn}
                accessibilityRole="button"
                accessibilityLabel="Log in to TrekEasy">
                <Text style={s.secondaryCtaText}>Log In</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={browseAsGuest}
              style={s.browseLink}
              testID={T.landing.browseGuest}
              accessibilityRole="button"
              accessibilityLabel="Browse treks without an account">
              <Text style={s.browseLinkText}>Browse treks as a guest</Text>
              <ArrowRight size={13} color={C.textFaint} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </View>

        {/*
          Trending Now — the same live leaderboard the signed-in Explore tab
          renders under the same heading, resolved through the identical like
          aggregation via the public endpoint. Matching the wording as well as
          the data is the point: a visitor who signs up should recognise the
          section they were just looking at, not wonder why "Popular right now"
          became something else.
        */}
        <View style={s.popularHeader}>
          <View style={s.popularTitleRow}>
            <View style={s.popularIcon}>
              <TrendingUp size={15} color={C.brand} strokeWidth={2.5} />
            </View>
            <Text style={s.popularTitle}>Trending Now</Text>
          </View>
        </View>

        {trendingLoading ? (
          <View style={s.trendingLoading}>
            <ActivityIndicator size="small" color={C.brand} />
          </View>
        ) : trending.length === 0 ? (
          <View style={s.trendingEmpty}>
            <Text style={s.trendingEmptyText}>
              The leaderboard is warming up — be the first to like a route.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.showcaseRow}>
            {trending.map(({ trek, likes }, index) => (
              <TouchableOpacity
                key={trek.id}
                activeOpacity={0.88}
                onPress={() => previewTrek(trek.id)}
                style={s.showcaseCard}
                accessibilityRole="button"
                accessibilityLabel={`View ${trek.displayTitle}`}>
                <Image source={trek.image} style={s.showcaseImage} resizeMode="cover" />
                <LinearGradient
                  colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.88)']}
                  locations={[0, 0.38, 1]}
                  style={StyleSheet.absoluteFill}
                />

                <View style={s.rankBadge}>
                  <Text style={s.rankBadgeText}>{index + 1}</Text>
                </View>
                <View
                  style={[
                    s.showcaseDiff,
                    { backgroundColor: DIFFICULTY_COLOR[trek.difficulty] ?? C.textFaint },
                  ]}>
                  <Text style={s.showcaseDiffText}>{trek.difficulty}</Text>
                </View>

                <View style={s.showcaseBody}>
                  <Text style={s.showcaseName} numberOfLines={2}>
                    {trek.displayTitle}
                  </Text>
                  <View style={s.showcaseMeta}>
                    <Heart size={12} color={C.red} fill={C.red} strokeWidth={2} />
                    <Text style={s.showcaseMetaText}>{likes}</Text>
                    <Text style={s.showcaseDot}>·</Text>
                    <Clock size={11} color="rgba(255,255,255,0.75)" strokeWidth={2} />
                    <Text style={s.showcaseMetaText}>{trek.durationDays}d</Text>
                    <Text style={s.showcaseDot}>·</Text>
                    <Text style={s.showcaseMetaText}>
                      {trek.maxAltitude.toLocaleString()}m
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* ── Features ─────────────────────────────────────────────────── */}
        <Text style={s.sectionEyebrow}>What you get</Text>
        <Text style={s.sectionTitle}>Everything for the next expedition</Text>

        <View style={s.featureList}>
          {FEATURES.map(({ icon: Icon, title }) => (
            <View key={title} style={s.featureCard}>
              <View style={s.featureIcon}>
                <Icon size={20} color={C.brand} strokeWidth={2} />
              </View>
              <Text style={s.featureTitle}>{title}</Text>
            </View>
          ))}
        </View>

        {/* ── Closing CTA ──────────────────────────────────────────────── */}
        <View style={s.closingCard}>
          <LinearGradient
            colors={['rgba(15,82,56,0.28)', 'rgba(15,82,56,0.05)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.closingIcon}>
            <Sparkles size={24} color={C.brandLight} strokeWidth={2} />
          </View>
          <Text style={s.closingTitle}>Build your trek profile</Text>
          <Text style={s.closingBody}>
            Answer five quick questions and your feed reorders itself around your fitness,
            experience and altitude history, then keeps adapting as you explore.
          </Text>
          <View style={s.closingChips}>
            {PROFILE_INPUTS.map(label => (
              <View key={label} style={s.closingChip}>
                <Text style={s.closingChipText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const HERO_HEIGHT = Math.min(Math.max(width * 1.05, 480), 620);

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingBottom: 24 },

  /* Hero */
  hero: { height: HERO_HEIGHT, justifyContent: 'flex-end' },
  heroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroContent: { paddingHorizontal: 26, paddingBottom: 30 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  /* The mark was drawn in `C.brand` — a near-black green — inside a translucent
     green tile, over a dark photo. Three dark greens on top of each other is a
     mark nobody can see. It is white on a solid brand tile now, which is the
     only combination that survives whatever the hero image happens to be. */
  brandIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: C.brand,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { color: C.white, fontSize: 33, fontWeight: '700', letterSpacing: 0.4 },
  heroTitle: {
    color: C.white,
    fontSize: 38,
    fontWeight: '700',
    lineHeight: 43,
    letterSpacing: -0.6,
    marginBottom: 14,
  },
  heroSub: {
    color: C.textSub,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 26,
    maxWidth: 480,
  },
  ctaRow: { flexDirection: 'row', gap: 12 },
  primaryCta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.brand,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryCtaText: { color: C.white, fontSize: 15, fontWeight: '700' },
  secondaryCta: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryCtaText: { color: C.white, fontSize: 15, fontWeight: '600' },
  browseLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginTop: 18,
    paddingVertical: 6,
  },
  browseLinkText: { color: C.textFaint, fontSize: 13, fontWeight: '500' },

  /* Sections */
  sectionEyebrow: {
    color: C.brandLight,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 44,
    marginHorizontal: 22,
    marginBottom: 8,
  },
  sectionTitle: {
    color: C.white,
    fontSize: 24,
    fontWeight: '700',
    marginHorizontal: 22,
    marginBottom: 20,
  },

  /* Popular right now */
  popularHeader: { marginTop: 30, marginHorizontal: 22, marginBottom: 16 },
  popularTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  popularIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(15,82,56,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularTitle: { color: C.white, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  trendingLoading: { paddingVertical: 60, alignItems: 'center' },
  trendingEmpty: {
    marginHorizontal: 22,
    paddingVertical: 26,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  trendingEmptyText: { color: C.textFaint, fontSize: 13, lineHeight: 20, textAlign: 'center' },

  /* Features — title-only rows, so they read as a scannable list. */
  featureList: { paddingHorizontal: 22, gap: 10 },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(15,82,56,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: { color: C.white, fontSize: 15, fontWeight: '600', flex: 1, lineHeight: 21 },

  /* Showcase */
  showcaseRow: { paddingHorizontal: 22, gap: 13 },
  showcaseCard: {
    width: Math.min(width * 0.6, 268),
    height: 208,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  showcaseImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  rankBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15,82,56,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: { color: C.white, fontSize: 12, fontWeight: '700' },
  showcaseDiff: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  showcaseDiffText: { color: C.white, fontSize: 10, fontWeight: '700' },
  showcaseBody: { position: 'absolute', left: 14, right: 14, bottom: 14 },
  showcaseName: { color: C.white, fontSize: 15, fontWeight: '700', lineHeight: 19 },
  showcaseMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  showcaseMetaText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '500' },
  showcaseDot: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },

  /* Closing */
  closingCard: {
    marginHorizontal: 22,
    marginTop: 44,
    padding: 26,
    borderRadius: 22,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(25,122,83,0.30)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  closingIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(15,82,56,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(25,122,83,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  closingTitle: { color: C.white, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  closingBody: {
    color: C.textSub,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 18,
  },
  closingChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  closingChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(15,82,56,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(25,122,83,0.42)',
  },
  closingChipText: { color: C.brandLight, fontSize: 12, fontWeight: '700' },
  closingFootnote: {
    color: C.textFaint,
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
});
