import { redirect } from "next/navigation";

/**
 * The app is a portfolio tracker; its home is the portfolio. This used to be a
 * third list of the same destinations the tab bar and More page already carry.
 */
export default function Home() {
  redirect("/portfolio");
}
