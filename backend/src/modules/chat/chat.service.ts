import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatRoom, ChatRoomDocument, ChatDifficulty } from '@db/schemas/chat-room.schema';
import { Message, MessageDocument } from '@db/schemas/message.schema';
import { DestinationsService } from '@/modules/destinations/destinations.service';

export interface CreateRoomDto {
  trekId: string;
  roomName: string;
  maxMembers: number;
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface RoomFilters {
  search?: string;
  location?: string;
  /** Only rooms with at least this many open spots left. */
  capacity?: number;
  /** Only rooms for a trek of at most this many days. */
  durationDays?: number;
  difficulty?: string;
  /** Only rooms `viewerId` already belongs to — the "My Chats" list. */
  mine?: boolean;
}

/** A member preview for the discovery card's avatar stack. */
export interface RoomMemberPreview {
  id: string;
  name: string | null;
  profilePicture: string;
}

export interface RoomLastMessage {
  content: string;
  sender_name: string | null;
  created_at: Date;
  /** Members (other than the sender) who have read up to this message. */
  seen_by: RoomMemberPreview[];
}

/** The wire shape of a room the client reads. Every field is defaulted. */
export interface ChatRoomView {
  id: string;
  trekId: string;
  roomName: string;
  destinationName: string;
  location: string;
  durationDays: number;
  difficulty: ChatDifficulty;
  maxMembers: number;
  start_date: Date | null;
  end_date: Date | null;
  member_count: number;
  members: RoomMemberPreview[];
  is_full: boolean;
  /** Omitted by callers that have no viewer to check against (e.g. sockets). */
  is_member?: boolean;
  /**
   * Only populated for the "My Chats" list (`mine: true`) — the discovery
   * feed never shows a room twice, so it never needs to know how it's been
   * going.
   */
  last_message?: RoomLastMessage | null;
  unread_count?: number;
  /**
   * Only populated on the discovery feed — people already in one of the
   * viewer's own rooms who are also in *this* one. There's no friends/
   * following graph in this app, so this is the closest real signal to
   * "mutual connections": you don't need an explicit social graph to know
   * you already share a group with someone.
   */
  mutual_connections?: RoomMemberPreview[];
  created_at: Date | null;
  updated_at: Date | null;
}

/** The wire shape of a message, with the sender denormalised for display. */
export interface ChatMessageView {
  id: string;
  chatRoomId: string;
  sender: { id: string; name: string | null; profilePicture: string } | null;
  content: string;
  /**
   * Ids of the *other* members who have read up to this message — not every
   * member, just whoever has actually caught up to it. Rendered as a small
   * avatar stack under the bubble rather than a single tick, since a group
   * room's members catch up at very different times and "seen by whom"
   * is the actually useful signal once there's more than one other person.
   */
  seenBy: string[];
  created_at: Date | null;
}

/** Neutralise regex metacharacters so free-text search can't inject a pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DIFFICULTIES = new Set(['Easy', 'Moderate', 'Hard']);

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatRoom.name) private readonly roomModel: Model<ChatRoomDocument>,
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    private readonly destinationsService: DestinationsService,
  ) {}

  /**
   * `rawMemberIds` must be captured from the document *before* `.populate()`
   * is called on it — Mongoose silently **drops** array entries whose ref
   * doesn't resolve to a real document (an orphaned member id; unlike a
   * single ref, which becomes `null`), so a populated array can be shorter
   * than the room's real membership. Deriving `member_count`/`is_full`/
   * `is_member` from that shrunk array would understate real occupancy the
   * moment any member's account went missing — capacity enforcement has to
   * stay correct regardless of population, so only the avatar-stack preview
   * below is allowed to be best-effort.
   */
  private toRoomView(r: ChatRoomDocument, rawMemberIds: string[], viewerId?: string): ChatRoomView {
    const members = Array.isArray(r.members) ? r.members : [];
    const memberViews: RoomMemberPreview[] = members
      .filter((m: any) => m && typeof m === 'object' && !(m instanceof Types.ObjectId))
      .map((m: any) => ({
        id: m._id.toString(),
        name: typeof m.name === 'string' ? m.name : null,
        profilePicture: typeof m.profilePicture === 'string' ? m.profilePicture : '',
      }));

    const view: ChatRoomView = {
      id: r._id.toString(),
      trekId: r.trekId ?? '',
      roomName: r.roomName ?? '',
      destinationName: r.destinationName ?? '',
      location: r.location ?? '',
      durationDays: r.durationDays ?? 0,
      difficulty: r.difficulty,
      maxMembers: r.maxMembers,
      start_date: r.startDate ?? null,
      end_date: r.endDate ?? null,
      member_count: rawMemberIds.length,
      members: memberViews,
      is_full: rawMemberIds.length >= r.maxMembers,
      created_at: r.createdAt ?? null,
      updated_at: r.updatedAt ?? null,
    };
    if (viewerId) view.is_member = rawMemberIds.includes(viewerId);
    return view;
  }

  /** Raw member ids as plain strings — call before `.populate()` touches the document. */
  private rawMemberIds(r: ChatRoomDocument): string[] {
    return (Array.isArray(r.members) ? r.members : []).map((m: any) => m.toString());
  }

  /**
   * `senderId` is the *raw* id — captured before `.populate()` touches the
   * document, same reasoning as `rawMemberIds`. A single ref's failed
   * populate sets the field to `null` (unlike an array, which drops the
   * entry), so reading `m.senderId` after populating — as this used to do —
   * crashes the moment a message's sender doesn't resolve to a real user.
   * `sender` is only ever used here for *display* info (name/picture); the
   * id itself never depends on population succeeding.
   */
  private toMessageView(
    m: MessageDocument,
    senderId: string,
    readInfo?: { memberIds: string[]; lastReadAt: Map<string, Date> },
  ): ChatMessageView {
    const sender = (m as any).senderId as any;
    const hasSender = sender && typeof sender === 'object' && !(sender instanceof Types.ObjectId);

    let seenBy: string[] = [];
    if (readInfo) {
      const createdAtMs = (m.createdAt ?? new Date(0)).getTime();
      seenBy = readInfo.memberIds
        .filter(id => id !== senderId)
        .filter(id => (readInfo.lastReadAt.get(id)?.getTime() ?? 0) >= createdAtMs);
    }

    return {
      id: m._id.toString(),
      chatRoomId: m.chatRoomId.toString(),
      sender: hasSender
        ? {
            id: senderId,
            name: typeof sender.name === 'string' ? sender.name : null,
            profilePicture: typeof sender.profilePicture === 'string' ? sender.profilePicture : '',
          }
        : null,
      content: m.content ?? '',
      seenBy,
      created_at: m.createdAt ?? null,
    };
  }

  /** A room id that is not a valid ObjectId is a "not found", not a crash. */
  private isValidId(id: string): boolean {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
  }

  /**
   * Messages in `roomIds` sent by someone other than `viewerId`, grouped by
   * room, counted against each room's own read threshold. One query across
   * every room rather than one count per room — simpler to verify correct
   * than a per-room-varying aggregation pipeline, and at the message volumes
   * a trek-group chat actually reaches, fetching the candidates directly costs
   * nothing worth optimising away.
   */
  private async unreadCountsByRoom(
    roomIds: Types.ObjectId[],
    viewerId: string,
    lastReadAtByRoomId: Map<string, Date | null>,
  ): Promise<Map<string, number>> {
    const viewerObjectId = new Types.ObjectId(viewerId);
    const candidates = await this.messageModel
      .find(
        { chatRoomId: { $in: roomIds }, senderId: { $ne: viewerObjectId } },
        { chatRoomId: 1, createdAt: 1 },
      )
      .lean()
      .exec();

    const counts = new Map<string, number>();
    for (const m of candidates) {
      const key = m.chatRoomId.toString();
      const threshold = lastReadAtByRoomId.get(key)?.getTime() ?? 0;
      if (m.createdAt.getTime() > threshold) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /** The single newest message in each of `roomIds`, for a chat-list preview line. */
  private async lastMessageByRoom(
    roomIds: Types.ObjectId[],
  ): Promise<Map<string, { content: string; senderId: string; createdAt: Date }>> {
    const rows = await this.messageModel.aggregate([
      { $match: { chatRoomId: { $in: roomIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$chatRoomId',
          content: { $first: '$content' },
          senderId: { $first: '$senderId' },
          createdAt: { $first: '$createdAt' },
        },
      },
    ]);
    const map = new Map<string, { content: string; senderId: string; createdAt: Date }>();
    for (const row of rows) {
      map.set(row._id.toString(), {
        content: row.content,
        senderId: row.senderId.toString(),
        createdAt: row.createdAt,
      });
    }
    return map;
  }

  /**
   * Attaches `last_message` and `unread_count` to each view and re-sorts by
   * most-recently-active — the "My Chats" list reads like a messaging inbox
   * (most recent conversation first), not like the discovery feed's
   * newest-room-first order.
   */
  private async enrichWithActivity(
    views: ChatRoomView[],
    rooms: ChatRoomDocument[],
    rawIdsByRoom: string[][],
    viewerId: string,
  ): Promise<ChatRoomView[]> {
    if (rooms.length === 0) return views;
    const roomIds = rooms.map(r => r._id as Types.ObjectId);
    const roomsById = new Map(rooms.map(r => [r._id.toString(), r]));
    const rawIdsById = new Map(rooms.map((r, i) => [r._id.toString(), rawIdsByRoom[i]]));
    const lastReadAtByRoomId = new Map<string, Date | null>(
      rooms.map(r => [r._id.toString(), r.lastReadAt?.get(viewerId) ?? null]),
    );

    const [lastMessages, unreadCounts] = await Promise.all([
      this.lastMessageByRoom(roomIds),
      this.unreadCountsByRoom(roomIds, viewerId, lastReadAtByRoomId),
    ]);

    for (const view of views) {
      const last = lastMessages.get(view.id);
      if (last) {
        // The *raw* member id list, not `view.members` — array-populate
        // silently drops any id that doesn't resolve to a real User
        // document (see `toRoomView`'s doc comment), so a member whose
        // account failed to populate would otherwise be invisible to this
        // check even though their `lastReadAt` entry is right there on the
        // room. Display info still comes from `view.members` and degrades
        // to a nameless entry rather than disappearing.
        const room = roomsById.get(view.id);
        const rawIds = rawIdsById.get(view.id) ?? [];
        const lastCreatedMs = last.createdAt.getTime();
        const seenBy = rawIds
          .filter(id => id !== last.senderId)
          .filter(id => {
            const readAt = room?.lastReadAt?.get(id);
            return !!readAt && readAt.getTime() >= lastCreatedMs;
          })
          .map(id => view.members.find(m => m.id === id) ?? { id, name: null, profilePicture: '' });
        view.last_message = {
          content: last.content,
          sender_name: view.members.find(m => m.id === last.senderId)?.name ?? null,
          created_at: last.createdAt,
          seen_by: seenBy,
        };
      } else {
        view.last_message = null;
      }
      view.unread_count = unreadCounts.get(view.id) ?? 0;
    }

    return [...views].sort((a, b) => {
      const aTime = (a.last_message?.created_at ?? a.created_at ?? new Date(0)).getTime();
      const bTime = (b.last_message?.created_at ?? b.created_at ?? new Date(0)).getTime();
      return bTime - aTime;
    });
  }

  /**
   * Create an expedition's group chat.
   *
   * Many rooms can exist for the same trek — each is its own expedition with
   * its own dates and capacity — so this is a plain create, not a join. The
   * creator is always taken from the JWT, never the body, so a caller cannot
   * open a room attributed to somebody else. Difficulty is resolved from the
   * trek's catalogue entry rather than trusted from the client, so a room can
   * never advertise a difficulty that disagrees with the actual route.
   */
  async createRoom(creatorId: string, data: CreateRoomDto): Promise<ChatRoomView> {
    const trekId = data.trekId.trim();
    const destination = await this.destinationsService.findByIdOrThrow(trekId);

    // The client already prevents this in the calendar picker, but the
    // itinerary's own duration is the actual constraint — a 10-day trek
    // cannot be planned for a single day — so it's re-checked here rather
    // than trusted, same as every other business rule in this service.
    if (data.startDate && data.endDate) {
      const MS_PER_DAY = 86_400_000;
      const spanDays = Math.round((data.endDate.getTime() - data.startDate.getTime()) / MS_PER_DAY) + 1;
      if (spanDays < destination.durationDays) {
        throw new BadRequestException(
          `${destination.name} takes ${destination.durationDays} days — pick a wider date range.`,
        );
      }
    }

    const room = new this.roomModel({
      trekId,
      roomName: data.roomName.trim(),
      destinationName: destination.name,
      location: destination.location,
      durationDays: destination.durationDays,
      difficulty: destination.difficulty,
      maxMembers: data.maxMembers,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      members: [new Types.ObjectId(creatorId)],
    });
    const saved = await room.save();
    return this.toRoomView(saved, this.rawMemberIds(saved), creatorId);
  }

  /**
   * The discovery feed: every room, optionally narrowed by filters, newest
   * first — except rooms `viewerId` already belongs to, which never appear
   * here at all now (they live exclusively in "My Chats"). Pass `mine: true`
   * to get the opposite: only rooms the viewer belongs to, most-recently-
   * active first, each with its `last_message`/`unread_count` attached.
   */
  async listRooms(filters: RoomFilters, viewerId?: string): Promise<ChatRoomView[]> {
    const query: Record<string, any> = {};

    const search = typeof filters.search === 'string' ? filters.search.trim() : '';
    if (search) {
      const escaped = escapeRegex(search).slice(0, 128);
      query.$or = [
        { roomName: { $regex: escaped, $options: 'i' } },
        { destinationName: { $regex: escaped, $options: 'i' } },
        { location: { $regex: escaped, $options: 'i' } },
      ];
    }

    const location = typeof filters.location === 'string' ? filters.location.trim() : '';
    if (location) {
      query.location = { $regex: escapeRegex(location).slice(0, 128), $options: 'i' };
    }

    if (typeof filters.difficulty === 'string' && DIFFICULTIES.has(filters.difficulty)) {
      query.difficulty = filters.difficulty;
    }

    if (Number.isFinite(filters.durationDays)) {
      query.durationDays = { $lte: filters.durationDays };
    }

    // "At least this many open spots" — expressed against the two stored
    // fields directly, so a room the array hasn't caught up on (impossible in
    // practice, since `joinRoom` updates both atomically) still can't drift.
    if (Number.isFinite(filters.capacity)) {
      query.$expr = { $gte: [{ $subtract: ['$maxMembers', { $size: '$members' }] }, filters.capacity] };
    }

    // "My Chats" narrows to rooms the viewer belongs to; the discovery feed
    // does the opposite by default — a joined room has nothing left to
    // "discover" and would just be a confusing duplicate of its My Chats row.
    if (viewerId) {
      const viewerObjectId = new Types.ObjectId(viewerId);
      query.members = filters.mine ? viewerObjectId : { $ne: viewerObjectId };
    }

    const rooms = await this.roomModel.find(query).sort({ createdAt: -1 }).exec();
    // Snapshot every room's raw ids before the batch populate below mutates
    // `members` in place — see `toRoomView`'s doc comment for why the order
    // matters.
    const rawIdsByRoom = rooms.map(r => this.rawMemberIds(r));
    await this.roomModel.populate(rooms, { path: 'members', select: 'name profilePicture' });
    let views = rooms.map((r, i) => this.toRoomView(r, rawIdsByRoom[i], viewerId));

    if (filters.mine && viewerId) {
      views = await this.enrichWithActivity(views, rooms, rawIdsByRoom, viewerId);
    } else if (viewerId) {
      views = await this.rankDiscoveryFeed(views, rawIdsByRoom, viewerId);
    }
    return views;
  }

  /**
   * Discovery-feed ranking: rooms sharing a member with one of the viewer's
   * own rooms first (labelled with who), then everything else, newest first
   * within each group — and a full room always sinks to the very bottom
   * regardless of that, since there's nothing left to discover about a room
   * you can't actually join.
   */
  private async rankDiscoveryFeed(
    views: ChatRoomView[],
    rawIdsByRoom: string[][],
    viewerId: string,
  ): Promise<ChatRoomView[]> {
    const myRooms = await this.roomModel
      .find({ members: new Types.ObjectId(viewerId) }, { members: 1 })
      .lean()
      .exec();
    const coMemberIds = new Set<string>();
    for (const r of myRooms) {
      for (const m of r.members as any[]) {
        const id = m.toString();
        if (id !== viewerId) coMemberIds.add(id);
      }
    }

    if (coMemberIds.size > 0) {
      views.forEach((view, i) => {
        const rawIds = rawIdsByRoom[i];
        const mutualIds = rawIds.filter(id => coMemberIds.has(id));
        if (mutualIds.length === 0) return;
        // Same graceful-degradation reasoning as `enrichWithActivity`'s
        // `seen_by`: an id that failed to populate still counts as a real
        // mutual connection, just displayed without a name.
        view.mutual_connections = mutualIds.map(
          id => view.members.find(m => m.id === id) ?? { id, name: null, profilePicture: '' },
        );
      });
    }

    return [...views].sort((a, b) => {
      if (a.is_full !== b.is_full) return a.is_full ? 1 : -1;
      const aMutual = (a.mutual_connections?.length ?? 0) > 0;
      const bMutual = (b.mutual_connections?.length ?? 0) > 0;
      if (aMutual !== bMutual) return aMutual ? -1 : 1;
      return (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0);
    });
  }

  /** A room by id, or null when it does not exist. */
  async getRoom(id: string, viewerId?: string): Promise<ChatRoomView | null> {
    if (!this.isValidId(id)) return null;
    const room = await this.roomModel.findById(id).exec();
    if (!room) return null;
    const rawIds = this.rawMemberIds(room);
    await room.populate('members', 'name profilePicture');
    return this.toRoomView(room, rawIds, viewerId);
  }

  /** True when `userId` is a member of this room. */
  async isMember(roomId: string, userId: string): Promise<boolean> {
    if (!this.isValidId(roomId) || !this.isValidId(userId)) return false;
    const found = await this.roomModel
      .findOne({ _id: roomId, members: new Types.ObjectId(userId) })
      .select('_id')
      .lean()
      .exec();
    return found !== null;
  }

  /**
   * Join a room, enforcing its capacity atomically.
   *
   * The `members: { $ne }` and size-vs-`maxMembers` checks live in the same
   * `findOneAndUpdate` filter as the `$push` — MongoDB matches-and-modifies a
   * single document as one atomic step, so two people racing for the last open
   * spot cannot both win: only one query matches once the push lands, however
   * close together the two requests arrive. A client-side "is it full" check
   * alone cannot make that guarantee.
   */
  async joinRoom(
    roomId: string,
    userId: string,
  ): Promise<{ room: ChatRoomView | null; error?: 'not_found' | 'already_member' | 'full' }> {
    if (!this.isValidId(roomId) || !this.isValidId(userId)) {
      return { room: null, error: 'not_found' };
    }
    const memberId = new Types.ObjectId(userId);

    const updated = await this.roomModel
      .findOneAndUpdate(
        {
          _id: roomId,
          members: { $ne: memberId },
          $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] },
        },
        { $push: { members: memberId } },
        { new: true },
      )
      .exec();

    if (updated) {
      const rawIds = this.rawMemberIds(updated);
      await updated.populate('members', 'name profilePicture');
      return { room: this.toRoomView(updated, rawIds, userId) };
    }

    // The update matched nothing — distinguish why, so the caller can report
    // it accurately instead of a generic failure.
    const existing = await this.roomModel.findById(roomId).select('members maxMembers').lean().exec();
    if (!existing) return { room: null, error: 'not_found' };
    const already = existing.members.some((m: any) => m.toString() === userId);
    return { room: null, error: already ? 'already_member' : 'full' };
  }

  /**
   * Leave a room. Symmetric for every member, creator included — nothing in
   * this schema distinguishes an "owner" from anyone else, so there is no
   * transfer-of-ownership question to resolve here. Also drops the leaver's
   * `lastReadAt` entry; a stale timestamp for someone no longer in the room
   * is just dead weight in that map.
   */
  async leaveRoom(roomId: string, userId: string): Promise<{ ok: boolean; error?: 'not_found' }> {
    if (!this.isValidId(roomId) || !this.isValidId(userId)) return { ok: false, error: 'not_found' };
    const updated = await this.roomModel
      .updateOne(
        { _id: roomId, members: new Types.ObjectId(userId) },
        { $pull: { members: new Types.ObjectId(userId) }, $unset: { [`lastReadAt.${userId}`]: '' } },
      )
      .exec();
    if (updated.matchedCount === 0) return { ok: false, error: 'not_found' };
    return { ok: true };
  }

  /**
   * Recent messages for a room, oldest first, with the sender populated. The
   * limit is a safety valve so a very busy room cannot dump unbounded history
   * over the wire on open.
   */
  async getMessages(roomId: string, limit = 200): Promise<ChatMessageView[]> {
    if (!this.isValidId(roomId)) return [];
    const [messages, room] = await Promise.all([
      this.messageModel.find({ chatRoomId: roomId }).sort({ createdAt: 1 }).limit(limit).exec(),
      this.roomModel.findById(roomId).select('members lastReadAt').lean().exec(),
    ]);
    // Snapshot each message's raw sender id before the batch populate below
    // mutates `senderId` in place — see `toMessageView`'s doc comment.
    const senderIds = messages.map(m => m.senderId.toString());
    await this.messageModel.populate(messages, { path: 'senderId', select: 'name profilePicture' });

    // `.lean()` serialises the schema's Map to a plain object, not a real
    // `Map` instance — normalise it back so `toMessageView` has one shape to
    // read from regardless of which query produced it.
    const readInfo = room
      ? { memberIds: room.members.map((m: any) => m.toString()), lastReadAt: new Map(Object.entries(room.lastReadAt ?? {})) }
      : undefined;
    return messages.map((m, i) => this.toMessageView(m, senderIds[i], readInfo));
  }

  /**
   * Persist a message and return it in the wire shape the room is broadcast.
   *
   * Also advances the sender's own `lastReadAt` to this message's timestamp —
   * sending implies having read up to that point, so a room with unread
   * messages from before wouldn't otherwise clear just because you replied.
   */
  async saveMessage(roomId: string, senderId: string, content: string): Promise<ChatMessageView | null> {
    if (!this.isValidId(roomId) || !this.isValidId(senderId)) return null;
    const message = new this.messageModel({
      chatRoomId: new Types.ObjectId(roomId),
      senderId: new Types.ObjectId(senderId),
      content,
    });
    const saved = await message.save();
    await Promise.all([
      saved.populate('senderId', 'name profilePicture'),
      this.roomModel
        .updateOne({ _id: roomId }, { $set: { [`lastReadAt.${senderId}`]: saved.createdAt } })
        .exec(),
    ]);
    // A message nobody else has had the chance to see yet — no other
    // member's `lastReadAt` can already be past it, so `seenBy` is always
    // empty for a message that was just created.
    return this.toMessageView(saved as MessageDocument, senderId);
  }

  /**
   * Record that `userId` has read up through now, and report who else is in
   * the room so the gateway can tell them their message just got seen.
   */
  async markRead(roomId: string, userId: string): Promise<{ at: Date; otherMemberIds: string[] } | null> {
    if (!this.isValidId(roomId) || !this.isValidId(userId)) return null;
    const at = new Date();
    const room = await this.roomModel
      .findOneAndUpdate(
        { _id: roomId, members: new Types.ObjectId(userId) },
        { $set: { [`lastReadAt.${userId}`]: at } },
        { new: true },
      )
      .select('members')
      .lean()
      .exec();
    if (!room) return null;
    const otherMemberIds = room.members.map((m: any) => m.toString()).filter(id => id !== userId);
    return { at, otherMemberIds };
  }

  /** Count of the viewer's rooms that have at least one unread message — the Profile badge. */
  async getUnreadRoomCount(viewerId: string): Promise<number> {
    if (!this.isValidId(viewerId)) return 0;
    const viewerObjectId = new Types.ObjectId(viewerId);
    const rooms = await this.roomModel.find({ members: viewerObjectId }).select('lastReadAt').lean().exec();
    if (rooms.length === 0) return 0;

    const roomIds = rooms.map(r => r._id as Types.ObjectId);
    const lastReadAtByRoomId = new Map<string, Date | null>(
      rooms.map(r => [r._id.toString(), (r.lastReadAt as any)?.[viewerId] ?? null]),
    );
    const unreadCounts = await this.unreadCountsByRoom(roomIds, viewerId, lastReadAtByRoomId);
    return [...unreadCounts.values()].filter(count => count > 0).length;
  }
}
