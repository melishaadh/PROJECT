/**
 * End-to-end test mode.
 *
 * True only in a binary built with `EXPO_PUBLIC_E2E=1`, which is how the Detox
 * build is produced (see `package.json` → `e2e:build:*`). `EXPO_PUBLIC_*`
 * variables are inlined by Metro at bundle time, so this is a compile-time
 * constant: a production bundle has `false` here and the branches it guards are
 * dead code the minifier drops. Nothing about this can be flipped at runtime,
 * which is the point — a test affordance that ships as a live switch is a
 * liability.
 *
 * It exists because two things in this app cannot be driven by a UI test:
 *
 *   · The system photo picker. `expo-image-picker` opens the Android photo
 *     picker / iOS `PHPicker`, which run in a *different process*. Detox drives
 *     the app's own view hierarchy, so it can see the "Choose from library"
 *     button but not a single pixel of what that button opens — a test that taps
 *     it waits forever on a screen it cannot reach. See `lib/profilePicture.ts`.
 *
 * Keep this list short. Every entry is a place where the tested app diverges
 * from the shipped one, which is exactly the sort of gap that lets a real bug
 * pass a green suite.
 */
export const IS_E2E = process.env.EXPO_PUBLIC_E2E === '1';
