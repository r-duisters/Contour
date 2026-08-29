import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BiometricLock from "@/components/BiometricLock";
import DeviceAlerts from "./device-alerts";
import FirstRun from "./first-run";
import Nav from "./nav";
import Providers from "./providers";
import "./globals.css";

/**
 * The device build's root layout.
 *
 * Deliberately thinner than `apps/web`'s. `PwaSetup` installs a service worker
 * for a browser that is already an installed app here; `BackgroundAlerts`
 * polls a server-only route; and `Providers` mounts `HttpClient`, which is the
 * one thing this build must not use. Each returns in a later task with a
 * device-shaped counterpart or not at all.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Contour",
  description: "Portfolio tracking, on the device.",
  icons: { icon: "/icons/favicon-64.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {/*
            The only lock this build has. There is no password, no passkey, no
            SESSION_SECRET, no /login and no /setup — the server did that, and
            there is no server. Falling back to the device PIN is the plugin's
            own behaviour and is the right one: a lock this app cannot itself
            reset is the point.

            No TopNav either: it is `hidden md:block`, and there is no desktop
            here. The tab bar carries its own list, because half of what the
            web app puts behind More is server-only.
          */}
          <BiometricLock>
            {/* An empty device gets the setup flow instead of an empty
                portfolio — and instead of the tab bar, so the wizard has the
                screen to itself. */}
            {/* Checks the rules on every foreground and posts them itself. */}
            <DeviceAlerts />
            <FirstRun>
              <div className="pb-20">{children}</div>
              <Nav />
            </FirstRun>
          </BiometricLock>
        </Providers>
      </body>
    </html>
  );
}
