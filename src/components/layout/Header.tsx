"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";
import type { Role } from "@/lib/auth";

interface HeaderProps {
  role: Role;
  investorName?: string;
  portfolioId?: string;
}

export function Header({ role, investorName, portfolioId }: HeaderProps) {
  return (
    <header
      className="border-b border-border/60 bg-card/80 backdrop-blur-xl sticky top-0 z-50"
      style={{ boxShadow: "0 1px 0 hsl(210 25% 96% / 0.04)" }}
    >
      <div className="w-full px-5 sm:px-7 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center">
          <img src="/icon.png" alt="Ariete" className="h-8 w-8 rounded-xl object-cover shadow-gold" />
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 h-8 px-3 rounded-lg bg-secondary/60 border border-border/50">
            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-primary">
                {(investorName ?? "U")[0].toUpperCase()}
              </span>
            </div>
            <div className="hidden xs:block leading-none">
              <p className="text-xs font-medium text-foreground leading-none">{investorName ?? "User"}</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                {role === "admin" ? "Administrator" : portfolioId}
              </p>
            </div>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
