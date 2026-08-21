import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";
import TradingBackdrop from "@/components/TradingBackdrop";
import NablaMark from "@/components/NablaMark";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.passwordHash) redirect("/setup");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <TradingBackdrop />
      <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-sm bg-neutral-950/70 border border-neutral-800 rounded-xl p-6 md:p-8 backdrop-blur-sm">
        <NablaMark size={56} />
        <h1 className="text-2xl font-semibold">Nabla</h1>
        <Suspense><LoginForm mode="login" /></Suspense>
      </div>
    </main>
  );
}
