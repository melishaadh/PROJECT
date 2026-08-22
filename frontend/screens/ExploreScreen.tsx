import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StatusBar,
  StyleSheet,
  RefreshControl,
  Platform,
} from 'react-native';
import { SlidersHorizontal, TrendingUp, X } from 'lucide-react-native';
import { router } from 'expo-router';
import Header from '@/components/Header';
import DrawerMenu from '@/components/DrawerMenu';
import TrekCard from '@/components/TrekCard';
import SearchBar from '@/components/SearchBar';
import FilterModal, { FilterState, DEFAULT_FILTERS } from '@/components/FilterModal';
import LoginPromptModal from '@/components/LoginPromptModal';
import { DESTINATIONS, Destination } from '@/data/destinations';
import { useAuth } from '@/context/AuthContext';
import { useLikes } from '@/hooks/useLikes';
import { fetchTrending, TrendingTrek } from '@/lib/recommendationApi';
import { searchTreksWithIntent } from '@/lib/trekSearch';
import { T, TREK_SURFACE } from '@/constants/testIDs';
import { C } from '@/constants/theme';

export default function ExploreScreen() {
  const { isLoggedIn, user } = useAuth();
  const { liked, countFor, isPending, toggleLike, reload: reloadLikes } = useLikes();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [trending, setTrending] = useState<TrendingTrek[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Trending Now is a members-only section. Guests never see it, and the
   * request is not even issued for them — the endpoint requires a JWT.
   */
  const loadTrending = useCallback(async () => {
    if (!isLoggedIn) {
      setTrending([]);
      return;
    }
    setTrending(await fetchTrending(3));
  }, [isLoggedIn]);

  useEffect(() => {
    let active = true;
    if (!isLoggedIn) {
      setTrending([]);
      return;
    }
    fetchTrending(3).then(t => {
      if (active) setTrending(t);
    });
    return () => {
      active = false;
    };
    // `user` is included so the board reloads when the account changes.
  }, [isLoggedIn, user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadLikes(), loadTrending()]);
    setRefreshing(false);
  }, [reloadLikes, loadTrending]);

  const handleLike = useCallback(
    async (id: string) => {
      const outcome = await toggleLike(id);
      if (outcome === 'unauthenticated') {
        setLoginMessage('Please log in to like a trek.');
        setLoginPrompt(true);
        return;
      }
      // A like changes the leaderboard, so refresh it for members. The store has
      // already rolled its own state back if the write failed.
      if (outcome === 'liked' || outcome === 'unliked') loadTrending();
    },
    [toggleLike, loadTrending]
  );

  /**
   * The search bar is members-only, so a session ending has to drop whatever
   * was typed — otherwise the guest catalogue below would stay filtered by a
   * query with no visible input to clear it.
   */
  useEffect(() => {
    if (!isLoggedIn) setSearch('');
  }, [isLoggedIn]);

  /**
   * Parse and run the query, then narrow by the explicit filters.
   *
   * The search resolves title, solo, gateway, duration and price intent and
   * decides the ordering (`cheap` → ascending, `expensive` → descending, a named
   * duration → nearest-first). `filter` preserves that order, so applying the
   * filter chips afterwards narrows the list without disturbing how it was
   * sorted.
   *
   * `relaxed` is deliberately not read. The engine still reports when it had to
   * loosen a query, but the screen no longer announces it: a banner saying
   * nothing matched exactly, sitting directly above a list of perfectly good
   * results, reads as an error report about results the user can plainly see.
   * The ordering already communicates closeness.
   */
  const { treks: searched } = useMemo(
    () => searchTreksWithIntent(DESTINATIONS, search),
    [search]
  );

  const filtered = useMemo(
    () =>
      searched.filter(t => {
        const matchDiff = filters.difficulty === 'All' || t.difficulty === filters.difficulty;
        const matchDur = t.durationDays <= filters.maxDuration;
        const matchPrice = t.priceNPR <= filters.maxPrice;
        return matchDiff && matchDur && matchPrice;
      }),
    [searched, filters]
  );

  const filtersActive =
    filters.difficulty !== DEFAULT_FILTERS.difficulty ||
    filters.maxDuration !== DEFAULT_FILTERS.maxDuration ||
    filters.maxPrice !== DEFAULT_FILTERS.maxPrice;

  const anythingActive = filtersActive || search.length > 0;

  const clearAll = useCallback(() => {
    setSearch('');
    setFilters(DEFAULT_FILTERS);
  }, []);

  /**
   * One handler for the whole list rather than an arrow per row.
   *
   * `TrekCard` is memoized and takes the trek id, so these two identities stay
   * stable across renders and only the cards whose own like state actually
   * changed re-render. Inline `onPress={() => …}` arrows defeated that entirely.
   */
  const openTrek = useCallback((trekId: string) => {
    router.push(`/trek/${trekId}`);
  }, []);

  const renderTrek = useCallback(
    ({ item }: { item: Destination }) => (
      <TrekCard
        trek={item}
        surface={TREK_SURFACE.explore}
        isLiked={liked.has(item.id)}
        likeCount={countFor(item.id)}
        likePending={isPending(item.id)}
        onLike={handleLike}
        onPress={openTrek}
      />
    ),
    [liked, countFor, isPending, handleLike, openTrek]
  );

  const keyExtractor = useCallback((item: Destination) => item.id, []);

  return (
    <View style={s.root} testID={T.explore.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Header onMenuPress={() => setDrawerOpen(true)} />

      {/*
        Search & Filter.

        Members only. A guest has no session, so every action the search leads
        to — liking a route, opening a personalised feed — would immediately
        bounce them to a login prompt; showing the field at all just invites a
        dead end. Guests browse the full catalogue below instead.

        There is deliberately no example placeholder and no row of preset
        filter pills beneath the field: the query itself is the filter, and the
        chips duplicated what the search already understood.
      */}
      {isLoggedIn && (
        <View style={s.searchRow}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search treks"
            testID={T.explore.search}
          />
          <TouchableOpacity
            onPress={() => setFilterOpen(true)}
            style={[s.filterBtn, filtersActive && s.filterBtnActive]}
            accessibilityRole="button"
            accessibilityLabel="Open filters">
            <SlidersHorizontal
              size={20}
              color={filtersActive ? C.white : C.textFaint}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        testID={T.explore.list}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.list, !isLoggedIn && s.listGuest]}
        /*
          Virtualization budget.

          Cards are image-heavy, so the cost that matters is how many decode at
          once rather than how many exist. Two screens of cells ahead and behind
          is enough that scrolling never reaches a blank cell, while an initial
          batch of four keeps the first paint to what actually fits on screen.
          `removeClippedSubviews` is off on web, where it detaches nodes the
          browser was compositing perfectly well and causes flicker instead.
        */
        initialNumToRender={4}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'web'}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} />
        }
        ListHeaderComponent={
          <>
            {/* Trending Now — members only */}
            {isLoggedIn && trending.length > 0 && (
              <View style={s.section}>
                <View style={s.trendingHeader}>
                  <TrendingUp size={16} color={C.brand} strokeWidth={2.5} />
                  <Text style={s.sectionTitle}>Trending Now</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {trending.map(({ trek, likes }) => (
                    <TrekCard
                      key={trek.id}
                      trek={trek}
                      compact
                      surface={TREK_SURFACE.trending}
                      isLiked={liked.has(trek.id)}
                      // Prefer the shared store's count (it reflects an
                      // in-progress optimistic update); the leaderboard's own
                      // figure covers the moment before counts have loaded.
                      likeCount={countFor(trek.id) || likes}
                      likePending={isPending(trek.id)}
                      onLike={handleLike}
                      onPress={openTrek}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={s.discoverHeader}>
              <Text style={s.sectionTitle}>Discover Treks</Text>
              <View style={s.discoverRight}>
                <Text style={s.resultCount}>
                  {filtered.length} {filtered.length === 1 ? 'trek' : 'treks'}
                </Text>
                {anythingActive && (
                  <TouchableOpacity
                    onPress={clearAll}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search and filters"
                    style={s.clearChip}>
                    <X size={12} color={C.textSub} strokeWidth={2.5} />
                    <Text style={s.clearChipText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        }
        renderItem={renderTrek}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>No treks match your search.</Text>
            <TouchableOpacity style={s.clearBtn} onPress={clearAll}>
              <Text style={s.clearBtnText}>Clear filters</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <FilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
        current={filters}
      />
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
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },

  list: { paddingHorizontal: 16, paddingBottom: 120 },
  /**
   * Guest spacing.
   *
   * The search row is members-only, and it was the only thing providing a gap
   * between the header's bottom border and the "Discover Treks" heading. With it
   * hidden the heading sat flush against the border, touching the chrome. This
   * restores exactly the space the search row occupied (12 top padding + a 46pt
   * field + 12 bottom) so the guest layout has the same rhythm as the member one
   * rather than a different value that happens to look close.
   */
  listGuest: { paddingTop: 12 + 46 + 12 },
  section: { marginBottom: 20 },
  trendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
  sectionTitle: {
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
  },
  discoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  discoverRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultCount: { color: C.textFaint, fontSize: 12 },
  clearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: C.border,
  },
  clearChipText: { color: C.textSub, fontSize: 11, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { color: C.textFaint, fontSize: 15, marginBottom: 16 },
  clearBtn: {
    backgroundColor: C.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  clearBtnText: { color: C.white, fontWeight: '600' },
});
