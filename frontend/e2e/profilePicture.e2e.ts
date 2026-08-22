/**
 * The profile-picture flow, on its own.
 *
 * This runs first (`00`-style ordering is not available, so the filename is
 * alphabetically ahead of `onboardUsers` — Detox runs specs in file order) and it
 * exists to answer one question before the long sweep starts: does selecting a
 * profile picture work end to end, or does it hang?
 *
 * It is worth isolating because the failure mode it guards against is not an
 * assertion error, it is a *hang*. Tapping "Choose from library" used to hand off
 * to the operating system's photo picker, which draws in a different process that
 * Detox cannot see, tap or dismiss — the run would sit there until the test timed
 * out with no useful message. Two changes make it testable, and both are checked
 * here:
 *
 *   · Under `EXPO_PUBLIC_E2E=1` the app resolves a bundled image instead of
 *     opening the system picker, so control returns to our own view hierarchy.
 *     Everything downstream stays real — multipart upload, the 5MB ceiling, the
 *     server's magic-byte check, the write to the user document.
 *   · The sheet is now fully dismissed before the picker runs, which is what fixes
 *     the iOS case where UIKit dropped the presentation request and the button
 *     looked dead.
 *
 * If this spec fails, the sweep that follows would fail for every single user, so
 * failing here first is the cheaper signal.
 */

import { T } from '@/constants/testIDs';

import { landingPage } from './pages/LandingPage';
import { onboardingPage } from './pages/OnboardingPage';
import { profilePage } from './pages/ProfilePage';
import { signUpPage } from './pages/SignUpPage';
import { tabBar } from './pages/TabBar';
import { isVisible, waitVisible } from './support/actions';
import { screenshot } from './support/reporter';
import { toTestUser } from './support/users';

/**
 * A throwaway account, so this spec does not depend on — or consume — a row from
 * the real dataset. The email is unique per run because a fresh registration is
 * what puts us on a profile with no picture yet.
 */
function scratchUser() {
  const stamp = Date.now().toString(36);
  return toTestUser({
    username: 'dptester',
    email: `dp.tester.${stamp}@example.com`,
    password: 'DpTester123',
    dob: '14-03-1995',
    age: 31,
    cohort: 'Active Adventurers',
  });
}

describe('Profile picture — selection and upload must not hang', () => {
  const user = scratchUser();

  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      permissions: { photos: 'YES', camera: 'NO', medialibrary: 'YES' },
    });

    // Get to a signed-in profile the ordinary way: sign up, answer onboarding.
    await landingPage.waitUntilLoaded();
    await landingPage.goToSignUp();
    await signUpPage.waitUntilLoaded();
    await signUpPage.fillForm(user);

    if ((await signUpPage.submitAndSettle()) === 'error') {
      const message = await signUpPage.readError();
      await screenshot('dp-setup-signup-failed');
      throw new Error(`Could not create the scratch account: ${message}`);
    }

    await onboardingPage.waitUntilLoaded();
    await onboardingPage.answerAll(user);
    if ((await onboardingPage.saveAndContinue()) === 'error') {
      await screenshot('dp-setup-onboarding-failed');
      throw new Error(`Onboarding failed: ${await onboardingPage.readError()}`);
    }

    await tabBar.waitUntilVisible();
    await tabBar.goToProfile();
    await profilePage.waitUntilLoaded();
  });

  it('opens the picture action sheet from the avatar', async () => {
    await profilePage.openPictureSheet();
    await waitVisible(T.profile.dpChooseFromLibrary);
    await profilePage.closePictureSheet();
  });

  it('offers no Remove row before a picture has been set', async () => {
    await profilePage.openPictureSheet();
    expect(await profilePage.hasPicture()).toBe(false);
    await profilePage.closePictureSheet();
  });

  it('selects an image and uploads it without hanging', async () => {
    const result = await profilePage.uploadPicture();
    if (!result.ok) await screenshot('dp-upload-failed');

    // Asserted on the app's own words. A hang would never reach here — the wait
    // inside `uploadPicture` fails first, with a screenshot of a stuck screen.
    expect(result.message).toBe('Profile picture updated');
    await profilePage.dismissToast();
  });

  it('offers the Remove row once a picture exists', async () => {
    await profilePage.openPictureSheet();
    expect(await profilePage.hasPicture()).toBe(true);
    await profilePage.closePictureSheet();
  });

  it('removes the picture again', async () => {
    const result = await profilePage.removePicture();
    if (!result.ok) await screenshot('dp-remove-failed');
    expect(result.message).toBe('Profile picture removed');
    await profilePage.dismissToast();
  });

  it('is still interactive afterwards — the sheet did not leave the UI wedged', async () => {
    // The specific regression: after the action sheet closed, the screen could be
    // left with an invisible modal still capturing touches. Tapping something
    // ordinary proves the hierarchy is live.
    await profilePage.openPictureSheet();
    await profilePage.closePictureSheet();
    expect(await isVisible(T.profile.dpSheet)).toBe(false);
    await profilePage.enterBio('Still tappable after the picture flow.');
    const saved = await profilePage.saveDetails();
    expect(saved.message).toBe('Profile saved successfully');
  });
});
