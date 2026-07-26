import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "@cc/ui/globals.css";

const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "CustomerConnect Portal",
  description: "B2B customer self-service portal for the SAP order-to-cash cycle.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
