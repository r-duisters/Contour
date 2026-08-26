import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "../login/LoginForm";
import TradingBackdrop from "@/components/TradingBackdrop";
import ContourMark from "@/components/ContourMark";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (settings?.passwordHash) redirect("/login");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <TradingBackdrop />
      <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-xs">
        <div className="flex flex-col items-center gap-[18px]">
          <div
            className="w-[92px] h-[92px] rounded-[22%] bg-blue-600 flex items-center justify-center"
            style={{ boxShadow: "0 10px 40px rgba(37,99,235,0.35)" }}
          >
            <ContourMark size={92} breathing />
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-neutral-100">Welcome to Contour</h1>
        </div>
        <p className="text-sm text-neutral-500 text-center">First run — set the password that protects this app.</p>
        <Suspense><LoginForm mode="setup" /></Suspense>
      </div>
    </main>
  );
}
