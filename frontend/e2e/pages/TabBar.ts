import { T } from '@/constants/testIDs';

import { tap, waitVisible } from '../support/actions';

/**
 * The floating bottom tab bar.
 *
 * Navigation happens by tapping it, never by pushing a route programmatically —
 * a test that jumps straight to `/profile` proves nothing about whether a user
 * could have got there.
 */
export class TabBar {
  async waitUntilVisible(): Promise<void> {
    await waitVisible(T.tabs.profile);
  }

  async goToForYou(): Promise<void> {
    await tap(T.tabs.forYou);
    await waitVisible(T.forYou.screen);
  }

  async goToExplore(): Promise<void> {
    await tap(T.tabs.explore);
    await waitVisible(T.explore.screen);
  }

  async goToProfile(): Promise<void> {
    await tap(T.tabs.profile);
  }
}

export const tabBar = new TabBar();
