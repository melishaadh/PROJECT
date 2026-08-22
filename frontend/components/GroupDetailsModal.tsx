import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { X, MapPin, CalendarRange, Users, LogOut } from 'lucide-react-native';
import { router } from 'expo-router';
import Avatar from '@/components/Avatar';
import { ChatRoom, leaveChatRoom } from '@/lib/chatService';
import { C, DIFFICULTY_COLOR } from '@/constants/theme';

/** `D MMM YYYY` for the details sheet's date range. */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

interface GroupDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  room: ChatRoom;
}

/**
 * Tapping a room's header opens this — everything about the expedition that
 * doesn't fit in the thread itself: the full member list and the room's own
 * metadata.
 */
export default function GroupDetailsModal({ visible, onClose, room }: GroupDetailsModalProps) {
  const [leaving, setLeaving] = useState(false);
  const diffColor = DIFFICULTY_COLOR[room.difficulty] ?? C.textFaint;
  const dateRange =
    room.start_date && room.end_date
      ? `${formatDate(room.start_date)} – ${formatDate(room.end_date)}`
      : '';

  const confirmLeave = () => {
    Alert.alert(
      'Leave this group?',
      `You'll stop receiving messages from "${room.roomName}" and will need a new invite or to rejoin from Explore to come back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: handleLeave },
      ],
    );
  };

  const handleLeave = async () => {
    setLeaving(true);
    const { ok, error } = await leaveChatRoom(room.id);
    setLeaving(false);
    if (ok) {
      onClose();
      // The thread this modal was opened from is no longer accessible —
      // land back on the chat list rather than a screen that would now 403
      // on its own message history.
      router.replace('/(tabs)/chatroom');
    } else {
      Alert.alert('Could not leave', error ?? 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />

          <View style={s.header}>
            <Text style={s.title} numberOfLines={1}>{room.roomName}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close group details"
              style={s.closeBtn}>
              <X size={18} color={C.textSub} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.metaRow}>
              <MapPin size={14} color={C.textFaint} strokeWidth={2} />
              <Text style={s.metaText}>{room.location || room.destinationName}</Text>
            </View>
            {dateRange !== '' && (
              <View style={s.metaRow}>
                <CalendarRange size={14} color={C.textFaint} strokeWidth={2} />
                <Text style={s.metaText}>{dateRange}</Text>
              </View>
            )}
            <View style={s.metaRow}>
              <Users size={14} color={C.textFaint} strokeWidth={2} />
              <Text style={s.metaText}>{room.member_count}/{room.maxMembers} members</Text>
            </View>
            <View style={[s.diffBadge, { backgroundColor: diffColor }]}>
              <Text style={s.diffBadgeText}>{room.difficulty}</Text>
            </View>

            <Text style={s.sectionLabel}>Members</Text>
            {room.members.map(member => (
              <View key={member.id} style={s.memberRow}>
                <Avatar uri={member.profilePicture} initials={member.name} size={38} />
                <Text style={s.memberName}>{member.name || 'Trekker'}</Text>
              </View>
            ))}

            <TouchableOpacity
              onPress={confirmLeave}
              disabled={leaving}
              style={[s.leaveBtn, leaving && s.leaveBtnBusy]}
              accessibilityRole="button"
              accessibilityLabel={`Leave ${room.roomName}`}>
              {leaving ? (
                <ActivityIndicator size="small" color={C.red} />
              ) : (
                <>
                  <LogOut size={16} color={C.red} strokeWidth={2} />
                  <Text style={s.leaveBtnText}>Leave Chat</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={{ height: 24 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 14,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderColor: C.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    gap: 12,
  },
  title: { color: C.white, fontSize: 19, fontWeight: '700', flex: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  metaText: { color: C.textSub, fontSize: 13 },
  diffBadge: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
    marginBottom: 8,
  },
  diffBadgeText: { color: C.white, fontSize: 11, fontWeight: '700' },

  sectionLabel: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 12,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  memberName: { color: C.white, fontSize: 14, fontWeight: '600' },

  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
  },
  leaveBtnBusy: { opacity: 0.6 },
  leaveBtnText: { color: C.red, fontSize: 15, fontWeight: '700' },
});
