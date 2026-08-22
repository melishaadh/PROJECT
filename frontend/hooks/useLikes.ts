import { useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  loadLikes,
  reloadLikes,
  toggleLike as toggleLikeInStore,
  useLikesState,
  ToggleLikeOutcome,
} from '@/lib/likesStore';

export type { ToggleLikeOutcome };

/**
 * Single source of truth for "what has this user liked" and "how many likes does
 * each trek have".
 *
 * The state itself lives in `lib/likesStore.ts` as a module singleton, so every
 * screen that renders a heart shares one cache: a like registered on Explore is
 * reflected on For You and the trek detail screen instantly, with no refetch and
 * no per-screen duplication. Mounting several screens issues a single request.
 *
 * The displayed count is always the server's aggregate of unique user likes —
 * never the catalogue's static seed.
 */
export function useLikes() {
  const { user, isLoggedIn } = useAuth();
  const { liked, counts, pending, loading } = useLikesState();

  const userId = user?.id ?? null;

  useEffect(() => {
    // The store no-ops when this user's state is already loaded, so remounting a
    // screen does not refetch.
    loadLikes(userId);
  }, [userId]);

  const toggleLike = useCallback(
    (trekId: string) => toggleLikeInStore(trekId, isLoggedIn),
    [isLoggedIn]
  );

  /**
   * Live like count for a trek. Always defined once loaded — the backend returns
   * an explicit 0 for treks nobody has liked, so callers never need (and must
   * not use) the catalogue's seed value as a fallback.
   */
  const countFor = useCallback((trekId: string) => counts[trekId] ?? 0, [counts]);

  /** True while a like/unlike for this trek is in flight — disable the control. */
  const isPending = useCallback((trekId: string) => pending.has(trekId), [pending]);

  return {
    liked,
    counts,
    countFor,
    isPending,
    toggleLike,
    reload: reloadLikes,
    loading,
  };
}
