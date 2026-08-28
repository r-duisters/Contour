"use client";

import { useRouter } from "next/navigation";
import SetupScreen from "@/components/screens/SetupScreen";

/**
 * The same flow, reached deliberately from More rather than on first launch.
 *
 * It is the route that makes "Skip" safe: skipping is only reasonable if the
 * flow can be found again, and a person who skipped it is never asked twice.
 */
export default function Page() {
  const router = useRouter();
  return <SetupScreen onDone={() => router.push("/portfolio")} />;
}
