"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, TrendingUp, Building2, Wallet,
  Upload, Users, Menu, X, SlidersHorizontal, Eye, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  group?: string;
}

const investorNav: NavItem[] = [
  { icon: LayoutDashboard, label: "Overview",    href: "/dashboard",                group: "Portfolio" },
  { icon: TrendingUp,      label: "Listed",      href: "/dashboard/listed",         group: "Portfolio" },
  { icon: Building2,       label: "Non-Listed",  href: "/dashboard/non-listed",     group: "Portfolio" },
  { icon: Wallet,          label: "Cash",        href: "/dashboard/cash",           group: "Portfolio" },
  { icon: FileText,        label: "Disclaimer",  href: "/dashboard/disclaimer",     group: "Legal" },
];

const adminNav: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard",         href: "/admin",              group: "Management" },
  { icon: Upload,          label: "Upload Data",       href: "/admin/upload",       group: "Management" },
  { icon: Building2,       label: "Non-Listed Values", href: "/admin/non-listed",   group: "Data Entry" },
  { icon: Wallet,          label: "Cash & Liquidity",  href: "/admin/cash",         group: "Data Entry" },
  { icon: Users,           label: "Investors",         href: "/admin/investors",    group: "Data Entry" },
  { icon: Eye,             label: "See as user",       href: "/admin/see-as-user",  group: "Review" },
  { icon: SlidersHorizontal, label: "Fund Settings",   href: "/admin/settings",     group: "Foundation" },
];

function NavSection({ label, items, pathname, onNav }: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNav?: () => void;
}) {
  return (
    <div className="mb-4">
      <p className="px-3 mb-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNav}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                <item.icon className={cn(
                  "w-4 h-4 shrink-0",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                <span className="flex-1 leading-none">{item.label}</span>
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = role === "admin" ? adminNav : investorNav;
  const groups = [...new Set(items.map((i) => i.group ?? ""))];

  const NavContent = ({ onNav }: { onNav?: () => void }) => (
    <nav className="flex-1 px-2 py-4 overflow-y-auto">
      {groups.map((group) => (
        <NavSection
          key={group}
          label={group}
          items={items.filter((i) => i.group === group)}
          pathname={pathname}
          onNav={onNav}
        />
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex w-56 min-h-[calc(100vh-56px)] border-r border-border/50 flex-col shrink-0"
        style={{ background: "hsl(var(--sidebar-background))" }}
      >
        <NavContent />
      </aside>

      {/* Mobile FAB */}
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold"
      >
        <Menu className="w-5 h-5 text-white" />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside
            className="relative w-60 border-r border-border flex flex-col animate-slide-in"
            style={{ background: "hsl(var(--sidebar-background))" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <span className="text-sm font-semibold text-foreground">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <NavContent onNav={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
