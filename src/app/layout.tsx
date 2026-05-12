import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ariete Investor Portal",
  description: "Private portfolio reporting for Ariete Capital clients",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
