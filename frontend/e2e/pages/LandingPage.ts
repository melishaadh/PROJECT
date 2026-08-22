import { T } from '@/constants/testIDs';

import { tap, waitVisible } from '../support/actions';

/** The unauthenticated entry screen — where every run starts. */
export class LandingPage {
  async waitUntilLoaded(): Promise<void> {
    await waitVisible(T.landing.screen);
  }

  /** Tap "Get Started", which pushes the signup screen. */
  async goToSignUp(): Promise<void> {
    await tap(T.landing.getStarted);
  }

  /** Tap "Log In". */
  async goToLogIn(): Promise<void> {
    await tap(T.landing.logIn);
  }

}

export const landingPage = new LandingPage();
