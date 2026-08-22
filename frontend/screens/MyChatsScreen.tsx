import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { ArrowLeft, MessageSquare, Mail, Users } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import Avatar from '@/components/Avatar';
import {
  listChatRooms,
  listMyInvitations,
  respondToInvitation,
  ChatRoom,
  ChatInvitation,
} from '@/lib/chatService';
import { trekImageFor } from '@/data/destinations';
import { C, TAB_BAR_SPACE } from '@/constants/theme';

/** `2m` / `3h` / `Mon` / `Aug 4` — the Messenger-style compact timestamp. */
function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The groups you've already joined, plus any pending invitations waiting on you. */
export default function MyChatsScreen() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [invitations, setInvitations] = useState<ChatInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    else setRefreshing(true);
    // `listChatRooms` sorts "mine" results by most-recently-active and
    // attaches `last_message`/`unread_count` server-side — this screen just
    // renders what it's given.
    const [nextRooms, nextInvitations] = await Promise.all([
      listChatRooms({ mine: true }),
      listMyInvitations(),
    ]);
    setRooms(nextRooms);
    setInvitations(nextInvitations);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const handleRespond = async (invitation: ChatInvitation, accept: boolean) => {
    if (respondingId) return;
    setRespondingId(invitation.id);
    const { ok } = await respondToInvitation(invitation.id, accept);
    setRespondingId(null);
    if (ok) {
      setInvitations(prev => prev.filter(inv => inv.id !== invitation.id));
      // Accepting adds a room the plain list doesn't have yet — a full
      // reload is simpler and cheap enough than splicing one in by hand.
      if (accept) load(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={10}
          style={s.headerBack}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ArrowLeft size={20} color={C.white} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Chats</Text>
      </View>

      {loading ? (
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={room => room.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(false)} tintColor={C.brand} />
          }
          ListHeaderComponent={
            invitations.length > 0 ? (
              <View style={s.invitesSection}>
                <Text style={s.sectionLabel}>Pending Invitations</Text>
                {invitations.map(invitation => {
                  const busy = respondingId === invitation.id;
                  const full = invitation.room.is_full;
                  return (
                    <View key={invitation.id} style={s.inviteCard}>
                      <Avatar
                        uri={invitation.inviter.profilePicture}
                        initials={invitation.inviter.name}
                        size={38}
                      />
                      <View style={s.inviteInfo}>
                        <Text style={s.inviteText}>
                          <Text style={s.inviteName}>{invitation.inviter.name || 'Someone'}</Text>
                          {' invited you to '}
                          <Text style={s.inviteName}>{invitation.room.roomName}</Text>
                        </Text>
                        <Text style={s.inviteMeta}>
                          {invitation.room.member_count}/{invitation.room.maxMembers} members
                        </Text>
                      </View>
                      {busy ? (
                        <ActivityIndicator size="small" color={C.brand} />
                      ) : (
                        <View style={s.inviteActions}>
                          <TouchableOpacity
                            onPress={() => handleRespond(invitation, false)}
                            style={s.declineBtn}
                            accessibilityRole="button"
                            accessibilityLabel={`Decline invite to ${invitation.room.roomName}`}>
                            <Text style={s.declineBtnText}>Decline</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => !full && handleRespond(invitation, true)}
                            disabled={full}
                            style={[s.acceptBtn, full && s.acceptBtnFull]}
                            accessibilityRole="button"
                            accessibilityLabel={
                              full
                                ? `${invitation.room.roomName} is full`
                                : `Accept invite to ${invitation.room.roomName}`
                            }>
                            <Text style={[s.acceptBtnText, full && s.acceptBtnTextFull]}>
                              {full ? 'Group Full' : 'Accept'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
                <Text style={s.sectionLabel}>Messages</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <ChatInboxRow room={item} onPress={() => router.push(`/chat/${item.id}`)} />}
          ListEmptyComponent={
            invitations.length === 0 ? (
              <View style={s.empty}>
                <View style={s.emptyIcon}>
                  <MessageSquare size={26} color={C.brand} strokeWidth={2} />
                </View>
                <Text style={s.emptyTitle}>No chats yet</Text>
                <Text style={s.emptyText}>
                  Join a group from Explore, or start your own from a trek's page.
                </Text>
              </View>
            ) : (
              <View style={s.emptyGroupsOnly}>
                <Mail size={22} color={C.textFaint} strokeWidth={2} />
                <Text style={s.emptyGroupsOnlyText}>No groups yet — respond to an invite above to join one.</Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

/**
 * A Messenger/Instagram-style DM row: name, last-message snippet, timestamp,
 * an unread badge, and an avatar stack of whoever has *seen the last
 * message* — not just the room roster, so the row actually answers "who's
 * caught up" the way Instagram's own seen-by avatars do.
 */
function ChatInboxRow({ room, onPress }: { room: ChatRoom; onPress: () => void }) {
  const unread = room.unread_count ?? 0;
  const hasUnread = unread > 0;
  const viewers = room.last_message?.seen_by ?? [];
  const trekImage = trekImageFor(room.trekId);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={s.row}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Open ${room.roomName}${hasUnread ? `, ${unread} unread` : ''}`}>
      <View style={s.rowIcon}>
        {trekImage ? (
          <Image source={trekImage} style={s.rowIconImage} resizeMode="cover" />
        ) : (
          <Users size={18} color={C.brandLight} strokeWidth={2} />
        )}
      </View>

      <View style={s.rowBody}>
        <View style={s.rowTopLine}>
          <Text style={[s.rowName, hasUnread && s.rowNameUnread]} numberOfLines={1}>
            {room.roomName}
          </Text>
          {room.last_message && (
            <Text style={[s.rowTime, hasUnread && s.rowTimeUnread]}>
              {formatRelativeTime(room.last_message.created_at)}
            </Text>
          )}
        </View>

        <View style={s.rowBottomLine}>
          <Text style={[s.rowSnippet, hasUnread && s.rowSnippetUnread]} numberOfLines={1}>
            {room.last_message
              ? `${room.last_message.sender_name ? `${room.last_message.sender_name}: ` : ''}${room.last_message.content}`
              : 'No messages yet'}
          </Text>

          <View style={s.rowRight}>
            {viewers.length > 0 && (
              <View style={s.avatarStack}>
                {viewers.slice(0, 3).map((m, i) => (
                  <Avatar
                    key={m.id}
                    uri={m.profilePicture}
                    initials={m.name}
                    size={18}
                    style={{ marginLeft: i === 0 ? 0 : -6 }}
                  />
                ))}
              </View>
            )}
            {hasUnread && (
              <View style={s.unreadBadge}>
                <Text style={s.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 58,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerBack: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: C.white, fontSize: 17, fontWeight: '700' },

  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: TAB_BAR_SPACE },

  list: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: TAB_BAR_SPACE + 20,
  },

  sectionLabel: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginTop: 4,
    marginHorizontal: 6,
  },
  invitesSection: { marginBottom: 4 },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    marginHorizontal: 6,
  },
  inviteInfo: { flex: 1 },
  inviteText: { color: C.textSub, fontSize: 13, lineHeight: 18 },
  inviteName: { color: C.white, fontWeight: '700' },
  inviteMeta: { color: C.textFaint, fontSize: 11, marginTop: 3 },
  inviteActions: { flexDirection: 'row', gap: 8 },
  declineBtn: {
    backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  declineBtnText: { color: C.textSub, fontSize: 12, fontWeight: '700' },
  acceptBtn: {
    backgroundColor: C.brand,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  acceptBtnFull: { backgroundColor: C.elevated, opacity: 0.6 },
  acceptBtnText: { color: C.white, fontSize: 12, fontWeight: '700' },
  acceptBtnTextFull: { color: C.textFaint },

  /* Inbox row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: C.brandDim,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  rowIconImage: { width: '100%', height: '100%' },
  rowBody: { flex: 1 },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowName: { color: C.textSub, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  rowNameUnread: { color: C.white, fontWeight: '700' },
  rowTime: { color: C.textFaint, fontSize: 11 },
  rowTimeUnread: { color: C.brandLight, fontWeight: '700' },
  rowBottomLine: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 3,
  },
  rowSnippet: { color: C.textFaint, fontSize: 13, flex: 1, marginRight: 8 },
  rowSnippetUnread: { color: C.textSub, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  unreadBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: { color: C.white, fontSize: 10, fontWeight: '700' },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: C.brandDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: {
    color: C.textSub, fontSize: 13, lineHeight: 20, textAlign: 'center',
  },
  emptyGroupsOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginHorizontal: 6,
  },
  emptyGroupsOnlyText: { color: C.textFaint, fontSize: 12, flex: 1, lineHeight: 18 },
});
