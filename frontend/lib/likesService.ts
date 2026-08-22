/**
 * likesService.ts
 *
 * Database-backed trek likes. Reads and writes through the NestJS backend
 * (`/users/me/likes`), authenticated with the access token `authTokens` manages
 * — so likes are tied to the user's account, not the device, and a token that
 * expires mid-session is renewed transparently rather than silently dropping
 * the like.
 *
 * Like *counts* always come from the server's aggregation. There is no
 * client-side fallback number: the catalogue carries no popularity field at
 * all, precisely so a fabricated figure can never be displayed as if it were
 * real engagement.
 */

import { apiFetch } from '@/lib/authTokens';

/** trekId → live like count. */
export type LikeCounts = Record<string, number>;

/** The current user's liked trek IDs. Empty set when logged out or on error. */
export async function fetchUserLikes(): Promise<Set<string>> {
  const { ok, data } = await apiFetch<{ trekId: string }[]>('/users/me/likes');
  if (!ok || !Array.isArray(data)) return new Set();
  return new Set(
    data.map(l => l?.trekId).filter((id): id is string => typeof id === 'string')
  );
}

/**
 * Live like count for every trek, in one request. Public — guests see real
 * counts on cards even though they cannot like.
 */
export async function fetchLikeCounts(): Promise<LikeCounts> {
  const { ok, data } = await apiFetch<LikeCounts>('/users/likes/counts', { anonymous: true });
  if (!ok || !data || typeof data !== 'object' || Array.isArray(data)) return {};

  // Coerce defensively: a malformed entry becoming NaN downstream would render
  // as "NaN" on a card rather than failing anywhere it could be noticed.
  const counts: LikeCounts = {};
  for (const [trekId, value] of Object.entries(data)) {
    if (typeof value === 'number' && Number.isFinite(value)) counts[trekId] = Math.max(0, value);
  }
  return counts;
}

export interface LikeResult {
  ok: boolean;
  /** Server-authoritative count after the write, when the request succeeded. */
  likeCount?: number;
  /** Present when the write failed, for the caller to surface. */
  error?: string;
}

/** Like a trek. Requires login. Idempotent server-side. */
export async function likeTrek(trekId: string): Promise<LikeResult> {
  return writeLike('likes', trekId);
}

/** Unlike a trek. Requires login. Idempotent server-side. */
export async function unlikeTrek(trekId: string): Promise<LikeResult> {
  return writeLike('unlike', trekId);
}

async function writeLike(path: 'likes' | 'unlike', trekId: string): Promise<LikeResult> {
  if (!trekId) return { ok: false, error: 'Missing trek id' };

  const { ok, data, networkError } = await apiFetch<{ success?: boolean; likeCount?: number }>(
    `/users/me/${path}`,
    { method: 'POST', body: { trekId } }
  );

  if (!ok || data?.success !== true) {
    return {
      ok: false,
      error: networkError ? 'You appear to be offline.' : 'Could not save that just now.',
    };
  }
  return {
    ok: true,
    likeCount: typeof data.likeCount === 'number' ? data.likeCount : undefined,
  };
}
