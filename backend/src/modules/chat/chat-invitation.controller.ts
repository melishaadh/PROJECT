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
  ConflictException,
} from '@nestjs/common';
import { IsMongoId, IsBoolean, IsString, MaxLength } from 'class-validator';
import { ChatInvitationService } from './chat-invitation.service';
import { ChatGateway } from './chat.gateway';
import { JwtAuthGuard, AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';

class InviteBodyDto {
  @IsMongoId()
  inviteeId!: string;
}

class InviteStatusQueryDto {
  @IsMongoId()
  inviteeId!: string;

  /** Comma-separated room ids — kept as one query param rather than a repeated one for a simpler client call. */
  @IsString() @MaxLength(2000)
  roomIds!: string;
}

class RespondBodyDto {
  @IsBoolean()
  accept!: boolean;
}

/**
 * Invitations — kept as their own controller inside `ChatModule` rather than
 * under `/users/me/...` alongside the rest of that resource's routes: an
 * invite is entirely a chat-domain concept (it references a room, and
 * accepting one calls straight into `ChatService.joinRoom`), so putting it
 * anywhere else would mean either duplicating that logic or reaching across
 * a module boundary for no real benefit.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatInvitationController {
  constructor(
    private readonly invitationService: ChatInvitationService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /** Invite someone to a room you're already in. */
  @Post('rooms/:id/invite')
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Request() req: AuthenticatedRequest,
    @Param('id') roomId: string,
    @Body() body: InviteBodyDto,
  ) {
    const invitation = await this.invitationService.createInvitation(
      roomId,
      req.user.userId,
      body.inviteeId,
    );
    this.chatGateway.notifyInvitation(body.inviteeId, invitation);
    return { success: true, invitation };
  }

  /** Invitations addressed to me, still pending. */
  @Get('invitations')
  async myInvitations(@Request() req: AuthenticatedRequest) {
    const invitations = await this.invitationService.getMyInvitations(req.user.userId);
    return { invitations };
  }

  /**
   * Of the given rooms, which already have a pending invite out to
   * `inviteeId` — the "Add to Group" picker's per-row state.
   */
  @Get('rooms/invite-status')
  async inviteStatus(@Query() query: InviteStatusQueryDto) {
    const roomIds = query.roomIds.split(',').map(id => id.trim()).filter(Boolean).slice(0, 200);
    const pending = await this.invitationService.pendingInviteRoomIds(roomIds, query.inviteeId);
    return { pendingRoomIds: [...pending] };
  }

  /** Accept or decline — only the invitee may respond to their own invite. */
  @Post('invitations/:id/respond')
  @HttpCode(HttpStatus.OK)
  async respond(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: RespondBodyDto,
  ) {
    const result = await this.invitationService.respond(id, req.user.userId, body.accept);
    if (result.error === 'not_found') throw new NotFoundException('Invitation not found.');
    if (result.error === 'full') throw new ConflictException('This group is full.');
    return { success: true, status: result.status };
  }
}
