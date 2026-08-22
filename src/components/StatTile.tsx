import { TrendingDown, TrendingUp } from "lucide-react";

/**
 * A labelled figure on a raised surface — the app's most repeated unit.
 *
 * It existed three times over with small differences: the portfolio tile
 * carried a trend arrow and an optional sub-line, the asset detail one did
 * not, and the insights one had neither and a different text size. This is
 * the union, with the differences as props.
 *
 * `signed` takes the number itself rather than a boolean so that zero reads
 * neutral instead of green — a portfolio that has made exactly nothing has
 * not made a gain.
 */
export default function StatTile({
  label, value, signed, big, sub,
}: {
  label: string;
  value: string;
  /** Colour and arrow by sign. Omit for figures that have no direction. */
  signed?: number;
  big?: boolean;
  sub?: React.ReactNode;
}) {
  const color =
    signed === undefined || signed === 0 ? "text-neutral-200"
    : signed > 0 ? "text-green-500"
    : "text-red-500";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className={`${big ? "text-xl" : "text-base"} font-medium ${color} flex items-center gap-1.5`}>
        {signed !== undefined && signed > 0 && <TrendingUp size={16} aria-hidden />}
        {signed !== undefined && signed < 0 && <TrendingDown size={16} aria-hidden />}
        {value}
      </div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}
