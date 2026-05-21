import { Building2, HandCoins } from "lucide-react";
import { getPortfolioSnapshot } from "@/server/queries/portfolio";
import { getLatestManualRows } from "@/server/queries/admin";
import { formatEur, formatDate } from "@/lib/utils";

type NonListedRow = {
  key: string;
  label: string;
  bucket: "participation" | "loan" | "other";
  value: number;
  date: string;
};

function titleFromKey(key: string) {
  return key
    .replace(/^TRACKER_PARTICIPATION_/, "")
    .replace(/^TRACKER_LOAN_/, "")
    .replace(/^CEO_TRACKER_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bucketForKey(key: string): NonListedRow["bucket"] {
  if (key.startsWith("TRACKER_PARTICIPATION_") || key === "CEO_TRACKER_PARTICIPATIONS" || key === "PRIVATE_PARTICIPATIONS") return "participation";
  if (key.startsWith("TRACKER_LOAN_") || key === "CEO_TRACKER_PRIVATE_LOANS" || key === "PRIVATE_LOAN_PRINCIPAL") return "loan";
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

function rowsFromApprovedSnapshot(snap: Awaited<ReturnType<typeof getPortfolioSnapshot>>): NonListedRow[] | null {
  if (!snap.overlaysFrozen) return null;
  return (snap.overlaySources?.manualItems ?? [])
    .filter((item) => item.item_type.toLowerCase() !== "cash" && Number(item.value) > 0)
    .map((item) => ({
      key: item.item_key,
      label: item.display_name ?? titleFromKey(item.item_key),
      bucket: bucketForManualItem(item),
      value: Number(item.value),
      date: item.value_date ?? snap.cutoffDate,
    }));
}

function sum(rows: NonListedRow[]) {
  return rows.reduce((total, row) => total + row.value, 0);
}

function BucketSection({ title, rows, total }: { title: string; rows: NonListedRow[]; total: number }) {
  if (rows.length === 0) return null;
  const bucketTotal = sum(rows);

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
        <span className="ml-auto font-numeric text-sm font-bold text-foreground">{formatEur(bucketTotal)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border/60" style={{ background: "hsl(222 35% 10%)" }}>
              <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Asset</th>
              <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Approved Value</th>
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
                    <span className="font-numeric text-base font-bold text-purple-400">{formatEur(row.value)}</span>
                  </td>
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
  const snap = await getPortfolioSnapshot();
  const { composition, cutoffDate } = snap;

  const approvedRows = rowsFromApprovedSnapshot(snap);
  const liveRows = approvedRows ? [] : await getLatestManualRows("non_listed");
  const rows: NonListedRow[] = approvedRows ?? liveRows.map((r) => ({
    key: r.itemKey,
    label: r.holdingName ?? r.displayName,
    bucket: bucketForKey(r.itemKey),
    value: r.value,
    date: r.valueDate,
  }));

  const total = rows.length > 0 ? sum(rows) : composition.nonListed;
  const participations = rows.filter((row) => row.bucket === "participation");
  const loans = rows.filter((row) => row.bucket === "loan");
  const other = rows.filter((row) => row.bucket === "other");

  return (
    <div className="space-y-5 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Non-Listed / Approved Values</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Current approved values - {formatDate(cutoffDate)}
        </p>
      </div>

      <div
        className="rounded-2xl border border-border/60 p-6 flex items-end justify-between gap-4"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Total Non-Listed</p>
          <p className="font-numeric text-5xl font-bold text-foreground leading-none">{formatEur(total)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {rows.length > 0 ? `${rows.length} approved items` : "No approved item breakdown in this snapshot"}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <Building2 className="w-7 h-7 text-purple-400" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/60 p-5 bg-secondary/20">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-purple-400" />
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Private Participations</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground">{formatEur(sum(participations))}</p>
          <p className="text-xs text-muted-foreground mt-2">{participations.length} approved values</p>
        </div>

        <div className="rounded-2xl border border-border/60 p-5 bg-secondary/20">
          <div className="flex items-center gap-2 mb-3">
            <HandCoins className="w-4 h-4 text-blue-400" />
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Private Loan Principal</p>
          </div>
          <p className="font-numeric text-3xl font-bold text-foreground">{formatEur(sum(loans))}</p>
          <p className="text-xs text-muted-foreground mt-2">{loans.length} principal balances</p>
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
