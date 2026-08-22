/*
 * ESLint 9 does find the root config by searching ancestors, but it resolves that
 * config's ignore patterns against the directory the config file lives in. Run from
 * here, `.next/**` would mean the repository root's build output, not this app's, and
 * the linter walks every generated chunk. Re-exporting from a config file inside the
 * app moves the base path here, where the patterns were always meant to apply.
 */
export { default } from "../../eslint.config.mjs";
