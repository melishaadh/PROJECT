import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Object storage for user-uploaded images.
 *
 * Profile pictures used to be persisted as inline `data:image/...;base64,...`
 * strings on the user document. That is wrong on three counts: it inflates
 * every user read by megabytes (the DP is fetched on every `/users/me`), base64
 * costs a third more bytes than the binary it encodes, and MongoDB's 16MB
 * document ceiling makes it a hard scaling wall. Images belong in object
 * storage; the database should hold a URL.
 *
 * Two backends, selected by configuration:
 *
 *   · **Cloudinary** when `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
 *     `CLOUDINARY_API_SECRET` are set. Uploads go over Cloudinary's REST API
 *     with a signed request — no SDK, so no extra dependency to audit.
 *   · **Local disk** otherwise, written under `uploads/` and served as a static
 *     route. This is the development fallback; it keeps the *shape* identical
 *     (the database stores a URL either way) so switching to Cloudinary in
 *     production is a config change, not a migration.
 *
 * Either way the caller gets back a URL and a delete handle, and no image byte
 * ever reaches a Mongo document.
 */

/** Where local uploads live, relative to the process working directory. */
export const UPLOAD_DIR = 'uploads';
/** Public path prefix the static handler serves `UPLOAD_DIR` from. */
export const UPLOAD_ROUTE = '/uploads';

export interface StoredImage {
  /** Absolute or app-relative URL the client can render. */
  url: string;
  /** Backend-specific handle used to delete the object later. */
  key: string;
  /** Which backend stored it. */
  provider: 'cloudinary' | 'local';
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.cloudinaryConfigured()) {
      this.logger.log('Profile pictures will be stored in Cloudinary.');
      return;
    }
    // Fail loudly in production rather than silently writing to a container
    // filesystem that disappears on the next deploy.
    if (this.config.get<string>('NODE_ENV') === 'production') {
      this.logger.error(
        'No cloud storage configured. Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / ' +
          'CLOUDINARY_API_SECRET — local disk uploads do not survive a redeploy.'
      );
    } else {
      this.logger.warn(
        'No cloud storage configured; profile pictures will be written to ' +
          `./${UPLOAD_DIR}. Configure Cloudinary before deploying.`
      );
    }
    await mkdir(join(process.cwd(), UPLOAD_DIR), { recursive: true }).catch(() => {});
  }

  private cloudinaryConfigured(): boolean {
    return Boolean(
      this.config.get<string>('CLOUDINARY_CLOUD_NAME') &&
        this.config.get<string>('CLOUDINARY_API_KEY') &&
        this.config.get<string>('CLOUDINARY_API_SECRET')
    );
  }

  /**
   * Persist an image buffer and return its URL.
   *
   * `extension` is derived by the caller from the *sniffed* content type, not
   * from the client-supplied filename — see `image-upload.ts`.
   */
  async storeImage(
    buffer: Buffer,
    extension: 'jpg' | 'png' | 'webp',
    folder = 'profile-pictures'
  ): Promise<StoredImage> {
    if (!buffer?.length) throw new BadRequestException('The uploaded file is empty.');

    return this.cloudinaryConfigured()
      ? this.storeInCloudinary(buffer, extension, folder)
      : this.storeOnDisk(buffer, extension, folder);
  }

  /** Best-effort removal of a previously stored object. Never throws. */
  async deleteImage(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      if (key.startsWith('cloudinary:')) {
        await this.deleteFromCloudinary(key.slice('cloudinary:'.length));
      } else if (key.startsWith('local:')) {
        await unlink(join(process.cwd(), UPLOAD_DIR, key.slice('local:'.length)));
      }
    } catch (error) {
      // A leaked object is a housekeeping problem; failing the user's request
      // over it would be worse. Log and move on.
      this.logger.warn(`Could not delete stored image "${key}": ${(error as Error).message}`);
    }
  }

  // ─── Cloudinary ────────────────────────────────────────────────────────────

  private async storeInCloudinary(
    buffer: Buffer,
    extension: string,
    folder: string
  ): Promise<StoredImage> {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME')!;
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY')!;
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET')!;

    const publicId = `${folder}/${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary's signature is a SHA-1 of the signed parameters in
    // alphabetical order, joined as a query string, with the API secret
    // appended. `api_key` and `file` are excluded from the signature.
    const signature = createHash('sha1')
      .update(`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), `upload.${extension}`);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('public_id', publicId);
    form.append('folder', folder);
    form.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: form }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Cloudinary upload failed (${response.status}): ${detail}`);
      throw new BadRequestException('Could not upload the image. Please try again.');
    }

    const result = (await response.json()) as { secure_url?: string; public_id?: string };
    if (!result.secure_url || !result.public_id) {
      throw new BadRequestException('Could not upload the image. Please try again.');
    }

    return {
      url: result.secure_url,
      key: `cloudinary:${result.public_id}`,
      provider: 'cloudinary',
    };
  }

  private async deleteFromCloudinary(publicId: string): Promise<void> {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) return;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHash('sha1')
      .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');

    const form = new FormData();
    form.append('public_id', publicId);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: 'POST',
      body: form,
    });
  }

  // ─── Local disk ────────────────────────────────────────────────────────────

  private async storeOnDisk(
    buffer: Buffer,
    extension: string,
    folder: string
  ): Promise<StoredImage> {
    // The filename is generated, never taken from the upload — a client-supplied
    // name is a path-traversal vector and this way there is nothing to sanitise.
    const filename = `${folder.replace(/[^a-z0-9-]/gi, '')}-${randomUUID()}.${extension}`;
    const directory = join(process.cwd(), UPLOAD_DIR);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), buffer);

    /*
      With `PUBLIC_BASE_URL` set this is an absolute URL. Without it — the
      default in local development, where the LAN address changes and pinning
      one would be worse than useless — the result is the server-relative
      `/uploads/<file>`.

      That relative form is deliberate, and the client resolves it against the
      origin it is already talking to (`resolveImageUri` in `lib/apiConfig.ts`).
      Do not "fix" it by hard-coding a host: an absolute URL baked in here is
      wrong the moment the machine's IP changes, and it would be persisted into
      every user document.
    */
    const base = (this.config.get<string>('PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
    return {
      url: `${base}${UPLOAD_ROUTE}/${filename}`,
      key: `local:${filename}`,
      provider: 'local',
    };
  }
}
