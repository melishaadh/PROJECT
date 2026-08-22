import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsDateString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AuthService, AuthResult } from './auth.service';
import { REFRESH_COOKIE, REFRESH_TOKEN_TTL_MS } from '@db/config/jwt.config';
import { JwtAuthGuard, AuthenticatedRequest } from '@/common/guards/jwt-auth.guard';

/** Trim and lowercase an email before validation, so " A@B.com " is one account. */
const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/** Collapse whitespace in a free-text name. */
const TrimText = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value));

class RegisterDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;

  @TrimText()
  @IsString()
  @IsNotEmpty({ message: 'Name is required.' })
  @MaxLength(60)
  // Letters, spaces, apostrophes and hyphens. Excluding everything else keeps
  // markup and control characters out of a field that is rendered verbatim in
  // search results and chat member lists.
  @Matches(/^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u, {
    message: 'Name may only contain letters, spaces, apostrophes and hyphens.',
  })
  name!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  // Bcrypt silently truncates beyond 72 bytes, so a longer password would give
  // a false sense of strength. Reject rather than quietly ignore the tail.
  @MaxLength(72)
  password!: string;

  /** ISO date (YYYY-MM-DD). Drives the automated age-group bucket. */
  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid date of birth.' })
  dateOfBirth?: string;
}

class LoginDto {
  /**
   * Email *or* username. Not validated as an email: the whole point is that
   * either one is accepted, and telling the caller which of the two they got
   * wrong before the password is even checked would leak which accounts exist.
   * Lowercased because both columns it is matched against are stored that way.
   */
  @NormalizeEmail()
  @IsString()
  @IsNotEmpty({ message: 'Enter your email or username.' })
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  @MaxLength(72)
  password!: string;
}

class RefreshDto {
  /**
   * Only used by native clients. Browsers send the token in the http-only
   * cookie instead, which JavaScript on the page cannot read.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refresh_token?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Rate limits are per-route and deliberately tight on the credential
   * endpoints. The global default (see `AppModule`) is sized for ordinary
   * browsing; sign-in is where an attacker gets unlimited guesses at a
   * password, so it gets its own much smaller budget.
   */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(
      body.email,
      body.name,
      body.password,
      body.dateOfBirth
    );
    return this.respondWithSession(result, res);
  }

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body.identifier, body.password);
    return this.respondWithSession(result, res);
  }

  /**
   * Exchange a refresh token for a new access token.
   *
   * Unauthenticated by design — the whole point is that it is reachable once
   * the access token has expired — but throttled, because it is the one
   * endpoint that mints credentials without a password.
   */
  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    // The cookie wins when present: on the web it is the copy that JavaScript
    // cannot read, so preferring it means an XSS payload cannot substitute a
    // token it has stolen from elsewhere.
    const token = this.readRefreshCookie(req) ?? body.refresh_token;
    if (!token) {
      throw new UnauthorizedException('No refresh token supplied.');
    }
    const result = await this.authService.refresh(token);
    return this.respondWithSession(result, res);
  }

  /**
   * Revoke the presented refresh token and clear the cookie.
   *
   * The access token cannot be revoked — that is the trade that makes it cheap
   * to verify — but it expires in minutes, and without a refresh token it
   * cannot be renewed, so the session is effectively over.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.revokeRefreshToken(this.readRefreshCookie(req) ?? body.refresh_token);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  /** Sign out of every device. Requires a live access token. */
  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @Req() req: Request & AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.revokeAllForUser(req.user.userId);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  // ─── Cookie plumbing ───────────────────────────────────────────────────────

  /**
   * Set the refresh token as an http-only cookie *and* return it in the body.
   *
   * Both are needed because the same API serves two very different clients:
   *
   *   · A browser gets the cookie. `httpOnly` puts it out of reach of any
   *     script on the page, which is the property that makes a refresh token
   *     safer to hold long-term than an access token in `localStorage`.
   *   · The Expo/React Native app cannot rely on a cookie jar surviving a cold
   *     start, so it reads the token from the body and persists it in
   *     AsyncStorage. A native bundle has no script-injection surface for
   *     `httpOnly` to protect against, so this is not the same exposure — but
   *     it is why the cookie is preferred over the body when both are present.
   */
  private respondWithSession(result: AuthResult, res: Response) {
    res.cookie(REFRESH_COOKIE, result.refresh_token, {
      httpOnly: true,
      // Only sent over TLS in production. Forcing this in development would
      // make the cookie silently never arrive over plain http.
      secure: process.env.NODE_ENV === 'production',
      // The API and the web client are separate origins, so `strict` would drop
      // the cookie on the very requests that need it.
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_TTL_MS,
      path: '/api/auth',
    });
    return result;
  }

  private readRefreshCookie(req: Request): string | undefined {
    const value = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}
