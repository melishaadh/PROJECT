import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MAX_AGE_BRACKET_INDEX } from '@/common/age';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  /**
   * Lowercased mirror of `name`, kept in sync on every write. The autocomplete
   * runs an anchored `^prefix` regex against this field so MongoDB can use a
   * plain B-tree index — a case-insensitive (`$options: 'i'`) regex cannot.
   */
  @Prop({ trim: true, lowercase: true, default: '' })
  nameLower!: string;

  @Prop({ trim: true, default: '' })
  bio!: string;

  @Prop({ trim: true, default: '' })
  socialMediaLink!: string;

  /**
   * Custom profile picture (DP) — an https URL into object storage.
   *
   * Never image bytes. This field previously held an inline
   * `data:image/...;base64,...` payload, which meant every read of a user
   * document (and `/users/me` is read on every launch) dragged megabytes of
   * base64 with it, and a large enough picture could push the document past
   * MongoDB's 16MB ceiling. The bytes now live in Cloudinary — see
   * `StorageService` — and this is the reference to them.
   */
  @Prop({ trim: true, default: '', maxlength: 2048 })
  profilePicture!: string;

  /**
   * Storage handle for the current picture (`cloudinary:<publicId>` or
   * `local:<filename>`), so replacing or removing a DP can delete the object it
   * displaced instead of leaking it. Never serialised to the client.
   */
  @Prop({ trim: true, default: '', select: false })
  profilePictureKey!: string;

  /** Captured at signup; drives the automated age-group bucket. */
  @Prop({ type: Date, default: null })
  dateOfBirth!: Date | null;

  @Prop({ type: [String], default: [] })
  completedTrekIds!: string[];

  /**
   * The treks this user has liked.
   *
   * The `userinteractions` collection remains the source of truth — its
   * `{userId, trekId, type}` unique index is what guarantees one like per user
   * per trek — and this array is mirrored from it on every like/unlike so a
   * user's likes can be read in one shot without a second query. It is repaired
   * from the interactions on boot, so the two can never drift permanently.
   */
  @Prop({ type: [String], default: [] })
  likedTrekIds!: string[];

  @Prop({ required: true, select: false })
  password!: string;

  @Prop({
    type: {
      // 0-4: the five tailored peer brackets — see `common/age.ts`. Only ever
      // authoritative for accounts with no date of birth on record; otherwise
      // the bracket is re-derived from the DOB on every read.
      ageGroup: { type: Number, required: true, min: 0, max: MAX_AGE_BRACKET_INDEX },
      experienceLevel: { type: Number, required: true, min: 0, max: 3 },
      cardioFlag: { type: Number, required: true, min: 0, max: 1 },
      jointFlag: { type: Number, required: true, min: 0, max: 1 },
      altitudeHistory: { type: Number, required: true, min: 0, max: 3 },
      location: { type: String, trim: true, default: '' },
    },
    _id: false,
  })
  profile!: UserProfile;

  @Prop({
    type: {
      maxDuration: { type: Number, default: 21 },
      maxPrice: { type: Number, default: 300000 },
      difficulty: { type: String, default: 'All', enum: ['All', 'Easy', 'Moderate', 'Hard'] },
    },
    _id: false,
  })
  preferences!: UserPreferences;

  @Prop({ default: false })
  isOnboarded!: boolean;

  @Prop({ default: false })
  ageGroupLocked!: boolean;

  @Prop({ type: Date, default: null })
  lastLogin!: Date | null;
}

export interface UserProfile {
  ageGroup: number;
  experienceLevel: number;
  cardioFlag: number;
  jointFlag: number;
  altitudeHistory: number;
  location: string;
}

export interface UserPreferences {
  maxDuration: number;
  maxPrice: number;
  difficulty: 'All' | 'Easy' | 'Moderate' | 'Hard';
}

export const UserSchema = SchemaFactory.createForClass(User);

/*
  No explicit `{ email: 1 }` index here.

  `@Prop({ unique: true })` on `email` already declares one, and declaring it a
  second time made Mongoose log a "Duplicate schema index on {email:1}" warning
  on every boot. Two identical declarations do not produce two indexes — Mongo
  keeps one — so the warning was pure noise, but boot-time noise is exactly what
  stops a real warning from being noticed.
*/
UserSchema.index({ isOnboarded: 1 });
// Powers the "Find Trekkers" autocomplete.
UserSchema.index({ nameLower: 1 });

/** Keep the search mirror in sync on document saves. */
UserSchema.pre('save', function (next) {
  const self = this as any;
  if (self.isModified?.('name')) {
    self.nameLower = (self.name ?? '').toLowerCase();
  }
  next();
});

export type UserDocument = User & Document;

export const PROFILE_RANGES = {
  ageGroup: { min: 0, max: MAX_AGE_BRACKET_INDEX },
  experienceLevel: { min: 0, max: 3 },
  cardioFlag: { min: 0, max: 1 },
  jointFlag: { min: 0, max: 1 },
  altitudeHistory: { min: 0, max: 3 },
} as const;