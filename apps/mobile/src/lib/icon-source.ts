import { bundledIconSource, type IconSource } from "@/components/icon-source";
import BUNDLED from "../../public/icons/index.json";

/**
 * Logos that shipped with the app.
 *
 * Imported rather than fetched: the list is known at build time, and a request
 * per unknown ticker would be a round trip to the app's own bundle to learn
 * that something is not in it.
 *
 * Anything absent gets coloured initials. That covers the coins the upstream
 * icon set never had — it predates most of 2024's listings — and it is the
 * honest answer rather than a broken image. Run `scripts/bundle-icons.mjs`
 * after editing `scripts/icon-tickers.json`.
 */
export const DEVICE_ICON_SOURCE: IconSource = bundledIconSource(new Set(BUNDLED));
