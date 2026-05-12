import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ariete Investor Portal",
  description: "Private portfolio reporting for Ariete Capital clients",
  icons: {
    icon: [
      { url: "/icon.png?v=agent-portal", sizes: "604x604", type: "image/png" },
      { url: "/favicon.ico?v=agent-portal", sizes: "any" },
    ],
    shortcut: "/icon.png?v=agent-portal",
    apple: [{ url: "/apple-icon.png?v=agent-portal", sizes: "604x604", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
