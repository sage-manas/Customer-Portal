/**
 * `server-only` is a build-time guard: importing it from a client bundle is a
 * hard error, which is exactly what we want in the app and exactly what we do
 * not want in a test runner, where every module is loaded in the same process.
 *
 * Vitest resolves the package's *client* build (jsdom sets the browser
 * condition), so the real module throws on import. Aliasing it here to an
 * empty module lets a server module be unit-tested without weakening the
 * guarantee in the app — Next still resolves the real package at build time.
 */
export {};
