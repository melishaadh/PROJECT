/**
 * Thin wrappers over Detox's matchers, expressed the way a person interacts with
 * a phone.
 *
 * Two rules hold everywhere in this suite:
 *
 * 1. **No sleeps.** There is not a single `setTimeout` in here. Detox already
 *    knows when the app is idle — it tracks the JS event loop, the native run
 *    loop, pending network requests and RN's own animation and layout queues,
 *    and holds every action until they are all quiet. A `sleep(2000)` on top of
 *    that is either redundant (Detox was already synchronised) or a bug in
 *    disguise (the wait is masking a race that will resurface on a slower
 *    machine). Where a wait is genuinely needed — an element that appears only
 *    after a round trip — it is expressed as `waitFor(...).toBeVisible()`, which
 *    resolves the moment the condition holds. The `withTimeout` on those is a
 *    *failure deadline*, not a delay.
 *
 * 2. **Interact through the view hierarchy only.** Everything here is a tap, a
 *    type, a scroll or an assertion against a real native view. Nothing reaches
 *    into application state, storage or the backend.
 */

/*
  Detox and Jest both publish a global `expect`, and in a Jest-run Detox suite
  Jest's wins — so `expect(element(...)).toBeVisible()` does not type-check and,
  worse, would not behave like a Detox assertion at runtime. Detox's is imported
  under its own name for element assertions; Jest's global stays available for
  ordinary value assertions in the specs.
*/
import { expect as expectElement } from 'detox';

/** How long a UI transition may take before we call it a failure. */
export const UI_TIMEOUT = 10_000;

/**
 * How long an action that waits on the network may take. Registration is the
 * slow one: the backend hashes the password with bcrypt at cost 12 before it
 * replies, and it is rate limited to 5 registrations a minute per IP, so a
 * request can sit waiting for the limiter to open.
 */
export const NETWORK_TIMEOUT = 90_000;

const byId = (id: string): Detox.NativeMatcher => by.id(id);

/** Wait until an element is on screen and hittable. */
export async function waitVisible(id: string, timeout = UI_TIMEOUT): Promise<void> {
  await waitFor(element(byId(id))).toBeVisible().withTimeout(timeout);
}

/** Wait until an element is gone — a dismissed sheet, a finished spinner. */
export async function waitGone(id: string, timeout = UI_TIMEOUT): Promise<void> {
  await waitFor(element(byId(id))).not.toBeVisible().withTimeout(timeout);
}

/** True if the element is currently on screen, without failing when it is not. */
export async function isVisible(id: string): Promise<boolean> {
  try {
    await expectElement(element(byId(id))).toBeVisible();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for whichever of several elements shows up first, and report which.
 *
 * This is how the suite handles branches a real user would simply *see* — after
 * tapping "Create Account" you land on onboarding, or you stay put with an
 * "Email already registered" message under the button. Polling both and acting
 * on the winner keeps that decision in the UI, rather than asking the backend
 * up front which one to expect.
 *
 * It polls with `isVisible` rather than racing `waitFor` promises, because a
 * rejected `waitFor` that nobody is awaiting surfaces as an unhandled rejection
 * and takes the whole run down with it.
 */
export async function waitForFirst(
  ids: readonly string[],
  timeout = UI_TIMEOUT
): Promise<string> {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const id of ids) {
      if (await isVisible(id)) return id;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `None of [${ids.join(', ')}] became visible within ${timeout}ms`
      );
    }
    // No sleep: each isVisible round trip is itself synchronised against the
    // app's idle state, so this loop advances only as fast as the app settles.
  }
}

/** Tap an element, waiting for it to be tappable first. */
export async function tap(id: string, timeout = UI_TIMEOUT): Promise<void> {
  await waitVisible(id, timeout);
  await element(byId(id)).tap();
}

/**
 * Type into a field the way a person does: focus it, clear whatever was there,
 * then enter the text and drop the keyboard.
 *
 * `replaceText` rather than `typeText` for the value itself — `typeText` goes
 * key by key through the soft keyboard, which is both slow across ~500 users and
 * flaky on emulators whose keyboard sometimes covers the next field. The
 * `onChangeText` handler still fires for the full value, so every filter and
 * validator in the component runs exactly as it would for a human typist.
 */
export async function fill(id: string, value: string): Promise<void> {
  await waitVisible(id);
  const field = element(byId(id));
  await field.tap();
  await field.replaceText(value);
}

/** Type key by key — for fields whose per-keystroke behaviour is under test. */
export async function typeSlowly(id: string, value: string): Promise<void> {
  await waitVisible(id);
  const field = element(byId(id));
  await field.tap();
  await field.clearText();
  await field.typeText(value);
}

/** Dismiss the soft keyboard so it stops covering the element we need next. */
export async function hideKeyboard(): Promise<void> {
  if (device.getPlatform() === 'android') {
    await device.pressBack();
    return;
  }
  // iOS has no back button; tapping the screen's own scroll view blurs the field.
  await element(by.type('RCTScrollView')).atIndex(0).tap({ x: 20, y: 20 });
}

/**
 * Scroll a container until the target is on screen, then tap it.
 *
 * Long forms put their submit button below the fold, and Detox will not tap
 * what it cannot see. `whileElement` scrolls only as far as it has to.
 */
export async function scrollToAndTap(
  targetId: string,
  scrollableId: string,
  direction: Detox.Direction = 'down'
): Promise<void> {
  await waitFor(element(byId(targetId)))
    .toBeVisible()
    .whileElement(byId(scrollableId))
    .scroll(220, direction);
  await element(byId(targetId)).tap();
}

/** Read the text out of an element, for logging what a user would have read. */
export async function readText(id: string): Promise<string | null> {
  try {
    const attrs = (await element(byId(id)).getAttributes()) as Detox.ElementAttributes;
    return attrs.text ?? attrs.label ?? null;
  } catch {
    return null;
  }
}
