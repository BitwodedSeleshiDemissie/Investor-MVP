import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import * as XLSX from "xlsx";
import { Client } from "pg";

type Env = Record<string, string>;

const env = loadLocalEnv();
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@arietetest.com";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admintest";
const investorEmail = process.env.E2E_INVESTOR_EMAIL ?? "user@arietetest.com";
const investorPassword = process.env.E2E_INVESTOR_PASSWORD ?? "usertest";
const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
const databaseSsl = process.env.DATABASE_SSL ?? env.DATABASE_SSL;

const stamp = Date.now().toString();
const filePrefix = `MVP_E2E_UPLOAD_${stamp}_`;
const stockName = `MVP E2E STOCK ${stamp}`;
const etfName = `MVP E2E ETF ${stamp}`;

test.describe.configure({ mode: "serial" });
test.skip(!databaseUrl, "E2E needs DATABASE_URL in env/.env");

test.beforeAll(async () => {
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
});

test("admin CSV upload generates an auditable snapshot visible to investors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mvp-upload-e2e-"));
  const uploadFiles = writeCsvFixtures(tempDir);

  await login(page, "admin");
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();

  await page.goto("/admin/upload");
  await expect(page.getByRole("heading", { name: "Upload Monthly Report" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(uploadFiles);
  await expect(page.getByText("3 files queued")).toBeVisible();

  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/admin/upload-snapshot") && resp.request().method() === "POST",
    { timeout: 120_000 }
  );
  await page.getByRole("button", { name: /Upload 3 files/ }).click();
  const response = await responsePromise;
  const result = await response.json();

  expect(response.ok(), JSON.stringify(result)).toBe(true);
  expect(result.cutoffDate).toBe("2099-04-30");
  expect(result.snapshotId).toEqual(expect.any(Number));
  expect(result.holdingsCount).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Snapshot generated for 2099-04-30")).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("link", { name: /Download audit workbook/ }).click(),
  ]);
  const auditPath = path.join(tempDir, "downloaded-audit.xlsx");
  await download.saveAs(auditPath);
  const workbook = XLSX.read(fs.readFileSync(auditPath), { type: "buffer" });
  expect(workbook.SheetNames).toEqual(
    expect.arrayContaining(["Portfolio Metrics", "Holdings", "Trade Log", "IRR Analysis", "Monthly Returns"])
  );

  await verifyDbSnapshot(result.snapshotId);

  await page.context().clearCookies();
  await login(page, "investor");
  await page.goto("/dashboard/listed");
  await expect(page.getByRole("heading", { name: "Listed / Market-Priced" })).toBeVisible();
  await expect(page.getByText(stockName).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(etfName).first()).toBeVisible({ timeout: 30_000 });

  expect(pageErrors).toEqual([]);
});

async function login(page: Page, role: "admin" | "investor") {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(role === "admin" ? adminEmail : investorEmail);
  await page.locator('input[name="password"]').fill(role === "admin" ? adminPassword : investorPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(role === "admin" ? /\/admin$/ : /\/dashboard$/);
}

function writeCsvFixtures(tempDir: string): string[] {
  const marchStatement = `"Ariete Capital S.r.l.";2/04/2099;18:46:57
"Estratto Conto   dal";1/03/2099;"al";31/03/2099

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/03/2099;;"Saldo Iniziale";"";;;;10000,00;
2/03/2099;4/03/2099;"${stockName}";"06009525900043";5,00000;EUR;100;-500,00;-5,00
15/03/2099;17/03/2099;"${stockName}";"Incasso Dividendi";;;;20,00;
20/03/2099;20/03/2099;"";"Conferimento";;;;1000,00;
`;

  const aprilStatement = `"Ariete Capital S.r.l.";8/05/2099;11:59:00
"Estratto Conto   dal";1/04/2099;"al";30/04/2099

"data";"valuta";"titolo";"riferim.";"Prezzo";;"quantita'";"importo EUR";"comm."
1/04/2099;;"Saldo Iniziale";"";;;;10515,00;
5/04/2099;7/04/2099;"${etfName}";"09117284865237";50,00000;EUR;10;-500,00;
10/04/2099;12/04/2099;"${stockName}";"06009525900044";6,00000;EUR;-40;240,00;-2,00
12/04/2099;14/04/2099;"BOT ZC APR99 A EUR";"Cedola";;;;10,00;
`;

  const aprilPositions = `"Ariete Capital S.r.l.";8/05/2099;11:59:11;;;;;;;;;;""
"titolo";;data;"Ora";"valuta";"protocollo/ordine";"quantita' ordine";"quantita'";"Prezzo";"Div";"Prezzo";"Cambio";"imp. EUR";"operazione";""
"${stockName}";"${stockName}";;;;"Saldo finale";;60;6,50000;EUR;;;390,00;;;;;
"${etfName}";"${etfName}";;;;"Saldo finale";;10;55,00000;EUR;;;550,00;;;;;
`;

  return [
    writeFile(tempDir, `${filePrefix}Estratto Conto 2099-03-31.csv`, marchStatement),
    writeFile(tempDir, `${filePrefix}Estratto Conto 2099-04-30.csv`, aprilStatement),
    writeFile(tempDir, `${filePrefix}Ec_X_8_05_2099.csv`, aprilPositions),
  ];
}

function writeFile(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

async function verifyDbSnapshot(snapshotId: number) {
  const client = createClient();
  await client.connect();
  try {
    const csvRows = await client.query(
      "SELECT filename FROM directa_csv_files WHERE filename LIKE $1 ORDER BY filename",
      [`${filePrefix}%`]
    );
    expect(csvRows.rows).toHaveLength(3);

    const snapshotRows = await client.query(
      "SELECT as_of_date::text AS as_of_date, source_file, payload FROM portfolio_snapshots WHERE id = $1",
      [snapshotId]
    );
    expect(snapshotRows.rows).toHaveLength(1);
    expect(snapshotRows.rows[0].as_of_date).toBe("2099-04-30");
    expect(snapshotRows.rows[0].source_file).toContain(filePrefix);
    expect(snapshotRows.rows[0].payload.holdings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ security: stockName, marketValue: 390 }),
        expect.objectContaining({ security: etfName, marketValue: 550 }),
      ])
    );

    const artifactRows = await client.query(
      "SELECT file_name, octet_length(content)::int AS bytes FROM portfolio_snapshot_artifacts WHERE snapshot_id = $1",
      [snapshotId]
    );
    expect(artifactRows.rows).toHaveLength(1);
    expect(artifactRows.rows[0].file_name).toBe("ariete-statement-audit-2099-04-30.xlsx");
    expect(artifactRows.rows[0].bytes).toBeGreaterThan(10_000);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  if (!databaseUrl) return;
  const client = createClient();
  await client.connect();
  try {
    await client.query(
      "DELETE FROM portfolio_snapshot_artifacts WHERE snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE source_file LIKE $1)",
      [`%${filePrefix}%`]
    );
    await client.query("DELETE FROM portfolio_snapshots WHERE source_file LIKE $1", [`%${filePrefix}%`]);
    await client.query("DELETE FROM directa_csv_files WHERE filename LIKE $1", [`${filePrefix}%`]);
    await client.query("DELETE FROM security_tipo_cache WHERE security_name LIKE $1", [`MVP E2E % ${stamp}`]);
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
  } finally {
    await client.end();
  }
}

function createClient() {
  return new Client({
    connectionString: databaseUrl,
    ssl: databaseSsl === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

function loadLocalEnv(): Env {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return {};
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .reduce<Env>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return acc;
      const key = trimmed.slice(0, idx);
      const raw = trimmed.slice(idx + 1).trim();
      acc[key] = raw.replace(/^["']|["']$/g, "");
      return acc;
    }, {});
}
