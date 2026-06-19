import { redirect } from "next/navigation";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getFundSettings } from "@/server/fund-settings";
import { hasAcceptedDisclaimer } from "@/server/queries/disclaimer";

export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const investorName = cleanDisplayName(session.investorName) ?? "Investor";
  const settings = await getFundSettings();
  const portfolioId = cleanDisplayName(settings.portfolioId);

  const showDisclaimer = session.email
    ? !(await hasAcceptedDisclaimer(session.email))
    : false;

  return (
    <DashboardShell
      role={session.role}
      investorName={investorName}
      portfolioId={portfolioId}
      showDisclaimer={showDisclaimer}
    >
      {children}
    </DashboardShell>
  );
}
