import { T } from '@/constants/testIDs';

import {
  NETWORK_TIMEOUT,
  fill,
  hideKeyboard,
  isVisible,
  readText,
  tap,
  waitForFirst,
  waitVisible,
} from '../support/actions';

/**
 * The sign-in form.
 *
 * Reached when signup reports the email is already registered — the suite then
 * signs in as that person rather than skipping them, so their onboarding still
 * gets driven through the UI on a re-run.
 */
export class LogInPage {
  async waitUntilLoaded(): Promise<void> {
    await waitVisible(T.login.screen);
    await waitVisible(T.login.email);
  }

  async enterEmail(email: string): Promise<void> {
    await fill(T.login.email, email);
  }

  async enterPassword(password: string): Promise<void> {
    await fill(T.login.password, password);
  }

  async submit(): Promise<void> {
    await tap(T.login.submit);
  }

  async readError(): Promise<string | null> {
    return (await isVisible(T.login.error)) ? readText(T.login.error) : null;
  }

  /**
   * Sign in and wait for the outcome.
   *
   * A successful sign-in replaces the route with the For You tab. A user who has
   * never finished onboarding still lands there — the app does not force the form
   * a second time — so the caller reaches preferences through the UI instead.
   */
  async signIn(email: string, password: string): Promise<'signed-in' | 'error'> {
    await this.enterEmail(email);
    await this.enterPassword(password);
    await hideKeyboard();
    await this.submit();

    const seen = await waitForFirst(
      [T.forYou.screen, T.tabs.profile, T.login.error],
      NETWORK_TIMEOUT
    );
    return seen === T.login.error ? 'error' : 'signed-in';
  }

  async goToSignUp(): Promise<void> {
    await tap(T.login.gotoSignup);
  }
}

export const logInPage = new LogInPage();
