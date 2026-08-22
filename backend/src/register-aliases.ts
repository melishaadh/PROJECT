/**
 * Runtime resolution for the `@/*` and `@db/*` TypeScript path aliases.
 *
 * `tsc` rewrites nothing: an `import '@db/schemas/user.schema'` is emitted as a
 * literal `require("@db/schemas/user.schema")`, which Node cannot resolve on its
 * own. Without this the compiled server throws MODULE_NOT_FOUND on the very
 * first schema import — the build succeeds and boot dies.
 *
 * Importing this for its side effect, as the *first* import of `main.ts`, is
 * what makes it launcher-agnostic. `module: commonjs` emits `require` calls in
 * source order, so these aliases are registered before any aliased module is
 * pulled in — under `nest start`, `nest start --watch` and a bare
 * `node dist/backend/src/main` alike, none of which pass `-r`.
 *
 * The two paths are `__dirname`-relative rather than cwd-relative because
 * `dist/` mirrors the repo layout (`dist/backend/src` + `dist/backend-database`
 * against `backend/src` + `backend-database`). The same expression therefore
 * resolves correctly whether this file is running as compiled JS or straight
 * from source under ts-node.
 */

import { addAliases } from 'module-alias';
import { join } from 'path';

addAliases({
  '@': __dirname,
  '@db': join(__dirname, '..', '..', 'backend-database'),
});
