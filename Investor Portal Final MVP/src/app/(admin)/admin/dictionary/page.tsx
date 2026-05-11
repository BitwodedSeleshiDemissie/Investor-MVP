import { Building2, Hash, Tag, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getAdminData } from "@/server/queries/admin";
import { dbEnabled } from "@/db/client";
import { DictionaryManager } from "@/components/admin/DictionaryManager";

export default async function DictionaryPage() {
  const { dictionary } = await getAdminData();
  const nonListed = dictionary.filter((d) => d.itemType === "non_listed");
  const cash = dictionary.filter((d) => d.itemType === "cash");

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Asset Dictionary</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage registered assets — non-listed and cash accounts
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
        {[
          { label: "Total Assets", value: dictionary.length, icon: Tag, color: "text-primary" },
          { label: "Non-Listed", value: nonListed.length, icon: Building2, color: "text-purple-400" },
          { label: "Cash Accounts", value: cash.length, icon: Hash, color: "text-blue-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-2xl border border-border/60 p-5 bg-card"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg bg-secondary/60">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
              </div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
            </div>
            <p className={`font-numeric text-3xl font-bold leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Main form + table */}
      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Building2 className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Add / Edit Assets</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">{dictionary.length} registered assets</span>
        </div>
        <div className="p-5 sm:p-6">
          {!dbEnabled() ? (
            <div className="py-8 text-center">
              <Building2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Database not configured</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Add DATABASE_URL in .env.local to manage assets.
              </p>
            </div>
          ) : (
            <DictionaryManager items={dictionary} />
          )}
        </div>
      </div>
    </div>
  );
}
