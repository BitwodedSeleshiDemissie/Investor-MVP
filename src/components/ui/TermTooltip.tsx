"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TermTooltipProps {
  definition: string;
}

type OpenMode = "hover" | "click";

export function TermTooltip({ definition }: TermTooltipProps) {
  const tooltipId = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<OpenMode>("hover");
  const [style, setStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  const calcStyle = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const width = 260;
    const gap = 10;
    const margin = 8;
    const preferAbove = rect.top > 140;
    const left = Math.max(width / 2 + margin, Math.min(rect.left + rect.width / 2, window.innerWidth - width / 2 - margin));

    setStyle({
      position: "fixed",
      left,
      top: preferAbove ? rect.top - gap : rect.bottom + gap,
      transform: preferAbove ? "translateX(-50%) translateY(-100%)" : "translateX(-50%)",
      width,
      zIndex: 9999,
      ["--caret-top" as string]: preferAbove ? "auto" : "-5px",
      ["--caret-bottom" as string]: preferAbove ? "-5px" : "auto",
      ["--caret-border-top" as string]: preferAbove ? "0" : "1px solid hsl(38 95% 52% / 0.4)",
      ["--caret-border-bottom" as string]: preferAbove ? "1px solid hsl(38 95% 52% / 0.4)" : "0",
    });
  }, []);

  const show = useCallback((nextMode: OpenMode) => {
    setMode(nextMode);
    calcStyle();
    setOpen(true);
  }, [calcStyle]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!btnRef.current?.contains(event.target as Node)) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, hide]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", calcStyle, { passive: true });
    window.addEventListener("resize", calcStyle, { passive: true });
    return () => {
      window.removeEventListener("scroll", calcStyle);
      window.removeEventListener("resize", calcStyle);
    };
  }, [open, calcStyle]);

  function handlePointerEnter(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && !open) {
      show("hover");
    }
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && mode === "hover") {
      hide();
    }
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (open && mode === "click") {
      hide();
      return;
    }
    show("click");
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        aria-label="What does this mean?"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className={[
          "w-4 h-4 shrink-0 rounded-full inline-flex items-center justify-center",
          "border transition-all duration-150 cursor-help",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          open
            ? "bg-primary/20 border-primary/70 text-primary"
            : "bg-primary/10 border-primary/45 text-primary hover:bg-primary/20 hover:border-primary/70",
        ].join(" ")}
      >
        <span className="text-[8px] font-black leading-none select-none">?</span>
      </button>

      {mounted && open && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          style={{
            ...style,
            background: "hsl(222 44% 6% / 0.98)",
            border: "1px solid hsl(38 95% 52% / 0.4)",
            borderRadius: 12,
            padding: "11px 14px",
            fontSize: 12,
            lineHeight: 1.7,
            color: "hsl(var(--muted-foreground))",
            boxShadow: [
              "0 12px 40px rgba(0,0,0,0.7)",
              "0 0 24px hsl(38 95% 52% / 0.22)",
              "0 0 0 1px hsl(38 95% 52% / 0.12)",
            ].join(", "),
            backdropFilter: "blur(12px)",
            pointerEvents: "none",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: "var(--caret-top)",
              bottom: "var(--caret-bottom)",
              left: "50%",
              transform: "translateX(-50%) rotate(45deg)",
              display: "block",
              width: 9,
              height: 9,
              background: "hsl(222 44% 6%)",
              borderLeft: "var(--caret-border-top)",
              borderTop: "var(--caret-border-top)",
              borderRight: "1px solid hsl(38 95% 52% / 0.4)",
              borderBottom: "var(--caret-border-bottom)",
            }}
          />
          {definition}
        </div>,
        document.body
      )}
    </>
  );
}
