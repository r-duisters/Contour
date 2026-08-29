/**
 * The version the app shows.
 *
 * A constant rather than an import of `package.json`: that file is not part of
 * any bundle, and reaching for it from shared code would pull a build artifact
 * into the browser. `version.test.ts` fails if this and the manifest disagree,
 * so the duplication cannot rot quietly — which is the only thing wrong with
 * duplicating a string.
 */
export const APP_VERSION = "0.1.0";
