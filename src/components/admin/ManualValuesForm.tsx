"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { saveManualValue } from "@/server/actions/admin";
import type { AdminDictionaryItem } from "@/types/portfolio";

const schema = z.object({
  itemKey: z.string().min(1),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.coerce.number().nonnegative(),
  holdingName: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  items: AdminDictionaryItem[];
  onSaved?: () => void;
}

export function ManualValuesForm({ items, onSaved }: Props) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("Error saving data");
  const nonListed = items.filter((i) => i.itemType === "non_listed");

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    setErrorMessage("Error saving data");
    try {
      const item = nonListed.find((i) => i.itemKey === values.itemKey);
      const result = await saveManualValue({ ...values, displayName: item?.displayName ?? values.itemKey });
      if (result?.data?.success) {
        setStatus("saved");
        reset();
        onSaved?.();
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setErrorMessage(result?.serverError ?? result?.data?.error ?? "Error saving data");
        setStatus("error");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error saving data");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Non-Listed Asset</label>
        <select
          {...register("itemKey")}
          className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">Select asset…</option>
          {nonListed.map((i) => (
            <option key={i.itemKey} value={i.itemKey}>{i.displayName}</option>
          ))}
        </select>
        {errors.itemKey && <p className="text-destructive text-xs mt-1">Please select an asset</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Value (€)</label>
          <input
            {...register("value")}
            type="number"
            step="0.01"
            placeholder="0.00"
            className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {errors.value && <p className="text-destructive text-xs mt-1">Invalid value</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Valuation Date</label>
          <input
            {...register("valueDate")}
            type="date"
            className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {errors.valueDate && <p className="text-destructive text-xs mt-1">Invalid date</p>}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Holding Name (optional)</label>
        <input
          {...register("holdingName")}
          type="text"
          placeholder="e.g. Fund XYZ share"
          className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save Value"}
      </button>
      {status === "error" && <p className="text-destructive text-xs text-center">{errorMessage}</p>}
    </form>
  );
}
