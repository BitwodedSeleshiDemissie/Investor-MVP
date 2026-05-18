"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle2, AlertCircle, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

type Status = "idle" | "uploading" | "success" | "error";

export function TrackerUpload() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xlsm")) {
      setStatus("error");
      setMessage("Only .xlsx files are accepted.");
      return;
    }
    setFileName(file.name);
    setStatus("uploading");
    setMessage("");

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(data.message ?? "Upload successful.");
        // Refresh the page so server components re-read the new file
        router.refresh();
      } else {
        setStatus("error");
        setMessage(data.error ?? "Upload failed.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error — could not reach server.");
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const borderColor =
    status === "success" ? "border-success/40 bg-success/5" :
    status === "error"   ? "border-destructive/40 bg-destructive/5" :
    "border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/8";

  return (
    <div
      className="rounded-2xl border border-border/60 overflow-hidden"
      style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
        style={{ background: "hsl(222 44% 7%)" }}
      >
        <div className="p-1.5 rounded-lg bg-primary/10">
          <FileSpreadsheet className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Upload Investment Tracker</h2>
        <span className="ml-auto text-[11px] text-muted-foreground bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
          Primary workflow
        </span>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Update the Excel tracker (<span className="font-mono text-xs text-foreground">Ariete_Capital_Investment_Tracker.xlsx</span>) and upload it here.
          All dashboard numbers refresh instantly.
        </p>

        {/* Drop zone */}
        <div
          className={`relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${borderColor}`}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => status !== "uploading" && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            onChange={onInputChange}
            disabled={status === "uploading"}
          />

          <div className="flex flex-col items-center justify-center gap-3 py-10 px-5 text-center select-none">
            {status === "uploading" ? (
              <>
                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Uploading…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fileName}</p>
                </div>
              </>
            ) : status === "success" ? (
              <>
                <CheckCircle2 className="w-8 h-8 text-success" />
                <div>
                  <p className="text-sm font-semibold text-success">Uploaded successfully</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{fileName}</p>
                </div>
              </>
            ) : status === "error" ? (
              <>
                <AlertCircle className="w-8 h-8 text-destructive" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Upload failed</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
                </div>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Drop your tracker here, or <span className="text-primary">click to browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">.xlsx files only</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Success message */}
        {status === "success" && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-success/8 border border-success/20 text-success text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {message}
          </div>
        )}

        {/* Reset button after upload */}
        {(status === "success" || status === "error") && (
          <button
            onClick={() => { setStatus("idle"); setFileName(""); setMessage(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            Upload another file
          </button>
        )}
      </div>
    </div>
  );
}
