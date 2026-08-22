import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * A live refresh-token grant.
 *
 * Only a SHA-256 digest of the token is stored, never the token itself, so a
 * database leak cannot be replayed as a set of valid sessions — the same reason
 * passwords are hashed. The digest is deterministic (unlike bcrypt) because the
 * lookup has to be an indexed equality match on presentation, and the token is
 * already 256 bits of CSPRNG output, so there is nothing to brute-force.
 *
 * Grants are **rotated**: presenting a refresh token consumes it and issues a
 * fresh one. A token presented twice is therefore either a replay or a race,
 * and the whole family is revoked — which is what turns a stolen refresh token
 * into a detectable event rather than a permanent silent foothold.
 */
@Schema({ timestamps: true, collection: 'refreshtokens' })
export class RefreshToken extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  /** SHA-256 hex digest of the issued token. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /**
   * Groups every rotation descended from one login. Revoking the family is how
   * a detected replay logs out the whole chain rather than just one token.
   */
  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  /** Set when the grant is rotated away, revoked, or the family is burned. */
  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

/**
 * Mongo drops the document once `expiresAt` passes, so expired grants clean
 * themselves up instead of accumulating forever.
 */
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Revoke-all-for-user, used on sign-out and on password change. */
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });

export type RefreshTokenDocument = RefreshToken & Document;
