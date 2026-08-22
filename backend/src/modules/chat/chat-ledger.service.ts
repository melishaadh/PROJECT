import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LedgerEntry, LedgerEntryDocument } from '@db/schemas/ledger-entry.schema';
import { ChatRoom, ChatRoomDocument } from '@db/schemas/chat-room.schema';
import { ChatService, RoomMemberPreview } from './chat.service';

export interface LedgerEntryView {
  id: string;
  roomId: string;
  payer: RoomMemberPreview;
  amount: number;
  remark: string;
  addedBy: string;
  created_at: Date | null;
}

export interface LedgerSummaryRow {
  member: RoomMemberPreview;
  total: number;
}

/**
 * A group's shared expense ledger — who paid for what on a trip, logged by
 * any member on anyone's behalf. Lives alongside chat rather than as its own
 * module: an entry only ever makes sense scoped to a room's membership, the
 * same access rule messages already enforce, so this reuses
 * `ChatService.isMember` rather than duplicating that check.
 */
@Injectable()
export class ChatLedgerService {
  constructor(
    @InjectModel(LedgerEntry.name) private readonly ledgerModel: Model<LedgerEntryDocument>,
    @InjectModel(ChatRoom.name) private readonly roomModel: Model<ChatRoomDocument>,
    private readonly chatService: ChatService,
  ) {}

  private isValidId(id: string): boolean {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
  }

  /** Member previews for every entry's payer, keyed by id — resolved once per read rather than per row. */
  private async memberPreviewsFor(roomId: string): Promise<Map<string, RoomMemberPreview>> {
    const room = await this.roomModel
      .findById(roomId)
      .populate('members', 'name profilePicture')
      .select('members')
      .exec();
    const map = new Map<string, RoomMemberPreview>();
    if (!room) return map;
    for (const m of room.members as any[]) {
      if (m && typeof m === 'object' && !(m instanceof Types.ObjectId)) {
        map.set(m._id.toString(), {
          id: m._id.toString(),
          name: typeof m.name === 'string' ? m.name : null,
          profilePicture: typeof m.profilePicture === 'string' ? m.profilePicture : '',
        });
      }
    }
    return map;
  }

  /**
   * Every entry, newest first, plus a per-member running total. Members with
   * no logged expense yet still appear in the summary at 0 — the point of a
   * shared ledger is seeing who *hasn't* paid anything, not just who has.
   */
  async getLedger(
    roomId: string,
    viewerId: string,
  ): Promise<{ entries: LedgerEntryView[]; summary: LedgerSummaryRow[] } | { error: 'forbidden' }> {
    if (!this.isValidId(roomId)) return { entries: [], summary: [] };
    if (!(await this.chatService.isMember(roomId, viewerId))) return { error: 'forbidden' };

    const [entries, previews] = await Promise.all([
      this.ledgerModel.find({ roomId }).sort({ createdAt: -1 }).lean().exec(),
      this.memberPreviewsFor(roomId),
    ]);

    const fallback = (id: Types.ObjectId): RoomMemberPreview => ({
      id: id.toString(),
      name: null,
      profilePicture: '',
    });

    const entryViews: LedgerEntryView[] = entries.map(e => ({
      id: e._id.toString(),
      roomId: e.roomId.toString(),
      payer: previews.get(e.payerId.toString()) ?? fallback(e.payerId),
      amount: e.amount,
      remark: e.remark,
      addedBy: e.addedBy.toString(),
      created_at: e.createdAt ?? null,
    }));

    const totals = new Map<string, number>();
    for (const e of entries) {
      const key = e.payerId.toString();
      totals.set(key, (totals.get(key) ?? 0) + e.amount);
    }
    // Every current member appears even at 0 — pulled from `previews` rather
    // than only the ids that have an entry.
    for (const id of previews.keys()) {
      if (!totals.has(id)) totals.set(id, 0);
    }
    const summary: LedgerSummaryRow[] = [...totals.entries()]
      .map(([id, total]) => ({ member: previews.get(id) ?? fallback(new Types.ObjectId(id)), total }))
      .sort((a, b) => b.total - a.total);

    return { entries: entryViews, summary };
  }

  /** Log an expense. Both the payer and the person logging it must already be members. */
  async addEntry(
    roomId: string,
    addedBy: string,
    payerId: string,
    amount: number,
    remark: string,
  ): Promise<LedgerEntryView> {
    if (!this.isValidId(roomId) || !this.isValidId(addedBy) || !this.isValidId(payerId)) {
      throw new NotFoundException('Room not found');
    }
    if (!(await this.chatService.isMember(roomId, addedBy))) {
      throw new ForbiddenException('You must be a member of this room to log an expense.');
    }
    if (!(await this.chatService.isMember(roomId, payerId))) {
      throw new BadRequestException('That person is not in this group.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Enter an amount greater than zero.');
    }

    const entry = await this.ledgerModel.create({
      roomId: new Types.ObjectId(roomId),
      payerId: new Types.ObjectId(payerId),
      addedBy: new Types.ObjectId(addedBy),
      amount,
      remark: remark.trim(),
    });

    const previews = await this.memberPreviewsFor(roomId);
    return {
      id: entry._id.toString(),
      roomId,
      payer: previews.get(payerId) ?? { id: payerId, name: null, profilePicture: '' },
      amount: entry.amount,
      remark: entry.remark,
      addedBy,
      created_at: entry.createdAt ?? null,
    };
  }

  /** Only whoever logged an entry can remove it — not the payer, not any other member. */
  async deleteEntry(roomId: string, entryId: string, requesterId: string): Promise<{ ok: boolean; error?: 'not_found' | 'forbidden' }> {
    if (!this.isValidId(roomId) || !this.isValidId(entryId) || !this.isValidId(requesterId)) {
      return { ok: false, error: 'not_found' };
    }
    const entry = await this.ledgerModel.findOne({ _id: entryId, roomId }).exec();
    if (!entry) return { ok: false, error: 'not_found' };
    if (entry.addedBy.toString() !== requesterId) return { ok: false, error: 'forbidden' };
    await entry.deleteOne();
    return { ok: true };
  }
}
