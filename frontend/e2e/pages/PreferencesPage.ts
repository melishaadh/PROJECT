import { T, optionID } from '@/constants/testIDs';

import {
  NETWORK_TIMEOUT,
  isVisible,
  readText,
  scrollToAndTap,
  tap,
  waitForFirst,
  waitGone,
  waitVisible,
} from '../support/actions';
import type { TestUser } from '../support/users';

/**
 * The trek-preferences sheet, opened from the For You feed.
 *
 * This is the returning-user path to the same five answers the onboarding form
 * asks for. It matters to the suite for two reasons: it is how an *existing*
 * account gets its preferences set (having already been past onboarding, that
 * screen is not shown again), and it is where the age bracket appears with its
 * lock badge for a DOB-derived account.
 */
export class PreferencesPage {
  /** Open the sheet from the For You tab. */
  async open(): Promise<void> {
    await tap(T.forYou.openPreferences);
    await waitVisible(T.preferences.sheet);
  }

  async chooseExperience(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.preferences.experience, value), T.preferences.scroll);
  }

  async chooseCardio(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.preferences.cardio, value), T.preferences.scroll);
  }

  async chooseJointStability(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.preferences.joint, value), T.preferences.scroll);
  }

  async chooseAltitudeHistory(value: number): Promise<void> {
    await scrollToAndTap(optionID(T.preferences.altitude, value), T.preferences.scroll);
  }

  async answerAll(user: TestUser): Promise<void> {
    await this.chooseExperience(user.answers.experienceLevel);
    await this.chooseCardio(user.answers.cardioFlag);
    await this.chooseJointStability(user.answers.jointFlag);
    await this.chooseAltitudeHistory(user.answers.altitudeHistory);
  }

  async readError(): Promise<string | null> {
    return (await isVisible(T.preferences.error)) ? readText(T.preferences.error) : null;
  }

  /**
   * Save and wait for the sheet to go.
   *
   * The component keeps itself open on failure so the edits are not lost, so the
   * sheet disappearing *is* the success signal — no separate assertion needed.
   */
  async save(): Promise<'saved' | 'error'> {
    await scrollToAndTap(T.preferences.save, T.preferences.scroll);
    const seen = await waitForFirst([T.forYou.screen, T.preferences.error], NETWORK_TIMEOUT);
    if (seen === T.preferences.error) return 'error';
    await waitGone(T.preferences.sheet, NETWORK_TIMEOUT);
    return 'saved';
  }
}

export const preferencesPage = new PreferencesPage();
