import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildAuditWorkbookBuffer } from "./audit-workbook";
import { computeComposition, computeKPIs, computeRisk } from "./calculations";

const marchStatement = `"Ariete Capital S.r.l.";2/04/2026;18:46:57
"Estratto Conto   dal";1/03/2026;"al";31/03/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/03/2026;;"Saldo Iniziale";"";;;;10000,00;
2/03/2026;4/03/2026;"ENEL";"06009525900043";5,00000;EUR;100;-500,00;-5,00
15/03/2026;17/03/2026;"ENEL";"Incasso Dividendi";;;;20,00;
20/03/2026;20/03/2026;"";"Conferimento";;;;1000,00;
`;

const aprilStatement = `"Ariete Capital S.r.l.";8/05/2026;11:59:00
"Estratto Conto   dal";1/04/2026;"al";30/04/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/04/2026;;"Saldo Iniziale";"";;;;10515,00;
5/04/2026;7/04/2026;"ISHARES FTSE MIB UCITS ETF EUR";"09117284865237";50,00000;EUR;10;-500,00;
10/04/2026;12/04/2026;"ENEL";"06009525900044";6,00000;EUR;-40;240,00;-2,00
12/04/2026;14/04/2026;"BOT ZC APR26 A EUR";"Cedola";;;;10,00;
`;

const aprilPositions = `"Ariete Capital S.r.l.";8/05/2026;11:59:11;;;;;;;;;;""
"titolo";;data;"Ora";"valuta";"protocollo/ordine";"quantita' ordine";"quantita'";"Prezzo";"Div";"Prezzo";"Cambio";"imp. EUR";"operazione";""
"ENEL";"ENEL";;;;"Saldo finale";;60;6,50000;EUR;;;390,00;;;;;
"ETF";"ISHARES FTSE MIB UCITS ETF EUR";;;;"Saldo finale";;10;55,00000;EUR;;;550,00;;;;;
`;

const settings = {
  riskFreeRate: 0.035,
  moicTarget: 2.0,
  targetEquityPct: 0.7,
  targetBondPct: 0.2,
  targetAltPct: 0.1,
};

function dateOnly(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

describe("Statement preprocessing MVP flow", () => {
  beforeAll(() => {
    vi.stubEnv("JWT_SECRET", "test-secret-at-least-sixteen-chars");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_SSL", "false");
  });

  it("builds a portfolio snapshot from uploaded CSV history without old Python or Excel files", async () => {
    const { buildWorkbookData, parseCsvFile, parsePositionCsvFile } = await import("./directa-preprocess");

    expect(parseCsvFile(marchStatement, "Estratto Conto 2026-03-31.csv")).toHaveLength(4);
    expect(parseCsvFile(aprilStatement, "Estratto Conto 2026-04-30.csv")).toHaveLength(4);
    expect(parsePositionCsvFile(aprilPositions, "Ec_X_8_05_2026.csv")).toHaveLength(2);

    const workbook = await buildWorkbookData(
      [
        { name: "Estratto Conto 2026-03-31.csv", content: marchStatement },
        { name: "Estratto Conto 2026-04-30.csv", content: aprilStatement },
        { name: "Ec_X_8_05_2026.csv", content: aprilPositions },
      ],
      { nonListedValue: 5_000, externalCash: 2_000, capitalCommitted: 100_000 }
    );

    expect(dateOnly(workbook.cutoffDate)).toBe("2026-04-30");
    expect(workbook.holdings).toHaveLength(2);
    expect(workbook.holdings.find((h) => h.security === "ENEL")).toMatchObject({
      shares: 60,
      currentPrice: 6.5,
      marketValue: 390,
      unrealizedPnl: 90,
    });
    expect(workbook.holdings.find((h) => h.security === "ISHARES FTSE MIB UCITS ETF EUR")).toMatchObject({
      shares: 10,
      currentPrice: 55,
      marketValue: 550,
      assetClass: "ETF/ETC",
    });

    const kpis = computeKPIs(workbook, settings);
    const composition = computeComposition(workbook);

    expect(kpis.totalPortfolioValue).toBeCloseTo(18_203, 6);
    expect(kpis.capitalCommitted).toBe(100_000);
    expect(kpis.totalIncome).toBeCloseTo(30, 6);
    expect(workbook.portfolioMetrics["Realized P&L"]).toBeCloseTo(38, 6);
    expect(composition).toEqual({
      listed: 940,
      nonListed: 5_000,
      cash: 12_263,
      total: 18_203,
    });

    const audit = buildAuditWorkbookBuffer(workbook);
    expect(audit.byteLength).toBeGreaterThan(10_000);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ariete-audit-"));
    const auditPath = path.join(tempDir, "audit.xlsx");
    fs.writeFileSync(auditPath, audit);
    const reloaded = XLSX.read(fs.readFileSync(auditPath), { type: "buffer" });

    expect(reloaded.SheetNames).toEqual(
      expect.arrayContaining(["Portfolio Metrics", "Holdings", "Trade Log", "IRR Analysis", "Monthly Returns"])
    );

    const risk = computeRisk(workbook, settings);
    expect(risk.annualizedReturn).toBeLessThan(1);
    expect(risk.volatilityAnnualized).toBeLessThan(1);
  });

  it("applies a new Estratto Conto month on top of the previous published snapshot without a positions CSV", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const workbook = await buildWorkbookData(
      [{ name: "Estratto Conto 2026-04-30.csv", content: aprilStatement }],
      {
        nonListedValue: 0,
        externalCash: 0,
        capitalCommitted: 100_000,
        previousSnapshot: {
          cutoffDate: "2026-03-31",
          totalPortfolioValue: 11_015,
          timeseries: [
            {
              monthEnd: "2026-03-31",
              nav: 11_015,
              normalized: 100,
              monthlyReturn: 0,
              cumulativeReturn: 0,
            },
          ],
          holdings: [
            {
              security: "ENEL",
              assetClass: "Stock",
              currency: "EUR",
              shares: 100,
              avgCost: 3,
              costBasis: 300,
              currentPrice: 5,
              marketValue: 500,
              unrealizedPnl: 200,
              pnlPct: 2 / 3,
              weight: 1,
            },
          ],
        },
      }
    );

    expect(dateOnly(workbook.cutoffDate)).toBe("2026-04-30");
    expect(workbook.holdings.find((h) => h.security === "ENEL")).toMatchObject({
      shares: 60,
      avgCost: 3,
      costBasis: 180,
      currentPrice: 6,
      marketValue: 360,
    });
    expect(workbook.holdings.find((h) => h.security === "ISHARES FTSE MIB UCITS ETF EUR")).toMatchObject({
      shares: 10,
      currentPrice: 50,
      marketValue: 500,
    });
    expect(workbook.portfolioMetrics["Statement Cash"]).toBeCloseTo(10_263, 6);
    expect(workbook.portfolioMetrics["Listed Market Value"]).toBeCloseTo(860, 6);
    expect(workbook.portfolioMetrics["Total Portfolio Value"]).toBeCloseTo(11_123, 6);
    expect(workbook.monthlyReturns).toHaveLength(2);
    expect(workbook.monthlyReturns.at(-1)?.monthlyReturn).toBeCloseTo(11_123 / 11_015 - 1, 8);
  });

  it("keeps Directa income gross by classifying withholding rows as tax", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const statement = `"Ariete Capital S.r.l.";1/05/2026;10:00:00
"Estratto Conto   dal";1/04/2026;"al";30/04/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/04/2026;;"Saldo Iniziale";"";;;;1000,00;
15/04/2026;15/04/2026;"ISHARES HIGH YLD CORP UCITS ET";"Provento Etf - IHYG";;;;100,00;
15/04/2026;15/04/2026;"ISHARES HIGH YLD CORP UCITS ET";"Rit.provento Etf - IHYG";;;;-26,00;
`;

    const workbook = await buildWorkbookData(
      [{ name: "Estratto Conto 2026-04-30.csv", content: statement }],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 100_000 }
    );

    expect(workbook.tradeLog.find((row) => row.netAmount === -26)?.type).toBe("Tax");
    expect(workbook.portfolioMetrics["Total Income (Div+Cpn+Dist)"]).toBe(100);
    expect(workbook.portfolioMetrics["Statement Cash"]).toBe(1_074);
  });

  it("values nominal bond quantities using quoted percent prices", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const statement = `"Ariete Capital S.r.l.";1/02/2026;10:00:00
"Estratto Conto   dal";1/01/2026;"al";31/01/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/01/2026;;"Saldo Iniziale";"";;;;100000,00;
10/01/2026;12/01/2026;"BOT ZC DEC25 A EUR";"V0001";99,50000;EUR;100000;-99500,00;
`;

    const positions = `"Ariete Capital S.r.l.";1/02/2026;10:01:00;;;;;;;;;;""
"titolo";;data;"Ora";"valuta";"protocollo/ordine";"quantita' ordine";"quantita'";"Prezzo";"Div";"Prezzo";"Cambio";"imp. EUR";"operazione";""
"BOT";"BOT ZC DEC25 A EUR";;;;"Saldo finale";;100000;99,70000;EUR;;;99700,00;;;;;
`;

    const workbook = await buildWorkbookData(
      [
        { name: "Estratto Conto 2026-01-31.csv", content: statement },
        { name: "Ec_X_1_02_2026.csv", content: positions },
      ],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 100_000 }
    );

    const bond = workbook.holdings.find((h) => h.security === "BOT ZC DEC25 A EUR");
    expect(bond).toMatchObject({
      assetClass: "Bond",
      shares: 100_000,
      currentPrice: 0.997,
      marketValue: 99_700,
      unrealizedPnl: 200,
    });
  });

  it("aggregates Directa split final-position rows and prefers Totale rows", async () => {
    const { parsePositionCsvFile } = await import("./directa-preprocess");

    const positions = `"Ariete Capital S.r.l.";8/05/2026;11:59:11;;;;;;;;;;""
"titolo";;data;"Ora";"valuta";"protocollo/ordine";"quantita' ordine";"quantita'";"Prezzo";"Div";"Prezzo";"Cambio";"imp. EUR";"operazione";""
"MONC";"MONCLER";;;;"Saldo finale";;2.982;51,24;EUR;;;152797,68;;;;;
"fondi a garanzia vendite scoperto";;;;;;;;;;;;"G"
"MONC";"MONCLER";;;;"Saldo finale";;18;51,24;EUR;;;922,32;;;
"MONC";"MONCLER";;;;"Totale";;3.000;51,24;EUR;;;153720,00;;;;;
`;

    const parsed = parsePositionCsvFile(positions, "Ec_X_8_05_2026.csv");

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      security: "MONCLER",
      quantity: 3_000,
      price: 51.24,
      marketValue: 153_720,
    });
  });

  it("trusts Directa position market value when bond price scale is ambiguous", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const statement = `"Ariete Capital S.r.l.";1/04/2026;10:00:00
"Estratto Conto   dal";1/03/2026;"al";31/03/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/03/2026;;"Saldo Iniziale";"";;;;500000,00;
18/03/2026;20/03/2026;"BTP FX 3.1% AUG26 EUR";"V0001";100,58900;EUR;100000;-100589,00;
`;

    const positions = `"Ariete Capital S.r.l.";1/04/2026;10:01:00;;;;;;;;;;""
"titolo";;data;"Ora";"valuta";"protocollo/ordine";"quantita' ordine";"quantita'";"Prezzo";"Div";"Prezzo";"Cambio";"imp. EUR";"operazione";""
"BTP";"BTP FX 3.1% AUG26 EUR";;;;"Saldo finale";;100000;10,05890;EUR;;;100589,00;;;;;
`;

    const workbook = await buildWorkbookData(
      [
        { name: "Estratto Conto 2026-03-31.csv", content: statement },
        { name: "Ec_X_1_04_2026.csv", content: positions },
      ],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 500_000 }
    );

    const bond = workbook.holdings.find((h) => h.security === "BTP FX 3.1% AUG26 EUR");
    expect(bond).toMatchObject({
      assetClass: "Bond",
      shares: 100_000,
      currentPrice: 1.00589,
      marketValue: 100_589,
      costBasis: 100_589,
      unrealizedPnl: 0,
    });
    expect(workbook.portfolioMetrics["Listed Market Value"]).toBeCloseTo(100_589, 6);
    expect(workbook.portfolioMetrics["Total Portfolio Value"]).toBeCloseTo(500_000, 6);
    expect(workbook.monthlyReturns.at(-1)?.nav).toBeCloseTo(500_000, 6);
  });

  it("removes redeemed securities from the monthly NAV series", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const january = `"Ariete Capital S.r.l.";1/02/2026;10:00:00
"Estratto Conto   dal";1/01/2026;"al";31/01/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/01/2026;;"Saldo Iniziale";"";;;;100000,00;
10/01/2026;12/01/2026;"BOT ZC DEC25 A EUR";"V0001";99,50000;EUR;100000;-99500,00;
`;

    const february = `"Ariete Capital S.r.l.";1/03/2026;10:00:00
"Estratto Conto   dal";1/02/2026;"al";28/02/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/02/2026;;"Saldo Iniziale";"";;;;500,00;
20/02/2026;20/02/2026;"BOT ZC DEC25 A EUR";"Rimborso obbl.";;;;99700,00;
`;

    const workbook = await buildWorkbookData(
      [
        { name: "Estratto Conto 2026-01-31.csv", content: january },
        { name: "Estratto Conto 2026-02-28.csv", content: february },
      ],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 100_000 }
    );

    expect(workbook.holdings.find((h) => h.security === "BOT ZC DEC25 A EUR")?.shares).toBe(0);
    expect(workbook.monthlyReturns.at(-1)?.nav).toBeCloseTo(100_200, 6);
  });

  it("carries ISINs from Directa references into holdings", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const statement = `"Ariete Capital S.r.l.";1/06/2026;10:00:00
"Estratto Conto   dal";1/05/2026;"al";31/05/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/05/2026;;"Saldo Iniziale";"";;;;1000,00;
5/05/2026;7/05/2026;"MVP TEST SECURITY";"US0378331005";10,00000;EUR;10;-100,00;
`;

    const workbook = await buildWorkbookData(
      [{ name: "Estratto Conto 2026-05-31.csv", content: statement }],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 1_000 }
    );

    expect(workbook.holdings.find((h) => h.security === "MVP TEST SECURITY")?.isin).toBe("US0378331005");
  });

  it("does not infer ISINs from security names alone", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const statement = `"Ariete Capital S.r.l.";1/06/2026;10:00:00
"Estratto Conto   dal";1/05/2026;"al";31/05/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/05/2026;;"Saldo Iniziale";"";;;;1000,00;
5/05/2026;7/05/2026;"ENEL";"06009525900043";10,00000;EUR;10;-100,00;
`;

    const workbook = await buildWorkbookData(
      [{ name: "Estratto Conto 2026-05-31.csv", content: statement }],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 1_000 }
    );

    expect(workbook.holdings.find((h) => h.security === "ENEL")?.isin).toBe("");
  });

  it("rejects malformed ISIN-looking references", async () => {
    const { buildWorkbookData } = await import("./directa-preprocess");

    const statement = `"Ariete Capital S.r.l.";1/06/2026;10:00:00
"Estratto Conto   dal";1/05/2026;"al";31/05/2026

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/05/2026;;"Saldo Iniziale";"";;;;1000,00;
5/05/2026;7/05/2026;"MVP TEST SECURITY";"US1234567890";10,00000;EUR;10;-100,00;
`;

    const workbook = await buildWorkbookData(
      [{ name: "Estratto Conto 2026-05-31.csv", content: statement }],
      { nonListedValue: 0, externalCash: 0, capitalCommitted: 1_000 }
    );

    expect(workbook.holdings.find((h) => h.security === "MVP TEST SECURITY")?.isin).toBe("");
  });
});
