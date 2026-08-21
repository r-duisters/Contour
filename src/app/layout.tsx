import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BiometricLock from "@/components/BiometricLock";
import PwaSetup from "@/components/PwaSetup";
import TabBar from "@/components/TabBar";
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
  title: "Nabla",
  description: "Portfolio tracking, risk-metric charting, and alerts.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Nabla" },
  icons: { apple: "/icons/apple-touch-icon.png" },
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
        <BiometricLock>
          <div className="pb-20 md:pb-0">{children}</div>
          <TabBar />
        </BiometricLock>
      </body>
    </html>
  );
}
