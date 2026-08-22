import { registerAs } from '@nestjs/config';

/**
 * Token policy.
 *
 * The access token is deliberately short-lived: it is sent on every request and
 * cannot be revoked once issued, so its blast radius is bounded by its lifetime
 * rather than by anything we can do after the fact. Sessions stay long-lived
 * through the *refresh* token instead, which is stored hashed server-side and
 * can be revoked — so a user is never randomly logged out, but a stolen access
 * token stops working in minutes.
 *
 * A missing secret in production is fatal rather than defaulted. Booting with
 * the well-known development secret would mean anyone who has read this
 * repository can mint a valid token for any account.
 */
function requiredSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} must be set to a random string of at least 32 characters in production.`
    );
  }
  if (value) {
    console.warn(`[Auth] ${name} is shorter than 32 characters — use a longer secret.`);
    return value;
  }
  console.warn(`[Auth] ${name} is not set. Falling back to a development-only secret.`);
  return devFallback;
}

export default registerAs('jwt', () => ({
  secret: requiredSecret('JWT_SECRET', 'trekeasy-dev-access-secret-change-in-production'),
  /** Short by design — the refresh token is what keeps the session alive. */
  expiresIn: process.env.JWT_EXPIRES_IN || '15m',

  refreshSecret: requiredSecret(
    'JWT_REFRESH_SECRET',
    'trekeasy-dev-refresh-secret-change-in-production'
  ),
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
}));

/** Refresh-token lifetime in milliseconds, for the cookie and the stored record. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Name of the http-only cookie carrying the refresh token. */
export const REFRESH_COOKIE = 'trekeasy_refresh';
