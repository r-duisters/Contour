"use client";

import TabBar from "@/components/TabBar";
import { DEVICE_MORE_GROUPS } from "@/components/more-menu";

/**
 * The tab bar with this app's own destinations.
 *
 * It exists as a file rather than as one line in `layout.tsx` because the
 * layout is a Server Component, and `DEVICE_MORE_GROUPS` carries lucide icons
 * — React components, which are functions, and functions cannot cross the
 * server/client boundary as props. The build says so plainly and only at
 * export time. Choosing the list on the client side of the line avoids it.
 *
 * `apps/web` renders `<TabBar />` bare and never hits this, because the
 * default list is read inside the client component rather than passed into it.
 */
export default function Nav() {
  return <TabBar moreGroups={DEVICE_MORE_GROUPS} />;
}
