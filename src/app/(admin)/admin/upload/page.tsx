import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DirectaUpload } from "@/components/admin/DirectaUpload";
import { TrackerUpload } from "@/components/admin/TrackerUpload";

export default function UploadDataPage() {
  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Upload Data</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Seed from the CEO tracker, then update monthly with Directa and manual inputs
          </p>
        </div>
      </div>

      <div
        className="rounded-2xl border border-border/60 p-5 text-sm text-muted-foreground space-y-1"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <p className="font-semibold text-foreground text-sm mb-2">Source order</p>
        <p>- Upload the CEO tracker once to create the official approved baseline.</p>
        <p>- Upload Directa monthly CSVs for transactions, income, commissions, and audit history.</p>
        <p>- Upload the Directa PDF snapshot so listed holdings, ISINs, market value, and brokerage cash come from the official statement.</p>
        <p>- Confirm manual non-listed values during the Directa upload. Cash outside brokerage is calculated automatically.</p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Directa Monthly CSVs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Combines CSV transaction history with the Directa PDF account snapshot.
          </p>
        </div>
        <DirectaUpload />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">CEO Tracker Baseline</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Imports the CEO-approved workbook as the current approved baseline.
          </p>
        </div>
        <TrackerUpload />
      </section>
    </div>
  );
}
