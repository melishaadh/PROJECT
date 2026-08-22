import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DestinationsService } from './destinations.service';

/**
 * Query parameters for the catalogue listing.
 *
 * Declared as a DTO rather than read as loose `@Query()` strings so the global
 * `ValidationPipe` (whitelist + transform) runs over them: anything not listed
 * here is stripped before the service sees it, and the numeric fields are
 * coerced through `@Type(() => Number)`. That combination is what makes an
 * operator object like `?minAltitude[$gt]=0` impossible to smuggle through —
 * it fails `@IsInt()` and is rejected with a 400 rather than reaching Mongo.
 */
class FindDestinationsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9000)
  minAltitude?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9000)
  maxAltitude?: number;

  @IsOptional() @IsIn(['Easy', 'Moderate', 'Hard'])
  difficulty?: string;

  @IsOptional() @IsIn(['budget', 'mid', 'premium'])
  priceTier?: string;

  @IsOptional() @IsString() @MaxLength(128)
  search?: string;
}

class LimitDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30)
  limit?: number;
}

class AltitudeRangeDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9000)
  minAltitude?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9000)
  maxAltitude?: number;
}

/**
 * Read-only catalogue API.
 *
 * The like counters are deliberately **not** writable here. They used to be —
 * an unauthenticated `POST /destinations/:trekId/like` incremented the counter
 * directly — which meant anyone could inflate the trending leaderboard without
 * an account, and the counter could drift from the interactions collection that
 * is supposed to be its source of truth. Likes now go through the authenticated
 * `POST /users/me/likes` path exclusively, which records one idempotent
 * interaction per user and mirrors the resulting count back here.
 */
@Controller('destinations')
export class DestinationsController {
  private readonly logger = new Logger(DestinationsController.name);

  constructor(private readonly destinationsService: DestinationsService) {}

  @Get()
  async findAll(@Query() query: FindDestinationsDto) {
    return this.destinationsService.findAll(query);
  }

  @Get('top')
  async getTop(@Query() query: LimitDto) {
    return this.destinationsService.getTopDestinations(query.limit ?? 10);
  }

  @Get('count')
  async count(@Query() query: AltitudeRangeDto) {
    const count = await this.destinationsService.count(query);
    return { count };
  }

  /**
   * Re-run the official 30-destination catalogue seed. Idempotent, and never
   * resets accumulated like counts.
   *
   * Authenticated: re-seeding rewrites every destination document, which is an
   * administrative action rather than something an anonymous caller should be
   * able to trigger. Throttled hard on top, because it is a bulk write.
   */
  @Post('seed')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async seed() {
    const { seeded, total } = await this.destinationsService.seedCatalogue();
    this.logger.log(`Catalogue re-seeded on request — ${total} routes (${seeded} written)`);
    return { success: true, seeded, total };
  }

  // Kept last: a static route declared after this would be swallowed by `:trekId`.
  @Get(':trekId')
  async findOne(@Param('trekId') trekId: string) {
    return this.destinationsService.findByIdOrThrow(trekId);
  }
}
