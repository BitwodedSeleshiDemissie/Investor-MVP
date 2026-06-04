import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { FundSettingsForm } from "@/components/admin/FundSettingsForm";
import { getFundSettings } from "@/server/fund-settings";

export default async function AdminSettingsPage() {
  const settings = await getFundSettings();

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground tracking-tight">Fund Settings</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Assumptions used by Directa snapshot calculations
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

      <FundSettingsForm settings={settings} />
    </div>
  );
}
