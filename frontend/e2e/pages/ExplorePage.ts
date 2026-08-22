import { T, TREK_SURFACE, trekCardID, trekLikeID } from '@/constants/testIDs';

import {
  NETWORK_TIMEOUT,
  UI_TIMEOUT,
  fill,
  isVisible,
  waitVisible,
} from '../support/actions';
import type { PlannedLike } from '../support/likePlan';

/**
 * The Explore tab — the catalogue, the search field and the Trending Now board.
 *
 * This is where the suite registers likes, rather than the For You feed, and the
 * distinction matters. The For You feed is a *curated* window of six to fourteen
 * routes chosen by the engine, so a plan that calls for a specific route has no
 * guarantee it is on screen — and worse, waiting for one to appear would mean
 * the test's own expectations were quietly steering which routes got liked.
 * Explore renders the whole catalogue, so every route in a plan is reachable and
 * the corpus the engine learns from is the one the plan actually specified.
 */
export class ExplorePage {
  async goTo(): Promise<void> {
    await waitVisible(T.tabs.explore);
    await element(by.id(T.tabs.explore)).tap();
    await waitVisible(T.explore.screen);
  }

  /**
   * Type into the search field, narrowing the list, and drop the keyboard.
   *
   * The keyboard matters here in a way it does not on the forms: the next thing
   * this page does is scroll a list looking for a card, and a keyboard covering
   * the bottom of the screen makes cards that are technically rendered fail a
   * visibility check. Tapping the return key is the safe way to dismiss it —
   * the field is a single-line input with `returnKeyType="search"`, so it blurs
   * on submit. `device.pressBack()` (what `hideKeyboard` uses on Android) would
   * also work when the keyboard is up, and navigate away from Explore when it is
   * not.
   */
  async search(query: string): Promise<void> {
    await fill(T.explore.search, query);
    await element(by.id(T.explore.search)).tapReturnKey();
  }

  /** Empty the search field, restoring the full catalogue. */
  async clearSearch(): Promise<void> {
    await fill(T.explore.search, '');
    await element(by.id(T.explore.search)).tapReturnKey();
  }

  /**
   * Scroll the catalogue until a route's card is on screen.
   *
   * Returns false rather than throwing: the caller uses it to decide whether the
   * search narrowed things down usefully, and "not in this filtered list" is an
   * expected answer, not a failure.
   */
  private async revealCard(trekId: string): Promise<boolean> {
    const cardId = trekCardID(TREK_SURFACE.explore, trekId);
    try {
      await waitFor(element(by.id(cardId)))
        .toBeVisible()
        .whileElement(by.id(T.explore.list))
        .scroll(320, 'down');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Like one route, the way a person would: search for it, scroll to its card,
   * tap the heart, and wait for the card to come back showing it as liked.
   *
   * **The wait is the assertion.** The heart's testID is named after the action
   * it currently offers — `explore-trek-7-like` while unliked,
   * `explore-trek-7-unlike` once liked — so waiting for the `unlike` id to
   * appear confirms the whole round trip: the tap landed, the write reached the
   * backend, and the confirmed state came back into the view. Detox's own
   * synchronisation holds the wait until the app is idle, so there is no sleep
   * and no polling interval to tune.
   *
   * Already-liked routes are handled rather than double-tapped. On a re-run over
   * the same dataset the account already exists and its likes are already
   * recorded; the `like` id is simply absent, and tapping the `unlike` heart
   * would silently *remove* the interaction this run is supposed to be building.
   *
   * @returns what happened, so the flow can report a partial plan honestly.
   */
  async like(target: PlannedLike): Promise<'liked' | 'already-liked' | 'not-found'> {
    const likeId = trekLikeID(TREK_SURFACE.explore, target.trekId, false);
    const likedId = trekLikeID(TREK_SURFACE.explore, target.trekId, true);

    // Fast path: narrow the catalogue to a handful of cards so the scroll is
    // short. Fall back to browsing the unfiltered list if the query does not
    // surface it — a person who cannot find something by search scrolls for it.
    await this.search(target.query);
    let found = await this.revealCard(target.trekId);
    if (!found) {
      await this.clearSearch();
      found = await this.revealCard(target.trekId);
    }
    if (!found) return 'not-found';

    if (await isVisible(likedId)) return 'already-liked';

    await waitVisible(likeId, UI_TIMEOUT);
    await element(by.id(likeId)).tap();

    // The optimistic update paints immediately; this waits for the state that
    // survives the server's confirmation, so a rejected write fails here.
    await waitFor(element(by.id(likedId))).toBeVisible().withTimeout(NETWORK_TIMEOUT);
    return 'liked';
  }
}

export const explorePage = new ExplorePage();
