// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    /*
      The backend is Node, not a React Native bundle.

      `expo lint` walks the whole project, so the NestJS service under
      `backend/` gets linted with the Expo ruleset too. One of its rules does not
      transfer: `expo/no-dynamic-env-var` forbids `process.env[name]` because
      Metro inlines env vars at bundle time and a dynamic key cannot be inlined.
      Nothing bundles the backend — it reads its configuration from the real
      environment at runtime, where a dynamic key is the normal way to write a
      typed config helper — so the rule was reporting an error against correct
      code, and `npm run lint` exited non-zero on every run as a result. A lint
      failure that nobody can act on is how a real one goes unnoticed.

      Scoped off here rather than ignoring the directory outright, so everything
      else in the ruleset still applies to the backend.
    */
    files: ["backend/**/*.ts"],
    rules: { "expo/no-dynamic-env-var": "off" },
  }
]);
