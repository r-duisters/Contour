/*
 * ESLint resolves a config's ignore patterns against the directory the config
 * file lives in, so each workspace needs its own entry point rather than
 * leaning on the root config's ancestor lookup. Re-exporting keeps one set of
 * rules while giving this package the right base path.
 */
export { default } from "../../eslint.config.mjs";
