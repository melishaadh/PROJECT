import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

/**
 * Upload policy for profile pictures.
 *
 * Two independent checks, because either alone is insufficient:
 *
 *   · **Size**, enforced by multer *before* the body is buffered. Checking
 *     after the fact would mean happily reading an arbitrarily large upload
 *     into memory first, which is the denial-of-service the limit exists to
 *     prevent.
 *   · **Type**, enforced by reading the file's leading bytes rather than
 *     trusting the `Content-Type` header or the filename extension. Both are
 *     attacker-controlled: a `.png` name and an `image/png` header say nothing
 *     about what is actually in the buffer, and accepting an HTML or SVG
 *     payload that later gets served back from our own origin is a stored-XSS
 *     vector. Only the magic bytes are authoritative.
 */

/** Hard ceiling for an uploaded picture. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

/** The only content types the API accepts. */
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];
export type ImageExtension = 'jpg' | 'png' | 'webp';

/** Multer configuration for the single-file profile picture endpoint. */
export const PROFILE_PICTURE_UPLOAD: MulterOptions = {
  // In memory: the buffer is validated and forwarded to object storage, so
  // writing it to a temp file first would only add a path to clean up.
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    // Bound the non-file parts too, so a multipart body cannot be padded out.
    fields: 4,
    fieldSize: 1024,
  },
  fileFilter: (_req, file, callback) => {
    // A cheap first pass on the declared type. The authoritative check is
    // `sniffImageType` below, once the bytes are actually in hand.
    if (!ALLOWED_IMAGE_MIME.includes(file.mimetype as AllowedImageMime)) {
      callback(
        new BadRequestException('Only JPEG, PNG and WebP images are accepted.') as unknown as Error,
        false
      );
      return;
    }
    callback(null, true);
  },
};

/**
 * Identify an image from its leading bytes, or null if it is not one of the
 * three accepted formats.
 *
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  "RIFF" ....  "WEBP"
 */
export function sniffImageType(
  buffer: Buffer
): { mime: AllowedImageMime; extension: ImageExtension } | null {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    return { mime: 'image/png', extension: 'png' };
  }

  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }

  return null;
}

/**
 * Validate an uploaded file end to end and return the type to store it as.
 * Throws a client-readable `BadRequestException` on any failure.
 */
export function validateImageUpload(file?: {
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
}): { mime: AllowedImageMime; extension: ImageExtension; buffer: Buffer } {
  if (!file?.buffer?.length) {
    throw new BadRequestException('No image was uploaded.');
  }
  // Multer's own limit should have caught this; re-checking costs nothing and
  // covers any caller that bypasses the interceptor.
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('Images must be 5MB or smaller.');
  }

  const sniffed = sniffImageType(file.buffer);
  if (!sniffed) {
    throw new BadRequestException(
      'That file is not a valid JPEG, PNG or WebP image.'
    );
  }
  // A mismatch between the declared and the actual type is not a mistake worth
  // accommodating — it is the signature of a deliberately mislabelled payload.
  if (file.mimetype && file.mimetype !== sniffed.mime) {
    throw new BadRequestException(
      `File content does not match its declared type (${file.mimetype}).`
    );
  }

  return { ...sniffed, buffer: file.buffer };
}
