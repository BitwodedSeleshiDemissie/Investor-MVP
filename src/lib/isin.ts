const ISIN_RE = /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/i;

function toLuhnDigits(isin: string): string {
  return [...isin.toUpperCase()]
    .map((char) => {
      if (char >= "A" && char <= "Z") return String(char.charCodeAt(0) - 55);
      return char;
    })
    .join("");
}

export function isValidIsin(value: string): boolean {
  const isin = value.toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;

  const digits = toLuhnDigits(isin);
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (!Number.isInteger(n)) return false;
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function extractIsin(value: string | null | undefined): string {
  const match = value?.toUpperCase().match(ISIN_RE);
  const isin = match?.[0] ?? "";
  return isin && isValidIsin(isin) ? isin : "";
}

export function resolveIsin(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const explicit = extractIsin(value);
    if (explicit) return explicit;
  }
  return "";
}
