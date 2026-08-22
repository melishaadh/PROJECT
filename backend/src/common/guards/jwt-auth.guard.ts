import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * The single authentication guard for the API.
 *
 * A thin named wrapper around `AuthGuard('jwt')`, for two reasons beyond
 * readability. First, every protected route reads as `@UseGuards(JwtAuthGuard)`,
 * so a route missing its guard is obvious in review. Second, it normalises the
 * failure: Passport's default rejection is a bare "Unauthorized", which the
 * client cannot distinguish from a *malformed* request, and the Expo client
 * treats a 401 as "this session is dead" — so the message matters.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    info: unknown,
    _context: ExecutionContext
  ): TUser {
    if (err || !user) {
      const expired = (info as Error | undefined)?.name === 'TokenExpiredError';
      throw (
        (err as Error) ??
        new UnauthorizedException(
          expired ? 'Your session has expired. Please sign in again.' : 'Authentication required.'
        )
      );
    }
    return user;
  }
}

/** What `JwtStrategy.validate` puts on `request.user`. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  type: string;
}

/** Narrow an Express request to one that has been through `JwtAuthGuard`. */
export interface AuthenticatedRequest {
  user: AuthenticatedUser;
}
