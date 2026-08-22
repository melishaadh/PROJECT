/**
 * Per-user run log — **console only**.
 *
 * The suite drives many users in a single spec, and Jest's own output is
 * organised by `it()` block, not by person. This keeps a record keyed by email so
 * the end of a run answers the only question that matters: which users got
 * through, which did not, and what the app said at the moment they didn't.
 *
 * Nothing here writes to disk. An earlier version dropped a JSON run log next to
 * Detox's artifacts, which put every email the run touched — alongside the step
 * each one reached — into a file that outlived the run and that nothing was
 * responsible for clearing up. Credentials never appear in this module at all:
 * the records are keyed by email and carry no password field, so there is no
 * path by which one could be printed.
 *
 * Failures are still captured two ways — a named device screenshot (Detox files
 * it under `artifacts/`, which is its own concern and is gitignored) and the
 * on-screen message read straight out of the view that displayed it, so the log
 * records what a person would have read rather than an exception from the test
 * framework.
 */

export type Outcome =
  | 'onboarded'      // signed up and completed the whole flow
  | 'existing'       // already registered; logged in instead
  | 'skipped'        // the form itself would refuse this row (under 18)
  | 'failed';        // something went wrong — see `error`

interface UserRecord {
  email: string;
  name: string;
  outcome: Outcome;
  /** The step being attempted, so a failure says where it stopped. */
  step?: string;
  /** Message read from the app's own error/validation view, when there was one. */
  uiMessage?: string | null;
  error?: string;
  screenshot?: string;
  bracket?: string;
  /** Which behavioural segment the user was simulated as. */
  style?: string;
  /** Routes liked through the UI: newly liked + already liked from a prior run. */
  likes?: number;
  /** One line describing the like plan, e.g. "niche · Annapurna · Moderate". */
  likeSummary?: string;
  durationMs: number;
}

const records: UserRecord[] = [];

export function record(entry: UserRecord): void {
  records.push(entry);
  const badge = {
    onboarded: '✓',
    existing: '·',
    skipped: '⊘',
    failed: '✗',
  }[entry.outcome];

  const bits = [
    `${badge} ${entry.email}`,
    entry.bracket ? `(${entry.bracket})` : '',
    entry.likes !== undefined ? `♥${entry.likes}` : '',
    entry.likeSummary ? `${entry.likeSummary}` : '',
    entry.step ? `at ${entry.step}` : '',
    entry.uiMessage ? `— app said: "${entry.uiMessage}"` : '',
    entry.error && !entry.uiMessage ? `— ${entry.error}` : '',
    `[${(entry.durationMs / 1000).toFixed(1)}s]`,
  ].filter(Boolean);

  console.log(bits.join(' '));
}

/**
 * Take a named screenshot. Detox writes it into the run's artifact directory;
 * the returned name is what ties a log line to the file on disk.
 */
export async function screenshot(name: string): Promise<string | undefined> {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  try {
    await device.takeScreenshot(safe);
    return safe;
  } catch {
    // A screenshot failing must never be the reason a test fails.
    return undefined;
  }
}

export function summary(): string {
  const count = (outcome: Outcome) => records.filter(r => r.outcome === outcome).length;
  const styled = (style: string) => records.filter(r => r.style === style).length;
  const totalLikes = records.reduce((sum, r) => sum + (r.likes ?? 0), 0);

  const lines = [
    '',
    '─────────────────────────────────────────────',
    `  onboarded  ${count('onboarded')}`,
    `  existing   ${count('existing')}`,
    `  skipped    ${count('skipped')}`,
    `  failed     ${count('failed')}`,
    `  total      ${records.length}`,
    '',
    // The behavioural split, so a run reports whether it actually produced the
    // two-segment corpus the engine is meant to be exercised against.
    `  diverse    ${styled('diverse')}`,
    `  niche      ${styled('niche')}`,
    `  likes      ${totalLikes}`,
  ];

  const failures = records.filter(r => r.outcome === 'failed');
  if (failures.length > 0) {
    lines.push('', '  failures:');
    for (const f of failures) {
      lines.push(
        `    ${f.email} — ${f.step ?? 'unknown step'}: ${f.uiMessage ?? f.error ?? 'no message'}` +
          (f.screenshot ? ` (screenshot: ${f.screenshot})` : '')
      );
    }
  }
  lines.push('─────────────────────────────────────────────', '');
  return lines.join('\n');
}

export const allRecords = (): readonly UserRecord[] => records;
