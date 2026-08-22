import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ChatDifficulty = 'Easy' | 'Moderate' | 'Hard';

/**
 * An expedition's group chat — many rooms can exist for the same trek (each
 * with its own dates and capacity), created via the "New Expedition" flow
 * rather than one auto-joined room per trek.
 *
 * The creator is written into `members` by `ChatService.createRoom`, so the
 * room always starts with its owner already inside.
 */
@Schema({ timestamps: true })
export class ChatRoom extends Document {
  /** The catalogue trek id this room is about (e.g. `'1'`, `'2'`). */
  @Prop({ required: true, trim: true })
  trekId!: string;

  /** Display name shown in the header and the discovery card. */
  @Prop({ required: true, trim: true })
  roomName!: string;

  /**
   * `destinationName`, `location` and `durationDays` are all resolved from
   * `DestinationsService.findById(trekId)` once, at creation, and stored here —
   * denormalised so the discovery feed's search/filter/card rendering never has
   * to join against the destinations collection on every request.
   */
  @Prop({ required: true, trim: true })
  destinationName!: string;

  @Prop({ trim: true, default: '' })
  location!: string;

  @Prop({ required: true, default: 0 })
  durationDays!: number;

  /** Users who can see and message this room. Bounded by `maxMembers`. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members!: Types.ObjectId[];

  /**
   * Hard cap on `members.length`, enforced atomically in
   * `ChatService.joinRoom` — never trust a client-side check alone, since two
   * people can tap "Join" on the last open spot at the same moment.
   */
  @Prop({ required: true, min: 1, max: 500 })
  maxMembers!: number;

  /**
   * Resolved server-side from the trek's catalogue entry at creation time
   * (`DestinationsService.findById`), never accepted from the client — the
   * client could otherwise advertise a mismatched difficulty for the actual
   * route.
   */
  @Prop({ required: true, enum: ['Easy', 'Moderate', 'Hard'] })
  difficulty!: ChatDifficulty;

  @Prop({ type: Date, default: null })
  startDate!: Date | null;

  @Prop({ type: Date, default: null })
  endDate!: Date | null;

  /**
   * Per-member "read up to" timestamp, keyed by user id string. Read receipts
   * are computed from this rather than stored per-message — a per-message
   * read flag would need writing on every message for every member as each
   * one reads, while this needs exactly one write per member per read event.
   * A message is "seen" once any other member's entry here is at or after
   * that message's `createdAt` — see `ChatService`'s doc comment for why
   * that's "any other member," not "every other member".
   */
  @Prop({ type: MongooseSchema.Types.Map, of: Date, default: () => new Map() })
  lastReadAt!: Map<string, Date>;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom);

// The discovery feed's default listing: "recently created first", optionally
// narrowed to one trek.
ChatRoomSchema.index({ trekId: 1, createdAt: -1 });
// Membership lookup: "which rooms is this user in" and "is this user in this
// room" both filter on the array.
ChatRoomSchema.index({ members: 1 });

export type ChatRoomDocument = ChatRoom & Document;
