import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * A single chat message inside a room.
 *
 * `senderId` stays an ObjectId reference in storage; the sender's name and
 * picture are attached at read time via `populate`, so a rename or a new DP
 * shows up in history without rewriting past messages.
 *
 * Both id fields use `MongooseSchema.Types.ObjectId` deliberately, not the
 * `Types.ObjectId` (BSON) class imported above — that's a different export
 * despite the identical name (`Types.ObjectId` builds *values*, e.g. `new
 * Types.ObjectId(id)`, while `Schema.Types.ObjectId` declares a *field's
 * type*). Using the value class as a field type gets silently accepted by
 * Mongoose but registered as `Mixed`, which stores an assigned ObjectId fine
 * but never casts a query's string filter to compare against it — so
 * `find({ chatRoomId: someString })` would ever have matched zero documents
 * even though the field looks completely normal.
 */
@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'User' })
  senderId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  content!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'ChatRoom' })
  chatRoomId!: Types.ObjectId;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// The history read is `find({ chatRoomId })` sorted by time.
MessageSchema.index({ chatRoomId: 1, createdAt: 1 });

export type MessageDocument = Message & Document;
