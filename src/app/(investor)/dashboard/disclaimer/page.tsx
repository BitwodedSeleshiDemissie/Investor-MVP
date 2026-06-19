export const dynamic = "force-dynamic";

import { FileText, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDisclaimerAcceptedAt } from "@/server/queries/disclaimer";
import { formatDate } from "@/lib/utils";

const CLAUSES = [
  {
    n: 1,
    title: "Purpose of the Portal",
    text: 'This portal is provided by Ariete Capital S.r.l. ("Ariete Capital", the "Company") for the convenience of its shareholders only. It is intended solely as an informational snapshot of the Company\'s portfolio and does not constitute an official statement of account, a financial statement, a capital account statement, a net asset value calculation, or a report prepared in accordance with any accounting or regulatory standard.',
  },
  {
    n: 2,
    title: "Unaudited Figures",
    text: "All figures, valuations and performance data displayed on this portal are unaudited. They have not been reviewed, verified or certified by any auditor, independent expert or supervisory authority and may differ, even materially, from the figures resulting from the Company's audited or statutory financial statements (Bilancio d'esercizio).",
  },
  {
    n: 3,
    title: "Timeliness of Information",
    text: "The information displayed may be out of date at any time. Data is updated periodically and not in real time. Ariete Capital makes no representation that the information shown reflects the current value or composition of the portfolio and assumes no obligation to update, correct or supplement any information displayed.",
  },
  {
    n: 4,
    title: "Dependence on Company P&L",
    text: "The values shown are referable to the overall economic results of the Company and may change as a consequence of the Company's profit and loss, which is determined not only by its financial holdings but also by its operating and commercial activities, costs, liabilities, taxes and other items unrelated to the portfolio itself. Portfolio performance shown on this portal therefore does not correspond to, and should not be read as, the return attributable to any individual investor or class of quotas.",
  },
  {
    n: 5,
    title: "Valuation of Unlisted Holdings",
    text: "All non-listed holdings are accounted for at their cost of acquisition. Such holdings are not marked to market and may not have been impaired or written up to reflect unrealized capital losses or unrealized capital gains. The actual realizable value of any unlisted holding may be significantly higher or lower than the value displayed, and no assurance is given that any holding could be sold at the value shown, or at all.",
  },
  {
    n: 6,
    title: "Source of Data",
    text: "Portfolio information relating to listed instruments is sourced from the Company's account held with Directa SIM S.p.A. Ariete Capital does not independently verify data provided by Directa or any other third party and accepts no responsibility for errors, omissions, delays or interruptions in such data. Directa is not responsible for the content of this portal.",
  },
  {
    n: 7,
    title: "No Offer, No Advice",
    text: "Nothing on this portal constitutes, or may be construed as, an offer to sell or a solicitation to buy any financial instrument, investment advice, legal, tax, accounting or immigration advice, or a personal recommendation. Investors should consult their own professional advisers before taking any decision based on the information displayed.",
  },
  {
    n: 8,
    title: "No Reliance",
    text: 'The information on this portal is provided "as is" and "as available", without warranty of any kind, express or implied, including as to accuracy, completeness, reliability or fitness for any purpose. Investors must not rely on this portal for any investment, divestment, tax, reporting or other decision. The only authoritative records are the Company\'s official corporate books, audited financial statements and formal communications issued by the Company.',
  },
  {
    n: 9,
    title: "Past Performance and Forward-Looking Information",
    text: "Past performance is not a reliable indicator of future results. Any projection, estimate or forward-looking statement is inherently uncertain, is based on assumptions that may prove incorrect, and may not be realized. Values may go down as well as up, and investors may lose part or all of the capital invested.",
  },
  {
    n: 10,
    title: "Currency and Rounding",
    text: "Values may be expressed in Euro or converted from other currencies at indicative exchange rates. Figures may be affected by rounding, currency fluctuations and timing differences.",
  },
  {
    n: 11,
    title: "Limitation of Liability",
    text: "To the maximum extent permitted by applicable law, Ariete Capital, its directors, officers, employees, advisers and service providers accept no liability for any direct or indirect loss or damage arising from access to, use of, reliance on, or inability to access this portal or its contents, including losses caused by errors, omissions, delays or interruptions in the data displayed.",
  },
  {
    n: 12,
    title: "Confidentiality",
    text: "The contents of this portal are confidential, are intended exclusively for the registered investor, and may not be reproduced, distributed or disclosed to third parties without the prior written consent of Ariete Capital.",
  },
  {
    n: 13,
    title: "No Regulatory Endorsement",
    text: "The information on this portal has not been approved or reviewed by CONSOB, Banca d'Italia or any other supervisory authority. This portal is not a prospectus or offering document.",
  },
  {
    n: 14,
    title: "Prevailing Documents",
    text: "In case of any conflict between the information displayed on this portal and the Company's statutory documents, audited financial statements, subscription agreements or official written communications, the latter shall prevail in all cases.",
  },
  {
    n: 15,
    title: "Governing Law",
    text: "This disclaimer and the use of the portal are governed by Italian law. Any dispute shall be subject to the exclusive jurisdiction of the Courts of Turin (Foro di Torino).",
  },
];

export default async function DisclaimerPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const acceptedAt = session.email
    ? await getDisclaimerAcceptedAt(session.email)
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-lg bg-primary/10">
          <FileText className="w-3.5 h-3.5 text-primary" />
        </div>
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          Investor Portal Disclaimer
        </h1>
      </div>

      {/* Acceptance badge */}
      {acceptedAt && (
        <div
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-border/60"
          style={{ background: "hsl(var(--card))" }}
        >
          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">
            You accepted this disclaimer on{" "}
            <span className="text-foreground font-medium">
              {formatDate(acceptedAt.toISOString())}
            </span>
            .
          </p>
        </div>
      )}

      {/* Disclaimer text */}
      <section
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b border-border/60"
          style={{ background: "hsl(222 44% 7%)" }}
        >
          <div className="p-1.5 rounded-lg bg-primary/10">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">
            Ariete Capital S.r.l. — Investor Portal Disclaimer
          </h2>
        </div>

        <div className="px-5 py-5 space-y-5">
          {CLAUSES.map((clause) => (
            <div key={clause.n}>
              <p className="text-xs font-semibold text-foreground mb-1.5">
                <span className="text-primary mr-1">{clause.n}.</span>
                {clause.title}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {clause.text}
              </p>
            </div>
          ))}

          <div className="pt-4 border-t border-border/40">
            <p className="text-xs font-medium text-foreground leading-relaxed">
              By accessing this portal, you acknowledge that you have read, understood and accepted this disclaimer in full.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
