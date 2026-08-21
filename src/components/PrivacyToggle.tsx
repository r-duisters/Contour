"use client";

import { Eye, EyeOff } from "lucide-react";
import { setAmountsHidden } from "@/lib/display";
import { usePrivacy } from "@/components/usePrivacy";

/** Hide every amount while leaving the percentages readable. */
export default function PrivacyToggle() {
  const hidden = usePrivacy();
  return (
    <button
      onClick={() => setAmountsHidden(!hidden)}
      className="w-full flex items-center gap-3 text-sm border border-neutral-800 rounded px-3 py-2"
    >
      {hidden ? <EyeOff size={16} aria-hidden className="text-neutral-400" />
              : <Eye size={16} aria-hidden className="text-neutral-400" />}
      <span className="text-left">
        <span className="block">{hidden ? "Amounts hidden" : "Hide amounts"}</span>
        <span className="block text-xs text-neutral-500">
          {hidden ? "Percentages still show" : "Show only percentages, not values"}
        </span>
      </span>
    </button>
  );
}
