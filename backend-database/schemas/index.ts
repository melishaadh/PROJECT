/**
 * Public surface of the persistence layer.
 *
 * Each schema module is also importable directly (`@db/schemas/user.schema`),
 * which is what the Nest modules do so that `MongooseModule.forFeature` names
 * the one collection it registers. This barrel exists for consumers that want
 * the whole model set — the migration and seed scripts — and re-exports the
 * schema *classes* alongside the compiled schemas, since `@Prop` decorators
 * make the class the source of truth for both the type and the shape.
 */

export { User, UserSchema, PROFILE_RANGES } from './user.schema';
export type { UserDocument, UserProfile, UserPreferences } from './user.schema';

export { Destination, DestinationSchema } from './destination.schema';
export type { DestinationDocument } from './destination.schema';

export { UserInteraction, UserInteractionSchema } from './user-interaction.schema';
export type { UserInteractionDocument } from './user-interaction.schema';

export { RefreshToken, RefreshTokenSchema } from './refresh-token.schema';
export type { RefreshTokenDocument } from './refresh-token.schema';

export { ChatRoom, ChatRoomSchema } from './chat-room.schema';
export type { ChatRoomDocument } from './chat-room.schema';

export { Message, MessageSchema } from './message.schema';
export type { MessageDocument } from './message.schema';

export { ChatInvitation, ChatInvitationSchema } from './chat-invitation.schema';
export type { ChatInvitationDocument } from './chat-invitation.schema';

export { LedgerEntry, LedgerEntrySchema } from './ledger-entry.schema';
export type { LedgerEntryDocument } from './ledger-entry.schema';
