import { T, optionID } from '@/constants/testIDs';

import {
  NETWORK_TIMEOUT,
  isVisible,
  readText,
  scrollToAndTap,
  waitForFirst,
  waitVisible,
} from '../support/actions';
import type { TestUser } from '../support/users';

/**
 * "Complete your trek profile" — the first-run form.
 *
 * Every answer is a chip tapped on screen. The age bracket is the exception: it
 * arrives locked, because signup captured a date of birth and the backend derives
 * the bracket from it, so the suite *verifies* the selection rather than making
 * one. Tapping a locked row is a no-op in the component, and a test that tapped
 * it anyway would be asserting nothing.
 */
export class OnboardingPage {
  async waitUntilLoaded(): Promise<void> {
    await waitVisible(T.onboarding.screen);
  }



  async chooseExperience(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.onboarding.experience, value), T.onboarding.scroll);
  }

  async chooseCardio(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.onboarding.cardio, value), T.onboarding.scroll);
  }

  async chooseJointStability(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.onboarding.joint, value), T.onboarding.scroll);
  }

  async chooseAltitudeHistory(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.onboarding.altitude, value), T.onboarding.scroll);
  }

  /** Answer the whole form, scrolling down through it as a person would. */
  async answerAll(user: TestUser): Promise<void> {
    await this.chooseExperience(user.answers.experienceLevel);
    await this.chooseCardio(user.answers.cardioFlag);
    await this.chooseJointStability(user.answers.jointFlag);
    await this.chooseAltitudeHistory(user.answers.altitudeHistory);
  }

  async readError(): Promise<string | null> {
    return (await isVisible(T.onboarding.error)) ? readText(T.onboarding.error) : null;
  }

  /**
   * Tap "Save & Continue" and wait for the app to move on.
   *
   * Success replaces the route with the tab stack, so the tab bar appearing is
   * the signal. Failure keeps the form up with a message under the last question.
   */
  async saveAndContinue(): Promise<'app' | 'error'> {
    await scrollToAndTap(T.onboarding.save, T.onboarding.scroll);
    const seen = await waitForFirst(
      [T.tabs.profile, T.forYou.screen, T.onboarding.error],
      NETWORK_TIMEOUT
    );
    return seen === T.onboarding.error ? 'error' : 'app';
  }
}

export const onboardingPage = new OnboardingPage();
