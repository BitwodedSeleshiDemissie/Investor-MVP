import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { TermTooltip } from "@/components/ui/TermTooltip";

interface KPICardProps {
  title: string;
  value: string;
  subvalue?: string;
  subvalueColor?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  variant?: "default" | "primary" | "success" | "warning";
  className?: string;
  tooltip?: string;
}

export function KPICard({
  title,
  value,
  subvalue,
  subvalueColor = "neutral",
  icon: Icon,
  variant = "default",
  className,
  tooltip,
}: KPICardProps) {
  const isPositive = subvalueColor === "positive";
  const isNegative = subvalueColor === "negative";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 transition-all duration-200",
        "hover:-translate-y-0.5",
        variant === "primary" && "border-primary/20 bg-gradient-gold-soft",
        variant === "success" && "border-success/15 bg-[hsl(150_60%_40%_/_0.06)]",
        variant === "warning" && "border-warning/15 bg-[hsl(38_95%_52%_/_0.06)]",
        variant === "default" && "border-border bg-card",
        className
      )}
      style={{ boxShadow: variant === "primary" ? "var(--shadow-gold)" : "var(--shadow-card)" }}
    >
      {/* Subtle top highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest leading-none">
              {title}
            </p>
            {tooltip && <TermTooltip definition={tooltip} />}
          </div>
          <p className={cn(
            "font-numeric text-2xl sm:text-3xl font-bold leading-none tracking-tight",
            variant === "primary" ? "text-gradient-gold" : "text-foreground"
          )}>
            {value}
          </p>
          {subvalue && (
            <div className={cn(
              "flex items-center gap-1 mt-2.5",
              isPositive && "text-success",
              isNegative && "text-destructive",
              !isPositive && !isNegative && "text-muted-foreground"
            )}>
              {isPositive && <TrendingUp className="w-3 h-3 shrink-0" />}
              {isNegative && <TrendingDown className="w-3 h-3 shrink-0" />}
              {!isPositive && !isNegative && <Minus className="w-3 h-3 shrink-0" />}
              <span className="text-xs font-medium leading-none">{subvalue}</span>
            </div>
          )}
        </div>

        <div className={cn(
          "shrink-0 p-2.5 rounded-xl",
          variant === "primary" && "bg-primary/20 text-primary",
          variant === "success" && "bg-success/15 text-success",
          variant === "warning" && "bg-warning/15 text-warning",
          variant === "default" && "bg-secondary/70 text-muted-foreground",
        )}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}
