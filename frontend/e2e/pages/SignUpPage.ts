import { T } from '@/constants/testIDs';

import {
  NETWORK_TIMEOUT,
  fill,
  hideKeyboard,
  isVisible,
  readText,
  tap,
  typeSlowly,
  waitForFirst,
  waitVisible,
} from '../support/actions';
import type { TestUser } from '../support/users';

/**
 * The "Create your account" form.
 *
 * Filled field by field in the order a person reads them, with the date of birth
 * entered as three separate numeric inputs because that is what the screen
 * renders — there is no date picker to shortcut.
 */
export class SignUpPage {
  async waitUntilLoaded(): Promise<void> {
    await waitVisible(T.signup.screen);
    await waitVisible(T.signup.username);
  }

  async enterUsername(name: string): Promise<void> {
    await fill(T.signup.username, name);
  }

  async enterEmail(email: string): Promise<void> {
    await fill(T.signup.email, email);
  }

  /**
   * The three date fields, keyed in one at a time.
   *
   * Typed key by key rather than pasted: each field strips non-digits and caps
   * its own length on every keystroke (`numericField` in `app/signup.tsx`), and
   * driving it a character at a time is what actually exercises that filter.
   */
  async enterDateOfBirth(dob: { day: string; month: string; year: string }): Promise<void> {
    await typeSlowly(T.signup.dobDay, dob.day);
    await typeSlowly(T.signup.dobMonth, dob.month);
    await typeSlowly(T.signup.dobYear, dob.year);
  }

  /**
   * The hint under the date fields, which resolves the peer bracket live. Read
   * back to confirm the form agreed with the bracket the suite expected before
   * anything is submitted.
   */
  async readBracketHint(): Promise<string | null> {
    return readText(T.signup.dobHint);
  }

  async enterPassword(password: string): Promise<void> {
    await fill(T.signup.password, password);
  }

  async enterConfirmPassword(password: string): Promise<void> {
    await fill(T.signup.confirmPassword, password);
  }

  /** Fill in every field, exactly as a person would, top to bottom. */
  async fillForm(user: TestUser): Promise<void> {
    await this.enterUsername(user.name);
    await this.enterEmail(user.email);
    await this.enterDateOfBirth(user.dob);
    await this.enterPassword(user.password);
    await this.enterConfirmPassword(user.password);
    // The submit button sits below the confirm field; drop the keyboard so it is
    // not covering it when we go to tap.
    await hideKeyboard();
  }

  async submit(): Promise<void> {
    await tap(T.signup.submit);
  }

  /** The validation / server message shown under the heading, if any. */
  async readError(): Promise<string | null> {
    return (await isVisible(T.signup.error)) ? readText(T.signup.error) : null;
  }

  /**
   * Submit and wait to see which way the form went.
   *
   * Success routes to onboarding. Failure keeps us here with a message in the
   * error box — an email that is already registered being the common one, which
   * is how the suite discovers an existing user without asking the backend.
   */
  async submitAndSettle(): Promise<'onboarding' | 'error'> {
    await this.submit();
    const seen = await waitForFirst(
      [T.onboarding.screen, T.signup.error],
      NETWORK_TIMEOUT
    );
    return seen === T.onboarding.screen ? 'onboarding' : 'error';
  }

  async goToLogIn(): Promise<void> {
    await tap(T.signup.gotoLogin);
  }
}

export const signUpPage = new SignUpPage();
