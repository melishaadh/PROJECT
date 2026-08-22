import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type InvitationStatus = 'pending' | 'accepted' | 'declined';

/**
 * An invite from one room member to another user.
 *
 * `roomId`/`inviterId`/`inviteeId` all use `MongooseSchema.Types.ObjectId` —
 * not the `Types.ObjectId` (BSON value) class — deliberately: see
 * `message.schema.ts` for the exact failure mode of getting this wrong
 * (queries silently matching nothing because the field ends up typed
 * `Mixed`).
 */
@Schema({ timestamps: true })
export class ChatInvitation extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'ChatRoom' })
  roomId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'User' })
  inviterId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'User' })
  inviteeId!: Types.ObjectId;

  @Prop({ required: true, enum: ['pending', 'accepted', 'declined'], default: 'pending' })
  status!: InvitationStatus;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const ChatInvitationSchema = SchemaFactory.createForClass(ChatInvitation);

/** "My pending invites" — the query `getMyInvitations` runs. */
ChatInvitationSchema.index({ inviteeId: 1, status: 1 });

/**
 * At most one *pending* invite per (room, invitee) at a time — a partial
 * index rather than a plain unique one, so the same person can be invited
 * again after declining (or after a previous invite to a different run of
 * the same room membership), without the old accepted/declined row blocking
 * it forever.
 */
ChatInvitationSchema.index(
  { roomId: 1, inviteeId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

export type ChatInvitationDocument = ChatInvitation & Document;
