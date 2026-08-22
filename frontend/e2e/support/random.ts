/**
 * Deterministic pseudo-randomness, seeded from a string.
 *
 * Every per-user decision the suite makes — which onboarding chips to tap, which
 * behavioural segment the person belongs to, which routes they like — is drawn
 * from one of these, seeded off the user's email. That means a re-run over the
 * same dataset makes exactly the same 500 people behave exactly the same way, so
 * a failure is reproducible and the resulting interaction corpus is stable
 * enough to reason about the recommendation engine's output against.
 *
 * `Math.random()` is deliberately never used anywhere in the suite.
 */

/** FNV-1a. Small, fast, and well spread for short ASCII keys like an email. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an index from a weight table. Weights should sum to 1. */
export function pickWeighted(rng: () => number, weights: readonly number[]): number {
  let roll = rng();
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/** A copy of `items`, shuffled deterministically (Fisher-Yates). */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
