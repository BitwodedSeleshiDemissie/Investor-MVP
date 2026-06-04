import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import * as XLSX from "xlsx";
import { getTestPrisma } from "./prisma-test-client";

type Env = Record<string, string>;

const env = loadLocalEnv();
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@arietecapital.com";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admintest";
const investorEmail = process.env.E2E_INVESTOR_EMAIL ?? "osy@arietecapital.com";
const investorPassword = process.env.E2E_INVESTOR_PASSWORD ?? "osy123";
const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
const databaseSsl = process.env.DATABASE_SSL ?? env.DATABASE_SSL;

const stamp = Date.now().toString();
const filePrefix = `MVP_E2E_UPLOAD_${stamp}_`;
const stockName = `MVP E2E STOCK ${stamp}`;
const etfName = `MVP E2E ETF ${stamp}`;

type SnapshotPayload = {
  holdings?: Array<{ security?: string; marketValue?: number }>;
};

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
  const prisma = await getTestPrisma(databaseUrl!, databaseSsl);
  const csvRows = await prisma.directa_csv_files.findMany({
    where: { filename: { startsWith: filePrefix } },
    orderBy: { filename: "asc" },
    select: { filename: true },
  });
  expect(csvRows).toHaveLength(3);

  const snapshot = await prisma.portfolio_snapshots.findUnique({
    where: { id: BigInt(snapshotId) },
    select: { as_of_date: true, source_file: true, payload: true },
  });
  expect(snapshot).not.toBeNull();
  expect(dateOnly(snapshot!.as_of_date)).toBe("2099-04-30");
  expect(snapshot!.source_file).toContain(filePrefix);

  const payload = snapshot!.payload as SnapshotPayload;
  expect(payload.holdings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ security: stockName, marketValue: 390 }),
      expect.objectContaining({ security: etfName, marketValue: 550 }),
    ])
  );

  const artifactRows = await prisma.portfolio_snapshot_artifacts.findMany({
    where: { snapshot_id: BigInt(snapshotId) },
    select: { file_name: true, content: true },
  });
  expect(artifactRows).toHaveLength(1);
  expect(artifactRows[0].file_name).toBe("ariete-statement-audit-2099-04-30.xlsx");
  expect(artifactRows[0].content.byteLength).toBeGreaterThan(10_000);
}

async function cleanup() {
  if (!databaseUrl) return;
  const prisma = await getTestPrisma(databaseUrl, databaseSsl);
  try {
    const snapshots = await prisma.portfolio_snapshots.findMany({
      where: { source_file: { contains: filePrefix } },
      select: { id: true },
    });
    const snapshotIds = snapshots.map((snapshot) => snapshot.id);
    if (snapshotIds.length > 0) {
      await prisma.portfolio_snapshot_artifacts.deleteMany({ where: { snapshot_id: { in: snapshotIds } } });
    }
    await prisma.portfolio_snapshots.deleteMany({ where: { source_file: { contains: filePrefix } } });
    await prisma.directa_csv_files.deleteMany({ where: { filename: { startsWith: filePrefix } } });
    await prisma.security_tipo_cache.deleteMany({
      where: {
        security_name: {
          startsWith: "MVP E2E ",
          contains: stamp,
        },
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2021") throw error;
  }
}

function dateOnly(value: Date): string {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
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
