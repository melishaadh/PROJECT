import Constants from 'expo-constants';

// Resolve the backend API base URL.
//
// Priority:
//   1. EXPO_PUBLIC_API_URL   — explicit override for production / remote backends
//   2. Auto-detected dev host — the LAN IP of the machine running Metro, which
//      is also where the NestJS backend runs. This is what makes signup/login
//      work from Expo Go on a physical phone (where "localhost" is the phone).
//   3. localhost              — last-resort fallback (web / simulator).
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  const port = process.env.EXPO_PUBLIC_API_PORT || '3001';

  // In Expo dev, hostUri looks like "192.168.18.139:8081".
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants.expoGoConfig as any)?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${port}/api`;
  }

  return `http://localhost:${port}/api`;
}

export const API_URL = resolveApiUrl();

/**
 * The backend origin without the `/api` prefix.
 *
 * Uploaded images are served as static assets from `/uploads`, which is
 * registered *outside* the global `api` prefix — so they live on the origin,
 * not under the API path.
 */
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

/**
 * Turn a stored image reference into something `<Image>` can actually load.
 *
 * When the backend has no Cloudinary credentials it stores uploads on local
 * disk and records the URL as `${PUBLIC_BASE_URL}/uploads/<file>`. With
 * `PUBLIC_BASE_URL` unset — the default for local development — that collapses
 * to a bare `/uploads/<file>`, and a relative URI has nothing to resolve
 * against on native: React Native has no document base URL, so the request
 * silently fails and the avatar renders its fallback icon. The upload had
 * succeeded and the database was correct; only the URI was unusable.
 *
 * Resolving against the origin the app is already talking to fixes new uploads
 * *and* every relative path already sitting in the database, without pinning a
 * host that changes every time the dev machine's LAN address does.
 */
export function resolveImageUri(uri?: string | null): string | null {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;

  // Already loadable: absolute http(s), inline data, or a local file handle.
  if (/^(https?:|data:|file:|content:|asset:|blob:)/i.test(trimmed)) return trimmed;

  // Server-relative path — attach the origin serving it.
  if (trimmed.startsWith('/')) return `${API_ORIGIN}${trimmed}`;

  return trimmed;
}
