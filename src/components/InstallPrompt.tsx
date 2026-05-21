"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "android" | "ios" | "desktop" | null;

function detectPlatform(): Platform {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (isIos) return "ios";
  const isAndroid = /android/.test(ua);
  if (isAndroid) return "android";
  return "desktop";
}

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<Platform>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Don't show if already installed or previously dismissed
    if (isInStandaloneMode()) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    const detected = detectPlatform();
    setPlatform(detected);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS never fires beforeinstallprompt — show the manual-install hint instead
    if (detected === "ios") {
      const timer = setTimeout(() => setVisible(true), 3000);
      return () => {
        window.removeEventListener("beforeinstallprompt", onPrompt);
        clearTimeout(timer);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setInstalling(false);
    setDeferredPrompt(null);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install app"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
      style={{ filter: "drop-shadow(0 8px 32px rgba(0,0,0,0.6))" }}
    >
      <div
        className="flex items-center gap-3 rounded-2xl border border-border/60 px-4 py-3"
        style={{ background: "hsl(222 44% 9%)" }}
      >
        <Image
          src="/icon.png"
          alt="Ariete"
          width={40}
          height={40}
          className="rounded-xl shrink-0"
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">Install Ariete Portal</p>
          {platform === "ios" ? (
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              Tap <Share className="inline w-3 h-3 mb-0.5" /> then{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">
              Access your portfolio offline, anytime
            </p>
          )}
        </div>

        {platform !== "ios" && (
          <button
            onClick={install}
            disabled={installing}
            className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ background: "#f97316" }}
          >
            <Download className="w-3 h-3" />
            {installing ? "Installing…" : "Install"}
          </button>
        )}

        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
