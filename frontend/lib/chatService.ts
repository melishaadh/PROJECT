/**
 * chatService.ts
 *
 * Real-time group chat, backed by the NestJS `/chat` API and its socket.io
 * gateway. HTTP requests go through `apiFetch` (token attach + auto-refresh);
 * the socket handshake carries the same access token so the server can verify
 * identity before any event is dispatched.
 *
 * The socket is a singleton because only one chat thread is open at a time —
 * opening a thread takes the connection, closing it hands it back. The server
 * echoes every message back to the whole room (sender included) via
 * `newMessage`, so the UI appends on that single path and never optimistically
 * renders a message that failed to persist.
 */

import { io, Socket } from 'socket.io-client';
import { apiFetch, errorMessage, getToken } from '@/lib/authTokens';
import { API_ORIGIN } from '@/lib/apiConfig';

export type ChatDifficulty = 'Easy' | 'Moderate' | 'Hard';

export interface ChatRoomMember {
  id: string;
  name: string | null;
  profilePicture: string;
}

export interface ChatRoomLastMessage {
  content: string;
  sender_name: string | null;
  created_at: string;
  /** Members (other than the sender) who have read up to this message. */
  seen_by: ChatRoomMember[];
}

export interface ChatRoom {
  id: string;
  trekId: string;
  roomName: string;
  destinationName: string;
  location: string;
  durationDays: number;
  difficulty: ChatDifficulty;
  maxMembers: number;
  start_date: string | null;
  end_date: string | null;
  member_count: number;
  members: ChatRoomMember[];
  is_full: boolean;
  /** Present on every room returned to a signed-in viewer. */
  is_member?: boolean;
  /** Only populated by `listChatRooms({ mine: true })` — the My Chats list. */
  last_message?: ChatRoomLastMessage | null;
  unread_count?: number;
  /** Only populated on the discovery feed — people you already share a room with who are also in this one. */
  mutual_connections?: ChatRoomMember[];
  created_at: string;
  updated_at: string;
}

export interface ChatRoomFilters {
  search?: string;
  location?: string;
  /** Only rooms with at least this many open spots left. */
  capacity?: number;
  /** Only rooms for a trek of at most this many days. */
  durationDays?: number;
  difficulty?: ChatDifficulty;
  /** Only rooms the signed-in user already belongs to — the "My Chats" list. */
  mine?: boolean;
}

export interface ChatSender {
  id: string;
  name: string | null;
  profilePicture: string;
}

export interface ChatMessage {
  id: string;
  chatRoomId: string;
  sender: ChatSender | null;
  content: string;
  /** Ids of the other members who have read up to this message. */
  seenBy: string[];
  created_at: string;
}

// ─── HTTP API ─────────────────────────────────────────────────────────────────

export interface CreateChatRoomParams {
  trekId: string;
  roomName: string;
  maxMembers: number;
  /** ISO date strings; the trek's difficulty is resolved server-side. */
  startDate?: string;
  endDate?: string;
}

export async function createChatRoom(
  params: CreateChatRoomParams,
): Promise<{ room: ChatRoom | null; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean; room?: ChatRoom }>('/chat/rooms', {
    method: 'POST',
    body: params,
  });
  if (ok && data?.room) return { room: data.room };
  return { room: null, error: errorMessage(data, 'Could not create the group.') };
}

/** The discovery feed — every group, optionally narrowed by filters. */
export async function listChatRooms(filters: ChatRoomFilters = {}): Promise<ChatRoom[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.location) params.set('location', filters.location);
  if (filters.capacity !== undefined) params.set('capacity', String(filters.capacity));
  if (filters.durationDays !== undefined) params.set('durationDays', String(filters.durationDays));
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.mine) params.set('mine', 'true');

  const qs = params.toString();
  const { ok, data } = await apiFetch<{ rooms?: ChatRoom[] }>(`/chat/rooms${qs ? `?${qs}` : ''}`);
  return ok && Array.isArray(data?.rooms) ? data.rooms : [];
}

/** Join an existing group. Capacity is enforced atomically server-side. */
export async function joinChatRoom(roomId: string): Promise<{ room: ChatRoom | null; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean; room?: ChatRoom }>(
    `/chat/rooms/${encodeURIComponent(roomId)}/join`,
    { method: 'POST' },
  );
  if (ok && data?.room) return { room: data.room };
  return { room: null, error: errorMessage(data, 'Could not join the group.') };
}

export async function getChatRoom(roomId: string): Promise<ChatRoom | null> {
  const { ok, data } = await apiFetch<ChatRoom>(`/chat/rooms/${encodeURIComponent(roomId)}`);
  return ok && data && !(data as any).error ? data : null;
}

export async function getChatMessages(roomId: string): Promise<ChatMessage[]> {
  const { ok, data } = await apiFetch<{ messages?: ChatMessage[] }>(
    `/chat/rooms/${encodeURIComponent(roomId)}/messages`,
  );
  return ok && Array.isArray(data?.messages) ? data.messages : [];
}

/** Leave a group. Any of your other connected devices stop receiving its live messages too. */
export async function leaveChatRoom(roomId: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean }>(
    `/chat/rooms/${encodeURIComponent(roomId)}/leave`,
    { method: 'POST' },
  );
  if (ok && data?.success) return { ok: true };
  return { ok: false, error: errorMessage(data, 'Could not leave the group.') };
}

/** How many of your rooms have unread messages — drives the Profile inbox badge. */
export async function getUnreadRoomCount(): Promise<number> {
  const { ok, data } = await apiFetch<{ count?: number }>('/chat/unread-count');
  return ok && typeof data?.count === 'number' ? data.count : 0;
}

export interface ChatInvitation {
  id: string;
  status: 'pending' | 'accepted' | 'declined';
  room: {
    id: string;
    roomName: string;
    destinationName: string;
    maxMembers: number;
    member_count: number;
    is_full: boolean;
  };
  inviter: { id: string; name: string | null; profilePicture: string };
  created_at: string;
}

/** Invite someone (already known to be a real user id) to a room you're in. */
export async function sendInvitation(
  roomId: string,
  inviteeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean }>(
    `/chat/rooms/${encodeURIComponent(roomId)}/invite`,
    { method: 'POST', body: { inviteeId } },
  );
  if (ok && data?.success) return { ok: true };
  return { ok: false, error: errorMessage(data, 'Could not send the invite.') };
}

/** Of `roomIds`, which already have a pending invite out to `inviteeId` — the "Add to Group" picker's per-row state. */
export async function getPendingInviteRoomIds(roomIds: string[], inviteeId: string): Promise<Set<string>> {
  if (roomIds.length === 0) return new Set();
  const params = new URLSearchParams({ inviteeId, roomIds: roomIds.join(',') });
  const { ok, data } = await apiFetch<{ pendingRoomIds?: string[] }>(`/chat/rooms/invite-status?${params}`);
  return ok && Array.isArray(data?.pendingRoomIds) ? new Set(data.pendingRoomIds) : new Set();
}

/** Invitations addressed to me, still pending. */
export async function listMyInvitations(): Promise<ChatInvitation[]> {
  const { ok, data } = await apiFetch<{ invitations?: ChatInvitation[] }>('/chat/invitations');
  return ok && Array.isArray(data?.invitations) ? data.invitations : [];
}

/** Accept or decline. Accepting is capacity-checked atomically server-side. */
export async function respondToInvitation(
  invitationId: string,
  accept: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean }>(
    `/chat/invitations/${encodeURIComponent(invitationId)}/respond`,
    { method: 'POST', body: { accept } },
  );
  if (ok && data?.success) return { ok: true };
  return { ok: false, error: errorMessage(data, 'Could not respond to the invite.') };
}

// ─── Socket ───────────────────────────────────────────────────────────────────

let socket: Socket | null = null;

/**
 * Resolve once the handshake completes, reject if it is refused.
 *
 * Without this, `io()` returns an unconnected socket immediately and a rejected
 * handshake — an expired token, a server that is down — looks identical to a
 * healthy connection until the first message silently fails to arrive.
 */
function waitForConnect(s: Socket, timeoutMs = 8000): Promise<Socket> {
  if (s.connected) return Promise.resolve(s);

  return new Promise((resolve, reject) => {
    const settle = (err?: Error) => {
      clearTimeout(timer);
      s.off('connect', onConnect);
      s.off('connect_error', onError);
      if (err) reject(err);
      else resolve(s);
    };
    const onConnect = () => settle();
    const onError = (err: Error) => {
      // socket.io retries transport hiccups on its own and leaves `active` set;
      // only a refused handshake (auth) is terminal and worth surfacing.
      if (!s.active) settle(err);
    };
    const timer = setTimeout(() => settle(new Error('Connection timed out')), timeoutMs);

    s.on('connect', onConnect);
    s.on('connect_error', onError);
  });
}

async function ensureSocket(): Promise<Socket> {
  if (socket?.connected) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  const token = await getToken();
  if (!token) throw new Error('Not signed in');

  const next = io(API_ORIGIN, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
  });
  socket = next;

  try {
    return await waitForConnect(next);
  } catch (err) {
    // Leave no dead socket behind for the next caller to reuse.
    next.disconnect();
    if (socket === next) socket = null;
    throw err;
  }
}

/**
 * Best-effort live invitation delivery.
 *
 * The chat socket is deliberately scoped to "one thread open at a time" (see
 * the module doc comment) rather than kept alive app-wide, so this can only
 * deliver a `newInvitation` push while some thread's connection happens to
 * already be open. It is not a substitute for re-fetching `listMyInvitations`
 * on focus — screens that show the pending-invite badge/list should still do
 * that; this only makes the badge update instantly in the case where it can.
 * Making invitations truly always-live would mean making the socket
 * connection itself app-wide, which is a bigger change than this feature
 * needed.
 */
export function subscribeToInvitations(onInvitation: (invitation: ChatInvitation) => void): () => void {
  if (!socket) return () => {};
  const s = socket;
  s.on('newInvitation', onInvitation);
  return () => s.off('newInvitation', onInvitation);
}

export interface TypingEvent {
  userId: string;
  name: string | null;
}

export interface ReadEvent {
  userId: string;
  at: string;
}

/**
 * Open the live connection for a room and subscribe to its messages.
 *
 * Returns a cleanup that leaves the room and releases the socket — call it on
 * unmount. `onMessage` fires for every message broadcast into the room, the
 * sender's own included. `onTyping`/`onRead` are optional — callers that
 * don't render those indicators can omit them.
 */
export async function openRoomSocket(
  roomId: string,
  onMessage: (message: ChatMessage) => void,
  onTyping?: (event: TypingEvent) => void,
  onRead?: (event: ReadEvent) => void,
): Promise<() => void> {
  const s = await ensureSocket();

  const messageHandler = (message: ChatMessage) => {
    // The single connection may outlive this room; only deliver messages that
    // actually belong to it.
    if (message && message.chatRoomId === roomId) onMessage(message);
  };
  s.on('newMessage', messageHandler);

  const typingHandler = (event: TypingEvent & { roomId: string }) => {
    if (event && event.roomId === roomId) onTyping?.(event);
  };
  s.on('userTyping', typingHandler);

  const readHandler = (event: ReadEvent & { roomId: string }) => {
    if (event && event.roomId === roomId) onRead?.(event);
  };
  s.on('messagesRead', readHandler);

  // Re-join on every (re)connect: socket.io drops the socket.io room when the
  // transport reconnects, and the original join is only flushed once.
  const join = () => s.emit('joinRoom', { roomId });
  s.on('connect', join);
  // `ensureSocket` only resolves once connected, so this reaches the server
  // rather than sitting in the send buffer.
  join();

  return () => {
    s.off('newMessage', messageHandler);
    s.off('userTyping', typingHandler);
    s.off('messagesRead', readHandler);
    s.off('connect', join);
    if (s.connected) s.emit('leaveRoom', { roomId });
    s.disconnect();
    socket = null;
  };
}

/** Tell the room's other members you've read up through now. */
export async function markMessagesRead(roomId: string): Promise<void> {
  try {
    const s = await ensureSocket();
    s.emit('markRead', { roomId });
  } catch {
    // Best-effort — a failed read receipt shouldn't surface as a user-facing
    // error, since nothing the user did actually failed.
  }
}

let lastTypingEmit = 0;

/** Tell the room's other members you're typing. Throttled — call on every keystroke. */
export async function notifyTyping(roomId: string, name: string | null): Promise<void> {
  const now = Date.now();
  if (now - lastTypingEmit < 2000) return;
  lastTypingEmit = now;
  try {
    const s = await ensureSocket();
    s.emit('typing', { roomId, name });
  } catch {
    // Best-effort, same reasoning as `markMessagesRead`.
  }
}

/** Send a message and wait for the server's acknowledgement. */
export async function sendChatMessage(
  roomId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = await ensureSocket();
    // `timeout` guards against a socket that never connects: without it the
    // ack promise would hang and the composer would stay busy forever.
    const ack = (await s.timeout(8000).emitWithAck('sendMessage', { roomId, content })) as
      | { success?: boolean; error?: string }
      | undefined;
    if (!ack) return { ok: false, error: 'No response from the server.' };
    if (!ack.success) return { ok: false, error: ack.error ?? 'Could not send the message.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Not connected. Check your connection and try again.' };
  }
}

// ─── Shared ledger ──────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  roomId: string;
  payer: ChatRoomMember;
  amount: number;
  remark: string;
  addedBy: string;
  created_at: string;
}

export interface LedgerSummaryRow {
  member: ChatRoomMember;
  total: number;
}

export interface LedgerView {
  entries: LedgerEntry[];
  summary: LedgerSummaryRow[];
}

/** The group's shared expense ledger — who paid what, and each member's running total. */
export async function getRoomLedger(roomId: string): Promise<LedgerView> {
  const { ok, data } = await apiFetch<LedgerView>(`/chat/rooms/${encodeURIComponent(roomId)}/ledger`);
  return ok && data ? { entries: data.entries ?? [], summary: data.summary ?? [] } : { entries: [], summary: [] };
}

/** Log an expense: who paid, what it was for, how much. */
export async function addLedgerEntry(
  roomId: string,
  payerId: string,
  amount: number,
  remark: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean }>(
    `/chat/rooms/${encodeURIComponent(roomId)}/ledger`,
    { method: 'POST', body: { payerId, amount, remark } },
  );
  if (ok && data?.success) return { ok: true };
  return { ok: false, error: errorMessage(data, 'Could not add that expense.') };
}

/** Remove an entry you added — for fixing a typo'd amount or a wrong pick. */
export async function deleteLedgerEntry(roomId: string, entryId: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch<{ success?: boolean }>(
    `/chat/rooms/${encodeURIComponent(roomId)}/ledger/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
  );
  if (ok && data?.success) return { ok: true };
  return { ok: false, error: errorMessage(data, 'Could not remove that entry.') };
}
