"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { saveNonListedValues } from "@/server/actions/admin";

const schema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(["BUY", "SELL"]),
  investee: z.string().min(1, "Investee is required"),
  amount: z.coerce.number().positive(),
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

export function NonListedValuesForm() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      asOfDate: today(),
      tipo: "BUY",
      investee: "",
      amount: undefined,
    },
  });

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    setErrorMsg("");
    try {
      const result = await saveNonListedValues(values);
      if (result?.data?.success) {
        setStatus("saved");
        reset({ asOfDate: values.asOfDate, tipo: "BUY", investee: "", amount: undefined });
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

  const inputCls = "w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="non-listed-date" className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
          <input id="non-listed-date" {...register("asOfDate")} type="date" className={inputCls} />
          {errors.asOfDate && <p className="text-destructive text-xs mt-1">Required</p>}
        </div>

        <div>
          <label htmlFor="non-listed-tipo" className="block text-xs font-medium text-muted-foreground mb-1">Tipo</label>
          <select id="non-listed-tipo" {...register("tipo")} className={inputCls}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          {errors.tipo && <p className="text-destructive text-xs mt-1">Select BUY or SELL</p>}
        </div>
      </div>

      <div>
        <label htmlFor="non-listed-investee" className="block text-xs font-medium text-muted-foreground mb-1">Investee</label>
        <input
          id="non-listed-investee"
          {...register("investee")}
          type="text"
          placeholder="Ariete Tech Solutions"
          className={inputCls}
        />
        {errors.investee && <p className="text-destructive text-xs mt-1">Investee is required</p>}
      </div>

      <div className="grid grid-cols-[96px_1fr] gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Valuta</label>
          <div className="w-full px-3 py-2 bg-secondary/30 border border-border rounded-lg text-muted-foreground text-sm font-semibold">
            EUR
          </div>
        </div>
        <div>
          <label htmlFor="non-listed-amount" className="block text-xs font-medium text-muted-foreground mb-1">Amount</label>
          <input
            id="non-listed-amount"
            {...register("amount")}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className={`${inputCls} font-numeric`}
          />
          {errors.amount && <p className="text-destructive text-xs mt-1">Amount must be greater than 0</p>}
        </div>
      </div>

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Save Entry"}
      </button>
      {status === "error" && (
        <p className="text-destructive text-xs text-center">{errorMsg}</p>
      )}
    </form>
  );
}
