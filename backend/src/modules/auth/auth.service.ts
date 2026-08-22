import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { User, UserDocument } from '@db/schemas/user.schema';
import { RefreshToken, RefreshTokenDocument } from '@db/schemas/refresh-token.schema';
import { serializeUser } from '@/common/serialize-user';
import { DEFAULT_AGE_BRACKET, MIN_BRACKET_AGE, ageGroupFromAge, calculateAge } from '@/common/age';
import { REFRESH_TOKEN_TTL_MS } from '@db/config/jwt.config';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  /** Seconds until the access token expires, so the client can pre-emptively refresh. */
  expires_in: number;
}

export interface AuthResult extends AuthTokens {
  user: ReturnType<typeof serializeUser>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name) private refreshModel: Model<RefreshTokenDocument>,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(
    email: string,
    name: string,
    password: string,
    dateOfBirth?: string
  ): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();

    // The username is checked for collisions as well as the email, because it
    // is now a login credential: two accounts sharing a name would make
    // `login()`'s lookup ambiguous, and whichever document Mongo returned first
    // would be the only one of them that could ever sign in by username.
    const existingUser = await this.userModel
      .findOne({ $or: [{ email: normalizedEmail }, { nameLower: normalizedName }] })
      .exec();
    if (existingUser) {
      throw new ConflictException(
        existingUser.email === normalizedEmail
          ? 'Email already registered'
          : 'Username already taken'
      );
    }

    const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);

    // Resolve the tailored peer bracket from the supplied date of birth. A DOB
    // that does not parse to a plausible age is treated as "not supplied" rather
    // than rejected, so onboarding can still capture it later.
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    const age = calculateAge(dob);

    // The brackets start at 18, and this is where that floor is actually
    // enforced. The signup screen checks it too, but a check that only exists in
    // the client is a suggestion — and the consequence of getting past it is not
    // cosmetic: an under-age account has no cohort of its own, so it would be
    // clamped into Gen-Z Explorers and clustered against people up to six years
    // older, which is precisely the unrealistic age gap the peer rules exist to
    // prevent. Rejected rather than silently stored without the DOB, because
    // dropping it would leave a bypass that produces an unlocked bracket.
    if (age !== null && age < MIN_BRACKET_AGE) {
      throw new BadRequestException(
        `You must be at least ${MIN_BRACKET_AGE} years old to create an account.`
      );
    }

    const ageGroup = age === null ? DEFAULT_AGE_BRACKET : ageGroupFromAge(age);

    const user = new this.userModel({
      email: normalizedEmail,
      name: name.trim(),
      nameLower: normalizedName,
      dateOfBirth: age === null ? null : dob,
      password: hashedPassword,
      profile: {
        ageGroup,
        experienceLevel: 1,
        cardioFlag: 1,
        jointFlag: 1,
        altitudeHistory: 1,
      },
      preferences: {
        maxDuration: 21,
        maxPrice: 300000,
        difficulty: 'All',
      },
      isOnboarded: false,
      // A DOB-derived bucket is authoritative, so the picker stays locked.
      ageGroupLocked: age !== null,
      lastLogin: new Date(),
    });

    await user.save();
    this.logger.log(`New user registered: ${normalizedEmail}`);

    const tokens = await this.issueTokens(user);
    return { user: serializeUser(user), ...tokens };
  }

  /**
   * Sign in with either the email address or the username.
   *
   * `identifier` is matched against both columns in one query rather than
   * guessing from the shape of the string: an `@`-sniffing heuristic would lock
   * out anyone whose username happens to contain one. Both fields are stored
   * lowercased and indexed (`email` uniquely, `nameLower` for the trekker
   * autocomplete), so neither branch of the `$or` is a collection scan.
   */
  async login(identifier: string, password: string): Promise<AuthResult> {
    const normalized = identifier.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ $or: [{ email: normalized }, { nameLower: normalized }] })
      .select('+password')
      .exec();

    // Compare against a dummy hash when the account does not exist, so the
    // response time does not reveal which emails or usernames are registered.
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException('Invalid email/username or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email/username or password');
    }

    await this.userModel
      .updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } })
      .exec();

    const tokens = await this.issueTokens(user);
    return { user: serializeUser(user), ...tokens };
  }

  /**
   * Exchange a refresh token for a fresh pair, rotating the grant.
   *
   * The presented token is consumed whether or not the exchange succeeds. If a
   * token that has *already* been rotated away is presented, that means either
   * a replay or a leak, and the entire token family is revoked — the legitimate
   * holder is logged out too, which is the correct trade when the alternative
   * is leaving an attacker with a valid session.
   */
  async refresh(presentedToken: string): Promise<AuthResult> {
    const tokenHash = hashToken(presentedToken);
    const grant = await this.refreshModel.findOne({ tokenHash }).exec();

    if (!grant) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    if (grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) {
      // Replay of a consumed token: burn the whole family.
      await this.revokeFamily(grant.familyId);
      this.logger.warn(
        `Refresh token replay detected for user ${grant.userId.toString()}; family revoked.`
      );
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    const user = await this.userModel.findById(grant.userId).exec();
    if (!user) {
      await this.revokeFamily(grant.familyId);
      throw new UnauthorizedException('Account no longer exists.');
    }

    // Consume this grant, then mint its successor in the same family.
    await this.refreshModel
      .updateOne({ _id: grant._id }, { $set: { revokedAt: new Date() } })
      .exec();

    const tokens = await this.issueTokens(user, grant.familyId);
    return { user: serializeUser(user), ...tokens };
  }

  /** Revoke a single grant — the sign-out path. Idempotent. */
  async revokeRefreshToken(presentedToken?: string | null): Promise<void> {
    if (!presentedToken) return;
    await this.refreshModel
      .updateOne({ tokenHash: hashToken(presentedToken) }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  /** Revoke every live grant for a user — password change, "sign out everywhere". */
  async revokeAllForUser(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    await this.refreshModel
      .updateMany(
        { userId: new Types.ObjectId(userId), revokedAt: null },
        { $set: { revokedAt: new Date() } }
      )
      .exec();
  }

  async validateUserById(userId: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    return this.userModel.findById(userId).exec();
  }

  // ─── Account deletion ──────────────────────────────────────────────────────

  /**
   * Confirm the caller's password before a destructive action.
   *
   * Same shape as `login()`: the account is loaded with `+password` and
   * compared with bcrypt, throwing the same `UnauthorizedException` on a
   * mismatch. Deleting an account only from a live JWT would let anyone who
   * grabs an unattended, still-unlocked session erase it — the password gate
   * is what makes this a deliberate, re-authenticated action.
   */
  async verifyPassword(userId: string, password: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).select('+password +profilePictureKey').exec();
    if (!user) {
      throw new UnauthorizedException('Account no longer exists.');
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Incorrect password.');
    }
    return user;
  }

  /**
   * Erase the account's authentication state: every refresh grant (so no copy
   * of a token, active or leaked, can mint a new session) and the user
   * document itself. Called after `verifyPassword` and after
   * `UsersService.purgeUserData` has removed the user's interactions and
   * stored profile picture, so nothing is orphaned once this returns.
   */
  async deleteUserAccount(userId: string): Promise<void> {
    const objectId = new Types.ObjectId(userId);
    await this.refreshModel.deleteMany({ userId: objectId }).exec();
    await this.userModel.findByIdAndDelete(objectId).exec();
    this.logger.log(`Account deleted: ${userId}`);
  }

  // ─── Token minting ─────────────────────────────────────────────────────────

  /**
   * Mint an access/refresh pair and persist the refresh grant (hashed).
   *
   * `familyId` carries across a rotation so a replayed token can be traced back
   * to the login it descended from; omitting it starts a new family.
   */
  private async issueTokens(user: UserDocument, familyId?: string): Promise<AuthTokens> {
    const userId = user._id.toString();
    const access_token = this.jwtService.sign(
      { sub: userId, email: user.email, type: 'access' },
      {
        secret: this.config.get<string>('jwt.secret'),
        expiresIn: this.config.get<string>('jwt.expiresIn'),
      }
    );

    // 256 bits of CSPRNG output. Deliberately opaque rather than a second JWT:
    // there is nothing for the client to read in it, and an opaque token cannot
    // be accepted by mistake anywhere the access token is expected.
    const refresh_token = randomBytes(32).toString('base64url');

    await this.refreshModel.create({
      userId: user._id,
      tokenHash: hashToken(refresh_token),
      familyId: familyId ?? randomUUID(),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revokedAt: null,
    });

    return {
      access_token,
      refresh_token,
      expires_in: parseDuration(this.config.get<string>('jwt.expiresIn') ?? '15m'),
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshModel
      .updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }
}

/**
 * A real bcrypt hash of a throwaway value, compared against when an account is
 * not found so that "no such user" and "wrong password" take the same time.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.wm7iZBLxbrJVjKuqjKmZxxWnFwXvE2K';

/** SHA-256 hex digest — see the note on `RefreshToken.tokenHash`. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Convert a `15m` / `7d` / `3600` duration into whole seconds. */
function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 900;
  const amount = parseInt(match[1], 10);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? 's'] ?? 1;
  return amount * multiplier;
}
