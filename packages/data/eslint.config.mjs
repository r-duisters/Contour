// Re-exported rather than shared by reference: ESLint resolves a flat config's
// ignore patterns against the config file's own directory, so each workspace
// needs its own entry point for `.next/**`-style ignores to mean anything.
export { default } from "../../eslint.config.mjs";
