"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteManualValuesForDate } from "@/server/actions/admin";

interface Props {
  asOfDate: string;
  itemKeys: string[];
}

export function DeleteEntryButton({ asOfDate, itemKeys }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "deleting">("idle");

  useEffect(() => {
    if (state !== "confirm") return;
    const t = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(t);
  }, [state]);

  async function handleClick() {
    if (state === "idle") {
      setState("confirm");
      return;
    }
    if (state === "confirm") {
      setState("deleting");
      await deleteManualValuesForDate({ asOfDate, itemKeys });
      router.refresh();
    }
  }

  if (state === "confirm") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="text-[11px] font-semibold text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded border border-red-500/30 hover:border-red-400/50 whitespace-nowrap"
      >
        Confirm?
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "deleting"}
      aria-label="Delete entry"
      className="text-muted-foreground/40 hover:text-red-400 transition-colors p-1 rounded disabled:opacity-30"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}
