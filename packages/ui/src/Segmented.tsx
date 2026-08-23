"use client";

/**
 * A pill switch between two or more mutually exclusive views.
 *
 * **Not `RangePicker`, and must not be merged with it.** That control hides
 * its less-used timeframes behind "More" on a phone, which is right for eight
 * periods and wrong here: a category switch offers the page's only other half,
 * and burying it behind a second tap would make Stocks feel like a setting
 * rather than a destination. The shared look is the pill row; the behaviour
 * that matters is the part that differs.
 */
export default function Segmented<T extends string>({
  value, options, onChange, className = "",
}: {
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 p-1 rounded-full
                  bg-neutral-900/50 border border-neutral-800/50 ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.key}
          role="tab"
          onClick={() => onChange(o.key)}
          aria-selected={value === o.key}
          className={`px-3 py-1 text-xs rounded ${
            value === o.key ? "bg-neutral-800 text-neutral-100" : "text-neutral-500"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
