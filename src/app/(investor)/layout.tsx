import { redirect } from "next/navigation";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getFundSettings } from "@/server/fund-settings";

export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const investorName = cleanDisplayName(session.investorName) ?? "Investor";
  const settings = await getFundSettings();
  const portfolioId = cleanDisplayName(settings.portfolioId);

  return (
    <DashboardShell role={session.role} investorName={investorName} portfolioId={portfolioId}>
      {children}
    </DashboardShell>
  );
}
