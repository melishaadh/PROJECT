const base = require('./app.base.json').expo;

module.exports = ({ config }) => ({
  ...config,
  ...base,
  plugins: [
    "expo-router",
    "expo-font",
    "expo-web-browser",
    ...(process.env.DETOX_BUILD === "1"
      ? ["@config-plugins/detox"]
      : []),
    [
      "expo-image-picker",
      {
        photosPermission:
          "TrekEasy uses your photo library so you can choose a profile picture.",
        cameraPermission: false,
        microphonePermission: false
      }
    ]
  ]
});
