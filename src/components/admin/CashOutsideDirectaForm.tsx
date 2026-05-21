"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { saveCashOutsideDirecta } from "@/server/actions/admin";

const schema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cashOutsideDirecta: z.coerce.number().nonnegative(),
  mode: z.enum(["ADD_TO_BALANCE", "SET_BALANCE"]),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  currentCashOutside: number;
}

function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function CashOutsideDirectaForm({ currentCashOutside }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      asOfDate: today(),
      mode: "ADD_TO_BALANCE",
      cashOutsideDirecta: undefined,
    },
  });
  const mode = watch("mode");
  const amount = Number(watch("cashOutsideDirecta") ?? 0);
  const resultingBalance = mode === "ADD_TO_BALANCE"
    ? currentCashOutside + (Number.isFinite(amount) ? amount : 0)
    : (Number.isFinite(amount) ? amount : 0);

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    try {
      const result = await saveCashOutsideDirecta(values);
      if (result?.data?.success) {
        setStatus("saved");
        router.refresh();
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setErrorMsg(result?.serverError ?? result?.data?.error ?? "Error saving");
        setStatus("error");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error saving");
      setStatus("error");
    }
  }

  const inputCls = "w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-numeric";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">As of date</label>
        <input {...register("asOfDate")} type="date" className={inputCls} />
        {errors.asOfDate && <p className="text-destructive text-xs mt-1">Required</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
        <select {...register("mode")} className={inputCls}>
          <option value="ADD_TO_BALANCE">Add to external cash</option>
          <option value="SET_BALANCE">Set external cash total</option>
        </select>
        {errors.mode && <p className="text-destructive text-xs mt-1">Choose how to apply the value</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          {mode === "ADD_TO_BALANCE" ? "Amount to Add (€)" : "External Cash Total (€)"}
        </label>
        <input
          {...register("cashOutsideDirecta")}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          className={inputCls}
        />
        {errors.cashOutsideDirecta && <p className="text-destructive text-xs mt-1">Must be ≥ 0</p>}
      </div>

      <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">Current external cash</span>
          <span className="font-numeric font-semibold text-foreground">
            {new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(currentCashOutside)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs mt-1">
          <span className="text-muted-foreground">After save</span>
          <span className="font-numeric font-semibold text-blue-400">
            {new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(resultingBalance)}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save Balance"}
      </button>
      {status === "error" && (
        <p className="text-destructive text-xs text-center">{errorMsg}</p>
      )}
    </form>
  );
}
