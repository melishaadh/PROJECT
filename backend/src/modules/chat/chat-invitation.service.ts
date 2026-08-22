import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatInvitation, ChatInvitationDocument } from '@db/schemas/chat-invitation.schema';
import { ChatService } from './chat.service';

export interface InvitationView {
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
  created_at: Date | null;
}

@Injectable()
export class ChatInvitationService {
  constructor(
    @InjectModel(ChatInvitation.name) private readonly invitationModel: Model<ChatInvitationDocument>,
    private readonly chatService: ChatService,
  ) {}

  private isValidId(id: string): boolean {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
  }

  /**
   * `inviterId` is the *raw* id — captured before `.populate()` touches the
   * document, same reasoning as `ChatService.toMessageView`. Whether the
   * inviter's profile resolves is unrelated to whether the invitation itself
   * is valid: a message from a since-deleted sender still renders (as
   * `sender: null`), and an invite works the same way. Only the *room*
   * failing to populate makes the invite meaningless to show at all — there
   * would be no destination, capacity or member count left to render — so
   * that's the one case this returns `null` for.
   */
  private toView(inv: ChatInvitationDocument, inviterId: string): InvitationView | null {
    const room = (inv as any).roomId;
    const hasRoom = room && typeof room === 'object' && !(room instanceof Types.ObjectId);
    if (!hasRoom) return null;

    const inviter = (inv as any).inviterId;
    const hasInviter = inviter && typeof inviter === 'object' && !(inviter instanceof Types.ObjectId);

    const memberCount = Array.isArray(room.members) ? room.members.length : 0;
    return {
      id: inv._id.toString(),
      status: inv.status,
      room: {
        id: room._id.toString(),
        roomName: room.roomName ?? '',
        destinationName: room.destinationName ?? '',
        maxMembers: room.maxMembers ?? 0,
        member_count: memberCount,
        is_full: memberCount >= (room.maxMembers ?? 0),
      },
      inviter: {
        id: inviterId,
        name: hasInviter && typeof inviter.name === 'string' ? inviter.name : null,
        profilePicture: hasInviter && typeof inviter.profilePicture === 'string' ? inviter.profilePicture : '',
      },
      created_at: inv.createdAt ?? null,
    };
  }

  /**
   * Invite a user to a room. Only current members can invite — otherwise
   * anyone could spam invitations into a room they have no standing in. The
   * invitee is not required to exist as a real user (nothing here queries the
   * `users` collection): a bogus id just never surfaces to anyone, harmless.
   */
  async createInvitation(roomId: string, inviterId: string, inviteeId: string): Promise<InvitationView> {
    if (!this.isValidId(roomId) || !this.isValidId(inviterId) || !this.isValidId(inviteeId)) {
      throw new NotFoundException('Room not found');
    }
    if (inviterId === inviteeId) {
      throw new BadRequestException('You cannot invite yourself.');
    }
    if (!(await this.chatService.isMember(roomId, inviterId))) {
      throw new ForbiddenException('You must be a member of this room to invite someone.');
    }
    if (await this.chatService.isMember(roomId, inviteeId)) {
      throw new BadRequestException('That person is already in this group.');
    }

    let invitation: ChatInvitationDocument;
    try {
      invitation = await this.invitationModel.create({
        roomId: new Types.ObjectId(roomId),
        inviterId: new Types.ObjectId(inviterId),
        inviteeId: new Types.ObjectId(inviteeId),
      });
    } catch (err: any) {
      // The partial unique index rejects a second pending invite to the same
      // person for the same room — that's a real, expected outcome here, not
      // an infra failure, so it gets a clean 409 rather than surfacing as one.
      if (err?.code === 11000) throw new ConflictException('This person already has a pending invite to this group.');
      throw err;
    }

    await invitation.populate([
      { path: 'roomId', select: 'roomName destinationName maxMembers members' },
      { path: 'inviterId', select: 'name profilePicture' },
    ]);
    const view = this.toView(invitation, inviterId);
    if (!view) throw new NotFoundException('Room not found');
    return view;
  }

  /** Every pending invite addressed to `userId`, newest first. */
  async getMyInvitations(userId: string): Promise<InvitationView[]> {
    if (!this.isValidId(userId)) return [];
    const invitations = await this.invitationModel
      .find({ inviteeId: userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .exec();
    // Snapshot each invite's raw inviter id before the batch populate below
    // mutates `inviterId` in place — see `toView`'s doc comment.
    const inviterIds = invitations.map(inv => inv.inviterId.toString());
    await this.invitationModel.populate(invitations, [
      { path: 'roomId', select: 'roomName destinationName maxMembers members' },
      { path: 'inviterId', select: 'name profilePicture' },
    ]);
    // A room deleted after the invite was sent — not currently possible (no
    // delete-room feature exists), but `toView` returning null rather than a
    // half-filled object is what keeps that non-crashing if it ever is.
    return invitations
      .map((inv, i) => this.toView(inv, inviterIds[i]))
      .filter((v): v is InvitationView => v !== null);
  }

  /**
   * Which of `roomIds` already have a *pending* invite out to `inviteeId` —
   * regardless of who sent it. The picker in `ProfileScreen`'s "Add to
   * Group" sheet uses this to show "Invite sent" instead of a tappable row:
   * the partial unique index would reject a second one anyway, so this is
   * just telling the truth about what will happen before the user taps.
   */
  async pendingInviteRoomIds(roomIds: string[], inviteeId: string): Promise<Set<string>> {
    if (!this.isValidId(inviteeId) || roomIds.length === 0) return new Set();
    const validRoomIds = roomIds.filter(id => this.isValidId(id)).map(id => new Types.ObjectId(id));
    if (validRoomIds.length === 0) return new Set();
    const pending = await this.invitationModel
      .find({ roomId: { $in: validRoomIds }, inviteeId, status: 'pending' }, { roomId: 1 })
      .lean()
      .exec();
    return new Set(pending.map(p => p.roomId.toString()));
  }

  /**
   * Accept or decline. Accepting reuses `ChatService.joinRoom` rather than
   * duplicating its atomic capacity check — accepting an invite is exactly
   * "join, pre-authorised", so it should enforce the exact same guarantee a
   * public Join tap does: two acceptances racing for the last spot cannot
   * both win.
   *
   * The room join and the invitation's status update are two different
   * documents, so this isn't atomic *across* both — if the room-side update
   * succeeds and the status write then somehow failed, the user would be a
   * real member with their invite still marked pending. No transaction is
   * used here (none exist anywhere else in this codebase yet); the room
   * write is the one that has to be correct, and it's ordered first.
   */
  async respond(
    invitationId: string,
    userId: string,
    accept: boolean,
  ): Promise<{ status: 'accepted' | 'declined'; error?: 'not_found' | 'full' }> {
    if (!this.isValidId(invitationId) || !this.isValidId(userId)) {
      return { status: 'declined', error: 'not_found' };
    }
    const invitation = await this.invitationModel.findOne({
      _id: invitationId,
      inviteeId: userId,
      status: 'pending',
    });
    if (!invitation) return { status: 'declined', error: 'not_found' };

    if (!accept) {
      invitation.status = 'declined';
      await invitation.save();
      return { status: 'declined' };
    }

    const { room, error } = await this.chatService.joinRoom(invitation.roomId.toString(), userId);
    // `already_member` is not a failure here — they're in either way, which is
    // exactly what accepting was supposed to achieve.
    if (!room && error === 'full') return { status: 'declined', error: 'full' };

    invitation.status = 'accepted';
    await invitation.save();
    return { status: 'accepted' };
  }
}
