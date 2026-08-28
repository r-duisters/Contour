/**
 * Without this file `@import "tailwindcss"` in globals.css is left as an inert
 * CSS import: the build succeeds, every test passes, and the app ships with a
 * 4 KB stylesheet containing no utilities at all — which on a phone looks like
 * blue underlined links on a white page.
 *
 * apps/web has always had one. This workspace was created without it, and
 * nothing in the toolchain treats a missing PostCSS config as an error.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
