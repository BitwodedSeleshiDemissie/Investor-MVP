import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { env } from "@/lib/env";

export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <DashboardShell role={session.role} investorName={env.INVESTOR_NAME} portfolioId={env.PORTFOLIO_ID}>
      {children}
    </DashboardShell>
  );
}
