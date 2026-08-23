import type { LucideIcon } from "lucide-react";

/**
 * The page's own name, in the app's one header idiom.
 *
 * It is deliberately small and grey. The portfolio screen established this:
 * the label is subordinate to the figure beneath it, because the figure is
 * what the reader came for. Ledger, insights and the chart each grew their
 * own header instead — a large title here, a subtitle there, an icon at two
 * sizes in two colours, and on the chart no page identity at all — so four
 * screens announced themselves four ways.
 *
 * The icon is passed in rather than derived from the route: the nav already
 * owns that mapping in `TabBar` and `TopNav`, and a second lookup here would
 * be a second list to keep in step.
 *
 * Only the label pair lives here. The row around it does not, because it
 * legitimately differs: the portfolio hangs a picker and an add button off
 * it, and the chart puts it inside a bordered bar that must not cost the
 * charts any height.
 */
export default function PageLabel({
  icon: Icon, children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon size={18} aria-hidden className="text-neutral-500" />
      <h1 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
        {children}
      </h1>
    </span>
  );
}
