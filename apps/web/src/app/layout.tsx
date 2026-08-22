import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BackgroundAlerts from "@/components/BackgroundAlerts";
import BiometricLock from "@/components/BiometricLock";
import PwaSetup from "@/components/PwaSetup";
import TabBar from "@/components/TabBar";
import TopNav from "@/components/TopNav";
import "./globals.css";

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
  description: "Portfolio tracking, risk-metric charting, and alerts.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Contour" },
  // Both are named explicitly. Setting `icons` at all suppresses Next's
  // app/icon file convention, so a tab icon left to the convention silently
  // does not render.
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
        <PwaSetup />
        <BackgroundAlerts />
        <BiometricLock>
          <TopNav />
          <div className="pb-20 md:pb-0">{children}</div>
          <TabBar />
        </BiometricLock>
      </body>
    </html>
  );
}
