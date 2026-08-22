import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from './jwt-auth.guard';

const OWNER_PARAM_KEY = 'trekeasy:ownerParam';

/**
 * Declare which route/body parameter names the resource owner, so
 * `ResourceOwnerGuard` can compare it against the authenticated subject.
 *
 * Usage: `@OwnedBy('id')` for `PATCH /users/:id`, `@OwnedBy('userId')` for a
 * body field. Both the route params and the body are searched, in that order.
 */
export const OwnedBy = (param: string) => SetMetadata(OWNER_PARAM_KEY, param);

/**
 * Broken-object-level-authorization (BOLA / IDOR) defence.
 *
 * Authentication only proves *who* is calling. It says nothing about whether
 * that caller may touch the record the URL points at — and a route like
 * `PATCH /users/:id` that trusts `:id` lets any signed-in user rewrite any
 * other user's profile picture or preferences by changing one path segment.
 * That is the single most common API vulnerability, and it is invisible in
 * testing because the happy path always passes its own id.
 *
 * This guard closes it structurally: on any route marked `@OwnedBy(param)`, the
 * id in the request must equal the `sub` claim of the presented JWT. There is
 * no admin bypass, because the app has no admin role — if one is added later,
 * it belongs here as an explicit exemption rather than as an omitted check.
 *
 * Routes addressed as `/users/me` do not need this: they derive the target from
 * the token and never read an id off the wire, which is the stronger pattern
 * and the one this codebase prefers.
 */
@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  private readonly logger = new Logger(ResourceOwnerGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const param = this.reflector.getAllAndOverride<string | undefined>(OWNER_PARAM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No marker means the route does not address a user-owned resource by id.
    if (!param) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user?.userId) {
      // Reaching here means the route is missing `JwtAuthGuard`. Fail closed.
      throw new UnauthorizedException('Authentication required.');
    }

    const target = request.params?.[param] ?? request.body?.[param];
    // Nothing to compare against — the handler will resolve the target from the
    // token instead, which is safe by construction.
    if (target === undefined || target === null || target === '') return true;

    if (String(target) !== String(user.userId)) {
      this.logger.warn(
        `Blocked cross-account access: ${user.userId} → ${String(target)} on ${request.method} ${request.url}`
      );
      throw new ForbiddenException('You can only modify your own account.');
    }
    return true;
  }
}
