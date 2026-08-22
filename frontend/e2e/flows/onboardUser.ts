/**
 * One person's complete journey through the app, start to finish.
 *
 * This is the only place that knows the *order* of the journey; the page objects
 * know how to operate each screen and nothing about what comes next. Every step
 * is a native interaction — tap, type, scroll — and the branch points are decided
 * by reading what the app put on screen, the same way a person would.
 *
 * The app is relaunched with a clean slate for each user (`delete: true`), because
 * a session persists in AsyncStorage and the second user would otherwise start
 * already signed in as the first.
 */

import { T } from '@/constants/testIDs';

import { explorePage } from '../pages/ExplorePage';
import { forYouPage } from '../pages/ForYouPage';
import { landingPage } from '../pages/LandingPage';
import { logInPage } from '../pages/LogInPage';
import { onboardingPage } from '../pages/OnboardingPage';
import { preferencesPage } from '../pages/PreferencesPage';
import { profilePage } from '../pages/ProfilePage';
import { signUpPage } from '../pages/SignUpPage';
import { tabBar } from '../pages/TabBar';
import { NETWORK_TIMEOUT, waitForFirst } from '../support/actions';
import { MIN_LIKES, planLikes } from '../support/likePlan';
import type { Outcome } from '../support/reporter';
import type { TestUser } from '../support/users';

export interface FlowResult {
  outcome: Outcome;
  /** Where it got to — named after the step, for the failure log. */
  step: string;
  uiMessage?: string | null;
  /** What the user liked, and under which behavioural segment. */
  interactions?: InteractionResult;
}

/** The outcome of the like phase, for the run log. */
export interface InteractionResult {
  style: string;
  /** Routes newly liked in this run. */
  liked: number;
  /** Routes that were already liked from an earlier run over the dataset. */
  alreadyLiked: number;
  /** How many the plan asked for. */
  planned: number;
  summary: string;
}

/** Thrown with the step attached so the caller can report where it stopped. */
export class StepError extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly uiMessage: string | null = null
  ) {
    super(message);
    this.name = 'StepError';
  }
}

/** Cold start with storage wiped, so no session survives from the previous user. */
export async function relaunchClean(): Promise<void> {
  await device.launchApp({ newInstance: true, delete: true });
}

/**
 * The part of the journey that is the same whether the account was just created
 * or already existed: set a profile picture, fill in the profile, then save the
 * trek preferences from the For You sheet.
 *
 * Both callers arrive here from the tab stack, so this starts by navigating to
 * the Profile tab and ends on the For You tab.
 */
async function completeProfileAndPreferences(user: TestUser): Promise<void> {
  await tabBar.waitUntilVisible();
  await tabBar.goToProfile();
  await profilePage.waitUntilLoaded();

  const upload = await profilePage.uploadPicture();
  if (!upload.ok) {
    throw new StepError('profile-picture', `picture upload failed: ${upload.message}`, upload.message);
  }
  await profilePage.dismissToast();

  const details = await profilePage.updateDetails(user.profile);
  if (!details.ok) {
    throw new StepError('profile-details', `saving details failed: ${details.message}`, details.message);
  }

  await tabBar.goToForYou();
  await preferencesPage.open();
  await preferencesPage.answerAll(user);
  if ((await preferencesPage.save()) === 'error') {
    const message = await preferencesPage.readError();
    throw new StepError('preferences', `saving preferences failed: ${message}`, message);
  }
}

/**
 * The interaction phase: like three or four routes through the Explore tab, then
 * check the personalised feed actually came back with something.
 *
 * This is what turns a signed-up account into a *user*. Everything before it
 * produces a profile the engine can reason about in the abstract; this produces
 * the like history the behavioural and collaborative layers are built on, and it
 * deliberately overshoots the engine's 2-like trigger so that every account in
 * the corpus ends the run in the adapted state rather than in cold start.
 *
 * Which routes get liked is not arbitrary — see `likePlan.ts`. Roughly half the
 * population spreads its likes across regions, price tiers and difficulty tiers
 * to give the collaborative layer overlapping clusters to find; the rest keeps
 * them tightly inside one region and one parent trek family, which is the shape
 * that makes the content-based claims checkable.
 *
 * A route the plan asks for but the catalogue cannot show is recorded and
 * stepped over. Falling short of the trigger, though, is a real failure: an
 * account with fewer than two likes has not exercised the thing this run exists
 * to exercise.
 */
async function likeTreks(user: TestUser): Promise<InteractionResult> {
  const plan = planLikes(user.email, user.answers);
  if (plan.relaxed) {
    console.log(`      ${user.email}: ${plan.relaxed}`);
  }

  await tabBar.goToExplore();

  let liked = 0;
  let alreadyLiked = 0;
  const missing: string[] = [];

  for (const target of plan.likes) {
    const outcome = await explorePage.like(target);
    if (outcome === 'liked') liked++;
    else if (outcome === 'already-liked') alreadyLiked++;
    else missing.push(target.title);
  }

  if (missing.length > 0) {
    console.log(`      ${user.email}: could not find ${missing.join(', ')} in Explore`);
  }

  const registered = liked + alreadyLiked;
  if (registered < MIN_LIKES) {
    throw new StepError(
      'interactions',
      `only ${registered} of ${plan.likes.length} planned like(s) registered ` +
        `(${plan.style} profile); the behavioural layer needs at least ${MIN_LIKES}`
    );
  }

  /*
    The feed has to have something in it now.

    Every like re-ranks the recommendation matrix in the background — the app
    subscribes to the like store rather than waiting for a refresh — so by the
    time this navigates over, the engine has already been asked to rebuild this
    user's feed against a history of three or four routes. An empty state here
    means the request failed or returned nothing, and neither is acceptable for
    an account that has just told the engine exactly what it likes.
  */
  await tabBar.goToForYou();
  await forYouPage.waitUntilLoaded();
  if (!(await forYouPage.hasRecommendations())) {
    throw new StepError(
      'foryou',
      `the For You feed is empty after ${registered} like(s) — the engine returned no routes`
    );
  }

  return {
    style: plan.style,
    liked,
    alreadyLiked,
    planned: plan.likes.length,
    summary: plan.summary,
  };
}

/** Answer the onboarding form and save it. Shared by both paths. */
async function completeOnboardingForm(user: TestUser): Promise<void> {
  await onboardingPage.answerAll(user);
  if ((await onboardingPage.saveAndContinue()) === 'error') {
    const message = await onboardingPage.readError();
    throw new StepError('onboarding-save', `onboarding save failed: ${message}`, message);
  }
}

/**
 * Sign up, complete onboarding, set a profile picture, fill in the profile, and
 * confirm the preferences the account ended up with.
 *
 * Returns rather than throws for the outcomes that are not failures — an email
 * that is already registered is a normal state of the world on a re-run, not a
 * defect.
 */
export async function onboardUser(user: TestUser): Promise<FlowResult> {
  // ─── 1. Landing ───────────────────────────────────────────────────────────
  await landingPage.waitUntilLoaded();
  await landingPage.goToSignUp();

  // ─── 2. Sign-up form ──────────────────────────────────────────────────────
  await signUpPage.waitUntilLoaded();
  await signUpPage.fillForm(user);

  const submitted = await signUpPage.submitAndSettle();

  if (submitted === 'error') {
    const message = await signUpPage.readError();

    // Already registered — sign in as them instead and pick up the journey from
    // wherever their account already is.
    if (message && /already registered/i.test(message)) {
      return existingUserFlow(user, message);
    }

    throw new StepError('signup', `signup rejected: ${message ?? 'unknown reason'}`, message);
  }

  // ─── 3. Onboarding form ───────────────────────────────────────────────────
  await onboardingPage.waitUntilLoaded();

  /*
    No bracket assertion here any more.

    This used to check that the onboarding form showed the cohort the user's
    date of birth implies, which proved the DOB had reached the backend. The
    age UI has since been removed entirely — no cohort name, range, picker or
    lock badge is rendered anywhere — so there is nothing on screen left to
    read, and that is the intended state rather than a gap in the screen.

    The DOB → bracket mapping is still covered, just at the layer that now owns
    it: `recommendations.service.spec.ts` asserts every boundary age maps to the
    right bracket, and the feed's own `ageBracket` field is checked there too.
    Re-deriving it through the UI would mean re-exposing exactly what this
    change set out to hide.
  */
  await completeOnboardingForm(user);

  // ─── 4/5. Profile picture, details, and preferences ───────────────────────
  await completeProfileAndPreferences(user);

  // ─── 6. Real usage: like three or four routes, then read the feed ─────────
  const interactions = await likeTreks(user);

  return { outcome: 'onboarded', step: 'complete', interactions };
}

/**
 * The path for a user who already exists.
 *
 * Rather than skipping them, sign in and drive the same profile and preference
 * screens — so a second run over the dataset still exercises the whole UI and
 * still reports per-user, instead of quietly doing nothing.
 */
async function existingUserFlow(user: TestUser, signupMessage: string): Promise<FlowResult> {
  await signUpPage.goToLogIn();
  await logInPage.waitUntilLoaded();

  if ((await logInPage.signIn(user.email, user.password)) === 'error') {
    const message = await logInPage.readError();
    throw new StepError(
      'login',
      `account exists but sign-in failed: ${message ?? 'unknown reason'}`,
      message
    );
  }

  // A returning account may land on either the feed or onboarding, depending on
  // whether it ever finished the form. Handle whichever appears.
  const landedOn = await waitForFirst(
    [T.onboarding.screen, T.forYou.screen, T.tabs.profile],
    NETWORK_TIMEOUT
  );

  if (landedOn === T.onboarding.screen) {
    await onboardingPage.waitUntilLoaded();
    await completeOnboardingForm(user);
  }

  await completeProfileAndPreferences(user);

  const interactions = await likeTreks(user);

  return { outcome: 'existing', step: 'complete', uiMessage: signupMessage, interactions };
}
