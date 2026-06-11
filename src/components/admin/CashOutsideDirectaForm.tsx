"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { saveCashOutsideDirecta } from "@/server/actions/admin";

const schema = z.object({
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.coerce.number().nonnegative(),
});

type FormValues = z.infer<typeof schema>;

function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function CashOutsideDirectaForm({ currentValue }: { currentValue: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("Error saving cash balance");
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      valueDate: today(),
      value: Number.isFinite(currentValue) ? currentValue : 0,
    },
  });

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    setErrorMessage("Error saving cash balance");
    try {
      const result = await saveCashOutsideDirecta(values);
      if (result?.data?.success) {
        setStatus("saved");
        reset({ valueDate: values.valueDate, value: values.value });
        router.refresh();
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setErrorMessage(result?.serverError ?? result?.data?.error ?? "Error saving cash balance");
        setStatus("error");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error saving cash balance");
      setStatus("error");
    }
  }

  const inputCls = "w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-[1fr_180px_150px] gap-3 items-end">
      <div>
        <label htmlFor="outside-cash-value" className="block text-xs font-medium text-muted-foreground mb-1">
          Outside Cash Balance
        </label>
        <input
          {...register("value")}
          id="outside-cash-value"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          className={`${inputCls} font-numeric`}
        />
        {errors.value && <p className="text-destructive text-xs mt-1">Enter a valid non-negative amount</p>}
      </div>
      <div>
        <label htmlFor="outside-cash-date" className="block text-xs font-medium text-muted-foreground mb-1">
          Balance Date
        </label>
        <input {...register("valueDate")} id="outside-cash-date" type="date" className={inputCls} />
        {errors.valueDate && <p className="text-destructive text-xs mt-1">Select a valid date</p>}
      </div>
      <button
        type="submit"
        disabled={status === "saving"}
        className="h-10 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Save Cash"}
      </button>
      {status === "error" && <p className="md:col-span-3 text-destructive text-xs">{errorMessage}</p>}
    </form>
  );
}
