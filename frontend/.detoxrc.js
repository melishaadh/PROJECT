/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      // Generous, because one spec drives every user in the dataset end to end
      // through real network calls. Detox's own synchronisation decides how long
      // any individual step waits; this only caps the whole file.
      setupTimeout: 300_000,
      teardownTimeout: 120_000,
    },
  },

  // Screenshots and a device log for every test, kept whether it passed or
  // failed, plus the view hierarchy when a matcher cannot find an element.
  artifacts: {
    rootDir: 'artifacts',
    plugins: {
      log: { enabled: true },
      screenshot: {
        shouldTakeAutomaticSnapshots: true,
        keepOnlyFailedTestsArtifacts: false,
        takeWhen: { testStart: false, testDone: true, testFailure: true },
      },
      uiHierarchy: 'failing',
    },
  },

  apps: {
    /*
      Both Android configurations point at a *release* binary built with
      `EXPO_PUBLIC_E2E=1`.

      Release rather than debug because a debug build loads its bundle from the
      Metro dev server, which adds a moving part (and a websocket Detox has to
      wait on) to every launch. A release build embeds the bundle, so the app
      under test is self-contained and launches deterministically.

      `EXPO_PUBLIC_E2E=1` is what activates the image-picker bypass — see
      `lib/e2e.ts`. It has to be set at *build* time, because Metro inlines
      `EXPO_PUBLIC_*` into the bundle; setting it at test time does nothing.
    */
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk',
      build:
        'cd android && EXPO_PUBLIC_E2E=1 ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release && cd ..',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/TREKEASY.app',
      build:
        'EXPO_PUBLIC_E2E=1 xcodebuild -workspace ios/TREKEASY.xcworkspace -scheme TREKEASY -configuration Release -sdk iphonesimulator -derivedDataPath ios/build -quiet',
    },
  },

  devices: {
    emulator: {
      type: 'android.emulator',
      device: {
        // Override with `DETOX_AVD=<name>`; `emulator -list-avds` shows what you
        // have. Failing to match a real AVD is the most common first-run error.
        avdName: process.env.DETOX_AVD || 'Pixel_7_API_34',
      },
    },
    simulator: {
      type: 'ios.simulator',
      device: { type: process.env.DETOX_SIM || 'iPhone 15' },
    },
  },

  configurations: {
    'android.emu.release': { device: 'emulator', app: 'android.release' },
    'ios.sim.release': { device: 'simulator', app: 'ios.release' },
  },
};
