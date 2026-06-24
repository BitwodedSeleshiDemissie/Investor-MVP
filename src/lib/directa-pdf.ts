import { createRequire } from "module";
import type pdfParse from "pdf-parse";
import { resolveIsin } from "./isin";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse/lib/pdf-parse.js") as typeof pdfParse;

function parseItalianNumber(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseItalianDate(value: string): string {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

export type DirectaLiquidityPdf = {
  filename: string;
  text: string;
  liquidity: number;
  listedTotal: number;
  statementDate: string | null;
  positions: DirectaPdfPosition[];
};

export type DirectaPdfPosition = {
  security: string;
  isin: string;
  quantity: number;
  price: number;
  marketValue: number;
};

function parsePositions(text: string): DirectaPdfPosition[] {
  const positions: DirectaPdfPosition[] = [];
  const linePattern = /^(.+?)\s+\(([A-Z]{2}[A-Z0-9]{9}[0-9])\)\s+([0-9.]+)\s+([0-9.]+,\d{4})\s+([0-9.]+,\d{2})\*?$/;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    const match = line.match(linePattern);
    if (!match) continue;
    const isin = resolveIsin(match[2]);
    if (!isin) continue;
    positions.push({
      security: match[1].trim(),
      isin,
      quantity: parseItalianNumber(match[3]),
      price: parseItalianNumber(match[4]),
      marketValue: parseItalianNumber(match[5]),
    });
  }

  return positions;
}

export async function parseDirectaLiquidityPdf(buffer: Buffer, filename: string): Promise<DirectaLiquidityPdf> {
  const result = await pdf(buffer);
  const rawText = result.text;
  const normalizedText = rawText.replace(/\s+/g, " ").trim();
  const liquidityMatch = normalizedText.match(/TOTALE\s+LIQUIDITA(?:['\u2019]|\s+)?\s*:?\s*([+-]?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (!liquidityMatch) {
    throw new Error(`Could not find TOTALE LIQUIDITA' in ${filename}`);
  }

  const totalMatch = normalizedText.match(/TOTALE\s+TITOLI\s+EURO\s+([0-9.]+,\d{2})/i);
  const positions = parsePositions(rawText);
  if (positions.length === 0) {
    throw new Error(`Could not find listed positions with ISINs in ${filename}`);
  }

  const dateMatch = normalizedText.match(/data\s*Operazione\s*(\d{2}\/\d{2}\/\d{4})/i);
  return {
    filename,
    text: normalizedText,
    liquidity: parseItalianNumber(liquidityMatch[1]),
    listedTotal: totalMatch
      ? parseItalianNumber(totalMatch[1])
      : positions.reduce((sum, position) => sum + position.marketValue, 0),
    statementDate: dateMatch ? parseItalianDate(dateMatch[1]) : null,
    positions,
  };
}
