import { redirect } from "next/navigation";
import { cleanDisplayName, getSession } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getFundSettings } from "@/server/fund-settings";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");
  const settings = await getFundSettings();

  return (
    <DashboardShell role="admin" investorName="Admin" portfolioId={cleanDisplayName(settings.portfolioId)}>
      {children}
    </DashboardShell>
  );
}
