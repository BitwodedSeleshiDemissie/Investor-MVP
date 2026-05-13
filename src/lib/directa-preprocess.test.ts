import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildAuditWorkbookBuffer } from "./audit-workbook";
import { computeComposition, computeKPIs, computeRisk } from "./calculations";
import { loadWorkbook } from "./excel-loader";

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
    const reloaded = loadWorkbook(auditPath);

    expect(dateOnly(reloaded.cutoffDate)).toBe("2026-04-30");
    expect(reloaded.holdings).toHaveLength(2);
    expect(reloaded.tradeLog.some((row) => row.security === "ENEL" && row.type === "Sell")).toBe(true);
    expect(reloaded.monthlyReturns).toHaveLength(2);

    const risk = computeRisk(workbook, settings);
    expect(risk.annualizedReturn).toBeLessThan(1);
    expect(risk.volatilityAnnualized).toBeLessThan(1);
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
});
