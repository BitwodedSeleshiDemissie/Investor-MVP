import { Users, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getInvestorProfiles } from "@/server/queries/admin";
import { dbEnabled } from "@/db/prisma";
import { InvestorProfilesForm } from "@/components/admin/InvestorProfilesForm";
import { formatEur } from "@/lib/utils";

export default async function InvestorsPage() {
  const profiles = await getInvestorProfiles();
  const activeProfiles = profiles.filter((p) => p.active);
  const totalCapital = activeProfiles.reduce((s, p) => s + p.capitalEur, 0);
  const totalUnits = activeProfiles.reduce((s, p) => s + p.units, 0);

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Investor Profiles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage investor registry — used to compute per-investor performance metrics
          </p>
        </div>
        <Link
          href="/admin"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Active Investors</p>
          <p className="font-numeric text-3xl font-bold text-foreground">{activeProfiles.length}</p>
        </div>
        <div
          className="rounded-2xl border border-primary/20 p-5"
          style={{ background: "hsl(26 90% 54% / 0.07)", boxShadow: "var(--shadow-gold)" }}
        >
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Total Capital</p>
          <p className="font-numeric text-3xl font-bold text-gradient-gold">
            {activeProfiles.length > 0 ? formatEur(totalCapital) : "—"}
          </p>
        </div>
        <div
          className="rounded-2xl border border-border/60 p-5"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Total Units</p>
          <p className="font-numeric text-3xl font-bold text-foreground">
            {activeProfiles.length > 0 ? totalUnits.toLocaleString("en", { maximumFractionDigits: 2 }) : "—"}
          </p>
        </div>
      </div>

      {!dbEnabled() ? (
        <div
          className="rounded-2xl border border-border/60 p-10 text-center"
          style={{ background: "hsl(var(--card))" }}
        >
          <Users className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Database not configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add DATABASE_URL in .env.</p>
        </div>
      ) : (
        <InvestorProfilesForm profiles={profiles} />
      )}
    </div>
  );
}
