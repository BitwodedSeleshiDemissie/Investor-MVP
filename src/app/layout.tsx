import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ariete Invest — Investor Portal",
  description: "Private portfolio reporting for Ariete Invest clients",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
