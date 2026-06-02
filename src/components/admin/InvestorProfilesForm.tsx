"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2, Upload, UserPlus, Users } from "lucide-react";
import { deleteInvestorProfile, saveInvestorProfile } from "@/server/actions/admin";
import { formatDate, formatEur } from "@/lib/utils";
import type { InvestorProfile } from "@/types/portfolio";

const schema = z.object({
  name: z.string().min(1, "Name required"),
  investorType: z.string().min(1).default("Individual"),
  capitalEur: z.coerce.number().nonnegative("Must be >= 0"),
  units: z.coerce.number().nonnegative("Must be >= 0"),
  subscriptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  navUnitAtSub: z.coerce.number().nonnegative().default(1.0),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  profiles: InvestorProfile[];
  currentNavUnit: number;
}

export function InvestorProfilesForm({ profiles, currentNavUnit }: Props) {
  const router = useRouter();
  const [formStatus, setFormStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [formError, setFormError] = useState("");
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [calculationMode, setCalculationMode] = useState<"unitsFromNav" | "navFromUnits">("unitsFromNav");
  const defaultNavUnit = Number.isFinite(currentNavUnit) && currentNavUnit > 0 ? currentNavUnit : 1;

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { investorType: "Individual", navUnitAtSub: defaultNavUnit },
  });

  function inputNumber(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : Number(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  function recalculateUnits(capital: number | null, navUnit: number | null): void {
    if (capital === null || navUnit === null || navUnit <= 0) return;
    setValue("units", round(capital / navUnit), { shouldDirty: true, shouldValidate: true });
  }

  function recalculateNavUnit(capital: number | null, units: number | null): void {
    if (capital === null || units === null || units <= 0) return;
    setValue("navUnitAtSub", round(capital / units), { shouldDirty: true, shouldValidate: true });
  }

  const capitalField = register("capitalEur", {
    onChange: (event) => {
      const capital = inputNumber(event.target.value);
      if (calculationMode === "navFromUnits") {
        recalculateNavUnit(capital, inputNumber(getValues("units")));
      } else {
        recalculateUnits(capital, inputNumber(getValues("navUnitAtSub")));
      }
    },
  });
  const unitsField = register("units", {
    onChange: (event) => {
      setCalculationMode("navFromUnits");
      recalculateNavUnit(inputNumber(getValues("capitalEur")), inputNumber(event.target.value));
    },
  });
  const navUnitField = register("navUnitAtSub", {
    onChange: (event) => {
      setCalculationMode("unitsFromNav");
      recalculateUnits(inputNumber(getValues("capitalEur")), inputNumber(event.target.value));
    },
  });

  async function onSubmit(values: FormValues) {
    setFormStatus("saving");
    setFormError("");
    try {
      const result = await saveInvestorProfile(values);
      if (result?.data?.success) {
        setFormStatus("saved");
        setCalculationMode("unitsFromNav");
        reset({ investorType: "Individual", navUnitAtSub: defaultNavUnit });
        router.refresh();
        setTimeout(() => setFormStatus("idle"), 3000);
      } else {
        setFormError(result?.serverError ?? result?.data?.error ?? "Error saving profile");
        setFormStatus("error");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error saving profile");
      setFormStatus("error");
    }
  }

  async function handleDelete(name: string) {
    setDeletingName(name);
    try {
      await deleteInvestorProfile({ name });
      router.refresh();
    } finally {
      setDeletingName(null);
    }
  }

  const activeProfiles = profiles.filter((p) => p.active);

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-emerald-500/10">
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Investor Source</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            Investor profiles come from the tracker context upload on the Upload Data page. This page is only for manual corrections or investor-specific entries that are not in Directa.
          </p>
          <Link
            href="/admin/upload"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Open Upload Data
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-primary/10">
              <UserPlus className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Add / Update Investor</h2>
          </div>
          <div className="p-5">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <input
                  {...register("name")}
                  type="text"
                  placeholder="e.g. Mario Rossi"
                  className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {errors.name && <p className="text-destructive text-xs mt-0.5">{errors.name.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
                  <select
                    {...register("investorType")}
                    className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="Individual">Individual</option>
                    <option value="Corporate">Corporate</option>
                    <option value="Family Office">Family Office</option>
                    <option value="Institutional">Institutional</option>
                    <option value="Foundation">Foundation</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Subscription Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    {...register("subscriptionDate")}
                    type="date"
                    className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.subscriptionDate && <p className="text-destructive text-xs mt-0.5">{errors.subscriptionDate.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Capital Committed (EUR) <span className="text-destructive">*</span>
                  </label>
                  <input
                    {...capitalField}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.capitalEur && <p className="text-destructive text-xs mt-0.5">{errors.capitalEur.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Units <span className="text-destructive">*</span>
                  </label>
                  <input
                    {...unitsField}
                    type="number"
                    step="0.000001"
                    placeholder="0.000000"
                    className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {errors.units && <p className="text-destructive text-xs mt-0.5">{errors.units.message}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  NAV/Unit at Subscription
                </label>
                <input
                  {...navUnitField}
                  type="number"
                  step="0.000001"
                  placeholder="1.000000"
                  className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  Defaults to the latest published fund NAV/unit.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                <input
                  {...register("notes")}
                  type="text"
                  placeholder="Optional"
                  className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <button
                type="submit"
                disabled={formStatus === "saving"}
                className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {formStatus === "saving" ? "Saving..." : formStatus === "saved" ? "Saved" : "Save Investor"}
              </button>
              {formStatus === "error" && (
                <p className="text-destructive text-xs text-center">{formError}</p>
              )}
            </form>
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
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Registered Investors</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{activeProfiles.length} active</span>
          </div>
          {activeProfiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <Users className="w-10 h-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No investors yet</p>
              <p className="text-xs text-muted-foreground/60">Upload tracker context or add manually</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40 max-h-[460px] overflow-y-auto">
              {activeProfiles.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between px-5 py-4 hover:bg-secondary/20 transition-colors gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] border bg-secondary/40 text-muted-foreground border-border/40">
                        {p.investorType}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatEur(p.capitalEur)} | {p.units.toLocaleString("en", { maximumFractionDigits: 4 })} units | sub {formatDate(p.subscriptionDate)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(p.name)}
                    disabled={deletingName === p.name}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    title="Remove investor"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
