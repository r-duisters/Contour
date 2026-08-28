import PortfolioScreen from "@/components/screens/PortfolioScreen";

/**
 * The app's home, which is the portfolio.
 *
 * The web app redirects `/` to `/portfolio`. This renders the screen instead:
 * a static export has no server to redirect at, so the alternative is a
 * client-side `router.replace` — a blank frame and a history entry on every
 * cold start, to arrive at the page this one already is.
 *
 * (It rendered a "screens arrive with Task 5" placeholder until now. Task 5
 * moved every screen into `packages/ui` and wired the four routes it names,
 * and nothing pointed back at this one to say it was still the stub.)
 */
export default function Home() {
  return <PortfolioScreen />;
}
