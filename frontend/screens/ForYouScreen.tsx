import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Sparkles, SlidersHorizontal, LogIn } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import Header from '@/components/Header';
import DrawerMenu from '@/components/DrawerMenu';
import TrekCard from '@/components/TrekCard';
import PreferencesSheet from '@/components/PreferencesSheet';
import { T, TREK_SURFACE } from '@/constants/testIDs';
import { useAuth } from '@/context/AuthContext';
import { useLikes } from '@/hooks/useLikes';
import { subscribeToLikeChanges } from '@/lib/likesStore';
import {
  queueSignal,
  flushSignals,
  MIN_TRACKED_DWELL_MS,
  DISMISS_AFTER_GLANCES,
} from '@/lib/signalsService';
import { fetchForYouFeed, ForYouFeed } from '@/lib/recommendationApi';
import { Destination } from '@/data/destinations';
import { C, TAB_BAR_SPACE } from '@/constants/theme';

/**
 * Strip completed treks from a feed payload.
 *
 * The backend already excludes them at the query level, so this is a guard
 * rather than the mechanism — it exists for the one case the server cannot
 * cover: a response that was computed *before* the trek was marked complete.
 * Returns the payload unchanged when there is nothing to remove, so applying it
 * never costs a re-render.
 */
function withoutCompleted(feed: ForYouFeed, completed: ReadonlySet<string>): ForYouFeed {
  if (completed.size === 0) return feed;
  const recommended = feed.recommended.filter(trek => !completed.has(trek.id));
  return recommended.length === feed.recommended.length ? feed : { ...feed, recommended };
}

/**
 * The personalised feed.
 *
 * Four deliberate absences, all for the same reason — this screen is a feed,
 * not a browser:
 *
 *   · **No search bar.** Searching a curated selection of a dozen routes is
 *     searching the wrong thing; Explore is where you search the catalogue.
 *   · **No filter pills.** The feed *is* the filter. A second, contradictory
 *     set of controls on top of the engine's ranking only fights it.
 *   · **No affinity chips.** The engine still learns a dominant region, price
 *     tier and typical trip length, but the feed no longer prints them under the
 *     preference control. Restating the ranking in words directly above the
 *     ranking added a row that looked tappable, wasn't, and told the reader
 *     nothing the list below did not already show them.
 *   · **No "n treks hidden" notice.** The safety matrix drops routes that are
 *     unsafe for the user's health profile. Advertising a count of them invites
 *     the reader to go looking for what they are being protected from, and
 *     there is no action they can take about it here.
 *
 * Preferences open as a sheet over this screen rather than as a route push, so
 * interacting with them never navigates away — see `PreferencesSheet`.
 *
 * The feed re-ranks on every confirmed like anywhere in the app, so it is never
 * something the user has to refresh by hand — see the `subscribeToLikeChanges`
 * effect below.
 *
 * A trek marked complete on the profile screen leaves this feed on the same
 * frame — see the completed-trek effect below.
 */
export default function ForYouScreen() {
  const { user, profile, loading, isLoggedIn } = useAuth();
  const { liked, countFor, isPending, toggleLike, reload: reloadLikes } = useLikes();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feed, setFeed] = useState<ForYouFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);

  /** True once a feed has arrived, so a re-rank doesn't flash the spinner. */
  const hasLoadedRef = useRef(false);
  /** Guards against a stale response overwriting a newer one. */
  const requestIdRef = useRef(0);
  /**
   * The user's completed treks, readable from inside `loadFeed`.
   *
   * A response can be *newer* than the profile write that produced it — the
   * request may have been issued a moment before the trek was marked complete,
   * in which case the server ranked it legitimately and the ticket guard has no
   * way to tell. Screening every applied response through this ref closes that
   * window: a completed route cannot reach the list from any path.
   */
  const completedIdsRef = useRef<ReadonlySet<string>>(new Set());

  /** The completed-trek list, as a set and as a change signature. */
  const completedTrekIds = profile?.completedTrekIds;
  const completedKey = useMemo(() => (completedTrekIds ?? []).join('|'), [completedTrekIds]);
  const completedSet = useMemo(
    () => new Set(completedTrekIds ?? []),
    // Keyed on the signature, not the array: `AuthContext` returns a fresh array
    // on every profile write, including edits that have nothing to do with treks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completedKey]
  );
  useEffect(() => {
    completedIdsRef.current = completedSet;
  }, [completedSet]);

  /**
   * Fetch and apply the feed.
   *
   * Every call takes a ticket; only the newest one is allowed to write state.
   * Liking two treks quickly fires two re-ranks, and without this the slower
   * response could land last and undo the newer ranking.
   */
  const loadFeed = useCallback(async (showSpinner: boolean) => {
    const ticket = ++requestIdRef.current;
    if (showSpinner) setFeedLoading(true);
    try {
      const next = await fetchForYouFeed();
      if (ticket !== requestIdRef.current) return;
      if (next) {
        hasLoadedRef.current = true;
        setFeed(withoutCompleted(next, completedIdsRef.current));
      }
      // A null result means unauthenticated or unreachable. Keep whatever is
      // already rendered rather than blanking a feed the user is reading.
    } finally {
      if (ticket === requestIdRef.current) setFeedLoading(false);
    }
  }, []);

  /**
   * Load on mount and re-rank on every refocus, so a preference change or a
   * like registered elsewhere in the app is reflected on return.
   */
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        hasLoadedRef.current = false;
        requestIdRef.current++;
        setFeed(null);
        return;
      }
      // Spinner only for the first load; a refocus re-rank replaces the list
      // in place instead of blanking what the user is already looking at.
      void loadFeed(!hasLoadedRef.current);
    }, [user, loadFeed])
  );

  /**
   * Zero-refresh reactivity.
   *
   * Any confirmed like or unlike — from this feed, from Explore, from the trek
   * detail screen, from anywhere — re-ranks the recommendation matrix in the
   * background. This is what makes the adaptation visible: the backend recomputes
   * region, price and duration affinity from the user's like history on every
   * request, so liking a second Everest route pulls the remaining Khumbu routes
   * up the feed immediately, with no pull-to-refresh and no tab switch.
   *
   * Subscribing to the store rather than reloading from the like handler is what
   * covers the other screens: previously a like registered on Explore left this
   * feed ranked against stale history until it happened to be refocused. The
   * store only fires this once the write has been confirmed, so a failed like
   * re-ranks against unchanged history — i.e. does nothing — as it should.
   *
   * `showSpinner` is false throughout: the list is replaced in place rather than
   * blanked, so a background re-rank never flashes away what the user is reading.
   */
  useEffect(() => {
    if (!user) return;
    return subscribeToLikeChanges(() => {
      void loadFeed(false);
    });
  }, [user, loadFeed]);

  /**
   * ── Completed treks leave the feed immediately ───────────────────────────
   *
   * Marking a trek complete on the profile screen is a statement that it is no
   * longer a recommendation, and the backend enforces that absolutely: the id is
   * excluded from the candidate set with a Mongo `$nin` before anything is
   * scored, and `user:<id>` cache invalidation means the very next request
   * reflects it. What this effect adds is the client half — the feed the user is
   * *currently looking at* must not keep showing the route until something
   * happens to refetch it.
   *
   * Two steps, in this order:
   *   1. Drop the completed routes from the rendered list synchronously, so the
   *      card is gone on the same frame the profile write resolves.
   *   2. Re-rank in the background, because completing a trek changes more than
   *      one row: it feeds `learnAffinity` and the progression layer, so the
   *      whole ranking moves, not just the removed card.
   *
   * The trigger is the joined id list rather than the array, since
   * `AuthContext` hands back a fresh array on every profile write and the
   * identity alone would re-fetch on unrelated edits (a bio, a display name).
   * The first run is skipped: the focus effect above already owns the initial
   * load, and firing here too would double every mount.
   */
  const lastCompletedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      lastCompletedKeyRef.current = null;
      return;
    }
    if (lastCompletedKeyRef.current === null) {
      lastCompletedKeyRef.current = completedKey;
      return;
    }
    if (lastCompletedKeyRef.current === completedKey) return;
    lastCompletedKeyRef.current = completedKey;

    setFeed(current => (current ? withoutCompleted(current, completedSet) : current));
    void loadFeed(false);
  }, [user, completedKey, completedSet, loadFeed]);

  /**
   * ── Passive engagement tracking ──────────────────────────────────────────
   *
   * `onViewableItemsChanged` fires as cards enter and leave the viewport.
   * Entering starts a clock; leaving reports how long the card was actually on
   * screen. That dwell is the "lingering interest" signal — a card read for
   * eight seconds means something a card that flashed past does not.
   *
   * A card seen repeatedly, always briefly, and never liked is recorded as a
   * dismissal: the user has now scrolled past it several times and made a
   * choice, even if a passive one. Liked cards are exempt — an explicit
   * positive must never be read as a negative just because the card is small.
   */
  const viewStartedAt = useRef(new Map<string, number>());
  const glanceCount = useRef(new Map<string, number>());
  // Mirrors `liked` into a ref, because the viewability handler below has to be
  // referentially stable for the list's lifetime and would otherwise close over
  // whichever like set existed at mount.
  const likedRef = useRef(liked);
  useEffect(() => { likedRef.current = liked; }, [liked]);

  const handleViewableChanged = useRef(
    ({ changed }: { changed: { key?: string; item?: Destination; isViewable: boolean }[] }) => {
      const now = Date.now();
      for (const entry of changed) {
        const id = entry.item?.id ?? entry.key;
        if (!id) continue;

        if (entry.isViewable) {
          viewStartedAt.current.set(id, now);
          continue;
        }

        const startedAt = viewStartedAt.current.get(id);
        if (startedAt === undefined) continue;
        viewStartedAt.current.delete(id);

        const dwell = now - startedAt;
        queueSignal(id, 'view', dwell);

        if (dwell < MIN_TRACKED_DWELL_MS) {
          const glances = (glanceCount.current.get(id) ?? 0) + 1;
          glanceCount.current.set(id, glances);
          // `likedRef` rather than `liked` so this stable handler always reads
          // the current like set instead of the one captured at mount.
          if (glances >= DISMISS_AFTER_GLANCES && !likedRef.current.has(id)) {
            queueSignal(id, 'dismiss');
            glanceCount.current.set(id, 0);
          }
        }
      }
    }
  ).current;

  // RN requires this to be referentially stable for the lifetime of the list.
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 55,
    minimumViewTime: 250,
  }).current;

  // Flush whatever is queued when the screen loses focus, so a session's
  // signals are not stranded in memory until the next timer tick.
  useFocusEffect(
    useCallback(() => () => { void flushSignals(); }, [])
  );

  const handleLike = useCallback(
    async (id: string) => {
      // A like retires any dismissal pressure this card had built up.
      glanceCount.current.set(id, 0);
      // The re-rank is driven by the store subscription above, so there is
      // deliberately nothing to do here beyond the write itself — doing both
      // would fire two identical fetches per tap.
      await toggleLike(id);
    },
    [toggleLike]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadLikes(), user ? loadFeed(false) : Promise.resolve()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadLikes, user, loadFeed]);

  /**
   * The curated window the backend engine returned.
   *
   * At cold start this is the onboarding profile plus the DOB-derived age
   * bracket, resolved through a deterministic fallback cascade so it is never
   * empty and never the raw catalogue. As likes accumulate it slides onto
   * learned region/price/duration affinity and then collaborative signal.
   */
  const visible = useMemo(() => feed?.recommended ?? [], [feed]);

  /** Why each surfaced trek is here, keyed by id — rendered as a card chip. */
  const reasons = useMemo(() => feed?.reasons ?? {}, [feed]);

  /**
   * One handler for the whole list, so the memoized cards only re-render when
   * their own like state changes. See `TrekCard`.
   */
  const openTrek = useCallback((trekId: string) => {
    router.push(`/trek/${trekId}`);
  }, []);

  const renderTrek = useCallback(
    ({ item }: { item: Destination }) => (
      <TrekCard
        trek={item}
        surface={TREK_SURFACE.forYou}
        reason={reasons[item.id]}
        isLiked={liked.has(item.id)}
        likeCount={countFor(item.id)}
        likePending={isPending(item.id)}
        onLike={handleLike}
        onPress={openTrek}
      />
    ),
    [liked, countFor, isPending, handleLike, openTrek, reasons]
  );

  const keyExtractor = useCallback((item: Destination) => item.id, []);

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Header onMenuPress={() => setDrawerOpen(true)} />
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
        <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </View>
    );
  }

  // Signed-out visitors get a clear explanation instead of an unpersonalized
  // dump of the whole catalogue — For You means nothing without a profile.
  if (!isLoggedIn) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Header onMenuPress={() => setDrawerOpen(true)} />
        <View style={s.gateState}>
          <View style={s.gateIcon}>
            <Sparkles size={32} color={C.brand} strokeWidth={2} />
          </View>
          <Text style={s.gateTitle}>Your personalized feed</Text>
          <Text style={s.gateSub}>
            Sign in and complete your trek profile to get routes matched to your fitness,
            experience and altitude history — with unsafe routes filtered out.
          </Text>
          <TouchableOpacity onPress={() => router.push('/login')} style={s.gateCta}>
            <LogIn size={16} color={C.white} strokeWidth={2} />
            <Text style={s.gateCtaText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/signup')} style={s.gateSecondary}>
            <Text style={s.gateSecondaryText}>Create Account</Text>
          </TouchableOpacity>
        </View>
        <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </View>
    );
  }

  return (
    <View style={s.root} testID={T.forYou.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Header onMenuPress={() => setDrawerOpen(true)} />

      <View style={s.summaryRow}>
        <View style={s.summaryLeft}>
          <Sparkles size={16} color={C.brand} strokeWidth={2} />
          <Text style={s.summaryText}>
            {visible.length} {visible.length === 1 ? 'Trek' : 'Treks'}
          </Text>
          {feedLoading && <ActivityIndicator size="small" color={C.brand} />}
        </View>

        {/*
          Opens a sheet over this screen. Deliberately not a route push: the
          feed stays mounted underneath and re-ranks in place on save, so
          editing preferences never takes the user off the For You tab.
        */}
        <TouchableOpacity
          onPress={() => setPrefsOpen(true)}
          testID={T.forYou.openPreferences}
          style={s.actionBtn}
          accessibilityRole="button"
          accessibilityLabel="Edit trek preferences">
          <SlidersHorizontal size={15} color={C.textFaint} strokeWidth={2} />
          <Text style={s.actionText}>Preferences</Text>
        </TouchableOpacity>
      </View>

      {/*
        No list header.

        The "learning from your likes" chips that sat here — the region, price
        tier and duration summary rendered as pills with a trend arrow, e.g.
        "↗ Annapurna · Budget-friendly · ~7 days" — are gone. They restated what
        the ranking below already expresses, directly under the preference
        control, and read as a second row of filters that could not be tapped.
        The engine still computes the affinity; the feed just no longer narrates
        it.
      */}
      <FlatList
        data={visible}
        keyExtractor={keyExtractor}
        testID={T.forYou.list}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} />
        }
        /* Same virtualization budget as Explore — see the note there. */
        initialNumToRender={4}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'web'}
        onViewableItemsChanged={handleViewableChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={renderTrek}
        ListEmptyComponent={
          feedLoading ? (
            <View style={s.centerState}>
              <ActivityIndicator size="large" color={C.brand} />
            </View>
          ) : (
            <View style={s.empty} testID={T.forYou.empty}>
              <Text style={s.emptyText}>
                No recommendations yet — set your trek preferences to get started.
              </Text>
              <TouchableOpacity style={s.clearBtn} onPress={() => setPrefsOpen(true)}>
                <Text style={s.clearBtnText}>Set preferences</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />

      <PreferencesSheet
        visible={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        onSaved={() => loadFeed(false)}
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },

  /* Centred in the space above the floating tab bar — see `TAB_BAR_SPACE`. */
  gateState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: TAB_BAR_SPACE,
  },
  gateIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(15,82,56,0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  gateTitle: { color: C.white, fontSize: 19, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  gateSub: { color: C.textFaint, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  gateCta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.brand, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14,
  },
  gateCtaText: { color: C.white, fontSize: 15, fontWeight: '700' },
  gateSecondary: {
    marginTop: 12, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  gateSecondaryText: { color: C.textSub, fontSize: 15, fontWeight: '600' },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { color: C.white, fontSize: 14, fontWeight: '600' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  actionText: { color: C.textFaint, fontSize: 12, fontWeight: '500' },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyText: { color: C.textFaint, fontSize: 15, marginBottom: 16, textAlign: 'center', lineHeight: 22 },
  clearBtn: {
    backgroundColor: C.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  clearBtnText: { color: C.white, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
});
