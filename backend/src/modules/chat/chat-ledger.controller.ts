import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IsMongoId, IsNumber, IsString, IsNotEmpty, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ChatLedgerService } from './chat-ledger.service';
import { JwtAuthGuard, AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';

class AddLedgerEntryBodyDto {
  @IsMongoId()
  payerId!: string;

  @Type(() => Number) @IsNumber() @Min(0.01) @Max(10_000_000)
  amount!: number;

  @IsString() @IsNotEmpty() @MaxLength(200)
  remark!: string;
}

/**
 * A room's shared expense ledger — kept as its own controller (mirroring
 * `ChatInvitationController`) rather than folded into `ChatController`, since
 * it's a distinct sub-resource with its own add/list/delete lifecycle.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatLedgerController {
  constructor(private readonly ledgerService: ChatLedgerService) {}

  @Get('rooms/:id/ledger')
  async getLedger(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const result = await this.ledgerService.getLedger(id, req.user.userId);
    if ('error' in result) throw new ForbiddenException('You are not a member of this room.');
    return result;
  }

  @Post('rooms/:id/ledger')
  @HttpCode(HttpStatus.CREATED)
  async addEntry(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: AddLedgerEntryBodyDto,
  ) {
    const entry = await this.ledgerService.addEntry(id, req.user.userId, body.payerId, body.amount, body.remark);
    return { success: true, entry };
  }

  @Delete('rooms/:id/ledger/:entryId')
  @HttpCode(HttpStatus.OK)
  async deleteEntry(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    const result = await this.ledgerService.deleteEntry(id, entryId, req.user.userId);
    if (result.error === 'not_found') throw new NotFoundException('Entry not found.');
    if (result.error === 'forbidden') throw new ForbiddenException('You can only remove an entry you added.');
    return { success: true };
  }
}
