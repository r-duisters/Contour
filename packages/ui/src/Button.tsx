"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * The primary action. `BRAND.md` gives it `bg-blue-600`, sentence case, and
 * `size={14}` for any icon inside it.
 *
 * It was written out thirteen times in six spellings before this existed, and
 * the drift was not only cosmetic: six carried `disabled:opacity-50` and seven
 * did not, so whether a button looked disabled while it was disabled came down
 * to which line it was copied from. That belongs to the component, not to the
 * caller.
 *
 * `secondary` is the quieter neutral fill beside it — "Send test", "Log out",
 * "Evaluate now" — which had drifted the same way, minus the disabled state
 * entirely.
 *
 * No hover state, deliberately — the guide does not give either one, and
 * inventing it here would spread a decision nobody made.
 */
export default function Button({
  block = false, variant = "primary", className = "", type = "button", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type={type}
      {...rest}
      className={
        (variant === "primary" ? "bg-blue-600 " : "bg-neutral-700 ") +
        "disabled:opacity-50 text-white rounded text-sm " +
        "inline-flex items-center gap-1 " +
        (block ? "w-full justify-center px-3 py-2 " : "px-3 py-1 ") +
        className
      }
    />
  );
}
