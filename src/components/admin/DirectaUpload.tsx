"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";

type ManualItem = {
  item_key: string;
  display_name: string;
  item_type: string;
  subcategory: string | null;
  value: string;
};

type ConfirmResult = {
  snapshotId: number;
  cutoffDate: string;
  portfolioValue: number;
  fundIrr: number | null;
  directaListed: number;
  directaCash: number;
  nonDirectaTotal: number;
  aiSummary: string;
  canPublish: boolean;
  checks: Array<{
    severity: "ok" | "warning" | "blocker";
    title: string;
    detail: string;
  }>;
};

type DuplicateFile = {
  originalFilename: string;
  canonicalFilename: string;
  duplicateKind: "exact_file" | "same_name";
  batchId: number;
  filename: string;
  monthEnd: string | null;
  uploadedAt: string;
  status: string;
};

type DuplicatePrompt = {
  mode: "block" | "confirm";
  files: DuplicateFile[];
};

function fmt(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function monthToLastDay(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  const last = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(ym: string, offset: number): string {
  const [year, month] = ym.split("-").map(Number);
  const d = new Date(year, month - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

function formatShortMonthLabel(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

function adjacentMonths(anchor: string): string[] {
  return [shiftMonth(anchor, -1), anchor, shiftMonth(anchor, 1)];
}

function parseAiSummary(summary: string): { bullets: string[]; verdict: string } {
  const lines = summary
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let verdictIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("Ready to publish") || lines[i].startsWith("Needs manual")) {
      verdictIdx = i;
      break;
    }
  }
  if (verdictIdx >= 0) {
    return { bullets: lines.slice(0, verdictIdx), verdict: lines[verdictIdx] };
  }
  return { bullets: lines.slice(0, -1), verdict: lines.at(-1) ?? "" };
}

export function DirectaUpload() {
  const router = useRouter();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [files, setFiles] = useState<File[]>([]);
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [defaultsStatus, setDefaultsStatus] = useState<"loading" | "loaded" | "error">("loading");

  const [status, setStatus] = useState<"idle" | "uploading" | "confirm" | "published" | "error">("idle");
  const [publishStatus, setPublishStatus] = useState<"idle" | "publishing">("idle");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null);

  function setMonth(ym: string) {
    if (/^\d{4}-\d{2}$/.test(ym)) setSelectedMonth(ym);
  }

  function openMonthPicker() {
    const picker = monthInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!picker?.showPicker) {
      monthInputRef.current?.focus();
      return;
    }
    try {
      picker.showPicker();
    } catch {
      monthInputRef.current?.focus();
    }
  }

  useEffect(() => {
    fetch("/api/admin/manual-defaults")
      .then((r) => r.json())
      .then((data: { items?: { item_key: string; display_name: string; item_type: string; subcategory: string | null; latest_value: string | null }[] }) => {
        const items: ManualItem[] = (data.items ?? []).map((row) => ({
          item_key: row.item_key,
          display_name: row.display_name,
          item_type: row.item_type,
          subcategory: row.subcategory,
          value: row.latest_value ?? "0",
        }));
        setManualItems(items);
        setDefaultsStatus("loaded");
      })
      .catch(() => setDefaultsStatus("error"));
  }, []);

  const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
  const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith(".pdf"));

  function updateFiles(nextFiles: File[]) {
    setFiles(nextFiles);
    setStatus("idle");
    setErrorMsg("");
    setResult(null);
    setDuplicatePrompt(null);
  }

  function handleCsvFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const csvs = [...list].filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (csvs.length === 0) {
      setErrorMsg("Only Directa CSV files are accepted in this section.");
      setStatus("error");
      return;
    }
    if (csvs.length !== list.length) {
      setErrorMsg("Move the PDF to the Directa PDF section.");
      setStatus("error");
      return;
    }
    updateFiles([...pdfFiles, ...csvs]);
  }

  function handlePdfFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const pdfs = [...list].filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0 || pdfs.length !== list.length) {
      setErrorMsg("Only the Directa Situazione Patrimoniale PDF is accepted in this section.");
      setStatus("error");
      return;
    }
    updateFiles([...csvFiles, pdfs[pdfs.length - 1]]);
  }

  function setItemValue(item_key: string, value: string) {
    setManualItems((prev) =>
      prev.map((item) => (item.item_key === item_key ? { ...item, value } : item))
    );
  }

  async function checkDuplicates(): Promise<DuplicateFile[]> {
    const form = new FormData();
    for (const file of csvFiles) form.append("files", file);
    const resp = await fetch("/api/admin/directa-duplicates", { method: "POST", body: form });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
    return Array.isArray(json.duplicates) ? json.duplicates : [];
  }

  async function handleProcess(options: { skipDuplicateCheck?: boolean } = {}) {
    if (csvFiles.length === 0 || pdfFiles.length === 0) {
      setErrorMsg("Upload both Directa CSV transaction files and the Directa PDF account snapshot.");
      setStatus("error");
      return;
    }
    setStatus("uploading");
    setErrorMsg("");
    setResult(null);
    setDuplicatePrompt(null);

    try {
      if (!options.skipDuplicateCheck) {
        const duplicates = await checkDuplicates();
        const exactDuplicates = duplicates.filter((item) => item.duplicateKind === "exact_file");
        if (exactDuplicates.length > 0) {
          setDuplicatePrompt({ mode: "block", files: exactDuplicates });
          setStatus("idle");
          return;
        }
        if (duplicates.length > 0) {
          setDuplicatePrompt({ mode: "confirm", files: duplicates });
          setStatus("idle");
          return;
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return;
    }

    const form = new FormData();
    for (const file of [...csvFiles, ...pdfFiles]) form.append("files", file);
    form.append("cutoffDateOverride", monthToLastDay(selectedMonth));
    form.append(
      "manualInputs",
      JSON.stringify(
        manualItems.map((item) => ({
          item_key: item.item_key,
          item_type: item.item_type,
          display_name: item.display_name,
          subcategory: item.subcategory,
          value: Number(item.value) || 0,
        }))
      )
    );

    try {
      const resp = await fetch("/api/admin/upload-snapshot", { method: "POST", body: form });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
      setResult({
        snapshotId: json.snapshotId,
        cutoffDate: json.cutoffDate,
        portfolioValue: json.portfolioValue,
        fundIrr: json.fundIrr ?? null,
        directaListed: json.directaListed ?? 0,
        directaCash: json.directaCash ?? 0,
        nonDirectaTotal: json.nonDirectaTotal ?? 0,
        aiSummary: json.aiSummary ?? "",
        canPublish: json.canPublish !== false,
        checks: Array.isArray(json.checks) ? json.checks : [],
      });
      setFiles([]);
      setStatus("confirm");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  async function handlePublish() {
    if (!result?.snapshotId || !result.canPublish) return;
    setPublishStatus("publishing");
    setErrorMsg("");
    try {
      const resp = await fetch("/api/admin/publish-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshotId: result.snapshotId,
          approvalNote: "Admin reviewed and accepted snapshot via upload form.",
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
      setStatus("published");
      setResult(null);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setPublishStatus("idle");
    }
  }

  const nonListedItems = manualItems.filter((item) => item.item_type.toLowerCase() !== "cash");
  const participationItems = nonListedItems.filter(
    (item) => item.item_key.startsWith("PRIVATE_PARTICIPATION_") || (item.subcategory ?? "").toLowerCase().includes("participation")
  );
  const loanItems = nonListedItems.filter(
    (item) => item.item_key.startsWith("PRIVATE_LOAN_") || (item.subcategory ?? "").toLowerCase().includes("loan")
  );
  const otherNonListedItems = nonListedItems.filter(
    (item) => !participationItems.includes(item) && !loanItems.includes(item)
  );
  const cashItems = manualItems.filter((item) => item.item_type.toLowerCase() === "cash");

  function renderManualGroup(title: string, items: ManualItem[]) {
    if (items.length === 0) return null;
    return (
      <>
        <div className="px-4 py-2 bg-secondary/20 border-t border-border/30 first:border-t-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</span>
        </div>
        {items.map((item) => (
          <div key={item.item_key} className="flex items-center gap-3 px-4 py-2.5 border-t border-border/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{item.display_name}</p>
              {item.subcategory && <p className="text-[10px] text-muted-foreground">{item.subcategory}</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">EUR</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={item.value}
                onChange={(e) => setItemValue(item.item_key, e.target.value)}
                className="w-32 rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-xs font-numeric text-right text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Snapshot month
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(selectedMonth, -1))}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            aria-label="Previous month"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={openMonthPicker}
            className="flex h-10 min-w-[12rem] items-center justify-center gap-2 rounded-lg border border-border/60 bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/40"
          >
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {formatMonthLabel(selectedMonth)}
          </button>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(selectedMonth, 1))}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            aria-label="Next month"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <input
            ref={monthInputRef}
            type="month"
            value={selectedMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="sr-only"
            aria-label="Snapshot month"
          />
        </div>
        <div className="grid max-w-2xl grid-cols-3 gap-2">
          {adjacentMonths(currentYearMonth()).map((month) => {
            const selected = month === selectedMonth;
            return (
              <button
                key={month}
                type="button"
                onClick={() => setMonth(month)}
                className={`h-9 rounded-lg border px-2 text-xs font-semibold transition-colors ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                {formatShortMonthLabel(month)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="rounded-2xl border-2 border-dashed border-border/60 p-6 text-center transition-colors hover:border-primary/40 cursor-pointer"
          style={{ background: "hsl(var(--card))" }}
          onClick={() => csvInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleCsvFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={(e) => handleCsvFiles(e.target.files)}
          />
          <Upload className="w-7 h-7 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">Directa CSV exports</p>
          <p className="text-xs text-muted-foreground mt-1">Transactions, income, and activity history</p>
          <p className="mt-3 text-[11px] text-muted-foreground">{csvFiles.length} selected</p>
        </div>

        <div
          className="rounded-2xl border-2 border-dashed border-border/60 p-6 text-center transition-colors hover:border-primary/40 cursor-pointer"
          style={{ background: "hsl(var(--card))" }}
          onClick={() => pdfInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handlePdfFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => handlePdfFiles(e.target.files)}
          />
          <FileSpreadsheet className="w-7 h-7 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">Directa PDF snapshot</p>
          <p className="text-xs text-muted-foreground mt-1">Liquidity, listed positions, market values, ISINs</p>
          <p className="mt-3 text-[11px] text-muted-foreground">{pdfFiles.length > 0 ? pdfFiles[0].name : "Required"}</p>
        </div>
      </div>

      {(csvFiles.length > 0 || pdfFiles.length > 0) && (
        <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "hsl(var(--card))" }}>
          {[...csvFiles, ...pdfFiles].map((file) => (
            <div key={`${file.name}-${file.size}`} className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0">
              <FileSpreadsheet className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <span className="font-mono text-xs text-foreground flex-1 truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
            </div>
          ))}
          <button
            onClick={() => { setFiles([]); setStatus("idle"); setResult(null); setDuplicatePrompt(null); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear selection
          </button>
        </div>
      )}

      {duplicatePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border border-border/70 overflow-hidden"
            style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
              <h3 className="text-sm font-bold text-foreground">
                {duplicatePrompt.mode === "block" ? "File already uploaded" : "File name already exists"}
              </h3>
              <button
                onClick={() => setDuplicatePrompt(null)}
                className="rounded-lg p-1.5 text-muted-foreground/60 hover:bg-secondary/50 hover:text-foreground"
                aria-label="Close duplicate warning"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className={`rounded-xl border px-3 py-2.5 text-xs ${
                duplicatePrompt.mode === "block"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-warning/30 bg-warning/10 text-warning"
              }`}>
                <p className="font-semibold">
                  {duplicatePrompt.mode === "block"
                    ? "This exact Directa file has already been imported."
                    : "A Directa file with the same name was already imported."}
                </p>
                <p className="mt-1 leading-relaxed opacity-90">
                  {duplicatePrompt.mode === "block"
                    ? "Remove the duplicate file before processing."
                    : "Continue only if this is a corrected export; the previous file with this name will be superseded."}
                </p>
              </div>

              <div className="space-y-2">
                {duplicatePrompt.files.map((item) => (
                  <div key={`${item.duplicateKind}-${item.batchId}-${item.originalFilename}`} className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
                    <p className="font-mono text-xs text-foreground break-all">{item.originalFilename}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Existing batch #{item.batchId}
                      {item.monthEnd ? ` · ${item.monthEnd}` : ""}
                      {item.uploadedAt ? ` · ${new Date(item.uploadedAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => setDuplicatePrompt(null)}
                className="flex-1 rounded-xl border border-border/60 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary/40 transition-colors"
              >
                Cancel
              </button>
              {duplicatePrompt.mode === "confirm" && (
                <button
                  onClick={() => handleProcess({ skipDuplicateCheck: true })}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-opacity"
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {defaultsStatus === "loaded" && manualItems.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "hsl(var(--card))" }}>
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-xs font-semibold text-foreground">Manual non-Directa items</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Pre-filled from last known values. Confirm or edit before processing.
            </p>
          </div>

          {(nonListedItems.length > 0 || cashItems.length > 0) && (
            <>
              {renderManualGroup("Participations", participationItems)}
              {renderManualGroup("Private loan principal", loanItems)}
              {renderManualGroup("Other non-Directa values", otherNonListedItems)}
              {renderManualGroup("Cash outside brokerage", cashItems)}
            </>
          )}

          <div className="px-4 py-3 border-t border-border/30 bg-secondary/10">
            <p className="text-[11px] text-muted-foreground">
              Cash outside brokerage is pre-filled from the last approved value. Confirm or edit before processing.
            </p>
          </div>
        </div>
      )}

      {defaultsStatus === "loading" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading manual item defaults...
        </div>
      )}

      <button
        onClick={() => handleProcess()}
        disabled={csvFiles.length === 0 || pdfFiles.length === 0 || status === "uploading" || defaultsStatus === "loading"}
        className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background:
            csvFiles.length > 0 && pdfFiles.length > 0 && status !== "uploading" && defaultsStatus !== "loading"
              ? "hsl(var(--primary))"
              : undefined,
          color: "hsl(var(--primary-foreground))",
          border: "1px solid hsl(var(--primary))",
        }}
      >
        {status === "uploading"
          ? "Processing..."
          : defaultsStatus === "loading"
          ? "Loading defaults..."
          : "Process"}
      </button>

      {status === "published" && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-success/20 text-success text-sm" style={{ background: "hsl(var(--card))" }}>
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          Snapshot published. Investor portal now shows the latest month.
        </div>
      )}

      {status === "error" && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-destructive/20 text-destructive text-sm" style={{ background: "hsl(var(--card))" }}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {errorMsg || "Upload failed."}
        </div>
      )}

      {status === "uploading" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border/70 p-6 text-center" style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
            <Loader2 className="mx-auto mb-4 h-7 w-7 animate-spin text-primary" />
            <h3 className="text-base font-bold text-foreground">Building snapshot</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Parsing Directa statements, applying manual items, running checks...
            </p>
          </div>
        </div>
      )}

      {status === "confirm" && result && (() => {
        const { bullets, verdict } = parseAiSummary(result.aiSummary);
        const blockers = result.checks.filter((check) => check.severity === "blocker");
        const warnings = result.checks.filter((check) => check.severity === "warning");
        const isReady = result.canPublish && blockers.length === 0;
        const statusText = blockers.length > 0
          ? `Blocked: ${blockers[0].title}`
          : verdict || (result.canPublish ? "Ready to publish." : "Needs manual attention.");
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border/70 overflow-hidden" style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
                <h3 className="text-sm font-bold text-foreground">Snapshot -- {result.cutoffDate}</h3>
                <button
                  onClick={() => setStatus("idle")}
                  className="rounded-lg p-1.5 text-muted-foreground/60 hover:bg-secondary/50 hover:text-foreground"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-2">
                {[
                  { label: "Total NAV", value: fmt(result.portfolioValue) },
                  { label: "Fund IRR", value: fmtPct(result.fundIrr) },
                  { label: "Listed holdings (Directa)", value: fmt(result.directaListed) },
                  { label: "Brokerage account cash", value: fmt(result.directaCash) },
                  { label: "Non-listed + cash outside brokerage", value: fmt(result.nonDirectaTotal) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-xs font-semibold font-numeric text-foreground">{value}</span>
                  </div>
                ))}
              </div>

              {bullets.length > 0 && (
                <div className="px-5 pb-3 space-y-1.5 border-t border-border/40 pt-3">
                  {bullets.map((bullet, i) => (
                    <p key={i} className="text-xs text-muted-foreground leading-relaxed">{bullet}</p>
                  ))}
                </div>
              )}

              {(blockers.length > 0 || warnings.length > 0) && (
                <div className="mx-5 mb-4 space-y-2">
                  {[...blockers, ...warnings].map((check) => (
                    <div
                      key={`${check.severity}-${check.title}`}
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        check.severity === "blocker"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-warning/30 bg-warning/10 text-warning"
                      }`}
                    >
                      <p className="font-semibold">{check.title}</p>
                      <p className="mt-1 leading-relaxed opacity-90">{check.detail}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className={`mx-5 mb-4 px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                isReady
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-warning/30 bg-warning/10 text-warning"
              }`}>
                {isReady
                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                {statusText}
              </div>

              <div className="flex gap-3 px-5 pb-5">
                <button
                  onClick={() => setStatus("idle")}
                  className="flex-1 rounded-xl border border-border/60 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePublish}
                  disabled={publishStatus === "publishing" || !result.canPublish}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {publishStatus === "publishing"
                    ? "Publishing..."
                    : result.canPublish
                      ? "Accept & Publish"
                      : "Cannot Publish"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
