import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { IsNotEmpty, IsString, IsOptional, IsIn, IsInt, IsDateString, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { JwtAuthGuard, AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';

/**
 * DTOs must be classes with decorators — the global `ValidationPipe` only
 * validates against a metatype, and an interface would let any body through.
 */
class CreateRoomBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(128)
  trekId!: string;

  @IsString() @IsNotEmpty() @MaxLength(160)
  roomName!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxMembers!: number;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  endDate?: string;
}

class ListRoomsQueryDto {
  @IsOptional() @IsString() @MaxLength(128)
  search?: string;

  @IsOptional() @IsString() @MaxLength(128)
  location?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  capacity?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  durationDays?: number;

  @IsOptional() @IsString() @MaxLength(16)
  difficulty?: string;

  // A plain string check rather than `@Type(() => Boolean)` — the `Boolean`
  // constructor treats any non-empty string (including the literal text
  // `"false"`) as truthy, so that decorator would silently ignore `?mine=false`.
  @IsOptional() @IsIn(['true', 'false'])
  mine?: string;
}

/**
 * Chat-room API.
 *
 * Every route requires a session. `rooms` (the discovery feed) is open to any
 * signed-in user, since browsing groups before joining one is the whole point
 * — but the detail and message-history routes stay membership-gated, so a
 * non-member can see a room's card without being able to read who is talking
 * in it.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /** How many of the viewer's rooms have unread messages — the Profile inbox badge. */
  @Get('unread-count')
  async unreadCount(@Request() req: AuthenticatedRequest) {
    const count = await this.chatService.getUnreadRoomCount(req.user.userId);
    return { count };
  }

  /**
   * Create an expedition's group chat. Many rooms can exist for the same trek
   * — this always creates a new one; joining an existing room is `POST
   * rooms/:id/join`. Difficulty is resolved server-side from the trek's
   * catalogue entry, not accepted from the client.
   */
  @Post('rooms')
  @HttpCode(HttpStatus.CREATED)
  async createRoom(@Request() req: AuthenticatedRequest, @Body() body: CreateRoomBodyDto) {
    const room = await this.chatService.createRoom(req.user.userId, {
      trekId: body.trekId,
      roomName: body.roomName,
      maxMembers: body.maxMembers,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
    });
    return { success: true, room };
  }

  /** The discovery feed — every room, optionally filtered, newest first. */
  @Get('rooms')
  async listRooms(@Request() req: AuthenticatedRequest, @Query() query: ListRoomsQueryDto) {
    const rooms = await this.chatService.listRooms(
      { ...query, mine: query.mine === 'true' },
      req.user.userId,
    );
    return { rooms };
  }

  /** A single room's card data — readable pre-join so the discovery card can render. */
  @Get('rooms/:id')
  async getRoom(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const room = await this.chatService.getRoom(id, req.user.userId);
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  /**
   * Join a room. Capacity is enforced atomically in the service — this just
   * translates the outcome into the right HTTP status.
   */
  @Post('rooms/:id/join')
  @HttpCode(HttpStatus.OK)
  async joinRoom(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const { room, error } = await this.chatService.joinRoom(id, req.user.userId);
    if (error === 'not_found') throw new NotFoundException('Room not found');
    if (error === 'full') throw new ConflictException('This group is full.');
    if (error === 'already_member') throw new BadRequestException('You are already in this group.');
    return { success: true, room };
  }

  /** Leave a room. Evicts any of the leaver's connected sockets from its live channel. */
  @Post('rooms/:id/leave')
  @HttpCode(HttpStatus.OK)
  async leaveRoom(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const { ok, error } = await this.chatService.leaveRoom(id, req.user.userId);
    if (error === 'not_found') throw new NotFoundException('Room not found');
    if (ok) this.chatGateway.evictFromRoom(req.user.userId, id);
    return { success: ok };
  }

  /** Message history for a room — members only. */
  @Get('rooms/:id/messages')
  async getMessages(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!(await this.chatService.isMember(id, req.user.userId))) {
      throw new ForbiddenException('You are not a member of this room.');
    }
    const messages = await this.chatService.getMessages(id);
    return { messages };
  }
}
