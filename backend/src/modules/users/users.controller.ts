import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, Res, UseGuards,
  UseInterceptors, UploadedFile, HttpCode, HttpStatus, Logger, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  IsInt, IsNumber, IsString, IsOptional, IsArray, IsIn, IsNotEmpty, IsDateString,
  Min, Max, MaxLength, ArrayMaxSize, Matches, ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { UsersService } from './users.service';
import { DestinationsService } from '@/modules/destinations/destinations.service';
import { AuthService } from '@/modules/auth/auth.service';
import { UserProfile, UserPreferences } from '@db/schemas/user.schema';
import { REFRESH_COOKIE } from '@db/config/jwt.config';
import { serializeUser } from '@/common/serialize-user';
import { JwtAuthGuard, AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';
import { PROFILE_PICTURE_UPLOAD } from '@/common/image-upload';
import { MAX_AGE_BRACKET_INDEX } from '@/common/age';

/** Collapse surrounding whitespace on free-text input. */
const TrimText = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

// DTOs — decorators are REQUIRED: the global ValidationPipe runs with
// whitelist:true + forbidNonWhitelisted:true, so a property without a
// validation decorator does not merely get stripped, it fails the request.
class UpdateProfileDto {
  // 0-4 — the five tailored peer brackets. The value is advisory: `updateProfile`
  // overwrites it with the DOB-derived bracket whenever a DOB is on record.
  @IsInt() @Min(0) @Max(MAX_AGE_BRACKET_INDEX)
  ageGroup!: number;

  @IsInt() @Min(0) @Max(3)
  experienceLevel!: number;

  @IsInt() @Min(0) @Max(1)
  cardioFlag!: number;

  @IsInt() @Min(0) @Max(1)
  jointFlag!: number;

  @IsInt() @Min(0) @Max(3)
  altitudeHistory!: number;

  @IsOptional() @IsString() @MaxLength(120) @TrimText()
  location?: string;

  // Bounded rather than merely numeric: an unbounded preference is a value the
  // recommendation engine has to normalise against, and a wild one distorts it.
  @IsOptional() @IsNumber() @Min(1) @Max(60)
  maxDuration?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000)
  maxPrice?: number;

  @IsOptional() @IsIn(['All', 'Easy', 'Moderate', 'Hard'])
  difficulty?: 'All' | 'Easy' | 'Moderate' | 'Hard';
}

class UpdateIdentityDto {
  @IsOptional() @IsString() @TrimText() @IsNotEmpty() @MaxLength(60)
  @Matches(/^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u, {
    message: 'Name may only contain letters, spaces, apostrophes and hyphens.',
  })
  name?: string;

  @IsOptional() @IsString() @MaxLength(500)
  bio?: string;

  // Scheme validation happens in the service (`normalizeSocialLink`), because a
  // bare "instagram.com/x" is legitimate input that has to be upgraded, not
  // rejected. This bound just keeps the payload sane.
  @IsOptional() @IsString() @MaxLength(300)
  socialMediaLink?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) @MaxLength(24, { each: true })
  completedTrekIds?: string[];

  @IsOptional() @IsDateString()
  dateOfBirth?: string;
}

class AddCompletedTrekDto {
  @IsString() @IsNotEmpty() @MaxLength(24) @TrimText()
  trekId!: string;
}

class LikeTrekDto {
  @IsString() @IsNotEmpty() @MaxLength(24) @TrimText()
  trekId!: string;
}

/**
 * One passive signal. `dwellMs` is only meaningful for `view` — a dismissal has
 * no duration, it is the absence of one.
 */
class SignalDto {
  @IsString() @IsNotEmpty() @MaxLength(24) @TrimText()
  trekId!: string;

  @IsIn(['view', 'dismiss'])
  type!: 'view' | 'dismiss';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(600_000)
  dwellMs?: number;
}

/**
 * A batch of signals. Capped so a single request cannot be used to write an
 * unbounded number of documents; the client batches per scroll session, which
 * is far below this.
 */
class RecordSignalsDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SignalDto)
  signals!: SignalDto[];
}

class SearchUsersDto {
  @IsString() @IsNotEmpty() @MaxLength(64) @TrimText()
  q!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;
}

class DeleteAccountDto {
  @IsString() @IsNotEmpty({ message: 'Enter your password to confirm account deletion.' })
  @MaxLength(72)
  password!: string;
}

/**
 * User routes.
 *
 * Every mutating route is addressed as `/users/me` and resolves its target from
 * the JWT subject. That is deliberate: there is no `:id` for a caller to swap,
 * so broken-object-level authorization is prevented structurally rather than by
 * a check that a future route might omit. Where an id *is* in the URL, the
 * route carries `@OwnedBy` and the global `ResourceOwnerGuard` enforces that it
 * matches the token — see `GET /users/:id`, which is a read of public profile
 * fields only and is therefore left open to any authenticated member.
 */
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly destinationsService: DestinationsService,
    private readonly authService: AuthService,
  ) {}

  // ─── Static routes first, so "me"/"search" are not captured by ":id" ────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: AuthenticatedRequest) {
    const user = await this.usersService.findById(req.user.userId);
    if (!user) throw new NotFoundException('User not found');
    return serializeUser(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@Request() req: AuthenticatedRequest, @Body() body: UpdateIdentityDto) {
    const user = await this.usersService.updateIdentityFields(req.user.userId, body);
    if (!user) throw new NotFoundException('User not found');
    return { success: true, user: serializeUser(user) };
  }

  /**
   * Upload a new profile picture.
   *
   * Multipart rather than a base64 field on the JSON body: the bytes go
   * straight to object storage and only a URL is persisted. `FileInterceptor`
   * enforces the 5MB ceiling and the MIME allow-list *before* the body is
   * buffered, and the service re-checks the magic bytes — see `image-upload.ts`
   * for why the declared content type is not trusted on its own.
   *
   * The target is always the token's own account. Throttled because it is the
   * most expensive write in the API.
   */
  @Post('me/profile-picture')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', PROFILE_PICTURE_UPLOAD))
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async uploadProfilePicture(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const user = await this.usersService.setProfilePicture(req.user.userId, file);
    return { success: true, user: serializeUser(user) };
  }

  @Delete('me/profile-picture')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteProfilePicture(@Request() req: AuthenticatedRequest) {
    const user = await this.usersService.removeProfilePicture(req.user.userId);
    return { success: true, user: serializeUser(user) };
  }

  /**
   * Permanently delete the caller's account.
   *
   * Password-gated (see `AuthService.verifyPassword`) and irreversible, so the
   * three steps run in an order where a wrong password leaves nothing touched:
   * verify first, then purge the data `UsersService` owns (interactions, the
   * stored profile picture), then let `AuthService` revoke every refresh grant
   * and delete the document itself. Throttled tightly — this is the one route
   * on the API that destroys an account.
   */
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async deleteAccount(
    @Request() req: AuthenticatedRequest,
    @Body() body: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.verifyPassword(req.user.userId, body.password);
    await this.usersService.purgeUserData(req.user.userId, (user as any).profilePictureKey);
    await this.authService.deleteUserAccount(req.user.userId);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { success: true };
  }

  /**
   * Live autocomplete for the "Find Trekkers" search bar.
   *
   * Authenticated, and throttled tighter than the global budget. Both matter:
   * this endpoint enumerates the user directory a prefix at a time, so leaving
   * it open and unlimited would make scraping every account trivial. The
   * client debounces to 250ms, so 60/minute is far above what typing produces
   * and far below what a scraper needs.
   */
  @Get('search')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async searchUsers(@Query() query: SearchUsersDto) {
    return this.usersService.searchByName(query.q, query.limit ?? 15);
  }

  /** Live like counts for every trek, keyed by trekId. Public. */
  @Get('likes/counts')
  async getLikeCounts() {
    return this.usersService.getAllLikeCounts();
  }

  @Get('likes/top')
  async getTopLiked() {
    const top = await this.usersService.getTopLikedTreks(3);
    return top.map(t => ({ trekId: t.trekId, likeCount: t.count }));
  }

  @Get('likes/count/:trekId')
  async getLikeCount(@Param('trekId') trekId: string) {
    const count = await this.usersService.getTrekLikeCount(trekId);
    return { trekId, likeCount: count };
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Request() req: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    const profile: UserProfile = {
      ageGroup: body.ageGroup,
      experienceLevel: body.experienceLevel,
      cardioFlag: body.cardioFlag,
      jointFlag: body.jointFlag,
      altitudeHistory: body.altitudeHistory,
      location: body.location ?? '',
    };
    const preferences: Partial<UserPreferences> = {};
    if (body.maxDuration !== undefined) preferences.maxDuration = body.maxDuration;
    if (body.maxPrice !== undefined) preferences.maxPrice = body.maxPrice;
    if (body.difficulty !== undefined) preferences.difficulty = body.difficulty;

    const user = await this.usersService.updateProfile(
      req.user.userId,
      profile,
      Object.keys(preferences).length > 0 ? preferences : undefined
    );
    if (!user) throw new NotFoundException('User not found');
    return { success: true, user: serializeUser(user) };
  }

  @Patch('identity')
  @UseGuards(JwtAuthGuard)
  async updateIdentity(@Request() req: AuthenticatedRequest, @Body() body: UpdateIdentityDto) {
    const user = await this.usersService.updateIdentityFields(req.user.userId, body);
    if (!user) throw new NotFoundException('User not found');
    return { success: true, user: serializeUser(user) };
  }

  @Post('me/completed-treks')
  @UseGuards(JwtAuthGuard)
  async addCompletedTrek(@Request() req: AuthenticatedRequest, @Body() body: AddCompletedTrekDto) {
    const user = await this.usersService.addCompletedTrek(req.user.userId, body.trekId);
    if (!user) throw new NotFoundException('User not found');
    return { success: true, completedTrekIds: user.completedTrekIds };
  }

  @Post('me/completed-treks/remove')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async removeCompletedTrek(@Request() req: AuthenticatedRequest, @Body() body: AddCompletedTrekDto) {
    const user = await this.usersService.removeCompletedTrek(req.user.userId, body.trekId);
    if (!user) throw new NotFoundException('User not found');
    return { success: true, completedTrekIds: user.completedTrekIds };
  }

  /**
   * Record passive engagement — how long cards were held on screen and which
   * were scrolled straight past.
   *
   * Fire-and-forget from the client's point of view: it returns a bare count
   * and nothing downstream waits on it, because a failed signal write must
   * never interrupt scrolling. Given a higher rate budget than the default
   * since it is called once per scroll session rather than per screen.
   */
  @Post('me/signals')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 240 } })
  async recordSignals(
    @Request() req: AuthenticatedRequest,
    @Body() body: RecordSignalsDto,
  ) {
    return this.usersService.recordSignals(req.user.userId, body.signals);
  }

  /**
   * Like a trek. Idempotent — liking twice is a no-op that returns the same
   * count, which is what makes the client's optimistic update safe to keep.
   */
  @Post('me/likes')
  @UseGuards(JwtAuthGuard)
  async likeTrek(@Request() req: AuthenticatedRequest, @Body() body: LikeTrekDto) {
    // Reject unknown ids up front rather than recording an interaction against
    // a trek that does not exist and skewing the leaderboard with a phantom row.
    await this.destinationsService.findByIdOrThrow(body.trekId);

    const { trekId } = await this.usersService.likeTrek(req.user.userId, body.trekId);
    const likeCount = await this.usersService.getTrekLikeCount(trekId);
    await this.mirrorLikeCount(trekId, likeCount);
    return { success: true, trekId, likeCount, liked: true };
  }

  @Post('me/unlike')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async unlikeTrek(@Request() req: AuthenticatedRequest, @Body() body: LikeTrekDto) {
    const { trekId } = await this.usersService.unlikeTrek(req.user.userId, body.trekId);
    const likeCount = await this.usersService.getTrekLikeCount(trekId);
    await this.mirrorLikeCount(trekId, likeCount);
    // Idempotent: unliking something you never liked still leaves you unliked,
    // so the client's optimistic state is correct either way.
    return { success: true, trekId, likeCount, liked: false };
  }

  @Get('me/likes')
  @UseGuards(JwtAuthGuard)
  async getMyLikes(@Request() req: AuthenticatedRequest) {
    const likes = await this.usersService.getUserLikes(req.user.userId);
    return likes.map(l => ({ trekId: l.trekId, likedAt: l.interactedAt }));
  }

  @Get('liked/:trekId')
  @UseGuards(JwtAuthGuard)
  async isLiked(@Param('trekId') trekId: string, @Request() req: AuthenticatedRequest) {
    const isLiked = await this.usersService.isTrekLikedByUser(req.user.userId, trekId);
    return { isLiked };
  }

  /**
   * Another member's public profile.
   *
   * Readable by any authenticated member — that is the point of the trekker
   * search — but the projection is strictly the public fields. Email, date of
   * birth, derived age, health flags and preferences are all withheld: age in
   * particular is confidential and exists only inside the backend's KNN and
   * safety matrices. `@OwnedBy` is deliberately *not* applied here: this is the
   * one route where the id in the URL is legitimately somebody else's, because
   * it is a read of public data rather than a mutation.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getFullProfile(@Param('id') id: string) {
    const profile = await this.usersService.getPublicProfile(id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  /**
   * Mirror the authoritative count onto the destination document so the trending
   * leaderboard and popularity layer read it without an aggregation.
   *
   * Isolated in a try/catch on purpose: the interaction collection is the source
   * of truth and has already been written by this point, so a failure to update
   * the denormalised copy must not fail the user's like. The boot-time resync
   * repairs any counter left behind.
   */
  private async mirrorLikeCount(trekId: string, likeCount: number): Promise<void> {
    try {
      await this.destinationsService.setLikeCount(trekId, likeCount);
    } catch (error) {
      this.logger.warn(
        `Could not mirror like count for trek ${trekId}: ${(error as Error).message}`
      );
    }
  }
}
