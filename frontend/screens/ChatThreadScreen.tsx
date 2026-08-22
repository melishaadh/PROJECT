import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import {
  ArrowLeft,
  Send,
  Users,
  AlertTriangle,
  Check,
  NotebookText,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Avatar from '@/components/Avatar';
import GroupDetailsModal from '@/components/GroupDetailsModal';
import SharedLedgerModal from '@/components/SharedLedgerModal';
import { C } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  ChatMessage,
  ChatRoom,
  ChatRoomMember,
  getChatMessages,
  getChatRoom,
  openRoomSocket,
  sendChatMessage,
  markMessagesRead,
  notifyTyping,
} from '@/lib/chatService';

/** `HH:MM` local time for a message's timestamp. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "Today" / "Yesterday" / "August 4" — the date-separator label for a message. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric' });
}

/** How long a typing signal stays valid without a fresh one — no explicit "stopped" event. */
const TYPING_TTL_MS = 3000;

type ThreadItem =
  | { key: string; kind: 'separator'; label: string }
  | {
      key: string;
      kind: 'message';
      message: ChatMessage;
      /** First message in a run of consecutive messages from the same sender — shows the avatar/name. */
      isGroupStart: boolean;
      /** Last message in that run — gets the normal spacing gap before whatever comes next. */
      isGroupEnd: boolean;
    };

/**
 * Interleave date separators between messages from different calendar days,
 * and mark each message's place in its sender's consecutive run — a solid
 * block of messages from one person, grouped tightly with the avatar and
 * name shown once, is what makes a transcript read as an actual
 * conversation rather than a list of isolated, identically-formatted rows.
 */
function buildThreadItems(messages: ChatMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastLabel = '';
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const label = dayLabel(message.created_at);
    const daySeparatorHere = !!label && label !== lastLabel;
    if (daySeparatorHere) {
      items.push({ key: `sep-${message.id}`, kind: 'separator', label });
      lastLabel = label;
    }

    const prev = messages[i - 1];
    const next = messages[i + 1];
    const isGroupStart = daySeparatorHere || !prev || prev.sender?.id !== message.sender?.id;
    const isGroupEnd = !next || (!!label && dayLabel(next.created_at) !== label) || next.sender?.id !== message.sender?.id;

    items.push({ key: message.id, kind: 'message', message, isGroupStart, isGroupEnd });
  }
  return items;
}

export default function ChatThreadScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const { user } = useAuth();
  const myId = user?.id;

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectError, setConnectError] = useState(false);
  const [sending, setSending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string | null; at: number }>>(new Map());
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const listRef = useRef<FlatList<ThreadItem>>(null);
  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // My own display name, read off the room's member list rather than a
  // separate lookup — `getChatRoom` already returns it, and it's exactly the
  // name other members should see attached to a typing indicator.
  const myName = room?.members.find(m => m.id === myId)?.name ?? null;

  // Load room + history. Both are member-gated server-side, so a 403 surfaces
  // here as "could not open" rather than a leak of the room's contents.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      const [roomData, history] = await Promise.all([
        getChatRoom(roomId),
        getChatMessages(roomId),
      ]);
      if (!active) return;
      setLoading(false);
      if (!roomData) {
        setError('Could not open this chat room.');
        return;
      }
      setRoom(roomData);
      setMessages(history);
      // Opening the thread is "reading" everything currently in it.
      markMessagesRead(roomId);
    })();
    return () => {
      active = false;
    };
  }, [roomId]);

  // Live updates. The socket opens only once the room exists, and tears down on
  // unmount or when the room id changes. `connectError` is a separate state
  // from `error` (send failures) so a failed send cannot tear down a live
  // connection, and vice versa.
  useEffect(() => {
    if (!room || connectError) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    openRoomSocket(
      roomId,
      incoming => {
        if (cancelled) return;
        // The sender's own message arrives through the same broadcast, so appends
        // stay in one place regardless of who sent them.
        setMessages(prev => {
          if (prev.some(m => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
        // Still here and watching — this counts as reading it too.
        if (incoming.sender?.id !== myId) markMessagesRead(roomId);
      },
      ({ userId, name }) => {
        if (cancelled || userId === myId) return;
        setTypingUsers(prev => new Map(prev).set(userId, { name, at: Date.now() }));
      },
      ({ userId, at }) => {
        if (cancelled || userId === myId) return;
        // Add this peer to every own message's avatar stack up through `at` —
        // they may already be there (they can call markRead more than once as
        // new messages arrive), so this stays idempotent rather than pushing
        // a duplicate.
        setMessages(prev =>
          prev.map(m =>
            m.sender?.id === myId && !m.seenBy.includes(userId) && new Date(m.created_at) <= new Date(at)
              ? { ...m, seenBy: [...m.seenBy, userId] }
              : m,
          ),
        );
      },
    )
      .then(teardown => {
        if (cancelled) teardown();
        else cleanup = teardown;
      })
      .catch(() => {
        if (!cancelled) setConnectError(true);
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [roomId, room, connectError, myId]);

  // Typing signals expire on their own — clear anything older than the TTL
  // every second rather than waiting on an explicit "stopped typing" event.
  useEffect(() => {
    const t = setInterval(() => {
      setTypingUsers(prev => {
        const cutoff = Date.now() - TYPING_TTL_MS;
        const next = new Map([...prev].filter(([, v]) => v.at >= cutoff));
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Tracked so the composer's own bottom safe-area padding can drop out while
  // the keyboard is up — `KeyboardAvoidingView` already lifts the composer by
  // exactly the keyboard's height, so keeping that static padding underneath
  // it too just leaves a dead gap floating above the keyboard instead of the
  // composer sitting flush against it.
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleInputChange = (text: string) => {
    setInput(text);
    if (text.trim()) notifyTyping(roomId, myName);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    // Drop the previous failure's banner: it describes the send being retried,
    // and leaving it up would make a successful retry look like it also failed.
    setError('');
    const result = await sendChatMessage(roomId, text);
    setSending(false);
    if (!result.ok) {
      // Restore the draft so the failure costs a tap, not the content.
      setInput(text);
      setError(result.error ?? 'Could not send the message.');
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const threadItems = useMemo(() => buildThreadItems(messages), [messages]);

  // For each viewer, the most recent of *my* messages they've read so far —
  // Messenger's convention is a seen-avatar under the newest message each
  // person has caught up to, not repeated under every message that happens
  // to be at-or-before their read point. `messages` is chronological, so a
  // later message's entry simply overwrites an earlier one for the same
  // viewer as this walks forward.
  const latestSeenMessageId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (m.sender?.id !== myId) continue;
      for (const viewerId of m.seenBy) map.set(viewerId, m.id);
    }
    return map;
  }, [messages, myId]);

  const typingLabel = useMemo(() => {
    const names = [...typingUsers.values()].map(v => v.name || 'Someone');
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return 'Several people are typing…';
  }, [typingUsers]);

  // ─── States ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ChatHeader roomName="Chat" onBack={goBack} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      </View>
    );
  }

  if (error && !room) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ChatHeader roomName="Chat" onBack={goBack} />
        <View style={s.center}>
          <View style={s.errorIcon}>
            <AlertTriangle size={26} color={C.amber} strokeWidth={2} />
          </View>
          <Text style={s.centerTitle}>Chat unavailable</Text>
          <Text style={s.centerSub}>{error}</Text>
          <TouchableOpacity onPress={goBack} style={s.primaryBtn}>
            <Text style={s.primaryBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const roomName = room?.roomName ?? 'Chat';
  const memberCount = room?.member_count ?? 0;
  const maxMembers = room?.maxMembers ?? 0;

  return (
    <KeyboardAvoidingView
      style={s.root}
      // Android's own window-resize handling is unreliable across OS
      // versions/keyboards/foldables (`app.json` turns it off via
      // `softwareKeyboardLayoutMode: "pan"` for exactly that reason), so
      // `height` here is what actually moves the composer above the
      // keyboard there — `undefined` left it entirely up to a native
      // mechanism that this app no longer opts into.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ChatHeader
        roomName={roomName}
        onBack={goBack}
        onPress={() => setDetailsOpen(true)}
        subtitle={
          memberCount > 0 ? (
            <View style={s.headerSubRow}>
              <Users size={12} color={C.textFaint} strokeWidth={2} />
              <Text style={s.headerSub}>
                {memberCount}{maxMembers > 0 ? `/${maxMembers}` : ''} members
              </Text>
            </View>
          ) : null
        }
      />

      {messages.length === 0 ? (
        <View style={s.emptyState}>
          <View style={s.errorIcon}>
            <Users size={26} color={C.brand} strokeWidth={2} />
          </View>
          <Text style={s.centerTitle}>No messages yet</Text>
          <Text style={s.centerSub}>
            This is the start of the group. Say hello and get the conversation going.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={threadItems}
          keyExtractor={item => item.key}
          renderItem={({ item }) =>
            item.kind === 'separator' ? (
              <View style={s.dateSeparator}>
                <Text style={s.dateSeparatorText}>{item.label}</Text>
              </View>
            ) : (
              <MessageBubble
                message={item.message}
                isOwn={item.message.sender?.id === myId}
                members={room?.members ?? []}
                isGroupStart={item.isGroupStart}
                isGroupEnd={item.isGroupEnd}
                latestSeenMessageId={latestSeenMessageId}
              />
            )
          }
          onContentSizeChange={scrollToEnd}
          onLayout={scrollToEnd}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.listContent}
        />
      )}

      {typingLabel !== '' && (
        <View style={s.typingRow}>
          <Text style={s.typingText}>{typingLabel}</Text>
        </View>
      )}

      {connectError && (
        <View style={s.composerError}>
          <AlertTriangle size={13} color={C.amber} strokeWidth={2} />
          <Text style={s.composerErrorText}>
            Live chat is unavailable right now — messages may not send.
          </Text>
        </View>
      )}

      {error !== '' && (
        <View style={s.composerError}>
          <AlertTriangle size={13} color={C.red} strokeWidth={2} />
          <Text style={s.composerErrorText}>{error}</Text>
        </View>
      )}

      <View
        style={[
          s.composer,
          { paddingBottom: keyboardVisible ? 10 : Platform.OS === 'ios' ? 28 : 16 },
        ]}>
        <TouchableOpacity
          onPress={() => setLedgerOpen(true)}
          style={s.journalBtn}
          accessibilityRole="button"
          accessibilityLabel="Open shared ledger">
          <NotebookText size={20} color={C.textSub} strokeWidth={2} />
        </TouchableOpacity>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={handleInputChange}
            placeholder="Message the group…"
            placeholderTextColor={C.textFaint}
            multiline
            underlineColorAndroid="transparent"
            selectionColor={C.brand}
            accessibilityLabel="Chat message input"
          />
        </View>
        <TouchableOpacity
          onPress={handleSend}
          disabled={!input.trim() || sending}
          style={[s.sendBtn, (!input.trim() || sending) && s.sendBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send message">
          <Send size={18} color={C.white} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {room && (
        <GroupDetailsModal
          visible={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          room={room}
        />
      )}

      {room && (
        <SharedLedgerModal
          visible={ledgerOpen}
          onClose={() => setLedgerOpen(false)}
          room={room}
          currentUserId={myId ?? null}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function ChatHeader({
  roomName,
  onBack,
  onPress,
  subtitle,
}: {
  roomName: string;
  onBack: () => void;
  onPress?: () => void;
  subtitle?: React.ReactNode;
}) {
  return (
    <View style={s.header}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={10}
        style={s.headerBack}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <ArrowLeft size={20} color={C.white} strokeWidth={2} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onPress}
        disabled={!onPress}
        activeOpacity={onPress ? 0.7 : 1}
        style={s.headerTitleWrap}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? 'Open group details' : undefined}>
        <Text style={s.headerTitle} numberOfLines={1}>{roomName}</Text>
        {subtitle}
      </TouchableOpacity>
    </View>
  );
}

function MessageBubble({
  message,
  isOwn,
  members,
  isGroupStart,
  isGroupEnd,
  latestSeenMessageId,
}: {
  message: ChatMessage;
  isOwn: boolean;
  /** The room's member list, to resolve `seenBy` ids into avatars. */
  members: ChatRoomMember[];
  /** First message in this sender's consecutive run — shows the avatar/name. */
  isGroupStart: boolean;
  /** Last message in that run — gets the normal gap before the next sender's group. */
  isGroupEnd: boolean;
  /** Viewer id → the most recent of *my* messages they've read; see `ChatThreadScreen`'s doc comment. */
  latestSeenMessageId: Map<string, string>;
}) {
  const senderName = message.sender?.name || 'Trekker';
  const time = formatTime(message.created_at);
  const rowSpacing = isGroupEnd ? s.rowSpacingLoose : s.rowSpacingTight;

  if (isOwn) {
    const viewers = message.seenBy
      .filter(id => latestSeenMessageId.get(id) === message.id)
      .map(id => members.find(m => m.id === id))
      .filter((m): m is ChatRoomMember => !!m);

    return (
      <View style={[s.row, s.rowOwn, rowSpacing]}>
        <View style={s.ownCol}>
          <View style={[s.bubble, s.bubbleOwn]}>
            <Text style={s.bubbleText}>{message.content}</Text>
            <View style={s.bubbleMetaOwn}>
              {time !== '' && <Text style={s.bubbleTimeOwn}>{time}</Text>}
              {viewers.length === 0 && isGroupEnd && (
                <Check size={13} color="rgba(255,255,255,0.55)" strokeWidth={2.5} />
              )}
            </View>
          </View>
          {/* Instagram/Messenger-style seen-by row — who has read up through
              this message, shown once under the newest message each person
              has caught up to rather than repeated under every one of mine
              they've already seen. */}
          {viewers.length > 0 && (
            <View style={s.seenByRow}>
              {viewers.slice(0, 4).map((viewer, i) => (
                <Avatar
                  key={viewer.id}
                  uri={viewer.profilePicture}
                  initials={viewer.name}
                  size={16}
                  style={{ marginLeft: i === 0 ? 0 : -6 }}
                />
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[s.row, s.rowOther, rowSpacing]}>
      {isGroupStart ? (
        <Avatar uri={message.sender?.profilePicture} initials={message.sender?.name} size={30} style={s.bubbleAvatar} />
      ) : (
        // Holds the same width an avatar would, so every bubble in the run
        // still lines up under the first one instead of creeping left.
        <View style={s.bubbleAvatarSpacer} />
      )}
      <View style={s.otherCol}>
        {isGroupStart && <Text style={s.senderName}>{senderName}</Text>}
        <View style={[s.bubble, s.bubbleOther]}>
          <Text style={s.bubbleText}>{message.content}</Text>
          {time !== '' && <Text style={s.bubbleTimeOther}>{time}</Text>}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  /* Header — mirrors the itinerary screen's sub-screen header. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: Platform.OS === 'ios' ? 58 : 44,
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
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: C.white, fontSize: 17, fontWeight: '700' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  headerSub: { color: C.textFaint, fontSize: 12 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  errorIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: C.brandDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  centerTitle: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  centerSub: {
    color: C.textSub, fontSize: 13, lineHeight: 20,
    textAlign: 'center', marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: C.brand, paddingHorizontal: 26, paddingVertical: 12, borderRadius: 14,
  },
  primaryBtnText: { color: C.white, fontSize: 14, fontWeight: '700' },

  /* Message list */
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  dateSeparator: { alignItems: 'center', marginVertical: 14 },
  dateSeparatorText: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', width: '100%' },
  /** Tight gap within a sender's consecutive run; the normal gap only appears after a run's last message. */
  rowSpacingTight: { marginBottom: 3 },
  rowSpacingLoose: { marginBottom: 14 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start', gap: 8 },
  /*
   * `maxWidth` lives here, not on `bubble`, deliberately. `ownCol` has no
   * `flex`/width of its own, so if the *bubble* carried a percentage
   * `maxWidth` instead, Yoga would have to resolve that percentage against
   * a parent (`ownCol`) whose own width is still being computed from that
   * same bubble — a circular layout that (on some RN/Yoga versions and
   * device configurations) resolves to a near-zero width, wrapping a word
   * as short as "Hello" onto two lines. `ownCol`'s parent (`row`) has a
   * real, already-resolved width, so capping `ownCol` there breaks the
   * cycle; the bubble inside it is then free to size to its own content.
   */
  ownCol: { alignItems: 'flex-end', maxWidth: '80%' },
  seenByRow: { flexDirection: 'row', marginTop: 4, marginRight: 4 },
  bubbleAvatar: { marginTop: 16 },
  /** Same footprint as `bubbleAvatar` (30 wide + `rowOther`'s 8 gap) so a mid-run bubble still lines up under the first one. */
  bubbleAvatarSpacer: { width: 30 },
  otherCol: { flex: 1, alignItems: 'flex-start' },
  senderName: {
    color: C.textFaint, fontSize: 11, fontWeight: '600',
    marginBottom: 4, marginLeft: 2,
  },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOwn: {
    backgroundColor: C.brand,
    borderBottomRightRadius: 4,
    // `ownCol` already caps the available width at 80% of the row; without
    // this, the bubble would additionally cap itself at 80% *of that*
    // (~64% of the row), squeezing it narrower than the other side's bubble
    // for no reason.
    maxWidth: '100%',
  },
  bubbleOther: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { color: C.white, fontSize: 14, lineHeight: 20 },
  bubbleMetaOwn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, alignSelf: 'flex-end',
  },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
  bubbleTimeOther: { color: C.textFaint, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },

  /* Typing indicator */
  typingRow: { paddingHorizontal: 20, paddingBottom: 4 },
  typingText: { color: C.textFaint, fontSize: 12, fontStyle: 'italic' },

  /* Composer */
  composerError: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingTop: 8,
  },
  composerErrorText: { color: C.textSub, fontSize: 12, flex: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    maxHeight: 110,
    justifyContent: 'center',
  },
  input: { color: C.white, fontSize: 14, paddingTop: 10, paddingBottom: 10, maxHeight: 90 },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  journalBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
