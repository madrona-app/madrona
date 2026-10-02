/**
 * lint-staged config.
 *
 * Lives at the git root so staged-file globs match paths relative to the
 * repo root. Invoked by `frontend/.husky/pre-commit`, which cds here first.
 *
 * Commands return literal strings (no file args appended) because the
 * nav-catalog drift check doesn't take per-file input — it verifies the
 * whole snapshot against the committed JSON.
 */
export default {
  // Any touch to the TS nav config or the committed JSON must re-verify the
  // drift snapshot. Catches hand-edited JSON and forgotten regenerations.
  '{frontend/src/lib/navigationConfig.ts,frontend/src/lib/navigationCatalog.ts,shared/nav_catalog.json}':
    () => 'pnpm --dir frontend run check:nav-catalog',
};
