import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
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
const nonListedKey = `E2E_BUTTON_NL_${stamp}`;
const cashKey = `E2E_BUTTON_EXTERNAL_CASH_${stamp}`;
const nonListedName = `E2E Button Non Listed ${stamp}`;
const cashName = `E2E Button External Cash ${stamp}`;
const holdingName = `E2E Button Holding ${stamp}`;
const testDate = "2099-01-27";
const controlValue = 987_654.32;

test.describe.configure({ mode: "serial" });
test.skip(!databaseUrl, "E2E needs DATABASE_URL in env/.env");

test.beforeAll(async () => {
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
});

test("all primary buttons and navigation controls work end to end", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", async (dialog) => dialog.accept());

  await login(page, "admin");
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();

  await openAdminCard(page, "Asset Dictionary", /\/admin\/dictionary$/);
  await page.locator("main").getByRole("link", { name: /Dashboard/ }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await openAdminCard(page, "Non-Listed Values", /\/admin\/non-listed$/);
  await page.locator("main").getByRole("link", { name: /Dashboard/ }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await openAdminCard(page, "Cash & Liquidity", /\/admin\/cash$/);
  await page.locator("main").getByRole("link", { name: /Dashboard/ }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await openAdminCard(page, "Portfolio Parameters", /\/admin\/controls$/);
  await page.locator("main").getByRole("link", { name: /Dashboard/ }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await sideNav(page).getByRole("link", { name: "Asset Dictionary" }).click();
  await expect(page).toHaveURL(/\/admin\/dictionary$/);
  await addDictionaryItem(page, nonListedKey, nonListedName, "Non-Listed");
  await addDictionaryItem(page, cashKey, cashName, "Cash");

  await sideNav(page).getByRole("link", { name: "Non-Listed Values" }).click();
  await expect(page).toHaveURL(/\/admin\/non-listed$/);
  await page.getByLabel("Non-Listed Asset").selectOption({ label: nonListedName });
  await page.getByLabel(/Value/).fill("12000");
  await page.getByLabel("Valuation Date").fill(testDate);
  await page.getByLabel(/Holding Name/).fill(holdingName);
  await page.getByRole("button", { name: "Save Value" }).click();
  await expect(page.getByRole("button", { name: /Saved/ })).toBeVisible();
  await expect(page.getByText(holdingName).first()).toBeVisible();
  await expect(page.getByText(cashKey)).toHaveCount(0);

  await sideNav(page).getByRole("link", { name: "Cash & Liquidity" }).click();
  await expect(page).toHaveURL(/\/admin\/cash$/);
  await page.getByLabel("Cash Account").selectOption({ label: cashName });
  await page.getByLabel("Balance (€)").fill("34000");
  await page.getByLabel("Balance Date").fill(testDate);
  await page.getByRole("button", { name: "Save Balance" }).click();
  await expect(page.getByRole("button", { name: /Saved/ })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: cashName }).first()).toBeVisible();

  await sideNav(page).getByRole("link", { name: "Parameters" }).click();
  await expect(page).toHaveURL(/\/admin\/controls$/);
  await page.getByLabel(/Capital Committed/).fill(controlValue.toString());
  await page.getByLabel("Reference Date").fill(testDate);
  await page.getByRole("button", { name: "Save Parameters" }).click();
  await expect(page.getByRole("button", { name: /Saved/ })).toBeVisible();
  await expect(page.getByText(/987[.,]654/).first()).toBeVisible();

  await sideNav(page).getByRole("link", { name: "Asset Dictionary" }).click();
  await page.getByRole("button", { name: `Remove ${nonListedName}` }).click();
  await expect(page.getByText(nonListedKey)).toHaveCount(0);
  await page.getByRole("button", { name: `Remove ${cashName}` }).click();
  await expect(page.getByText(cashKey)).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "investor");
  await expect(page.getByRole("heading", { name: "Portfolio Overview" })).toBeVisible();
  await sideNav(page).getByRole("link", { name: "Listed", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Listed / Market-Priced" })).toBeVisible();
  await sideNav(page).getByRole("link", { name: "Non-Listed", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Non-Listed / Approved Values" })).toBeVisible();
  await sideNav(page).getByRole("link", { name: "Cash" }).click();
  await expect(page.getByRole("heading", { name: "Cash & Liquidity" })).toBeVisible();
  await sideNav(page).getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Portfolio Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "investor");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByText("Menu")).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByText("Menu")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

async function login(page: Page, role: "admin" | "investor") {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(role === "admin" ? adminEmail : investorEmail);
  await page.locator('input[name="password"]').fill(role === "admin" ? adminPassword! : investorPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openAdminCard(page: Page, name: string, url: RegExp) {
  await page.locator("main").getByRole("link", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(url);
}

function sideNav(page: Page) {
  return page.locator("aside").first();
}

async function addDictionaryItem(page: Page, itemKey: string, displayName: string, type: "Non-Listed" | "Cash") {
  await page.getByLabel(/Key/).fill(itemKey);
  await page.getByLabel("Display Name").fill(displayName);
  await page.getByLabel("Type").selectOption({ label: type });
  await page.getByLabel("Currency").fill("EUR");
  await page.getByLabel("Sort Order").fill("9999");
  await page.getByRole("button", { name: "Add / Update" }).click();
  await expect(page.getByRole("button", { name: /Saved/ })).toBeVisible();
  await expect(page.getByText(itemKey)).toBeVisible();
}

async function cleanup() {
  if (!databaseUrl) return;
  const prisma = await getTestPrisma(databaseUrl, databaseSsl);
  const itemKeys = [nonListedKey, cashKey];
  await prisma.admin_manual_values.deleteMany({ where: { item_key: { in: itemKeys } } });
  await prisma.asset_dictionary.deleteMany({ where: { item_key: { in: itemKeys } } });
  await prisma.admin_controls.deleteMany({
    where: {
      as_of_date: new Date(`${testDate}T00:00:00.000Z`),
      capital_committed: controlValue,
    },
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
