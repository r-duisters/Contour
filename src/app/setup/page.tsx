import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LoginForm from "../login/LoginForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (settings?.passwordHash) redirect("/login");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <h1 className="text-2xl font-semibold">Welcome to Trader</h1>
      <p className="text-sm text-neutral-500">First run — set the password that protects this app.</p>
      <Suspense><LoginForm mode="setup" /></Suspense>
    </main>
  );
}
