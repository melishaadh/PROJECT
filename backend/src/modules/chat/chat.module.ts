import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './chat.controller';
import { ChatInvitationController } from './chat-invitation.controller';
import { ChatLedgerController } from './chat-ledger.controller';
import { ChatService } from './chat.service';
import { ChatInvitationService } from './chat-invitation.service';
import { ChatLedgerService } from './chat-ledger.service';
import { ChatGateway } from './chat.gateway';
import { ChatRoom, ChatRoomSchema } from '@db/schemas/chat-room.schema';
import { Message, MessageSchema } from '@db/schemas/message.schema';
import { ChatInvitation, ChatInvitationSchema } from '@db/schemas/chat-invitation.schema';
import { LedgerEntry, LedgerEntrySchema } from '@db/schemas/ledger-entry.schema';
import { AuthModule } from '@/modules/auth/auth.module';
import { DestinationsModule } from '@/modules/destinations/destinations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: Message.name, schema: MessageSchema },
      { name: ChatInvitation.name, schema: ChatInvitationSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
    ]),
    // Provides the `JwtService` the gateway uses to authenticate socket
    // handshakes with the same access-token secret as the HTTP API.
    AuthModule,
    // Provides `DestinationsService`, which `ChatService.createRoom` reads
    // (never writes) to resolve a room's difficulty/location/duration from
    // the trek's real catalogue entry.
    DestinationsModule,
  ],
  // `ChatInvitationController` registers `rooms/invite-status` — a static
  // path shaped exactly like `ChatController`'s `rooms/:id`. Express matches
  // by registration order, not specificity, so the invitation controller has
  // to come first or its route is silently unreachable (swallowed as a
  // `:id` lookup for the literal id "invite-status").
  controllers: [ChatInvitationController, ChatLedgerController, ChatController],
  providers: [ChatService, ChatInvitationService, ChatLedgerService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
