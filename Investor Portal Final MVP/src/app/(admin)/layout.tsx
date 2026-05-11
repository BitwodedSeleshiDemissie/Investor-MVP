import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { env } from "@/lib/env";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");

  return (
    <DashboardShell role="admin" investorName="Admin" portfolioId={env.PORTFOLIO_ID}>
      {children}
    </DashboardShell>
  );
}
