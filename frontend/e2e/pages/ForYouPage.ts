import { T, TREK_SURFACE, trekCardID } from '@/constants/testIDs';

import { NETWORK_TIMEOUT, isVisible, waitVisible } from '../support/actions';

/**
 * The personalised feed.
 *
 * The suite reads this screen rather than driving it. Its job here is to confirm
 * that the engine actually produced a feed for the account once the account had
 * a history — a screen that renders its empty state after a user has liked three
 * routes means the recommendation request failed, returned nothing, or was never
 * re-issued, and any of the three is a defect worth failing a run over.
 */
export class ForYouPage {
  async waitUntilLoaded(): Promise<void> {
    await waitVisible(T.forYou.screen, NETWORK_TIMEOUT);
  }

  /**
   * True when the engine returned at least one route.
   *
   * Asserted through the *absence* of the empty state rather than by hunting for
   * a specific card: which routes the feed contains is the engine's decision, and
   * a test that named them would be asserting its own ranking rather than the
   * engine's.
   *
   * The feed re-ranks in the background on every confirmed like, so this may be
   * read while a re-rank is in flight. `waitVisible` on the screen has already
   * let Detox settle the app, and the list is replaced in place rather than
   * blanked, so there is no window in which a populated feed reads as empty.
   */
  async hasRecommendations(): Promise<boolean> {
    return !(await isVisible(T.forYou.empty));
  }

  /** Whether a specific route is currently on screen, without scrolling. */
  async showsTrek(trekId: string): Promise<boolean> {
    return isVisible(trekCardID(TREK_SURFACE.forYou, trekId));
  }
}

export const forYouPage = new ForYouPage();
