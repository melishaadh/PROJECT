import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MessageSquare, Users, CalendarRange, UserCheck } from 'lucide-react-native';
import Avatar from '@/components/Avatar';
import { ChatRoom } from '@/lib/chatService';
import { trekImageFor } from '@/data/destinations';
import { C, DIFFICULTY_COLOR } from '@/constants/theme';

/** "Joined by Suman, Anisha" — trims to two names plus a "+N more" tail. */
function joinedByLabel(names: string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length <= 2) return clean.join(', ');
  return `${clean.slice(0, 2).join(', ')} +${clean.length - 2} more`;
}

/** `D MMM` for a card's date range. */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

interface ChatGroupCardProps {
  room: ChatRoom;
  onPress?: () => void;
  disabled?: boolean;
  /** The right-side control — View/Join/Full on Explore, a chevron on My Chats. */
  action: React.ReactNode;
}

/**
 * The group card shared by the Explore feed and My Chats — one visual
 * definition, so the two lists can never quietly drift apart on layout while
 * differing only in which action each one offers.
 */
export default function ChatGroupCard({ room, onPress, disabled, action }: ChatGroupCardProps) {
  const diffColor = DIFFICULTY_COLOR[room.difficulty] ?? C.textFaint;
  const trekImage = trekImageFor(room.trekId);
  const previewMembers = room.members.slice(0, 3);
  const extra = room.member_count - previewMembers.length;
  const dateRange =
    room.start_date && room.end_date
      ? `${formatDate(room.start_date)} – ${formatDate(room.end_date)}`
      : '';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={s.card}
      accessibilityRole="button"
      accessibilityLabel={`${room.roomName} group`}>
      <View style={s.cardTop}>
        <View style={s.cardIcon}>
          {trekImage ? (
            <Image source={trekImage} style={s.cardIconImage} resizeMode="cover" />
          ) : (
            <MessageSquare size={20} color={C.brandLight} strokeWidth={2} />
          )}
        </View>
        <View style={s.cardTitleWrap}>
          <Text style={s.cardName} numberOfLines={1}>{room.roomName}</Text>
          <Text style={s.cardDest} numberOfLines={1}>
            {room.location || room.destinationName}
          </Text>
        </View>
        <View style={[s.diffBadge, { backgroundColor: diffColor }]}>
          <Text style={s.diffBadgeText}>{room.difficulty}</Text>
        </View>
      </View>

      <View style={s.cardMetaRow}>
        <Users size={12} color={C.textFaint} strokeWidth={2} />
        <Text style={s.cardMetaText}>
          {room.member_count}/{room.maxMembers} members
        </Text>
        {dateRange !== '' && (
          <>
            <CalendarRange size={12} color={C.textFaint} strokeWidth={2} />
            <Text style={s.cardMetaText}>{dateRange}</Text>
          </>
        )}
      </View>

      {!!room.mutual_connections?.length && (
        <View style={s.mutualRow}>
          <UserCheck size={12} color={C.brandLight} strokeWidth={2} />
          <Text style={s.mutualText} numberOfLines={1}>
            Joined by {joinedByLabel(room.mutual_connections.map(m => m.name || 'a trekker you know'))}
          </Text>
        </View>
      )}

      <View style={s.cardBottom}>
        <View style={s.avatarStack}>
          {previewMembers.map((m, i) => (
            <Avatar
              key={m.id}
              uri={m.profilePicture}
              initials={m.name}
              size={28}
              bordered
              style={{ marginLeft: i === 0 ? 0 : -10 }}
            />
          ))}
          {extra > 0 && (
            <View style={[s.avatarExtra, { marginLeft: previewMembers.length ? -10 : 0 }]}>
              <Text style={s.avatarExtraText}>+{extra}</Text>
            </View>
          )}
        </View>

        {action}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.brandDim,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  cardIconImage: { width: '100%', height: '100%' },
  cardTitleWrap: { flex: 1 },
  cardName: { color: C.white, fontSize: 15, fontWeight: '700' },
  cardDest: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  diffBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  diffBadgeText: { color: C.white, fontSize: 11, fontWeight: '700' },

  cardMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 12, flexWrap: 'wrap',
  },
  cardMetaText: { color: C.textFaint, fontSize: 12, marginRight: 8 },

  mutualRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  mutualText: { color: C.brandLight, fontSize: 12, fontWeight: '600', flex: 1 },

  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatarExtra: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.elevated,
    borderWidth: 2, borderColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarExtraText: { color: C.textSub, fontSize: 10, fontWeight: '700' },
});
