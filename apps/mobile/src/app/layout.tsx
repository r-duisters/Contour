import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
