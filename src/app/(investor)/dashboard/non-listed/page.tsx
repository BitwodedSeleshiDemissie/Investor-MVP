import { Building2, HandCoins, Info } from "lucide-react";
import { redirect } from "next/navigation";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { getLatestManualRows, getNonListedInvestedByInvestee, getPrivateLoanInvestedByCounterparty } from "@/server/queries/admin";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { formatEur, formatDate } from "@/lib/utils";

type NonListedRow = {
  key: string;
  label: string;
  bucket: "participation" | "loan" | "other";
  value: number;
  fundValue?: number;
  date: string;
  investedCapital?: number;
};

function titleFromKey(key: string) {
  return key
    .replace(/^PRIVATE_PARTICIPATION_/, "")
    .replace(/^PRIVATE_LOAN_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bucketForKey(key: string): NonListedRow["bucket"] {
  if (key.startsWith("PRIVATE_PARTICIPATION_") || key === "PRIVATE_PARTICIPATIONS") return "participation";
  if (key.startsWith("PRIVATE_LOAN_") || key === "PRIVATE_LOAN_PRINCIPAL") return "loan";
  return "other";
}

function bucketForManualItem(item: {
  item_key: string;
  subcategory?: string | null;
}): NonListedRow["bucket"] {
  const subcategory = item.subcategory?.toLowerCase() ?? "";
  if (subcategory.includes("participation")) return "participation";
  if (subcategory.includes("loan")) return "loan";
  return bucketForKey(item.item_key);
}

function bucketLabel(bucket: NonListedRow["bucket"]) {
  if (bucket === "participation") return "Private participations";
  if (bucket === "loan") return "Private loan principal";
  return "Other approved values";
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

function rowsFromApprovedSnapshot(snap: Awaited<ReturnType<typeof getPortfolioSnapshot>>): NonListedRow[] | null {
  const items = snap.overlaySources?.manualItems ?? [];
  if (items.length === 0) return null;
  return items
    .filter((item) => item.item_type.toLowerCase() !== "cash" && Number(item.value) > 0)
    .map((item) => ({
      key: item.item_key,
      label: item.display_name ?? titleFromKey(item.item_key),
      bucket: bucketForManualItem(item),
      value: Number(item.value),
      date: item.value_date ?? snap.cutoffDate,
    }));
}

function attachInvestedCapital(
  rows: NonListedRow[],
  participationMap: Map<string, number>,
  loanMap: Map<string, number>,
): NonListedRow[] {
  return rows.map((row) => {
    const map = row.bucket === "loan" ? loanMap : participationMap;
    const normalizedLabel = normalizeName(row.label);
    let fundInvested: number | undefined;
    for (const [name, invested] of map) {
      if (normalizeName(name) === normalizedLabel) {
        fundInvested = invested;
        break;
      }
    }
    if (fundInvested == null || fundInvested <= 0) return row;
    // Scale fund-level invested to investor's share
    const fraction = row.fundValue && row.fundValue > 0 ? row.value / row.fundValue : 1;
    return { ...row, investedCapital: fundInvested * fraction };
  });
}

function sum(rows: NonListedRow[]) {
  return rows.reduce((total, row) => total + row.value, 0);
}

function sumFund(rows: NonListedRow[]) {
  return rows.reduce((total, row) => total + Number(row.fundValue ?? 0), 0);
}

function withFundValues(rows: NonListedRow[], fundRows: NonListedRow[] | null): NonListedRow[] {
  if (!fundRows) return rows;
  const fundByKey = new Map(fundRows.map((row) => [row.key, row.value]));
  return rows.map((row) => ({ ...row, fundValue: fundByKey.get(row.key) }));
}

function PnLBadge({ value, invested }: { value: number; invested: number }) {
  if (invested <= 0) return null;
  const pct = ((value - invested) / invested) * 100;
  const positive = pct >= 0;
  return (
    <div className="flex items-center justify-end gap-1.5 mt-0.5">
      <span className={`text-[10px] font-semibold ${positive ? "text-emerald-400" : "text-destructive"}`}>
        {positive ? "+" : ""}{pct.toFixed(1)}%
      </span>
      <span className="text-[11px] text-muted-foreground">{formatEur(invested)}</span>
    </div>
  );
}

function BucketSection({ title, rows, total }: { title: string; rows: NonListedRow[]; total: number }) {
  if (rows.length === 0) return null;
  const bucketTotal = sum(rows);
  const showFundValues = rows.some((row) => typeof row.fundValue === "number");

  return (
    <div
      className="rounded-2xl border border-border/60 overflow-hidden"
      style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
        style={{ background: "hsl(222 44% 7%)" }}
      >
        <div className="p-1.5 rounded-lg bg-purple-500/10">
          <Building2 className="w-3.5 h-3.5 text-purple-400" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <div className="ml-auto text-right">
          <p className="font-numeric text-sm font-bold text-foreground">{formatEur(bucketTotal)}</p>
          {showFundValues && <p className="text-[11px] text-muted-foreground">Portfolio {formatEur(sumFund(rows))}</p>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
              <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Asset</th>
              <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {showFundValues ? "Your Value" : "Approved Value"}
              </th>
              {showFundValues && (
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Portfolio Value</th>
              )}
              <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Weight</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .sort((a, b) => b.value - a.value)
              .map((row) => (
                <tr key={row.key} className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors">
                  <td className="px-5 py-4">
                    <p className="font-medium text-foreground">{row.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(row.date)}</p>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <p className="font-numeric text-base font-bold text-foreground">{formatEur(row.value)}</p>
                    {row.investedCapital != null && (
                      <PnLBadge value={row.value} invested={row.investedCapital} />
                    )}
                  </td>
                  {showFundValues && (
                    <td className="px-5 py-4 text-right">
                      <span className="font-numeric text-sm font-semibold text-muted-foreground">
                        {typeof row.fundValue === "number" ? formatEur(row.fundValue) : "-"}
                      </span>
                    </td>
                  )}
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-purple-500/60"
                          style={{ width: `${total > 0 ? (row.value / total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="font-numeric text-xs text-muted-foreground w-10 text-right">
                        {total > 0 ? ((row.value / total) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function NonListedPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const investorName = cleanDisplayName(session.investorName);
  if (session.role === "investor" && !investorName) redirect("/login");

  const isInvestorView = session.role === "investor";
  const [snap, fundSnap, participationMap, loanMap] = await Promise.all([
    getPortfolioSnapshot(isInvestorView ? investorName : undefined),
    isInvestorView ? getPortfolioSnapshot() : Promise.resolve(null),
    getNonListedInvestedByInvestee(),
    getPrivateLoanInvestedByCounterparty(),
  ]);
  const { composition, cutoffDate } = snap;

  const approvedRows = rowsFromApprovedSnapshot(snap);
  const fundRows = fundSnap ? rowsFromApprovedSnapshot(fundSnap) : null;
  const liveRows = approvedRows ? [] : await getLatestManualRows("non_listed");
  const rawRows: NonListedRow[] = approvedRows
    ? withFundValues(approvedRows, fundRows)
    : liveRows.map((r) => ({
        key: r.itemKey,
        label: r.holdingName ?? r.displayName,
        bucket: bucketForKey(r.itemKey),
        value: r.value,
        date: r.valueDate,
      }));

  const rows = attachInvestedCapital(rawRows, participationMap, loanMap);

  const total = rows.length > 0 ? sum(rows) : composition.nonListed;
  const fundTotal = fundRows && fundRows.length > 0 ? sum(fundRows) : fundSnap?.composition.nonListed ?? null;
  const participations = rows.filter((row) => row.bucket === "participation");
  const loans = rows.filter((row) => row.bucket === "loan");
  const other = rows.filter((row) => row.bucket === "other");
  const fundParticipationTotal = sumFund(participations);
  const fundLoanTotal = sumFund(loans);

  const totalInvested = rows.reduce((s, r) => s + (r.investedCapital ?? 0), 0);
  const participationInvested = participations.reduce((s, r) => s + (r.investedCapital ?? 0), 0);
  const loanInvested = loans.reduce((s, r) => s + (r.investedCapital ?? 0), 0);

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Non-Listed / Approved Values</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Current approved values — {formatDate(cutoffDate)}
        </p>
      </div>

      {/* Valuation note */}
      <div className="flex gap-3 rounded-xl border border-border/40 bg-secondary/20 px-4 py-3">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Valuation methodology — </span>
          Non-listed assets are valued based on approved assessments reviewed periodically by the investment manager,
          typically following material corporate events or on a quarterly basis. Methods may include recent
          transaction prices, management accounts, or comparable company analysis. Values reflect the most
          recently approved figures as of the date shown for each asset.
        </p>
      </div>

      {/* Hero card */}
      <div
        className="rounded-2xl border border-border/60 p-6 flex items-end justify-between gap-4"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            {isInvestorView ? "Your Non-Listed Allocation" : "Total Non-Listed"}
          </p>
          <p className="font-numeric text-5xl font-bold text-foreground leading-none">{formatEur(total)}</p>
          {totalInvested > 0 ? (
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs font-semibold ${total >= totalInvested ? "text-emerald-400" : "text-destructive"}`}>
                {total >= totalInvested ? "+" : ""}{(((total - totalInvested) / totalInvested) * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">Invested {formatEur(totalInvested)}</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              {isInvestorView && fundTotal !== null
                ? `Portfolio total ${formatEur(fundTotal)}`
                : rows.length > 0 ? `${rows.length} approved items` : "No approved item breakdown in this snapshot"}
            </p>
          )}
        </div>
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <Building2 className="w-7 h-7 text-purple-400" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/60 p-5 bg-secondary/20">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-purple-400" />
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Private Participations</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground">{formatEur(sum(participations))}</p>
          {participationInvested > 0 ? (
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs font-semibold ${sum(participations) >= participationInvested ? "text-emerald-400" : "text-destructive"}`}>
                {sum(participations) >= participationInvested ? "+" : ""}
                {(((sum(participations) - participationInvested) / participationInvested) * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">vs. {formatEur(participationInvested)} invested</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              {isInvestorView && fundParticipationTotal > 0 ? `Portfolio total ${formatEur(fundParticipationTotal)}` : `${participations.length} approved values`}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 p-5 bg-secondary/20">
          <div className="flex items-center gap-2 mb-3">
            <HandCoins className="w-4 h-4 text-blue-400" />
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Private Loan Principal</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground">{formatEur(sum(loans))}</p>
          {loanInvested > 0 ? (
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs font-semibold ${sum(loans) >= loanInvested ? "text-emerald-400" : "text-destructive"}`}>
                {sum(loans) >= loanInvested ? "+" : ""}
                {(((sum(loans) - loanInvested) / loanInvested) * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">vs. {formatEur(loanInvested)} disbursed</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              {isInvestorView && fundLoanTotal > 0 ? `Portfolio total ${formatEur(fundLoanTotal)}` : `${loans.length} principal balances`}
            </p>
          )}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <BucketSection title={bucketLabel("participation")} rows={participations} total={total} />
          <BucketSection title={bucketLabel("loan")} rows={loans} total={total} />
          <BucketSection title={bucketLabel("other")} rows={other} total={total} />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-border/60 bg-card">
          <Building2 className="w-10 h-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No non-listed values entered</p>
        </div>
      )}
    </div>
  );
}
