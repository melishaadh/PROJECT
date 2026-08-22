import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { AuthenticatedUser } from '@/common/guards/jwt-auth.guard';

interface JwtPayload {
  sub?: string;
  email?: string;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Never relax this. An expired access token is the entire reason the
      // refresh flow exists.
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret')!,
      // Pinned, so a token presenting `alg: none` or a different family cannot
      // be talked into verifying.
      algorithms: ['HS256'],
    });
  }

  /**
   * Everything downstream trusts `request.user`, so this is the last place a
   * malformed or wrong-purpose token can be caught.
   *
   * `type` is checked explicitly: without it, any HS256 token this service ever
   * signs with the same secret would be accepted as an access token. Validating
   * `sub` as an ObjectId matters for the same reason — it flows straight into
   * Mongo queries, and a subject that is not an id belongs rejected at the
   * boundary rather than cast somewhere deeper.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload?.type !== 'access') {
      throw new UnauthorizedException('Invalid token type.');
    }
    if (typeof payload.sub !== 'string' || !Types.ObjectId.isValid(payload.sub)) {
      throw new UnauthorizedException('Malformed token subject.');
    }
    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      type: payload.type,
    };
  }
}
