import {
  Wallet, Database, TrendingUp,
  CheckCircle2, AlertCircle, Upload, Users, Clock,
  Download, FileText, ArrowRight, Layers, HandCoins, CreditCard,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { getAdminFreshness, getFixedPortfolioValues, getInvestorProfiles, getSnapshotHistory } from "@/server/queries/admin";
import { dbEnabled } from "@/db/prisma";
import { formatEur, formatDate, formatDateTime } from "@/lib/utils";

type SectionItem = {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  stat: string;
  color: string;
  bgColor: string;
  ok: boolean;
};

export default async function AdminPage() {
  const isDbEnabled = dbEnabled();
  const [portfolioValues, investorProfiles, snapshotHistory, adminFreshness] = await Promise.all([
    getFixedPortfolioValues(),
    getInvestorProfiles(),
    getSnapshotHistory(),
    getAdminFreshness(),
  ]);

  const {
    privateParticipations,
    privateLoanPrincipal,
    cashOutsideDirecta,
    statementCash,
  } = portfolioValues;

  const activeInvestors = investorProfiles.filter((p) => p.active);
  const totalNonListed  = privateParticipations + privateLoanPrincipal;
  const totalCash       = statementCash + cashOutsideDirecta;
  const latestUpload    = snapshotHistory[0];
  const latestPublished = snapshotHistory.find((snapshot) => snapshot.status === "published") ?? null;
  const latestSourceFiles = latestPublished?.sourceFile
    ? latestPublished.sourceFile.split(",").map((file) => file.trim()).filter(Boolean)
    : [];
  const latestSourceLabel = latestSourceFiles.length > 0
    ? latestSourceFiles.slice(0, 2).join(", ") + (latestSourceFiles.length > 2 ? ` +${latestSourceFiles.length - 2}` : "")
    : "No source file recorded";
  const latestTransactionsThrough = latestPublished?.transactionsThrough ?? latestPublished?.cutoffDate ?? "";

  const steps = [
    {
      label: "Baseline snapshot uploaded",
      detail: latestPublished
        ? `Published: ${formatDate(latestPublished.cutoffDate)} · data through ${formatDate(latestTransactionsThrough)}`
        : "No snapshot — upload the CEO tracker workbook",
      ok: Boolean(latestPublished),
    },
    {
      label: "Non-listed values entered",
      detail: totalNonListed > 0
        ? `Participations: ${formatEur(privateParticipations)} · Loans: ${formatEur(privateLoanPrincipal)}`
        : "No non-listed values yet",
      ok: totalNonListed > 0,
    },
    {
      label: "Cash outside brokerage calculated",
      detail: cashOutsideDirecta > 0
        ? `${formatEur(cashOutsideDirecta)} residual (brokerage cash ${formatEur(statementCash)} from Directa)`
        : "No outside-brokerage cash residual",
      ok: cashOutsideDirecta > 0,
    },
    {
      label: "Investors configured",
      detail: activeInvestors.length > 0
        ? `${activeInvestors.length} active investor${activeInvestors.length !== 1 ? "s" : ""}`
        : "No investors — add profiles to enable per-investor metrics",
      ok: activeInvestors.length > 0,
    },
  ];
  const stepsComplete = steps.filter((s) => s.ok).length;

  const groups: Array<{ label: string; description: string; items: SectionItem[] }> = [
    {
      label: "Monthly Values",
      description: "Enter once a month. These feed directly into the portfolio composition shown to all investors.",
      items: [
        {
          href: "/admin/non-listed",
          icon: TrendingUp,
          title: "Non-Listed Assets",
          description: `Private Participations and Private Loan Principal — manually approved each month from the CEO tracker`,
          stat: totalNonListed > 0
            ? `${formatEur(privateParticipations)} participations · ${formatEur(privateLoanPrincipal)} loans`
            : "No values entered",
          color: "text-purple-400",
          bgColor: "bg-purple-500/10",
          ok: totalNonListed > 0,
        },
        {
          href: "/admin/cash",
          icon: Wallet,
          title: "Cash",
          description: `Brokerage cash comes from the Directa PDF. Cash outside brokerage is calculated automatically.`,
          stat: totalCash > 0
            ? `${formatEur(statementCash)} brokerage · ${formatEur(cashOutsideDirecta)} outside`
            : "No cash data",
          color: "text-blue-400",
          bgColor: "bg-blue-500/10",
          ok: cashOutsideDirecta > 0 || statementCash > 0,
        },
      ],
    },
    {
      label: "Foundation",
      description: "Configure once. Investor profiles power all per-investor metrics on the portal.",
      items: [
        {
          href: "/admin/investors",
          icon: Users,
          title: "Investor Profiles",
          description: "Capital committed, units held, subscription date, and entry NAV per investor",
          stat: activeInvestors.length > 0 ? `${activeInvestors.length} active investor${activeInvestors.length !== 1 ? "s" : ""}` : "No investors",
          color: "text-indigo-400",
          bgColor: "bg-indigo-500/10",
          ok: activeInvestors.length > 0,
        },
        {
          href: "/admin/settings",
          icon: SlidersHorizontal,
          title: "Fund Settings",
          description: "Portfolio identity, dashboard assumptions, allocation targets, and waterfall parameters",
          stat: "Admin managed",
          color: "text-emerald-400",
          bgColor: "bg-emerald-500/10",
          ok: true,
        },
      ],
    },
    {
      label: "Data Upload",
      description: "Upload the CEO tracker once as the official baseline, then Directa CSVs plus the Directa PDF each month.",
      items: [
        {
          href: "/admin/upload",
          icon: Upload,
          title: "Upload Data",
          description: "CSV exports for transactions and income; PDF snapshot for holdings, liquidity, market value, and ISINs",
          stat: latestUpload ? `Last upload: ${formatDateTime(latestUpload.createdAt)}` : "No uploads yet",
          color: "text-emerald-400",
          bgColor: "bg-emerald-500/10",
          ok: Boolean(latestUpload),
        },
      ],
    },
  ];

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          What you enter here drives what investors see on the portal
        </p>
      </div>

      {/* DB status */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${
        isDbEnabled
          ? "bg-success/8 border-success/20 text-success"
          : "bg-warning/8 border-warning/20 text-warning"
      }`}>
        {isDbEnabled
          ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          : <Database className="w-4 h-4 shrink-0 mt-0.5" />
        }
        <div>
          <p className="font-semibold">{isDbEnabled ? "Database connected" : "Database not configured"}</p>
          <p className="text-xs mt-0.5 opacity-80">
            {isDbEnabled ? "All data entry modules are active." : "Add DATABASE_URL in .env to enable admin data saving."}
          </p>
        </div>
      </div>

      {/* Data freshness */}
      {latestPublished && (
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Data Freshness</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Last published</p>
              <p className="mt-1 font-numeric text-sm font-semibold text-foreground">{formatDateTime(latestPublished.publishedAt ?? latestPublished.createdAt)}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Transactions through</p>
              <p className="mt-1 font-numeric text-sm font-semibold text-foreground">{formatDate(latestTransactionsThrough)}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Source files</p>
              <p className="mt-1 text-sm font-semibold text-foreground truncate" title={latestPublished.sourceFile || latestSourceLabel}>
                {latestSourceLabel}
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Last admin update</p>
              <p className="mt-1 font-numeric text-sm font-semibold text-foreground">{formatDateTime(adminFreshness.lastAdminUpdateAt)}</p>
              {adminFreshness.lastAdminUpdateArea && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">{adminFreshness.lastAdminUpdateArea}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Readiness checklist */}
      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">System Readiness</h2>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
            stepsComplete === steps.length
              ? "bg-success/10 text-success border-success/20"
              : "bg-warning/10 text-warning border-warning/20"
          }`}>
            {stepsComplete}/{steps.length} ready
          </span>
        </div>
        <div className="divide-y divide-border/40">
          {steps.map((step) => (
            <div key={step.label} className="flex items-start gap-3 px-5 py-3.5">
              {step.ok
                ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                : <AlertCircle className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
              }
              <div className="min-w-0">
                <p className={`text-sm font-medium ${step.ok ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Current portfolio composition summary */}
      {(totalNonListed > 0 || totalCash > 0) && (
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <p className="text-sm font-semibold text-foreground">Current Portfolio Inputs</p>
            <p className="text-xs text-muted-foreground mt-0.5">Manual non-listed values plus brokerage cash and residual cash used in the next snapshot</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border/40">
            {[
              { label: "Private Participations", value: privateParticipations, icon: TrendingUp, color: "text-purple-400" },
              { label: "Private Loan Principal", value: privateLoanPrincipal,  icon: HandCoins,  color: "text-blue-400" },
              { label: "Brokerage Cash",         value: statementCash,         icon: CreditCard, color: "text-emerald-400" },
              { label: "Cash Outside Brokerage", value: cashOutsideDirecta,    icon: Wallet,     color: "text-sky-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="px-5 py-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest leading-none">{label}</p>
                </div>
                <p className={`font-numeric text-lg font-bold ${value > 0 ? color : "text-muted-foreground"}`}>
                  {value > 0 ? formatEur(value) : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section groups */}
      {groups.map((group) => (
        <div key={group.label} className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{group.label}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">{group.description}</p>
          </div>
          <div className={`grid gap-4 ${group.items.length === 1 ? "grid-cols-1 sm:max-w-sm" : "grid-cols-1 sm:grid-cols-2"}`}>
            {group.items.map(({ href, icon: Icon, title, description, stat, color, bgColor, ok }) => (
              <Link
                key={href}
                href={href}
                className="group rounded-2xl border border-border/60 p-5 hover:border-border transition-all duration-200 hover:-translate-y-0.5"
                style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-xl ${bgColor} shrink-0 mt-0.5`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0 mt-0.5" />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <p className={`font-numeric text-sm font-bold ${ok ? color : "text-muted-foreground"}`}>{stat}</p>
                  {ok
                    ? <CheckCircle2 className="w-4 h-4 text-success" />
                    : <AlertCircle className="w-4 h-4 text-muted-foreground/40" />
                  }
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* Snapshot history */}
      {snapshotHistory.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
            style={{ background: "hsl(222 44% 7%)" }}
          >
            <div className="p-1.5 rounded-lg bg-secondary/60">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Snapshot History</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">Last 12 months</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Cut-off</th>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Status</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden sm:table-cell">Portfolio value</th>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden md:table-cell">Approved by</th>
                  <th className="text-center px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Audit</th>
                </tr>
              </thead>
              <tbody>
                {snapshotHistory.map((snap) => (
                  <tr
                    key={snap.id}
                    className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-foreground font-numeric">{formatDate(snap.cutoffDate)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Transactions through {formatDate(snap.transactionsThrough ?? snap.cutoffDate)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Uploaded {formatDateTime(snap.createdAt)}</p>
                      {snap.publishedAt && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">Published {formatDate(snap.publishedAt)}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        snap.status === "published"
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-warning/10 text-warning border-warning/20"
                      }`}>
                        {snap.status === "published"
                          ? <CheckCircle2 className="w-3 h-3" />
                          : <Clock className="w-3 h-3" />
                        }
                        {snap.status === "published" ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right hidden sm:table-cell">
                      <span className="font-numeric text-sm font-bold text-foreground">{formatEur(snap.portfolioValue)}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      {snap.approvedBy
                        ? <p className="text-xs text-foreground">{snap.approvedBy}</p>
                        : <span className="text-xs text-muted-foreground">—</span>
                      }
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {snap.hasArtifact ? (
                        <a
                          href={`/api/admin/snapshot-artifacts/${snap.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Workbook</span>
                        </a>
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-muted-foreground/30 mx-auto" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
