import { T } from '@/constants/testIDs';

import {
  NETWORK_TIMEOUT,
  UI_TIMEOUT,
  fill,
  hideKeyboard,
  isVisible,
  readText,
  scrollToAndTap,
  tap,
  waitGone,
  waitVisible,
} from '../support/actions';

/**
 * The Profile tab: the profile picture, and the bio and social-link fields.
 *
 * The picture is the interesting one. Tapping the avatar opens an in-app action
 * sheet, and "Choose from library" would normally hand off to the operating
 * system's photo picker — a different process that Detox cannot see into. Under
 * `EXPO_PUBLIC_E2E=1` the app resolves a bundled image instead (see
 * `lib/profilePicture.ts`), so the tap returns to *our* hierarchy and everything
 * after the picker — the multipart upload, the size and magic-byte checks, the
 * write to the user document — runs for real and is what these methods assert on.
 */
export class ProfilePage {
  async waitUntilLoaded(): Promise<void> {
    // The screen renders a spinner until the profile arrives; wait for the real
    // thing rather than for either.
    await waitVisible(T.profile.screen, NETWORK_TIMEOUT);
    await waitVisible(T.profile.avatarButton);
  }

  // ─── Profile picture ───────────────────────────────────────────────────────

  /** Tap the avatar to open the picture action sheet. */
  async openPictureSheet(): Promise<void> {
    await tap(T.profile.avatarButton);
    await waitVisible(T.profile.dpSheet);
  }

  async closePictureSheet(): Promise<void> {
    await tap(T.profile.dpClose);
    await waitGone(T.profile.dpSheet);
  }

  /** True when the account already has a picture — the Remove row only renders then. */
  async hasPicture(): Promise<boolean> {
    return isVisible(T.profile.dpRemove);
  }

  /**
   * Select a picture and wait for the upload to finish.
   *
   * Returns the toast the app showed, which is the user-visible verdict:
   * "Profile picture updated" on success, or whatever went wrong. The sheet is
   * expected to close first — that dismissal is what releases the picker on iOS,
   * so waiting on it is also a regression check for the bug where the sheet slid
   * away and nothing further happened.
   */
  async uploadPicture(): Promise<{ ok: boolean; message: string | null }> {
    await this.openPictureSheet();
    await tap(T.profile.dpChooseFromLibrary);
    await waitGone(T.profile.dpSheet, UI_TIMEOUT);

    // The avatar shows a spinner for the duration of the upload; the toast is
    // what replaces it. Waiting on the toast rather than the spinner's absence
    // means a silent no-op fails here instead of passing.
    await waitVisible(T.profile.toast, NETWORK_TIMEOUT);
    const message = await readText(T.profile.toast);
    return { ok: message === 'Profile picture updated', message };
  }

  async removePicture(): Promise<{ ok: boolean; message: string | null }> {
    await this.openPictureSheet();
    await tap(T.profile.dpRemove);
    await waitGone(T.profile.dpSheet, UI_TIMEOUT);
    await waitVisible(T.profile.toast, NETWORK_TIMEOUT);
    const message = await readText(T.profile.toast);
    return { ok: message === 'Profile picture removed', message };
  }

  async dismissToast(): Promise<void> {
    if (await isVisible(T.profile.toastDismiss)) {
      await tap(T.profile.toastDismiss);
      await waitGone(T.profile.toast);
    }
  }

  // ─── Profile details ───────────────────────────────────────────────────────

  async enterBio(bio: string): Promise<void> {
    await scrollToAndTap(T.profile.bioInput, T.profile.scroll);
    await fill(T.profile.bioInput, bio);
  }

  async enterSocialLink(link: string): Promise<void> {
    await scrollToAndTap(T.profile.socialInput, T.profile.scroll);
    await fill(T.profile.socialInput, link);
  }

  /**
   * Save the details card and return the message printed under the button.
   *
   * The app writes "Profile saved successfully" there on success and the server's
   * complaint on failure, so this reads back the app's own words rather than
   * inferring an outcome.
   */
  async saveDetails(): Promise<{ ok: boolean; message: string | null }> {
    await hideKeyboard();
    await scrollToAndTap(T.profile.save, T.profile.scroll);
    await waitVisible(T.profile.saveMessage, NETWORK_TIMEOUT);
    const message = await readText(T.profile.saveMessage);
    return { ok: message === 'Profile saved successfully', message };
  }

  /** Fill in bio and social link, then save. */
  async updateDetails(details: { bio: string; socialMediaLink: string }): Promise<{
    ok: boolean;
    message: string | null;
  }> {
    await this.enterBio(details.bio);
    await this.enterSocialLink(details.socialMediaLink);
    return this.saveDetails();
  }
}

export const profilePage = new ProfilePage();
