import { Settings, DollarSign, Calendar, TrendingUp, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getAdminData } from "@/server/queries/admin";
import { dbEnabled } from "@/db/client";
import { PortfolioInputsForm } from "@/components/admin/PortfolioInputsForm";
import { formatEur, formatDate } from "@/lib/utils";

export default async function ControlsPage() {
  const { controls } = await getAdminData();
  const latest = controls[0];
  const prev = controls[1];

  const delta = latest && prev
    ? latest.capitalCommitted - prev.capitalCommitted
    : null;

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Portfolio Parameters</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set capital committed and reference dates
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

      {/* Current value */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          className="rounded-2xl border border-primary/20 p-6"
          style={{ background: "hsl(26 90% 54% / 0.07)", boxShadow: "var(--shadow-gold)" }}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent rounded-t-2xl" />
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Current Capital Committed
          </p>
          <p className="font-numeric text-4xl font-bold text-gradient-gold leading-none">
            {latest ? formatEur(latest.capitalCommitted) : "—"}
          </p>
          {latest && (
            <p className="text-xs text-muted-foreground mt-2">
              as of {formatDate(latest.asOfDate)}
            </p>
          )}
          {delta !== null && (
            <p className={`text-xs mt-1 font-medium ${delta >= 0 ? "text-success" : "text-destructive"}`}>
              {delta >= 0 ? "+" : ""}{formatEur(delta)} vs previous period
            </p>
          )}
        </div>

        <div
          className="rounded-2xl border border-border/60 p-6 bg-secondary/20"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Entry History
          </p>
          <p className="font-numeric text-4xl font-bold text-foreground leading-none">{controls.length}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {controls.length > 0
              ? `From ${formatDate(controls[controls.length - 1].asOfDate)} to ${formatDate(controls[0].asOfDate)}`
              : "No parameters entered"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Settings className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Set Parameters</h2>
          </div>
          <div className="p-5">
            {!dbEnabled() ? (
              <div className="py-8 text-center">
                <Settings className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Database not configured</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Add DATABASE_URL in .env.
                </p>
              </div>
            ) : (
              <PortfolioInputsForm controls={controls} />
            )}
          </div>
        </div>

        {/* Timeline of past values */}
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Capital Evolution</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{controls.length} entries</span>
          </div>
          {controls.length > 0 ? (
            <div className="divide-y divide-border/40">
              {controls.slice(0, 12).map((c, i) => {
                const prevC = controls[i + 1];
                const rowDelta = prevC ? c.capitalCommitted - prevC.capitalCommitted : null;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-5 py-4 hover:bg-secondary/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${i === 0 ? "bg-primary" : "bg-border"}`} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{formatDate(c.asOfDate)}</p>
                        {c.createdAt && (
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                            entered {formatDate(c.createdAt.split("T")[0])}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-numeric text-base font-bold text-foreground">{formatEur(c.capitalCommitted)}</p>
                      {rowDelta !== null && (
                        <p className={`font-numeric text-[11px] mt-0.5 ${rowDelta >= 0 ? "text-success" : "text-destructive"}`}>
                          {rowDelta >= 0 ? "+" : ""}{formatEur(rowDelta)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <DollarSign className="w-10 h-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No parameters entered</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
