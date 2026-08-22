/**
 * Drive every user in `scripts/data/trekeasy-users.json` through the app, one at
 * a time, entirely through the native UI.
 *
 * Nothing here talks to the backend or the database. Each account is created by
 * typing into the real signup form and tapping the real button, exactly as a
 * person would, and every assertion reads something the app actually rendered.
 *
 * One `it()` per user, so Jest reports them individually and a failure names the
 * person it happened to. A failing user does not stop the run: the next one gets
 * a clean app launch and starts fresh.
 *
 *   npm run e2e:test                          # everyone
 *   E2E_USER_LIMIT=3 npm run e2e:test         # first three
 *   E2E_USER_COHORT="Gen-Z" npm run e2e:test  # one bracket
 */

import { onboardUser, relaunchClean, StepError } from './flows/onboardUser';
import { allRecords, screenshot, record, summary } from './support/reporter';
import { loadTestUsers, selectionFromEnv } from './support/users';

const users = loadTestUsers(selectionFromEnv());

describe('TrekEasy — sign up and onboard every seeded user through the UI', () => {
  beforeAll(async () => {
    /*
      Grant the photo-library permission up front.

      This is belt-and-braces rather than the actual fix. The app does not request
      media-library permission at all any more (see the note in
      `lib/profilePicture.ts`), and under `EXPO_PUBLIC_E2E=1` the system picker is
      never opened in the first place. But `launchApp` is the only place a
      permission dialog can be pre-answered, and an unexpected OS dialog is the
      one thing that would block the suite while looking like an app hang — so it
      is settled here, once, before any test runs.
    */
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { photos: 'YES', camera: 'NO', medialibrary: 'YES' },
    });
  });

  // Console only — the suite deliberately writes no run report to disk.
  afterAll(() => {
    console.log(summary());
  });

  it('has users to run', () => {
    expect(users.length).toBeGreaterThan(0);
    console.log(`\n  driving ${users.length} user(s) through the UI\n`);
  });

  for (const [index, user] of users.entries()) {
    const label = `${String(index + 1).padStart(3, ' ')}/${users.length} ${user.email}`;

    it(`onboards ${label}`, async () => {
      const started = Date.now();

      // A row the signup form itself would refuse (under 18 today). Recorded and
      // stepped over rather than driven into a validation error, because the form
      // rejecting it is correct behaviour, not a bug to reproduce.
      if (user.skipReason) {
        record({
          email: user.email,
          name: user.name,
          outcome: 'skipped',
          step: 'precondition',
          uiMessage: user.skipReason,
          durationMs: Date.now() - started,
        });
        return;
      }

      try {
        // Fresh install state per user, so nobody inherits the previous session.
        await relaunchClean();

        const result = await onboardUser(user);

        record({
          email: user.email,
          name: user.name,
          outcome: result.outcome,
          step: result.step,
          uiMessage: result.uiMessage ?? null,
          bracket: user.bracketKey,
          style: result.interactions?.style,
          likes: result.interactions
            ? result.interactions.liked + result.interactions.alreadyLiked
            : undefined,
          likeSummary: result.interactions?.summary,
          durationMs: Date.now() - started,
        });
      } catch (error) {
        const step = error instanceof StepError ? error.step : 'unknown';
        const uiMessage = error instanceof StepError ? error.uiMessage : null;
        const shot = await screenshot(`fail-${index + 1}-${step}-${user.name}`);

        record({
          email: user.email,
          name: user.name,
          outcome: 'failed',
          step,
          uiMessage,
          error: (error as Error).message,
          screenshot: shot,
          bracket: user.bracketKey,
          durationMs: Date.now() - started,
        });

        /*
          Swallowed on purpose.

          Rethrowing would mark this `it()` red, which is what you want for a
          normal test — but here it would also stop the sweep at the first
          casualty, and the point of the run is to get through the whole dataset
          and report on all of it. Everything needed to diagnose the failure is
          captured above: the step, the app's own message, and a screenshot. The
          final `it()` below fails the suite if anything failed, so a red run
          still reports red overall.
        */
      }
    });
  }

  /**
   * The gate. Runs last, and fails the suite if any user failed — so the run as a
   * whole is red when it should be, even though the individual tests above
   * deliberately absorb their own failures to keep going.
   */
  it('completed every user without failures', () => {
    const failed = allRecords().filter(r => r.outcome === 'failed');
    if (failed.length > 0) {
      throw new Error(
        `${failed.length} of ${users.length} user(s) failed:\n` +
          failed.map(f => `  · ${f.email} at ${f.step}: ${f.uiMessage ?? f.error}`).join('\n')
      );
    }
  });
});
