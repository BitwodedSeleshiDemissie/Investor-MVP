"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { saveControl } from "@/server/actions/admin";
import type { ControlRow } from "@/types/portfolio";
import { formatEur, formatDate } from "@/lib/utils";

const schema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capitalCommitted: z.coerce.number().nonnegative(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  controls: ControlRow[];
  onSaved?: () => void;
}

export function PortfolioInputsForm({ controls, onSaved }: Props) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    const result = await saveControl(values);
    if (result?.data?.success) {
      setStatus("saved");
      reset();
      onSaved?.();
      setTimeout(() => setStatus("idle"), 3000);
    } else {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Capital Committed (€)</label>
            <input
              {...register("capitalCommitted")}
              type="number"
              step="0.01"
              placeholder="0.00"
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {errors.capitalCommitted && <p className="text-destructive text-xs mt-0.5">Invalid value</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Reference Date</label>
            <input
              {...register("asOfDate")}
              type="date"
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {errors.asOfDate && <p className="text-destructive text-xs mt-0.5">Invalid date</p>}
          </div>
        </div>
        <button
          type="submit"
          disabled={status === "saving"}
          className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save Parameters"}
        </button>
      </form>

      {controls.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Capital Committed</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Entered on</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {controls.slice(0, 10).map((c) => (
                <tr key={c.id} className="hover:bg-secondary/20">
                  <td className="px-4 py-2.5 text-foreground">{formatDate(c.asOfDate)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-foreground">{formatEur(c.capitalCommitted)}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                    {c.createdAt ? formatDate(c.createdAt.split("T")[0]) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
