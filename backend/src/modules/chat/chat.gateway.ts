import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatService } from './chat.service';
import { InvitationView } from './chat-invitation.service';

/** Socket.io room name for a chat room. Kept distinct from the ObjectId. */
const ROOM_PREFIX = 'chat-room-';

/**
 * Every authenticated socket's personal channel — the delivery target for
 * events addressed to a specific person rather than a room, like a new
 * invitation. Joined automatically on connect, since there is no "opt in"
 * step for a notification meant for you specifically.
 */
const USER_PREFIX = 'chat-user-';

/**
 * Socket CORS policy, mirroring the HTTP layer in `main.ts`: an explicit
 * `CORS_ORIGINS` allow-list wins, production refuses cross-origin entirely,
 * development reflects whatever asked.
 */
function socketCors(): any {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

interface JoinRoomBody {
  roomId?: string;
}

interface SendMessageBody {
  roomId?: string;
  content?: string;
}

interface LeaveRoomBody {
  roomId?: string;
}

interface MarkReadBody {
  roomId?: string;
}

interface TypingBody {
  roomId?: string;
  /**
   * The client's own display name, relayed as-is rather than looked up
   * server-side — typing events fire on every keystroke (throttled, but still
   * frequent) and are purely ephemeral, so a DB round trip per event isn't
   * worth paying for a "Someone is typing…" fallback the client can render
   * just as well itself if this is missing.
   */
  name?: string;
}

/**
 * Real-time chat gateway.
 *
 * Connections are authenticated with the same access JWT the HTTP API uses,
 * passed in the handshake as `auth.token`. Auth runs as socket.io middleware
 * (not `handleConnection`), so no event is dispatched to a socket until its
 * identity is known — a client cannot race `joinRoom` ahead of verification.
 *
 * Every membership check is repeated server-side on each event rather than
 * trusted from the connection: the JWT proves *who* you are, membership decides
 * *where* you may speak, and the two are checked separately.
 */
@WebSocketGateway({
  cors: { origin: socketCors(), credentials: true },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication required'));
      }
      try {
        const payload = await this.jwtService.verifyAsync<{ sub?: string; type?: string }>(
          token,
          { algorithms: ['HS256'] },
        );
        if (payload?.type !== 'access' || typeof payload.sub !== 'string') {
          return next(new Error('Invalid token'));
        }
        // Same guard the JWT strategy applies to HTTP: a subject that is not an
        // ObjectId flows straight into Mongo queries, so reject it here too.
        if (!Types.ObjectId.isValid(payload.sub)) {
          return next(new Error('Invalid token'));
        }
        socket.data.userId = payload.sub;
        next();
      } catch {
        next(new Error('Authentication required'));
      }
    });
  }

  /**
   * Every socket joins its own personal channel the moment it connects —
   * `afterInit`'s middleware has already set `client.data.userId` by the time
   * this fires, since socket.io runs connection middleware before dispatching
   * the `connection` event itself.
   */
  handleConnection(client: Socket): void {
    const userId = client.data.userId;
    if (typeof userId === 'string') {
      client.join(`${USER_PREFIX}${userId}`);
    }
  }

  /** Push a freshly created invitation to its recipient, if they're connected. */
  notifyInvitation(inviteeId: string, invitation: InvitationView): void {
    this.server.to(`${USER_PREFIX}${inviteeId}`).emit('newInvitation', invitation);
  }

  /**
   * Force every socket `userId` has open to stop listening to `roomId`'s
   * broadcast channel — called right after a REST leave-group succeeds.
   * Without this, a socket that had already called `joinRoom` keeps
   * receiving that room's live messages until it happens to reconnect,
   * despite no longer being a member: `sendMessage`'s broadcast targets the
   * socket.io room, which is membership-checked only at `joinRoom` time, not
   * re-checked on every delivery. Routed through each socket's personal
   * channel (`USER_PREFIX`) rather than a direct socket-id lookup, so it
   * still works if the same account has more than one device connected.
   */
  evictFromRoom(userId: string, roomId: string): void {
    const sockets = this.server.sockets.adapter.rooms.get(`${USER_PREFIX}${userId}`);
    if (!sockets) return;
    for (const socketId of sockets) {
      this.server.sockets.sockets.get(socketId)?.leave(`${ROOM_PREFIX}${roomId}`);
    }
  }

  handleDisconnect(client: Socket): void {
    // The socket.io room membership dies with the socket automatically; this
    // is just the audit trail for a client leaving mid-conversation.
    const userId = client.data.userId;
    if (typeof userId === 'string') {
      this.logger.debug(`Socket disconnected (user ${userId})`);
    }
  }

  /**
   * `joinRoom` — the client opts into a room's broadcast channel before
   * sending, so messages only reach sockets that asked to hear them.
   */
  @SubscribeMessage('joinRoom')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinRoomBody,
  ): Promise<{ success: boolean; roomId?: string; error?: string }> {
    const { roomId } = body ?? {};
    if (!roomId || typeof roomId !== 'string') {
      return { success: false, error: 'roomId is required' };
    }
    if (!(await this.chatService.isMember(roomId, client.data.userId))) {
      return { success: false, error: 'You are not a member of this room' };
    }
    await client.join(`${ROOM_PREFIX}${roomId}`);
    return { success: true, roomId };
  }

  /**
   * `sendMessage` — persists the message and broadcasts it to everyone in the
   * room, the sender included, so every client appends through the same
   * `newMessage` path and ordering is consistent.
   */
  @SubscribeMessage('sendMessage')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SendMessageBody,
  ): Promise<{ success: boolean; message?: any; error?: string }> {
    const { roomId, content } = body ?? {};
    if (!roomId || typeof roomId !== 'string') {
      return { success: false, error: 'roomId is required' };
    }
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) return { success: false, error: 'Message cannot be empty' };
    if (text.length > 2000) return { success: false, error: 'Message is too long' };

    if (!(await this.chatService.isMember(roomId, client.data.userId))) {
      return { success: false, error: 'You are not a member of this room' };
    }

    const message = await this.chatService.saveMessage(roomId, client.data.userId, text);
    if (!message) return { success: false, error: 'Could not send the message' };

    // Sending already implies participation; joining here means a client that
    // skipped `joinRoom` still receives its own message's broadcast.
    await client.join(`${ROOM_PREFIX}${roomId}`);
    this.server.to(`${ROOM_PREFIX}${roomId}`).emit('newMessage', message);
    return { success: true, message };
  }

  /** `leaveRoom` — stop listening to a room without dropping the connection. */
  @SubscribeMessage('leaveRoom')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: LeaveRoomBody,
  ): Promise<{ success: boolean }> {
    const { roomId } = body ?? {};
    if (roomId && typeof roomId === 'string') {
      await client.leave(`${ROOM_PREFIX}${roomId}`);
    }
    return { success: true };
  }

  /**
   * `markRead` — records that this client has read up through now, and tells
   * everyone else in the room so their own sent messages can flip to "seen"
   * without polling or a full re-fetch.
   */
  @SubscribeMessage('markRead')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: MarkReadBody,
  ): Promise<{ success: boolean; error?: string }> {
    const { roomId } = body ?? {};
    if (!roomId || typeof roomId !== 'string') {
      return { success: false, error: 'roomId is required' };
    }
    const result = await this.chatService.markRead(roomId, client.data.userId);
    if (!result) return { success: false, error: 'You are not a member of this room' };

    this.server.to(`${ROOM_PREFIX}${roomId}`).emit('messagesRead', {
      roomId,
      userId: client.data.userId,
      at: result.at,
    });
    return { success: true };
  }

  /**
   * `typing` — a fire-and-forget presence signal, deliberately outside the
   * membership check every other event pays for: it carries no data and
   * reaches only sockets already inside the room's broadcast channel, so
   * there is nothing here for a non-member to gain by forging it.
   */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: TypingBody): void {
    const { roomId, name } = body ?? {};
    if (!roomId || typeof roomId !== 'string') return;
    // `client.to()`, not `this.server.to()` — excludes the sender, so a
    // client never has to filter its own echo back out of the indicator.
    client.to(`${ROOM_PREFIX}${roomId}`).emit('userTyping', {
      roomId,
      userId: client.data.userId,
      name: typeof name === 'string' ? name : null,
    });
  }
}
