"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, SlidersHorizontal } from "lucide-react";
import { saveFundSettings } from "@/server/actions/admin";
import type { FundSettings } from "@/server/fund-settings";

const schema = z.object({
  portfolioId: z.string().min(1, "Portfolio ID required"),
  fundDisplayName: z.string().min(1, "Display name required"),
  baseCurrency: z.string().trim().length(3, "Use a 3-letter currency code"),
  subscriptionPricingPolicy: z.string().min(1, "Policy required"),
  riskFreeRatePct: z.coerce.number().min(0).max(100),
  moicTarget: z.coerce.number().positive(),
  targetEquityPct: z.coerce.number().min(0).max(100),
  targetBondPct: z.coerce.number().min(0).max(100),
  targetAltPct: z.coerce.number().min(0).max(100),
  hurdleRatePct: z.coerce.number().min(0).max(100),
  gpCarryPct: z.coerce.number().min(0).max(100),
  catchUpGpTargetPct: z.coerce.number().min(0).max(100),
}).refine((value) => {
  const sum = value.targetEquityPct + value.targetBondPct + value.targetAltPct;
  return Math.abs(sum - 100) < 0.000001;
}, {
  message: "Targets must add up to 100%.",
  path: ["targetAltPct"],
});

type FormValues = z.infer<typeof schema>;

function pct(value: number): number {
  return Number((value * 100).toFixed(4));
}

function defaults(settings: FundSettings): FormValues {
  return {
    portfolioId: settings.portfolioId,
    fundDisplayName: settings.fundDisplayName,
    baseCurrency: settings.baseCurrency,
    subscriptionPricingPolicy: settings.subscriptionPricingPolicy,
    riskFreeRatePct: pct(settings.riskFreeRate),
    moicTarget: settings.moicTarget,
    targetEquityPct: pct(settings.targetEquityPct),
    targetBondPct: pct(settings.targetBondPct),
    targetAltPct: pct(settings.targetAltPct),
    hurdleRatePct: pct(settings.hurdleRate),
    gpCarryPct: pct(settings.gpCarryPct),
    catchUpGpTargetPct: pct(settings.catchUpGpTargetPct),
  };
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
      {error && <p className="text-destructive text-xs mt-1">{error}</p>}
    </div>
  );
}

export function FundSettingsForm({ settings }: { settings: FundSettings }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(settings),
  });

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    setErrorMessage("");
    try {
      const result = await saveFundSettings(values);
      if (result?.data?.success) {
        setStatus("saved");
        router.refresh();
        setTimeout(() => setStatus("idle"), 2500);
      } else {
        setErrorMessage(result?.serverError ?? result?.data?.error ?? "Error saving settings");
        setStatus("error");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Error saving settings");
      setStatus("error");
    }
  }

  const inputClass =
    "w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const numberClass = `${inputClass} font-numeric`;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-primary/10">
            <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Fund Identity</h2>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Portfolio ID" error={errors.portfolioId?.message}>
            <input {...register("portfolioId")} className={inputClass} />
          </Field>
          <Field label="Fund Display Name" error={errors.fundDisplayName?.message}>
            <input {...register("fundDisplayName")} className={inputClass} />
          </Field>
          <Field label="Base Currency" error={errors.baseCurrency?.message}>
            <input {...register("baseCurrency")} className={inputClass} />
          </Field>
          <Field label="Subscription Pricing Policy" error={errors.subscriptionPricingPolicy?.message}>
            <input {...register("subscriptionPricingPolicy")} className={inputClass} />
          </Field>
        </div>
      </div>

      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-emerald-500/10">
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Dashboard Assumptions</h2>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Risk-Free Rate (%)" error={errors.riskFreeRatePct?.message}>
            <input {...register("riskFreeRatePct")} type="number" step="0.01" className={numberClass} />
          </Field>
          <Field label="MOIC Target" error={errors.moicTarget?.message}>
            <input {...register("moicTarget")} type="number" step="0.01" className={numberClass} />
          </Field>
          <Field label="Target Equity (%)" error={errors.targetEquityPct?.message}>
            <input {...register("targetEquityPct")} type="number" step="0.01" className={numberClass} />
          </Field>
          <Field label="Target Bond (%)" error={errors.targetBondPct?.message}>
            <input {...register("targetBondPct")} type="number" step="0.01" className={numberClass} />
          </Field>
          <Field label="Target Alternatives (%)" error={errors.targetAltPct?.message}>
            <input {...register("targetAltPct")} type="number" step="0.01" className={numberClass} />
          </Field>
        </div>
      </div>

      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-blue-500/10">
            <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Waterfall Assumptions</h2>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Hurdle Rate (%)" error={errors.hurdleRatePct?.message}>
            <input {...register("hurdleRatePct")} type="number" step="0.01" className={numberClass} />
          </Field>
          <Field label="GP Carry (%)" error={errors.gpCarryPct?.message}>
            <input {...register("gpCarryPct")} type="number" step="0.01" className={numberClass} />
          </Field>
          <Field label="Catch-up GP Target (%)" error={errors.catchUpGpTargetPct?.message}>
            <input {...register("catchUpGpTargetPct")} type="number" step="0.01" className={numberClass} />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Save Settings"}
        </button>
        {status === "error" && <p className="text-sm text-destructive">{errorMessage}</p>}
      </div>
    </form>
  );
}
