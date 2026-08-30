import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";
import TradingBackdrop from "@/components/TradingBackdrop";
import MarkTile from "@/components/MarkTile";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.passwordHash) redirect("/setup");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <TradingBackdrop />
      <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-xs">
        <div className="flex flex-col items-center gap-[18px]">
          <MarkTile size={92} glow breathing />
          <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-neutral-100">Contour</h1>
        </div>
        <Suspense><LoginForm mode="login" /></Suspense>
      </div>
    </main>
  );
}
