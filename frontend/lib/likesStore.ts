/**
 * likesStore.ts
 *
 * One process-wide store for "what has this user liked" and "how many likes does
 * each trek have".
 *
 * Every screen previously held its own copy of this state through `useLikes`,
 * which meant four independent fetches on startup and — worse — a like
 * registered on Explore left the For You feed and the trek detail screen showing
 * stale hearts until they happened to refetch. Hoisting the state to a module
 * singleton (the same `useSyncExternalStore` pattern as `guestMode.ts`) is what
 * makes a like appear everywhere at once.
 *
 * Counts are always the server's aggregate of unique user likes. The catalogue's
 * static `likes` field is a seed for ranking only and is never displayed as a
 * live count — mixing the two is what produced the "312 → 1 on like → 0 on
 * unlike" jump.
 */

import { useSyncExternalStore } from 'react';
import {
  fetchUserLikes,
  fetchLikeCounts,
  likeTrek,
  unlikeTrek,
  LikeCounts,
} from '@/lib/likesService';

export type ToggleLikeOutcome = 'liked' | 'unliked' | 'unauthenticated' | 'error';

export interface LikesState {
  /** Trek ids the current user has liked. */
  liked: ReadonlySet<string>;
  /** trekId → live like count, as aggregated by the server. */
  counts: Readonly<LikeCounts>;
  /** Trek ids with a like/unlike request in flight, so the UI can disable them. */
  pending: ReadonlySet<string>;
  /** True until the first successful load completes. */
  loading: boolean;
  /** True once counts have been loaded at least once this session. */
  hydrated: boolean;
}

const EMPTY_STATE: LikesState = {
  liked: new Set(),
  counts: {},
  pending: new Set(),
  loading: true,
  hydrated: false,
};

let state: LikesState = EMPTY_STATE;
const listeners = new Set<() => void>();

/**
 * Subscribers notified when a like or unlike has been *confirmed by the server*.
 *
 * Separate from the state listeners on purpose. Those fire on every optimistic
 * flip, rollback and pending toggle — several times per tap — and are for
 * re-rendering. This one fires once, only when the user's like history has
 * genuinely changed, and is what anything derived from that history subscribes to
 * so it can recompute. The For You feed uses it to re-rank the moment a like is
 * registered anywhere in the app, instead of waiting for a refocus or a
 * pull-to-refresh. See `notifyLikesChanged`.
 */
const likesChangedListeners = new Set<() => void>();

function notifyLikesChanged(): void {
  likesChangedListeners.forEach(listener => {
    try {
      listener();
    } catch {
      // One failing consumer must not stop the rest from being told.
    }
  });
}

/**
 * Subscribe to confirmed like/unlike events. Returns an unsubscribe function.
 *
 * Deliberately not a hook: the consumer needs to run an effect (a refetch) on
 * the event, not re-render on it.
 */
export function subscribeToLikeChanges(listener: () => void): () => void {
  likesChangedListeners.add(listener);
  return () => {
    likesChangedListeners.delete(listener);
  };
}

/** Identity of the user the current state belongs to, so we reload on switch. */
let ownerId: string | null = null;
/** De-dupes concurrent loads — every screen mounting at once shares one fetch. */
let inFlightLoad: Promise<void> | null = null;

function emit(): void {
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A throwing subscriber must not stop the others from being notified.
    }
  });
}

function setState(patch: Partial<LikesState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LikesState {
  return state;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * Load liked ids and counts for `userId` (null for a guest, who still sees real
 * counts but has no likes of their own).
 *
 * Concurrent callers share a single request. Switching account resets the state
 * first, so one user's hearts are never briefly shown to another.
 */
export async function loadLikes(userId: string | null, force = false): Promise<void> {
  const changedUser = ownerId !== userId;
  if (changedUser) {
    ownerId = userId;
    // Drop the previous account's likes immediately, but keep counts — they are
    // not user-specific, so there is no reason to flash them away.
    state = { ...state, liked: new Set(), pending: new Set(), loading: true };
    emit();
    inFlightLoad = null;
  } else if (!force && (inFlightLoad || state.hydrated)) {
    return inFlightLoad ?? Promise.resolve();
  }

  const load = (async () => {
    try {
      const [userLikes, likeCounts] = await Promise.all([
        userId ? fetchUserLikes() : Promise.resolve(new Set<string>()),
        fetchLikeCounts(),
      ]);
      // A late response from a previous account must not overwrite the current.
      if (ownerId !== userId) return;
      setState({
        liked: userLikes,
        // Merge rather than replace, so an optimistic count written while the
        // request was in flight is not clobbered by a slightly older snapshot.
        counts: { ...state.counts, ...likeCounts },
        loading: false,
        hydrated: true,
      });
    } catch {
      // Never leave the UI stuck on a spinner because a fetch failed.
      if (ownerId === userId) setState({ loading: false });
    } finally {
      inFlightLoad = null;
    }
  })();

  inFlightLoad = load;
  return load;
}

/** Force a refresh of both liked ids and counts (pull-to-refresh). */
export async function reloadLikes(): Promise<void> {
  return loadLikes(ownerId, true);
}

/** Clear all like state — used on sign-out. */
export function resetLikes(): void {
  ownerId = null;
  inFlightLoad = null;
  state = { ...EMPTY_STATE, liked: new Set(), pending: new Set(), counts: {} };
  emit();
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

function withPending(trekId: string, active: boolean): void {
  const pending = new Set(state.pending);
  if (active) pending.add(trekId);
  else pending.delete(trekId);
  setState({ pending });
}

/**
 * Toggle a like with an optimistic update.
 *
 * The heart and the count flip immediately, then reconcile against the server's
 * authoritative count. If the write fails, *both* are rolled back to exactly the
 * values they held before the tap — captured up front rather than recomputed, so
 * a rollback cannot drift.
 *
 * A trek already mid-request is ignored, which is what stops a double-tap from
 * issuing a like and an unlike that race each other.
 */
export async function toggleLike(
  trekId: string,
  isLoggedIn: boolean
): Promise<ToggleLikeOutcome> {
  if (!trekId) return 'error';
  if (!isLoggedIn) return 'unauthenticated';
  if (state.pending.has(trekId)) return 'error';

  const wasLiked = state.liked.has(trekId);
  const previousCount = state.counts[trekId] ?? 0;
  const optimisticCount = Math.max(0, previousCount + (wasLiked ? -1 : 1));

  const nextLiked = new Set(state.liked);
  if (wasLiked) nextLiked.delete(trekId);
  else nextLiked.add(trekId);

  const pending = new Set(state.pending);
  pending.add(trekId);

  setState({
    liked: nextLiked,
    counts: { ...state.counts, [trekId]: optimisticCount },
    pending,
  });

  try {
    const result = wasLiked ? await unlikeTrek(trekId) : await likeTrek(trekId);

    if (!result.ok) {
      // Roll back to the pre-tap snapshot.
      const rolledBack = new Set(state.liked);
      if (wasLiked) rolledBack.add(trekId);
      else rolledBack.delete(trekId);
      setState({
        liked: rolledBack,
        counts: { ...state.counts, [trekId]: previousCount },
      });
      return 'error';
    }

    // Trust the server's count over the optimistic one.
    if (typeof result.likeCount === 'number') {
      setState({ counts: { ...state.counts, [trekId]: Math.max(0, result.likeCount) } });
    }
    // The write landed, so anything derived from like history is now stale.
    // Announced here rather than at the call site so *every* path that likes a
    // trek — Explore, For You, the detail screen — triggers the same downstream
    // recompute, and a screen added later cannot forget to.
    notifyLikesChanged();
    return wasLiked ? 'unliked' : 'liked';
  } catch {
    const rolledBack = new Set(state.liked);
    if (wasLiked) rolledBack.add(trekId);
    else rolledBack.delete(trekId);
    setState({
      liked: rolledBack,
      counts: { ...state.counts, [trekId]: previousCount },
    });
    return 'error';
  } finally {
    withPending(trekId, false);
  }
}

// ─── React binding ────────────────────────────────────────────────────────────

/** Subscribe a component to the shared like state. */
export function useLikesState(): LikesState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
