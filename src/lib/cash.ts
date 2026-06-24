export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateCashOutsideBrokerage({
  capitalCommitted,
  listedValue,
  brokerageCash,
  nonListedValue,
}: {
  capitalCommitted: number;
  listedValue: number;
  brokerageCash: number;
  nonListedValue: number;
}): number {
  return roundMoney(Math.max(0, capitalCommitted - listedValue - brokerageCash - nonListedValue));
}

