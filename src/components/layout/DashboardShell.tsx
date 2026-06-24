import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { DisclaimerModal } from "@/components/DisclaimerModal";
import type { Role } from "@/lib/auth";

interface DashboardShellProps {
  children: React.ReactNode;
  role: Role;
  investorName?: string;
  portfolioId?: string;
  showDisclaimer?: boolean;
}

export function DashboardShell({ children, role, investorName, portfolioId, showDisclaimer }: DashboardShellProps) {
  return (
    <div className="flex flex-col h-screen bg-background">
      <Header role={role} investorName={investorName} portfolioId={portfolioId} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar role={role} />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {children}
        </main>
      </div>
      {showDisclaimer && <DisclaimerModal defaultOpen={true} />}
    </div>
  );
}
