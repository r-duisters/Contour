import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "../login/LoginForm";
import TradingBackdrop from "@/components/TradingBackdrop";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (settings?.passwordHash) redirect("/login");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <TradingBackdrop />
      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-sm bg-neutral-950/70 border border-neutral-800 rounded-xl p-8 backdrop-blur-sm">
        <h1 className="text-2xl font-semibold">Welcome to Trader</h1>
        <p className="text-sm text-neutral-500 text-center">First run — set the password that protects this app.</p>
        <Suspense><LoginForm mode="setup" /></Suspense>
      </div>
    </main>
  );
}
