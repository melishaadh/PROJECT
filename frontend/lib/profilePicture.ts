import * as ImagePicker from 'expo-image-picker';
import { Asset } from 'expo-asset';
import { IS_E2E } from '@/lib/e2e';

/**
 * Hard ceiling for an uploaded picture, mirroring the backend's multer limit.
 * Checking here too means an oversized photo is rejected before the upload
 * starts rather than after five megabytes have gone over a mobile connection.
 */
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/** The formats the backend accepts. Anything else is refused at the picker. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface PickedPicture {
  /** Local file URI, streamed straight into the multipart upload. */
  uri: string;
  mimeType: string;
  name: string;
}

export interface PickPictureResult {
  file?: PickedPicture;
  /** Set when the user cancelled — not an error, just nothing to do. */
  cancelled?: boolean;
  error?: string;
}

/** Map a content type onto the extension the server will store it under. */
function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Open the photo gallery and return a handle to the chosen image.
 *
 * Gallery selection is the only path — the in-app camera capture was removed
 * from the profile-picture flow, so there is no "Take Photo" option anywhere in
 * the app and camera permission is never requested for a DP.
 *
 * **No permission request.** This is the fix for "Choose from library" appearing
 * to hang: the flow used to gate itself behind
 * `requestMediaLibraryPermissionsAsync()` and bail out when it was not granted.
 * `expo-image-picker` reads the library through the platform's own picker — the
 * Android photo picker and iOS `PHPicker` — which runs out of process and returns
 * only the single item the user chose. Nothing is granted because nothing is
 * being accessed on the app's behalf, and since v16 the library no longer even
 * declares `READ_MEDIA_IMAGES`. Requesting a permission that is not declared
 * resolves as denied immediately and without a dialog, so the picker was never
 * launched at all: the sheet closed and nothing else happened. Launching directly
 * is both the supported path and the working one.
 *
 * The picker crops to a square and re-encodes at reduced quality, which keeps a
 * phone photo comfortably inside the size ceiling. Deliberately **not** base64:
 * the file URI is handed to `FormData`, which streams it from disk, so a large
 * image is never materialised in JavaScript memory and never travels as a
 * base64 string a third larger than the bytes it encodes.
 */
export async function pickProfilePicture(): Promise<PickPictureResult> {
  // Under test, hand back a bundled image instead of opening the system picker.
  // See `pickFixturePicture` for why this is a bypass rather than a mock.
  if (IS_E2E) return pickFixturePicture();

  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      // Explicitly single-select. `allowsEditing` and `allowsMultipleSelection`
      // are mutually exclusive and the library throws if both are on, so pinning
      // this makes the pairing safe against a future default flip.
      allowsMultipleSelection: false,
    });

    if (result.canceled) return { cancelled: true };

    const asset = result.assets?.[0];
    if (!asset?.uri) return { error: 'Could not read the selected image.' };

    /*
      Normalise the content type rather than reject on it.

      The backend compares the declared type against the file's actual magic
      bytes and refuses any mismatch, so what is sent here has to be accurate.
      Cropping re-encodes to JPEG on both platforms, so JPEG is the right answer
      whenever the picker reports nothing usable — an iOS HEIC original, for
      instance, arrives here already converted, and rejecting it on its original
      type (which is what this used to do) refused a photo that would have
      uploaded perfectly well.
    */
    const reported = (asset.mimeType ?? '').toLowerCase();
    const mimeType = ALLOWED_MIME.includes(reported as (typeof ALLOWED_MIME)[number])
      ? reported
      : 'image/jpeg';

    // `fileSize` is absent on some platforms; when it is present, use it.
    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_PICTURE_BYTES) {
      return { error: 'That image is larger than 5MB. Please choose a smaller one.' };
    }

    // The filename has to agree with the type we just settled on: a ".heic" name
    // on a JPEG body is the kind of inconsistency the server treats as suspect.
    return {
      file: {
        uri: asset.uri,
        mimeType,
        name: `profile.${extensionFor(mimeType)}`,
      },
    };
  } catch {
    return { error: 'Could not open the image picker.' };
  }
}

/** The image the end-to-end suite "chooses" — a 256×256 PNG in `assets/e2e`. */
const E2E_FIXTURE = require('../assets/e2e/avatar.png');

/**
 * The picked-image path used when `IS_E2E`.
 *
 * **Why this exists.** The system photo picker runs out of process — the Android
 * photo picker and iOS `PHPicker` are separate apps drawing on top of ours.
 * Detox automates *this* app's view hierarchy and has no visibility into
 * theirs, so a UI test that taps "Choose from library" opens a window it cannot
 * see, cannot tap, and cannot dismiss: the run hangs until the test times out,
 * which is exactly the symptom the profile page was failing with under
 * automation. No amount of waiting fixes it, because there is nothing in our
 * hierarchy left to wait for.
 *
 * **Why a bundled asset and not a stub URI.** Everything downstream of the
 * picker stays real: the file is resolved to an actual on-device path, handed to
 * `FormData`, streamed to the backend, checked against the multipart size limit
 * and sniffed for its magic bytes, and the returned URL is written to the user
 * document. A hard-coded `file:///nope.jpg` would sail past the picker and then
 * fail the upload, testing nothing. This way the only step skipped is the one
 * step that belongs to the operating system.
 *
 * `downloadAsync` copies the asset out of the bundle into the app's cache and
 * populates `localUri`; in a debug build it pulls from the Metro server. Either
 * way what comes back is a `file://` path that React Native's `FormData` can
 * stream, which `Image.resolveAssetSource` alone would not give us — in
 * development that resolves to an `http://` Metro URL, and RN's upload layer
 * will not fetch one.
 */
async function pickFixturePicture(): Promise<PickPictureResult> {
  try {
    const asset = Asset.fromModule(E2E_FIXTURE);
    await asset.downloadAsync();

    const uri = asset.localUri ?? asset.uri;
    if (!uri) return { error: 'E2E: could not resolve the fixture image.' };

    return { file: { uri, mimeType: 'image/png', name: 'profile.png' } };
  } catch (error) {
    // Surfaced rather than swallowed: a broken fixture should fail the test
    // loudly instead of looking like a user who cancelled.
    return { error: `E2E: fixture image unavailable (${(error as Error).message})` };
  }
}
