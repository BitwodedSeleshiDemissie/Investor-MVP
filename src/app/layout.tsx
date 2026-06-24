import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallPrompt } from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: "Ariete Investor Portal",
  description: "Private portfolio reporting for Ariete Capital clients",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ariete",
  },
  icons: {
    icon: [
      { url: "/icon.png?v=agent-portal", sizes: "604x604", type: "image/png" },
      { url: "/favicon.ico?v=agent-portal", sizes: "any" },
    ],
    shortcut: "/icon.png?v=agent-portal",
    apple: [{ url: "/apple-icon.png?v=agent-portal", sizes: "604x604", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="dark">
      <body suppressHydrationWarning>
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
