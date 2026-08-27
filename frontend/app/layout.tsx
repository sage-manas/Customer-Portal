import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "@/packages/ui/globals.css";

import { ToastProvider } from "@/components/Toast";

/**
 * Root layout, migrated from client/apps/web/app/layout.tsx.
 *
 * Two changes, both mechanical: the stylesheet is imported by path rather
 * than through the `@cc/ui/globals.css` package export (there is no
 * workspace package here), and the toast provider is mounted — demo-mode
 * feedback needs somewhere to render, and /client had no toast system
 * because its writes really did reach a backend.
 */

const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "CustomerConnect Portal",
  description: "B2B customer self-service portal for the SAP order-to-cash cycle.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
