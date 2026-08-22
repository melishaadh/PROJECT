/**
 * userSearchService.ts
 *
 * User search and public profile lookup, backed by the NestJS API. Requests go
 * through `apiFetch`, so the access token is attached and renewed without each
 * call site having to think about it.
 *
 * The group-membership helpers that used to live here (`fetchGroups`,
 * `addUserToGroup`, `createGroup`) are gone along with the `/groups` API they
 * wrapped — expedition chat replaced that flow, and it is served by
 * `chatService.ts` against `/chat`.
 */

import { Linking } from 'react-native';
import { apiFetch } from '@/lib/authTokens';

/**
 * Another trekker as this app is allowed to see them.
 *
 * Note what is not here: no email, no date of birth, no age, no health flags.
 * The backend's public-profile projection withholds them, and age in particular
 * is confidential — it exists only inside the KNN and safety matrices and is
 * never rendered on any profile view.
 */
export interface SearchUser {
  id: string;
  username: string | null;
  bio: string | null;
  socialMediaLink: string | null;
  profilePicture: string;
  completedTrekIds: string[];
}

/** Normalise a payload into `SearchUser`, defaulting every field. */
function toSearchUser(r: any): SearchUser | null {
  if (!r || typeof r.id !== 'string') return null;
  return {
    id: r.id,
    username: typeof r.username === 'string' ? r.username : null,
    bio: typeof r.bio === 'string' ? r.bio : null,
    socialMediaLink: typeof r.socialMediaLink === 'string' ? r.socialMediaLink : null,
    profilePicture: typeof r.profilePicture === 'string' ? r.profilePicture : '',
    completedTrekIds: Array.isArray(r.completedTrekIds)
      ? r.completedTrekIds.filter((id: unknown): id is string => typeof id === 'string')
      : [],
  };
}

/**
 * Autocomplete over usernames. The backend ranks prefix matches above
 * mid-word matches, so results stay stable as the query grows.
 */
export async function searchUsers(query: string, signal?: AbortSignal): Promise<SearchUser[]> {
  const q = query.trim();
  if (!q) return [];

  const { ok, data } = await apiFetch<any[]>(
    `/users/search?q=${encodeURIComponent(q)}`,
    { signal }
  );
  if (!ok || !Array.isArray(data)) return [];
  return data.map(toSearchUser).filter((u): u is SearchUser => u !== null);
}

/** Full public profile for a searched user (bio, socials, completed treks, DP). */
export async function fetchUserProfile(userId: string): Promise<SearchUser | null> {
  if (!userId) return null;
  const { ok, data } = await apiFetch<any>(`/users/${encodeURIComponent(userId)}`);
  if (!ok || !data || data.error) return null;
  return toSearchUser(data);
}

export function openSocialLink(url: string): void {
  if (!url) return;
  Linking.openURL(url).catch(() => {});
}
