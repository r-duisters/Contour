import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { prisma } from "@/lib/db";
import SetupWizard from "./SetupWizard";
import LoginForm from "../login/LoginForm";
import TradingBackdrop from "@/components/TradingBackdrop";
import MarkTile from "@/components/MarkTile";

export const dynamic = "force-dynamic";

/**
 * Two screens behind one path, because they are two halves of one idea.
 *
 * With no password set, this is the first run and the only question worth
 * asking is what protects the app. Once a password exists, `/setup` is the
 * flow itself — currency, a portfolio, your data, alerts — which is what the
 * More menu has always meant by "Set up again", and what the same path
 * already does on the phone.
 *
 * It did not do that here. `/setup` redirected to `/login` the moment a
 * password existed, so the menu entry led to a login screen for somebody
 * already logged in, and the web had no way to reach the flow at all.
 *
 * The route is public, so the session is checked here rather than by the
 * middleware: a first run has to reach the password form without one, and
 * running the flow again must not be a way around the lock.
 */
export default async function SetupPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  if (settings?.passwordHash) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const secret = process.env.SESSION_SECRET;
    const session = secret && token ? await verifySessionToken(token, secret) : null;
    if (!session) redirect(`/login?next=${encodeURIComponent("/setup")}`);
    return <SetupWizard />;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <TradingBackdrop />
      <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-xs">
        <div className="flex flex-col items-center gap-[18px]">
          <MarkTile size={92} glow breathing />
          <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-neutral-100">Welcome to Contour</h1>
        </div>
        <p className="text-sm text-neutral-500 text-center">First run — set the password that protects this app.</p>
        <Suspense><LoginForm mode="setup" /></Suspense>
      </div>
    </main>
  );
}
