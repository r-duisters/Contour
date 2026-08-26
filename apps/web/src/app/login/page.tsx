import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "./LoginForm";
import TradingBackdrop from "@/components/TradingBackdrop";
import ContourMark from "@/components/ContourMark";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.passwordHash) redirect("/setup");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <TradingBackdrop />
      <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-sm bg-neutral-950/70 border border-neutral-800 rounded-xl p-6 md:p-8 backdrop-blur-sm">
        <div
          className="w-[92px] h-[92px] rounded-[22%] bg-blue-600 flex items-center justify-center"
          style={{ boxShadow: "0 10px 40px rgba(37,99,235,0.35)" }}
        >
          <ContourMark size={92} />
        </div>
        <h1 className="text-2xl font-semibold">Contour</h1>
        <Suspense><LoginForm mode="login" /></Suspense>
      </div>
    </main>
  );
}
