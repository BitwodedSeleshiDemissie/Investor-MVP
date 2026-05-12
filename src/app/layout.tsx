import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ariete Investor Portal",
  description: "Private portfolio reporting for Ariete Capital clients",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/favicon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
