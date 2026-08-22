/**
 * authTokens.ts
 *
 * Session storage and the authenticated fetch wrapper.
 *
 * The backend issues a short-lived access token (minutes) alongside a
 * long-lived refresh token, so a leaked access token expires quickly while the
 * user still stays signed in for weeks. That only works if *something* performs
 * the exchange transparently — otherwise a 15-minute access token means the app
 * logs the user out every 15 minutes, which is exactly the "random logout"
 * problem it is meant to prevent.
 *
 * This module is that something. Every authenticated request goes through
 * `apiFetch`, which:
 *
 *   · refreshes proactively when the access token is within `REFRESH_SKEW_MS`
 *     of expiring, so the common path never pays a failed request first;
 *   · refreshes reactively on a 401 and retries the original request once, for
 *     the cases where the server expired a token earlier than we expected;
 *   · de-duplicates concurrent refreshes, so ten screens hydrating at once
 *     perform one token exchange rather than ten (nine of which would be
 *     rejected as replays and would burn the whole token family).
 *
 * Tokens live in AsyncStorage so a cold start resumes the session rather than
 * bouncing the user to the landing page.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '@/lib/apiConfig';

const ACCESS_TOKEN_KEY = 'trekEasyToken';
const REFRESH_TOKEN_KEY = 'trekEasyRefreshToken';
/** Epoch millis at which the access token stops being accepted. */
const EXPIRES_AT_KEY = 'trekEasyTokenExpiresAt';

/**
 * Refresh this long before the token actually expires. Covers clock skew
 * between device and server plus the round-trip of the request in flight.
 */
const REFRESH_SKEW_MS = 60_000;

export interface SessionTokens {
  access_token: string;
  refresh_token?: string | null;
  /** Access-token lifetime in seconds, as reported by the server. */
  expires_in?: number | null;
}

/** Called when the refresh chain fails terminally, so the app can sign out. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  onSessionExpired = handler;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export async function saveTokens(tokens: SessionTokens): Promise<void> {
  const entries: [string, string][] = [[ACCESS_TOKEN_KEY, tokens.access_token]];

  if (tokens.refresh_token) entries.push([REFRESH_TOKEN_KEY, tokens.refresh_token]);
  if (typeof tokens.expires_in === 'number' && tokens.expires_in > 0) {
    entries.push([EXPIRES_AT_KEY, String(Date.now() + tokens.expires_in * 1000)]);
  }

  try {
    await AsyncStorage.multiSet(entries);
  } catch {
    // A storage failure costs session persistence across restarts, not the
    // current session — the in-memory token still works until the app closes.
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, EXPIRES_AT_KEY]);
  } catch {}
}

/** The stored access token, without checking whether it is still valid. */
export async function getStoredAccessToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function getRefreshToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function getExpiresAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(EXPIRES_AT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

/** In-flight refresh, shared by every concurrent caller. */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchange the refresh token for a new pair.
 *
 * Returns the new access token, or null when the session is genuinely over.
 * A *network* failure returns the existing token rather than null: the session
 * is not invalid just because the device is briefly offline, and treating it as
 * such is what produces a spurious logout on a flaky connection.
 */
async function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const refresh_token = await getRefreshToken();
      // On the web the token is in an http-only cookie the client cannot read,
      // so an absent stored token is not proof there is no session — send the
      // request anyway with credentials and let the cookie speak.
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(refresh_token ? { refresh_token } : {}),
      });

      if (response.status === 401 || response.status === 403) {
        await clearTokens();
        onSessionExpired?.();
        return null;
      }
      if (!response.ok) {
        // 5xx or throttled: keep whatever we have and try again later.
        return getStoredAccessToken();
      }

      const data = await response.json();
      if (!data?.access_token) return getStoredAccessToken();

      await saveTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      });
      return data.access_token as string;
    } catch {
      // Offline. Deliberately not a sign-out.
      return getStoredAccessToken();
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * A usable access token, refreshing first if the stored one is expired or
 * about to be. Null when there is no session at all.
 */
export async function getToken(): Promise<string | null> {
  const token = await getStoredAccessToken();
  if (!token) {
    // No access token but possibly a refresh token (or cookie) — worth one try.
    return (await getRefreshToken()) ? refreshSession() : null;
  }

  const expiresAt = await getExpiresAt();
  // No recorded expiry means a session stored by an older build. Use it as-is;
  // the reactive 401 path below will refresh it when the server rejects it.
  if (expiresAt !== null && Date.now() >= expiresAt - REFRESH_SKEW_MS) {
    return refreshSession();
  }
  return token;
}

// ─── Authenticated fetch ──────────────────────────────────────────────────────

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  /** True when the request never reached the server (offline, DNS, timeout). */
  networkError: boolean;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Send without an Authorization header even if a session exists. */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Multipart payload; `Content-Type` is left for the runtime to set. */
  formData?: FormData;
}

/**
 * Perform an API request, attaching (and renewing) the access token.
 *
 * Never throws. Callers get a discriminated result instead, because almost
 * every call site needs to tell "the server said no" apart from "the request
 * never arrived" — and a thrown exception collapses that distinction into one
 * catch block.
 */
export async function apiFetch<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<ApiResponse<T>> {
  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    // Setting Content-Type on a FormData body would omit the multipart
    // boundary the runtime generates, and the server could not parse it.
    if (!options.formData) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      signal: options.signal,
      body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
    });
  };

  try {
    const token = options.anonymous ? null : await getToken();
    let response = await send(token);

    // Reactive refresh: the server rejected a token we believed was live.
    // Exactly one retry — a second 401 means the session really is over, and
    // retrying further would just burn the refresh-token family.
    if (response.status === 401 && !options.anonymous && token) {
      const renewed = await refreshSession();
      if (renewed && renewed !== token) {
        response = await send(renewed);
      }
    }

    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      // A 204, or an error page that is not JSON. `data` stays null.
    }

    return { ok: response.ok, status: response.status, data, networkError: false };
  } catch {
    // An aborted request is a caller-initiated cancellation rather than a
    // failure, but it surfaces here the same way; callers that pass a signal
    // check it themselves before acting on the result.
    return { ok: false, status: 0, data: null, networkError: true };
  }
}

/**
 * Human-readable message from a Nest error body.
 *
 * Nest sends `{ statusCode, error: 'Conflict', message: 'Email already
 * registered' }`; surfacing `error` verbatim would show the user the word
 * "Conflict", and validation failures arrive as an array of messages.
 */
export function errorMessage(data: any, fallback: string): string {
  const message = data?.message;
  if (Array.isArray(message) && message.length > 0) return String(message[0]);
  if (typeof message === 'string' && message) return message;
  if (typeof data?.error === 'string' && data.error) return data.error;
  return fallback;
}
