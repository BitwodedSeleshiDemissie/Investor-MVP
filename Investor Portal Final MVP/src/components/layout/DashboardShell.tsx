import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import type { Role } from "@/lib/auth";

interface DashboardShellProps {
  children: React.ReactNode;
  role: Role;
  investorName?: string;
  portfolioId?: string;
}

export function DashboardShell({ children, role, investorName, portfolioId }: DashboardShellProps) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header role={role} investorName={investorName} portfolioId={portfolioId} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar role={role} />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
