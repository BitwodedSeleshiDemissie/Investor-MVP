"use client";

import { useState } from "react";
import { Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export function SeedBaselineButton() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSeed() {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/admin/seed-baseline", { method: "POST" });
      const data = await res.json() as { error?: string; snapshotId?: number; investorCount?: number; portfolioValue?: number; cutoffDate?: string };
      if (!res.ok) {
        setMessage(data.error ?? "Seed failed");
        setState("error");
        return;
      }
      setMessage(
        `Snapshot #${data.snapshotId} created · ${data.investorCount} investors · cutoff ${data.cutoffDate}`
      );
      setState("done");
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setMessage("Network error — check the console");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="flex items-center gap-2 text-sm text-success">
        <CheckCircle2 className="w-4 h-4" />
        <span>{message} — reloading…</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleSeed}
        disabled={state === "loading"}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {state === "loading" ? "Seeding…" : "Import CEO Tracker Baseline"}
      </button>
      {state === "error" && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
