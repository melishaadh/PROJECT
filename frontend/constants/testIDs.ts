/**
 * Every testID the app exposes to Detox, in one place.
 *
 * The end-to-end suite imports this module rather than repeating string
 * literals, so a renamed element breaks the build instead of silently failing a
 * matcher at 2am. It is plain data with no React Native imports, which is what
 * lets the Detox runner (a bare Node process) import it as-is.
 *
 * Naming: `<screen>-<element>`, with parameterised ids built by the helpers at
 * the bottom. Ids are stable API for the tests — rename one only alongside its
 * usages here.
 */

export const T = {
  landing: {
    screen: 'landing-screen',
    getStarted: 'landing-get-started',
    logIn: 'landing-log-in',
    browseGuest: 'landing-browse-guest',
  },

  login: {
    screen: 'login-screen',
    back: 'login-back',
    email: 'login-email',
    password: 'login-password',
    togglePassword: 'login-toggle-password',
    submit: 'login-submit',
    error: 'login-error',
    gotoSignup: 'login-goto-signup',
  },

  signup: {
    screen: 'signup-screen',
    back: 'signup-back',
    username: 'signup-username',
    email: 'signup-email',
    dobDay: 'signup-dob-day',
    dobMonth: 'signup-dob-month',
    dobYear: 'signup-dob-year',
    dobHint: 'signup-dob-hint',
    password: 'signup-password',
    confirmPassword: 'signup-confirm-password',
    togglePassword: 'signup-toggle-password',
    submit: 'signup-submit',
    error: 'signup-error',
    gotoLogin: 'signup-goto-login',
  },

  onboarding: {
    screen: 'onboarding-screen',
    scroll: 'onboarding-scroll',
    save: 'onboarding-save',
    error: 'onboarding-error',
    /** Prefixes handed to `OptionGroup` — see `optionID`. */
    experience: 'onboarding-experience',
    cardio: 'onboarding-cardio',
    joint: 'onboarding-joint',
    altitude: 'onboarding-altitude',
  },

  profile: {
    screen: 'profile-screen',
    scroll: 'profile-scroll',
    signedOutSignIn: 'profile-signed-out-sign-in',
    signedOutSignUp: 'profile-signed-out-sign-up',

    avatarButton: 'profile-avatar-button',

    dpSheet: 'profile-dp-sheet',
    dpChooseFromLibrary: 'profile-dp-choose-library',
    dpRemove: 'profile-dp-remove',
    dpClose: 'profile-dp-close',

    toast: 'profile-toast',
    toastDismiss: 'profile-toast-dismiss',

    usernameInput: 'profile-username-input',
    usernameClear: 'profile-username-clear',
    bioInput: 'profile-bio-input',
    socialInput: 'profile-social-input',
    socialClear: 'profile-social-clear',
    save: 'profile-save',
    saveMessage: 'profile-save-message',

    userSearch: 'profile-user-search',
    addTrek: 'profile-add-trek',
    trekPicker: 'profile-trek-picker',
    trekPickerSearch: 'profile-trek-picker-search',
    trekPickerClose: 'profile-trek-picker-close',

    deleteAccountBtn: 'profile-delete-account-button',
    deleteAccountSheet: 'profile-delete-account-sheet',
    deleteAccountPassword: 'profile-delete-account-password',
    deleteAccountConfirm: 'profile-delete-account-confirm',
    deleteAccountCancel: 'profile-delete-account-cancel',
    deleteAccountError: 'profile-delete-account-error',
  },

  preferences: {
    sheet: 'preferences-sheet',
    close: 'preferences-close',
    save: 'preferences-save',
    error: 'preferences-error',
    scroll: 'preferences-scroll',
    experience: 'preferences-experience',
    cardio: 'preferences-cardio',
    joint: 'preferences-joint',
    altitude: 'preferences-altitude',
  },

  explore: {
    screen: 'explore-screen',
    search: 'explore-search',
    list: 'explore-list',
  },

  forYou: {
    screen: 'foryou-screen',
    openPreferences: 'foryou-open-preferences',
    list: 'foryou-list',
    /** Rendered only when the engine returned nothing to show. */
    empty: 'foryou-empty',
  },

  tabs: {
    explore: 'tab-explore',
    forYou: 'tab-foryou',
    chatroom: 'tab-chatroom',
    profile: 'tab-profile',
  },
} as const;

/**
 * One chip inside an `OptionGroup`, e.g. `optionID('onboarding-experience', 2)`
 * → `onboarding-experience-option-2`. Keyed by the numeric value the chip sets
 * rather than by its label, because the value is what the profile vector stores
 * and the label is free to change.
 */
export const optionID = (groupPrefix: string, value: number): string =>
  `${groupPrefix}-option-${value}`;

/**
 * One row of the age-bracket picker, keyed by the bracket's stable machine key
 * (`gen-z-explorers`, …) — see `lib/ageGroups.ts`.
 */

/**
 * Where a `TrekCard` is being rendered.
 *
 * The tab navigator keeps every visited screen mounted, so Explore's list and
 * the For You feed can both hold a card for trek `1` at the same time. Detox
 * matches across the whole hierarchy rather than the visible screen, so an id
 * built from the trek alone would match two views and fail the action. The
 * surface namespaces them.
 */
export const TREK_SURFACE = {
  explore: 'explore',
  trending: 'trending',
  forYou: 'foryou',
} as const;

export type TrekSurface = (typeof TREK_SURFACE)[keyof typeof TREK_SURFACE];

/** One trek card on a given surface, e.g. `explore-trek-1`. */
export const trekCardID = (surface: TrekSurface, trekId: string): string =>
  `${surface}-trek-${trekId}`;

/**
 * The heart on a trek card — **named after the action it offers**, not after the
 * element, so the id changes with the state: `explore-trek-1-like` while the
 * route is unliked, `explore-trek-1-unlike` once it is.
 *
 * That is deliberate, and it is what lets a UI test confirm a like actually
 * registered without reading pixels or reaching into app state. Tapping
 * `…-like` and then waiting for `…-unlike` to appear asserts the round trip end
 * to end: the optimistic update, the backend write, and the confirmed state
 * coming back. It also makes the interaction idempotent — a route that is
 * already liked has no `…-like` element to tap, so a re-run cannot silently
 * toggle a like back off.
 */
export const trekLikeID = (surface: TrekSurface, trekId: string, liked: boolean): string =>
  `${trekCardID(surface, trekId)}-${liked ? 'unlike' : 'like'}`;

/** A row in the completed-trek picker. */
export const trekPickerItemID = (trekId: string): string => `profile-trek-picker-item-${trekId}`;

/** A result row in the trekker search. */
export const userSearchResultID = (userId: string): string => `profile-user-result-${userId}`;
