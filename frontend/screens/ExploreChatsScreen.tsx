import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MessageSquare, LogIn, SlidersHorizontal } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import Header from '@/components/Header';
import DrawerMenu from '@/components/DrawerMenu';
import SearchBar from '@/components/SearchBar';
import ChatGroupCard from '@/components/ChatGroupCard';
import ChatFilterModal, { ChatFilterState, DEFAULT_CHAT_FILTERS } from '@/components/ChatFilterModal';
import { useAuth } from '@/context/AuthContext';
import { listChatRooms, joinChatRoom, ChatRoom, ChatRoomFilters } from '@/lib/chatService';
import { C, TAB_BAR_SPACE } from '@/constants/theme';

function toApiFilters(search: string, chips: ChatFilterState): ChatRoomFilters {
  return {
    search: search.trim() || undefined,
    difficulty: chips.difficulty !== 'All' ? (chips.difficulty as ChatRoomFilters['difficulty']) : undefined,
    durationDays: chips.maxDuration !== DEFAULT_CHAT_FILTERS.maxDuration ? chips.maxDuration : undefined,
    capacity: chips.minOpenSpots > 0 ? chips.minOpenSpots : undefined,
  };
}

/**
 * Discovery-only: find and join expeditions other trekkers have started.
 * Starting one of your own happens from a trek's own page ("Create Group"),
 * not from here — see `NewExpeditionScreen`.
 */
export default function ExploreChatsScreen() {
  const { isLoggedIn } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [chipFilters, setChipFilters] = useState<ChatFilterState>(DEFAULT_CHAT_FILTERS);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [banner, setBanner] = useState('');

  const apiFilters = useMemo(() => toApiFilters(search, chipFilters), [search, chipFilters]);

  const loadRooms = useCallback(async (filters: ChatRoomFilters, showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    else setRefreshing(true);
    const next = await listChatRooms(filters);
    setRooms(next);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Reload whenever the tab regains focus, so a group created elsewhere shows
  // up without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) {
        setRooms([]);
        setLoading(false);
        return;
      }
      loadRooms(apiFilters, true);
      // Filters intentionally excluded: focus should reload with whatever is
      // currently applied, not re-trigger every time a filter changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoggedIn, loadRooms]),
  );

  // Debounced so search-as-you-type and filter changes don't fire a request
  // per keystroke — 300ms is short enough to feel live, long enough to
  // collapse a fast typist's keystrokes into one request.
  useEffect(() => {
    if (!isLoggedIn) return;
    const t = setTimeout(() => loadRooms(apiFilters, false), 300);
    return () => clearTimeout(t);
  }, [apiFilters, isLoggedIn, loadRooms]);

  const openRoom = (roomId: string) => router.push(`/chat/${roomId}`);

  const handleJoin = async (room: ChatRoom) => {
    if (joiningId) return;
    setJoiningId(room.id);
    setBanner('');
    const { room: joined, error } = await joinChatRoom(room.id);
    setJoiningId(null);
    // Joining is the whole point of this screen — land the user straight in
    // the thread rather than leaving them to find it themselves.
    if (joined) openRoom(joined.id);
    else setBanner(error ?? 'Could not join the group.');
  };

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

  if (!isLoggedIn) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Header onMenuPress={() => setDrawerOpen(true)} />
        <View style={s.gateState}>
          <View style={s.gateIcon}>
            <MessageSquare size={30} color={C.brand} strokeWidth={2} />
          </View>
          <Text style={s.gateTitle}>Explore group chats</Text>
          <Text style={s.gateSub}>
            Sign in to discover expeditions other trekkers are organizing, and
            join the ones you want in on.
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
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Header onMenuPress={() => setDrawerOpen(true)} />

      <View style={s.searchRow}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search chats, destinations..."
        />
        <TouchableOpacity
          onPress={() => setFilterOpen(true)}
          style={s.filterBtn}
          accessibilityRole="button"
          accessibilityLabel="Filter groups">
          <SlidersHorizontal size={18} color={C.white} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {banner !== '' && (
        <View style={s.banner}>
          <Text style={s.bannerText}>{banner}</Text>
        </View>
      )}

      <FlatList
        data={rooms}
        keyExtractor={room => room.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadRooms(apiFilters, false)}
            tintColor={C.brand}
          />
        }
        renderItem={({ item }) => {
          const joining = joiningId === item.id;
          // Explore only ever lists rooms the viewer hasn't joined — a joined
          // room lives exclusively in My Chats now — so the card itself isn't
          // tappable here; `Full` vs `Join` is the only distinction left.
          return (
            <ChatGroupCard
              room={item}
              action={
                item.is_full ? (
                  <View style={s.fullBtn}>
                    <Text style={s.fullBtnText}>Full</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => handleJoin(item)}
                    disabled={joining}
                    style={[s.joinBtn, joining && s.joinBtnBusy]}
                    accessibilityRole="button"
                    accessibilityLabel={`Join ${item.roomName}`}>
                    {joining ? (
                      <ActivityIndicator size="small" color={C.white} />
                    ) : (
                      <Text style={s.joinBtnText}>Join</Text>
                    )}
                  </TouchableOpacity>
                )
              }
            />
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.gateIcon}>
              <MessageSquare size={26} color={C.brand} strokeWidth={2} />
            </View>
            <Text style={s.emptyTitle}>No groups found</Text>
            <Text style={s.emptyText}>
              Try clearing your filters — or open a trek and tap "Create Group"
              to start your own.
            </Text>
          </View>
        }
      />

      <ChatFilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={setChipFilters}
        current={chipFilters}
      />
      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: TAB_BAR_SPACE,
  },

  gateState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  gateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.brandDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  gateTitle: { color: C.white, fontSize: 19, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  gateSub: {
    color: C.textSub, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 26,
  },
  gateCta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.brand, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14,
  },
  gateCtaText: { color: C.white, fontSize: 15, fontWeight: '700' },
  gateSecondary: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 16 },
  gateSecondaryText: { color: C.textSub, fontSize: 14, fontWeight: '600' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: C.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  banner: {
    marginHorizontal: 18,
    marginTop: 10,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerText: { color: C.red, fontSize: 12, lineHeight: 18 },

  list: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: TAB_BAR_SPACE + 20,
  },

  joinBtn: {
    backgroundColor: C.brand,
    paddingHorizontal: 22, paddingVertical: 8, borderRadius: 12,
    minWidth: 64, alignItems: 'center',
  },
  joinBtnBusy: { opacity: 0.7 },
  joinBtnText: { color: C.white, fontSize: 13, fontWeight: '700' },

  fullBtn: {
    backgroundColor: C.elevated,
    paddingHorizontal: 18, paddingVertical: 8, borderRadius: 12,
    opacity: 0.6,
  },
  fullBtnText: { color: C.textFaint, fontSize: 13, fontWeight: '700' },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  emptyTitle: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: {
    color: C.textSub, fontSize: 13, lineHeight: 20, textAlign: 'center',
  },
});
