import { ArrowUpRight, Eye, Users } from "lucide-react";
import Link from "next/link";
import { getInvestorProfiles } from "@/server/queries/admin";
import { formatEur } from "@/lib/utils";

export default async function SeeAsUserPage() {
  const profiles = await getInvestorProfiles();
  const activeProfiles = profiles.filter((profile) => profile.active);

  return (
    <div className="space-y-6 pb-10 animate-fade-in">
      <div className="pt-1">
        <h1 className="text-xl font-bold text-foreground tracking-tight">See as user</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Open an investor-facing view in a separate tab for review.
        </p>
      </div>

      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Eye className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Investor Views</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">{activeProfiles.length} active</span>
        </div>

        {activeProfiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <Users className="w-10 h-10 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No active investors configured</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {activeProfiles.map((profile) => (
              <div key={profile.name} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{profile.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {profile.investorType} - {formatEur(profile.capitalEur)}
                  </p>
                </div>
                <Link
                  href={`/dashboard?viewAs=${encodeURIComponent(profile.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Open view
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
