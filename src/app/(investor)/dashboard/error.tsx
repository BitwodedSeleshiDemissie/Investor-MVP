"use client";

import { AlertTriangle } from "lucide-react";

interface ErrorPageProps {
  error: Error;
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorPageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground mb-2">Errore nel caricamento</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error.message || "Impossibile caricare i dati del portfolio. Verifica la connessione al database."}
        </p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Riprova
      </button>
    </div>
  );
}
