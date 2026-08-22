import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, UserPreferences, DEFAULT_PREFERENCES } from '@/lib/recommendation';
import { DEFAULT_AGE_BRACKET, clampBracket } from '@/lib/ageGroups';
import { setGuestMode } from '@/lib/guestMode';
import { loadLikes, resetLikes } from '@/lib/likesStore';
import {
  apiFetch,
  clearTokens,
  errorMessage,
  getStoredAccessToken,
  getToken,
  saveTokens,
  setSessionExpiredHandler,
} from '@/lib/authTokens';

export interface DbProfile extends UserProfile, UserPreferences {
  id: string;
  name: string | null;
  bio: string | null;
  socialMediaLink: string | null;
  /** https URL into object storage. Empty string when the user has no DP. */
  profilePicture: string;
  /** ISO date string, or null for accounts created before DOB capture. */
  dateOfBirth: string | null;
  /**
   * Whole years, derived server-side from `dateOfBirth`.
   *
   * Held here because onboarding explains that the age bracket is computed
   * rather than chosen. It is deliberately never rendered on any profile view,
   * and the public profile endpoint does not return it at all — age is
   * confidential and exists for the KNN and safety matrices only.
   */
  age: number | null;
  completedTrekIds: string[];
  /** Trek ids this user has liked, mirrored server-side from the interactions. */
  likedTrekIds: string[];
  ageGroupLocked: boolean;
  /** True when `ageGroup` is computed from DOB rather than user-selected. */
  ageGroupDerived: boolean;
  /**
   * The resolved peer bracket's own identity, as the *backend* named it.
   *
   * Held separately from `ageGroup` on purpose: the client has its own copy of
   * the bracket table to render the picker, but anything that reports which
   * cohort a user was actually clustered into should quote the server rather
   * than re-derive it, so a drifted client table cannot mislabel them.
   */
  ageBracketKey: string | null;
  ageBracketLabel: string | null;
  ageBracketRange: string | null;
}

/**
 * Identity fields the profile screen can write.
 *
 * `profilePicture` is not among them: it is set only through the multipart
 * upload endpoint, which validates real image bytes and stores them in object
 * storage. See `updateProfilePicture` below.
 */
export type EditableProfileFields = Pick<
  DbProfile,
  'name' | 'bio' | 'socialMediaLink' | 'completedTrekIds' | 'dateOfBirth'
>;

interface AuthContextValue {
  session: { user: { id: string; email: string } } | null;
  user: { id: string; email: string } | null;
  profile: DbProfile | null;
  loading: boolean;
  isLoggedIn: boolean;
  isOnboarded: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    dateOfBirth?: string
  ) => Promise<{ error: string | null }>;
  /** `identifier` is either the account's email address or its username. */
  signIn: (identifier: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Permanently delete the account. Requires the current password. */
  deleteAccount: (password: string) => Promise<{ error: string | null }>;
  saveProfile: (p: UserProfile & Partial<UserPreferences>) => Promise<{ error: string | null }>;
  updateProfileFields: (
    fields: Partial<EditableProfileFields>
  ) => Promise<{ error: string | null }>;
  /** Upload a new DP from a local file URI. Pass null to remove the current one. */
  updateProfilePicture: (
    file: { uri: string; mimeType: string; name: string } | null
  ) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  loading: false,
  isLoggedIn: false,
  isOnboarded: false,
  signUp: async () => ({ error: 'not implemented' }),
  signIn: async () => ({ error: 'not implemented' }),
  signOut: async () => {},
  deleteAccount: async () => ({ error: 'not implemented' }),
  saveProfile: async () => ({ error: 'not implemented' }),
  updateProfileFields: async () => ({ error: 'not implemented' }),
  updateProfilePicture: async () => ({ error: 'not implemented' }),
  refreshProfile: async () => {},
});

/**
 * Last known profile, cached alongside the token.
 *
 * Restoring from this makes a reload show the signed-in UI immediately instead
 * of a spinner, and — more importantly — lets the session survive a launch
 * where the backend is briefly unreachable. Only a definitive rejection from
 * the server (401/403/404, after the refresh attempt has already failed) ends a
 * session; a network failure never does.
 */
const PROFILE_CACHE_KEY = 'trekEasyProfile';

/** Status codes that mean "this token/account is no longer valid". */
const SESSION_INVALID_STATUSES = new Set([401, 403, 404]);

interface ApiUser {
  id: string;
  email: string;
  name: string | null;
  bio: string | null;
  socialMediaLink: string | null;
  profilePicture: string | null;
  dateOfBirth: string | null;
  age: number | null;
  completedTrekIds: string[];
  likedTrekIds: string[];
  ageGroup: number;
  experienceLevel: number;
  cardioFlag: number;
  jointFlag: number;
  altitudeHistory: number;
  ageGroupLocked: boolean;
  ageGroupDerived: boolean;
  ageBracketKey: string | null;
  ageBracketLabel: string | null;
  ageBracketRange: string | null;
  maxDuration: number;
  maxPrice: number;
  difficulty: DbProfile['difficulty'];
  isOnboarded: boolean;
}

/**
 * Normalise the API payload into the shape the UI reads.
 *
 * Every field is defaulted, including the numeric profile dimensions: a legacy
 * account whose embedded `profile` was never written comes back with those
 * undefined, and an undefined `ageGroup` would then index into the label arrays
 * and render "undefined" (or crash a `.toLocaleString()`) downstream.
 */
function toDbProfile(u: ApiUser): DbProfile {
  const int = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  return {
    id: u.id,
    name: u.name ?? null,
    bio: u.bio ?? null,
    socialMediaLink: u.socialMediaLink ?? null,
    profilePicture: u.profilePicture ?? '',
    dateOfBirth: u.dateOfBirth ?? null,
    age: typeof u.age === 'number' ? u.age : null,
    completedTrekIds: list(u.completedTrekIds),
    likedTrekIds: list(u.likedTrekIds),
    ageGroupLocked: u.ageGroupLocked === true,
    ageGroupDerived: u.ageGroupDerived === true,
    ageBracketKey: typeof u.ageBracketKey === 'string' ? u.ageBracketKey : null,
    ageBracketLabel: typeof u.ageBracketLabel === 'string' ? u.ageBracketLabel : null,
    ageBracketRange: typeof u.ageBracketRange === 'string' ? u.ageBracketRange : null,
    // Clamped rather than merely defaulted: a legacy document written under the
    // previous four-band scheme, or one hand-edited out of range, must still
    // index into the five-bracket table instead of rendering nothing.
    ageGroup: clampBracket(int(u.ageGroup, DEFAULT_AGE_BRACKET)),
    experienceLevel: int(u.experienceLevel, 1),
    cardioFlag: int(u.cardioFlag, 1),
    jointFlag: int(u.jointFlag, 1),
    altitudeHistory: int(u.altitudeHistory, 1),
    maxDuration: int(u.maxDuration, DEFAULT_PREFERENCES.maxDuration),
    maxPrice: int(u.maxPrice, DEFAULT_PREFERENCES.maxPrice),
    difficulty: u.difficulty ?? DEFAULT_PREFERENCES.difficulty,
  };
}

/** Persist the profile so the next launch can restore the session instantly. */
async function cacheUser(user: ApiUser | null): Promise<void> {
  try {
    if (user) await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
}

async function readCachedUser(): Promise<ApiUser | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Guard against a truncated or stale-shaped cache entry.
    return parsed && typeof parsed === 'object' && typeof parsed.id === 'string'
      ? (parsed as ApiUser)
      : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<DbProfile | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);

  /** Apply a server (or cached) user to state, and refresh the offline cache. */
  const applyUser = useCallback((u: ApiUser, persist = true) => {
    setUser({ id: u.id, email: u.email });
    setProfile(toDbProfile(u));
    setOnboarded(u.isOnboarded === true);
    if (persist) void cacheUser(u);
  }, []);

  const clearSession = useCallback(async () => {
    await Promise.all([clearTokens(), cacheUser(null)]);
    setUser(null);
    setProfile(null);
    setOnboarded(false);
    // Drop the previous account's hearts so they are never shown to the next one.
    resetLikes();
  }, []);

  /**
   * The token layer signs out only when the refresh chain is definitively
   * rejected — never on a network failure — so this handler can safely tear
   * down the session without second-guessing it.
   */
  useEffect(() => {
    setSessionExpiredHandler(() => {
      void clearSession();
    });
    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  /**
   * Restore the session on launch.
   *
   * Order matters: the cached profile is applied *first* so the app renders as
   * signed-in straight away, then the server is asked to confirm. `apiFetch`
   * has already attempted a token refresh by the time a 401 reaches us, so a
   * 401/403/404 here really does mean the session is over; anything else
   * (offline, 500, timeout) leaves the cached session intact rather than
   * bouncing the user to the landing page.
   */
  useEffect(() => {
    let active = true;
    (async () => {
      const token = await getStoredAccessToken();
      if (!token) {
        if (active) setLoading(false);
        return;
      }

      const cached = await readCachedUser();
      if (cached && active) {
        applyUser(cached, false);
        // Stop blocking immediately — the cached session is enough to render
        // the signed-in app. Revalidation below happens in the background, so a
        // slow or unreachable backend costs no startup latency.
        setLoading(false);
      }

      const { ok, status, data, networkError } = await apiFetch<ApiUser>('/users/me');
      if (!active) return;

      if (ok && data && !(data as any).error) {
        applyUser(data);
      } else if (!networkError && SESSION_INVALID_STATUSES.has(status)) {
        await clearSession();
      }
      // Otherwise: keep whatever the cache restored. The session survives.

      // With no cache to fall back on, this is the first point at which the
      // session state is actually known.
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [applyUser, clearSession]);

  const refreshProfile = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setProfile(null);
      return;
    }
    const { ok, status, data, networkError } = await apiFetch<ApiUser>('/users/me');
    if (ok && data && !(data as any).error) {
      applyUser(data);
    } else if (!networkError && SESSION_INVALID_STATUSES.has(status)) {
      await clearSession();
    }
  }, [applyUser, clearSession]);

  /** Shared tail of sign-up and sign-in: persist tokens, apply the user. */
  const establishSession = useCallback(
    async (data: any) => {
      await saveTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      });
      applyUser(data.user as ApiUser);
      // Load the new account's like state rather than inheriting whatever the
      // previous session left in the shared store.
      void loadLikes(data.user?.id ?? null, true);
    },
    [applyUser]
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string, dateOfBirth?: string) => {
      const { data, networkError } = await apiFetch('/auth/register', {
        method: 'POST',
        anonymous: true,
        body: { email, password, name, ...(dateOfBirth ? { dateOfBirth } : {}) },
      });
      if (networkError) return { error: 'Could not reach the server. Please try again.' };
      if (!data || data.error || !data.access_token) {
        return { error: errorMessage(data, 'Registration failed') };
      }
      await establishSession(data);
      return { error: null };
    },
    [establishSession]
  );

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const { data, networkError } = await apiFetch('/auth/login', {
        method: 'POST',
        anonymous: true,
        body: { identifier, password },
      });
      if (networkError) return { error: 'Could not reach the server. Please try again.' };
      if (!data || data.error || !data.access_token) {
        return { error: errorMessage(data, 'Login failed') };
      }
      await establishSession(data);
      return { error: null };
    },
    [establishSession]
  );

  const signOut = useCallback(async () => {
    // Tell the server to revoke the refresh grant, so the session cannot be
    // resumed from a copy of the token. Best-effort: a failure here must not
    // stop the local sign-out, or the user is stuck signed in while offline.
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    await clearSession();
    // Drop guest browsing too, so signing out returns to the landing page
    // instead of leaving the tabs open in a half-signed-out state.
    setGuestMode(false);
  }, [clearSession]);

  /**
   * Permanently delete the account. Unlike `signOut`, a failure here must
   * *not* clear the local session — a wrong password means nothing happened
   * server-side, and dropping the session anyway would look like the deletion
   * succeeded when the account is still live.
   */
  const deleteAccount = useCallback(
    async (password: string) => {
      const { ok, data, networkError } = await apiFetch('/users/account', {
        method: 'DELETE',
        body: { password },
      });
      if (networkError) return { error: 'Could not reach the server. Please try again.' };
      if (!ok) return { error: errorMessage(data, 'Could not delete account') };
      await clearSession();
      setGuestMode(false);
      return { error: null };
    },
    [clearSession]
  );

  const saveProfile = useCallback(
    async (p: UserProfile & Partial<UserPreferences>) => {
      const { ok, data, networkError } = await apiFetch('/users/profile', {
        method: 'PATCH',
        body: {
          ageGroup: p.ageGroup,
          experienceLevel: p.experienceLevel,
          cardioFlag: p.cardioFlag,
          jointFlag: p.jointFlag,
          altitudeHistory: p.altitudeHistory,
          maxDuration: p.maxDuration ?? DEFAULT_PREFERENCES.maxDuration,
          maxPrice: p.maxPrice ?? DEFAULT_PREFERENCES.maxPrice,
          difficulty: p.difficulty ?? DEFAULT_PREFERENCES.difficulty,
        },
      });
      if (networkError) return { error: 'Could not reach the server. Please try again.' };
      if (!ok || !data?.user) return { error: errorMessage(data, 'Could not save profile') };
      applyUser(data.user as ApiUser);
      return { error: null };
    },
    [applyUser]
  );

  const updateProfileFields = useCallback(
    async (fields: Partial<EditableProfileFields>) => {
      const { ok, data, networkError } = await apiFetch('/users/me', {
        method: 'PATCH',
        body: fields,
      });
      if (networkError) return { error: 'Could not reach the server. Please try again.' };
      if (!ok || !data?.user) return { error: errorMessage(data, 'Could not update profile') };
      applyUser(data.user as ApiUser);
      return { error: null };
    },
    [applyUser]
  );

  /**
   * Upload or remove the profile picture.
   *
   * The image is posted as multipart form data — the bytes go to object storage
   * and only the resulting URL is persisted. Sending it as inline base64 on a
   * JSON body, which is what this used to do, meant the picture was stored in
   * the user document and re-downloaded in full on every profile read.
   */
  const updateProfilePicture = useCallback(
    async (file: { uri: string; mimeType: string; name: string } | null) => {
      if (!file) {
        const { ok, data, networkError } = await apiFetch('/users/me/profile-picture', {
          method: 'DELETE',
        });
        if (networkError) return { error: 'Could not reach the server. Please try again.' };
        if (!ok || !data?.user) return { error: errorMessage(data, 'Could not remove the picture') };
        applyUser(data.user as ApiUser);
        return { error: null };
      }

      const form = new FormData();
      // React Native's FormData accepts this `{uri, name, type}` shape and
      // streams the file from disk, so the image is never held in JS memory.
      form.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as unknown as Blob);

      const { ok, data, networkError } = await apiFetch('/users/me/profile-picture', {
        method: 'POST',
        formData: form,
      });
      if (networkError) return { error: 'Could not reach the server. Please try again.' };
      if (!ok || !data?.user) return { error: errorMessage(data, 'Could not upload the picture') };
      applyUser(data.user as ApiUser);
      return { error: null };
    },
    [applyUser]
  );

  return (
    <AuthContext.Provider
      value={{
        session: user ? { user } : null,
        user,
        profile,
        loading,
        isLoggedIn: user !== null,
        isOnboarded: onboarded,
        signUp,
        signIn,
        signOut,
        deleteAccount,
        saveProfile,
        updateProfileFields,
        updateProfilePicture,
        refreshProfile,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Re-exported so existing service modules keep one import path for the token.
 * New code should prefer `apiFetch` from `@/lib/authTokens`, which handles the
 * refresh cycle rather than making each caller remember to.
 */
export { getToken };
