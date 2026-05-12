"use client";

import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, X, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { formatEur } from "@/lib/utils";

interface UploadResult {
  ok: boolean;
  cutoffDate: string;
  snapshotId: number;
  auditFileName: string;
  filesStored: number;
  newFiles: string[];
  portfolioValue: number;
  directaCash: number;
  holdingsCount: number;
  warnings: string[];
}

export default function UploadSnapshotPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(incoming: FileList | null) {
    if (!incoming) return;
    const csvs = Array.from(incoming).filter((f) => f.name.endsWith(".csv"));
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...csvs.filter((f) => !existing.has(f.name))];
    });
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setStatus("uploading");
    setResult(null);
    setErrorMsg("");

    const form = new FormData();
    for (const f of files) form.append("files", f);

    try {
      const resp = await fetch("/api/admin/upload-snapshot", { method: "POST", body: form });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
      setResult(json as UploadResult);
      setStatus("done");
      setFiles([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Upload Monthly Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload statement CSVs - new files are stored and merged with existing history
          </p>
        </div>
      </div>

      {/* Instructions */}
      <div
        className="rounded-2xl border border-border/60 p-5 text-sm text-muted-foreground space-y-1"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <p className="font-semibold text-foreground text-sm mb-2">How this works</p>
        <p>- Each month, upload the new <span className="font-mono text-xs bg-secondary/60 px-1 rounded">Estratto Conto YYYY-MM-DD.csv</span> statement file.</p>
        <p>- Previously uploaded files are stored, so you only need to add new ones each month.</p>
        <p>- The app processes the full accumulated history and writes a new portfolio snapshot.</p>
        <p>- It also stores a downloadable audit workbook for that snapshot.</p>
        <p>- First time? Upload all historical CSVs at once.</p>
      </div>

      {/* Drop zone */}
      <div
        className="rounded-2xl border-2 border-dashed border-border/60 p-8 text-center transition-colors hover:border-primary/40 cursor-pointer"
        style={{ background: "hsl(var(--card))" }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Upload className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground">Drop CSV files here or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">Estratto Conto YYYY-MM-DD.csv - multiple files accepted</p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 overflow-hidden"
          style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
        >
          <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between" style={{ background: "hsl(222 44% 7%)" }}>
            <p className="text-sm font-semibold text-foreground">{files.length} file{files.length > 1 ? "s" : ""} queued</p>
          </div>
          <ul className="divide-y divide-border/40">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                <FileText className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                <span className="font-mono text-xs text-foreground flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeFile(f.name)} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={files.length === 0 || status === "uploading"}
        className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: files.length > 0 && status !== "uploading" ? "hsl(var(--primary))" : undefined, color: "hsl(var(--primary-foreground))", border: "1px solid hsl(var(--primary))" }}
      >
        {status === "uploading" ? "Processing..." : `Upload ${files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""}` : "files"} & generate snapshot`}
      </button>

      {/* Result */}
      {status === "done" && result && (
        <div
          className="rounded-2xl border border-success/20 p-5 space-y-4"
          style={{ background: "hsl(var(--card))" }}
        >
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p className="font-semibold text-sm">Snapshot generated for {result.cutoffDate}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Portfolio value", value: formatEur(result.portfolioValue) },
              { label: "Statement cash", value: formatEur(result.directaCash) },
              { label: "Open positions", value: String(result.holdingsCount) },
              { label: "CSV files stored", value: String(result.filesStored) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-border/60 p-3" style={{ background: "hsl(222 35% 10%)" }}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
                <p className="font-numeric text-base font-bold text-foreground mt-1">{value}</p>
              </div>
            ))}
          </div>
          {result.newFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Stored: {result.newFiles.join(", ")}
            </p>
          )}
          {result.snapshotId && result.auditFileName && (
            <a
              href={`/api/admin/snapshot-artifacts/${result.snapshotId}`}
              className="inline-flex items-center justify-center rounded-xl border border-border/60 px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary/40 transition-colors"
            >
              Download audit workbook: {result.auditFileName}
            </a>
          )}
          {result.warnings.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-warning">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="rounded-2xl border border-destructive/20 p-5 flex items-start gap-3" style={{ background: "hsl(var(--card))" }}>
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-destructive">Upload failed</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
