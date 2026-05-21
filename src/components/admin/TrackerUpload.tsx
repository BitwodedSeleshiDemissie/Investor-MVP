"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";

export function TrackerUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File | null) {
    if (!f) return;
    if (!f.name.endsWith(".xlsx") && !f.name.endsWith(".xlsm")) {
      setErrorMsg("Only .xlsx or .xlsm files are accepted.");
      setStatus("error");
      return;
    }
    setFile(f);
    setStatus("idle");
    setErrorMsg("");
  }

  async function handleUpload() {
    if (!file) return;
    setStatus("uploading");
    setErrorMsg("");

    const form = new FormData();
    form.append("file", file);

    try {
      const resp = await fetch("/api/admin/upload", { method: "POST", body: form });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? `HTTP ${resp.status}`);
      setStatus("done");
      setFile(null);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl border-2 border-dashed border-border/60 p-8 text-center transition-colors hover:border-primary/40 cursor-pointer"
        style={{ background: "hsl(var(--card))" }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0] ?? null); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <Upload className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground">Drop CEO tracker here or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">Publishes the current approved baseline from Ariete_Capital_Investment_Tracker.xlsx</p>
      </div>

      {file && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/60" style={{ background: "hsl(var(--card))" }}>
          <span className="font-mono text-xs text-foreground flex-1 truncate">{file.name}</span>
          <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
          <button onClick={() => { setFile(null); setStatus("idle"); }} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={!file || status === "uploading"}
        className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: file && status !== "uploading" ? "hsl(var(--primary))" : undefined,
          color: "hsl(var(--primary-foreground))",
          border: "1px solid hsl(var(--primary))",
        }}
      >
        {status === "uploading" ? "Importing..." : "Import CEO tracker baseline"}
      </button>

      {status === "done" && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-success/20 text-success text-sm" style={{ background: "hsl(var(--card))" }}>
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          CEO tracker imported and published as the current approved baseline.
        </div>
      )}

      {status === "error" && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-destructive/20 text-destructive text-sm" style={{ background: "hsl(var(--card))" }}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {errorMsg || "Upload failed."}
        </div>
      )}
    </div>
  );
}
