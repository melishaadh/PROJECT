# End-to-end suite (Detox)

Drives the TrekEasy app the way a person does — launching the binary, tapping
native views, typing into real inputs, scrolling, and reading what the app puts on
screen. Nothing in here calls the API directly or touches MongoDB. Every account
it creates is created by filling in the signup form.

## What it runs

| Spec | What it covers |
| --- | --- |
| `profilePicture.e2e.ts` | The profile-picture flow in isolation — open the sheet, select an image, upload, remove, and confirm the screen is still interactive afterwards. Runs **first**, because if picture selection hangs, every user in the sweep would hang the same way. |
| `onboardUsers.e2e.ts` | One `it()` per row of `scripts/data/trekeasy-users.json` (500 users): landing → signup → onboarding → profile picture → profile details → preferences → **like 3–4 treks** → read the For You feed. |

## The interaction phase

Signing an account up is only half of what the sweep is for. An account with no
likes tells the recommendation engine nothing, so every user that gets through
onboarding then goes to Explore and likes **three or four distinct routes**
through the UI — searching for each one, scrolling to its card, and tapping the
heart. That is comfortably past the engine's 2-like behavioural trigger, so every
account in the corpus ends the run out of cold start and under behavioural
control.

Which routes get liked is not random. `support/likePlan.ts` splits the population
into two behavioural segments, each aimed at a different layer of the engine:

| Segment | ~share | Shape | What it exercises |
| --- | --- | --- | --- |
| `diverse` | 44% | Likes spread across regions, price tiers, difficulty tiers and durations (3.2 regions per plan on average) | The collaborative layer — creates overlap between otherwise unrelated clusters, and the multi-region affinity case |
| `niche` | 56% | Likes held inside one region and, where possible, one parent trek family and its sibling child routes (1.25 regions per plan; 75% strictly single-region) | The content-based layer — makes "liking a child route surfaces its siblings and the rest of the region" falsifiable |

Plans are constrained to routes that are *physically plausible for the answers
that user just gave*: a person who declared a poor cardio profile does not like
four 5,500m expeditions, because the engine would hard-block every one of them
and their whole like history would be evidence about routes they can never be
shown. Plans are deterministic in the email, so a re-run produces the same
corpus, and across the 500 users all 30 routes receive likes — with a natural
spread rather than a flat one, so the trending leaderboard has something real to
rank.

Likes are registered from **Explore, not For You**. The For You feed is a curated
window of 6–14 routes the engine chose; waiting for a planned route to appear
there would mean the test's own expectations were steering which routes got
liked. Explore renders the whole catalogue, so the corpus is the one the plan
specified.

Confirmation is structural rather than visual: the heart's testID is named after
the action it offers (`explore-trek-7-like` → `explore-trek-7-unlike`), so waiting
for the id to flip asserts the tap, the backend write and the confirmed state
coming back — and an already-liked route on a re-run has no `like` element to tap,
so the sweep can never toggle an interaction back off.

## First-time setup

Detox needs a real native binary, and this is a managed Expo project, so the
native projects are generated rather than committed:

```bash
npm run e2e:prebuild        # expo prebuild --clean → creates android/ and ios/
npm run e2e:build:android   # release APK + androidTest APK, built with EXPO_PUBLIC_E2E=1
```

`@config-plugins/detox` (wired into `app.json`) is what adds Detox's Android
instrumentation during prebuild. It declares a peer range of `expo@^53` while this
project is on 54, so it was installed with `--legacy-peer-deps`; the plugin only
patches the generated Gradle project and works as-is. Re-run `e2e:prebuild` after
changing `app.json` or adding a native module.

Point the runner at an emulator you actually have:

```bash
emulator -list-avds
DETOX_AVD=Pixel_7_API_34 npm run e2e:test     # or set DETOX_AVD in your shell
```

The backend must be reachable from the device. On an emulator, `localhost` is the
emulator itself, so build with the host's LAN address:

```bash
EXPO_PUBLIC_API_URL=http://192.168.18.139:3001/api npm run e2e:build:android
```

## Running

```bash
npm run e2e:picture                        # just the profile-picture spec
npm run e2e:smoke                          # first 3 users
npm run e2e:test                           # everyone
E2E_USER_LIMIT=10 npm run e2e:test         # first 10
E2E_USER_START=40 E2E_USER_LIMIT=20 npm run e2e:test
E2E_USER_COHORT="Gen-Z" npm run e2e:test   # one bracket
```

**The suite writes no run report.** Per-user status — outcome, behavioural
segment, likes registered, the step it reached and the message the app displayed —
is streamed to the console as the run goes, with a summary at the end. It is
deliberately not persisted: an earlier JSON run log put every email the run
touched into a file that outlived the run and that nothing was responsible for
clearing up. No credential is printed or written anywhere; `support/reporter.ts`
has no password field to print.

Detox's own artifacts still land in `artifacts/` (gitignored): a device log and
screenshot per test, and the view hierarchy for anything that failed to match.

## How the profile-picture problem was solved

Selecting a profile picture could not be automated at all, and the failure looked
like an app hang rather than a test error. Two separate causes:

1. **The system picker is out of process.** `expo-image-picker` opens the Android
   photo picker / iOS `PHPicker`, which are separate apps drawing over ours. Detox
   automates *this* app's view hierarchy, so it can tap "Choose from library" and
   then see nothing at all — no element to tap, nothing to dismiss, and the run
   sits there until it times out.

   Fixed by a build-time bypass: in a binary built with `EXPO_PUBLIC_E2E=1`,
   `pickProfilePicture()` resolves a bundled 256×256 PNG (`assets/e2e/avatar.png`)
   to a real on-device `file://` URI instead of opening the picker. Everything
   downstream stays real — the multipart upload, the 5MB ceiling, the server's
   magic-byte sniffing, the write to the user document. The only step skipped is
   the one owned by the operating system. See `lib/e2e.ts` and
   `lib/profilePicture.ts`.

   `EXPO_PUBLIC_*` is inlined by Metro at bundle time, so this is a compile-time
   constant — a production bundle has `false` there and the branch is dead code.
   It cannot be flipped at runtime.

2. **A genuine iOS bug, not a test artefact.** Both sheet actions called
   `setShowDpSheet(false)` and immediately continued, which asks UIKit to present
   the photo picker while our own modal is mid-dismiss. UIKit refuses to present
   onto a controller that is being dismissed — it logs and drops the request — so
   the sheet slid away and nothing happened, indistinguishable from a dead button.
   The action is now parked and fired from the modal's `onDismiss` (Android runs it
   immediately, since its picker is a separate activity and `Modal` has no
   `onDismiss` there). See `runDpAction` in `screens/ProfileScreen.tsx`.

`beforeAll` also pre-answers the photo/media permission dialogs via `launchApp`.
That is belt-and-braces — the app no longer requests media-library permission and
the picker is never opened under E2E — but an unexpected OS dialog is the other
thing that stalls a run while looking like an app hang, so it is settled once up
front.

## Structure

```
e2e/
  onboardUsers.e2e.ts     the sweep — one it() per user
  profilePicture.e2e.ts   the picture flow, isolated
  flows/
    onboardUser.ts        the journey: what order the screens come in
  pages/                  Page Object Model — one class per screen
    LandingPage.ts  SignUpPage.ts  LogInPage.ts
    OnboardingPage.ts  ProfilePage.ts  PreferencesPage.ts
    ExplorePage.ts  ForYouPage.ts  TabBar.ts
  support/
    actions.ts            tap / fill / scroll / wait helpers
    users.ts              loads and shapes the dataset
    likePlan.ts           behavioural segmentation — who likes what, and why
    random.ts             seeded PRNG; Math.random() is never used
    reporter.ts           per-user console log, screenshots, summary
```

The page objects know how to operate one screen and nothing about what comes next;
`flows/onboardUser.ts` is the only place that knows the order. testIDs come from
`constants/testIDs.ts` — the same module the components render from, so a renamed
id is a compile error here rather than a matcher that silently never matches.

## Conventions

**No arbitrary waits.** There is no `sleep` anywhere in this suite. Detox already
holds every action until the app is idle — it tracks the JS event loop, the native
run loop, in-flight network requests and RN's animation and layout queues. A
`sleep(2000)` on top of that is either redundant or masking a race that will come
back on slower hardware. Genuine waits are `waitFor(...).toBeVisible()`, which
resolves the instant the condition holds; the `withTimeout` on those is a failure
deadline, not a delay.

**Branches are decided by reading the screen.** After tapping "Create Account" the
suite waits for *either* the onboarding screen or the error box and acts on
whichever appears — the same decision a person makes by looking. That is how an
already-registered email is discovered (`waitForFirst` in `support/actions.ts`),
rather than by asking the backend up front.

**A failing user doesn't stop the run.** Each per-user `it()` catches its own
failure, records the step, the app's own message and a screenshot, and returns —
the next user gets a clean app launch. A final `it()` then fails the suite if
anything failed, so the run still reports red overall.

**Fresh state per user.** `device.launchApp({ newInstance: true, delete: true })`
between users, because a session persists in AsyncStorage and user 2 would
otherwise start signed in as user 1.

**Which elements get a testID.** Two rules, and nothing else:

1. every interactive control in these flows — buttons, inputs, chips, tabs — so
   any of them *can* be driven, whether or not this suite drives it yet;
2. anything the suite reads rather than taps (`profile-toast`,
   `profile-save-message`, `signup-dob-hint`, `signup-error`).

A testID on a non-interactive element that nothing reads is noise, and gets
removed. 20 of the 81 static ids are currently rendered but not yet touched by a
spec — all of them controls, kept under rule 1: the trekker search, the
completed-trek picker, the password reveal toggles, the back buttons, the guest
landing paths and Chatroom. That list is the honest inventory of the untested
surfaces.

Trek cards are the one parameterised case worth calling out. Their ids carry the
**surface** as well as the trek — `explore-trek-7`, `foryou-trek-7` — because the
tab navigator keeps visited screens mounted, so Explore and For You can both hold
a card for the same route at once and Detox matches across the whole hierarchy
rather than the visible screen. The surfaces the suite does not drive (completed
treks on a profile, and in the trekker modal) pass no surface at all and render no
testIDs, rather than colliding with the feed ids for the same route.

## Notes on the dataset

`support/users.ts` shapes each of the 500 rows into what the *form* will accept,
and nothing more:

- usernames with digits (`rohankc0`) lose the digit — the name field is letters
  only, and names are not unique in the schema, so the collision is harmless
- passwords under 8 characters are padded (`NituKC` → `NituKC123`)
- rows whose DOB puts them under 18 *today* are recorded as `skipped` rather than
  driven into an error, because the signup screen refusing them is correct
  behaviour
- onboarding answers are not in the source document, so they are derived
  deterministically from the email — a re-run taps exactly the same chips, and
  builds the same like plan

There is no API-level equivalent of this sweep any more. A `scripts/simulate-
signups.mjs` used to create the same accounts over HTTP; it has been removed,
along with the `signup-report.json` it wrote, because it recorded all 500
credentials to disk in plain text and creating accounts anywhere other than
through the form is exactly what this suite exists to avoid.

## Known limits

- Not yet executed against a device in this environment: there is no Android SDK
  or emulator here, so `e2e:prebuild` / `e2e:build:android` / `e2e:test` have not
  been run. What *is* verified without a device: the app and the suite typecheck
  and lint clean, and the two data layers were run against the real 500-row
  dataset — `support/users.ts` for the form shaping, and `support/likePlan.ts`
  for the segmentation (500/500 plans built, 3–4 distinct routes each, no
  duplicates, deterministic across repeat runs, all 30 catalogue routes covered).
  Everything that needs a device — the taps themselves — has not run.
- `binaryPath` for iOS assumes the scheme is `TREKEASY` (from `app.json` → `name`).
  If prebuild produces a different scheme name, update `.detoxrc.js`.
- Registration is rate limited to 5/minute per IP on the backend, so a full sweep
  of 500 users spends most of its wall-clock waiting on the limiter. Raise the
  limit on `POST /auth/register` while running a full sweep, or run in chunks with
  `E2E_USER_START`/`E2E_USER_LIMIT`.
