export const AGGREGATE_PRIVATE_PARTICIPATIONS_KEY = "PRIVATE_PARTICIPATIONS";
export const AGGREGATE_PRIVATE_LOAN_KEY = "PRIVATE_LOAN_PRINCIPAL";

export function slugKey(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "ENTRY";
}

export function participationItemKey(investee: string): string {
  return `PRIVATE_PARTICIPATION_${slugKey(investee)}`;
}

export function privateLoanItemKey(counterparty: string): string {
  return `PRIVATE_LOAN_${slugKey(counterparty)}`;
}

export function isDetailedParticipationKey(itemKey: string): boolean {
  return itemKey.startsWith("PRIVATE_PARTICIPATION_");
}

export function isDetailedPrivateLoanKey(itemKey: string): boolean {
  return itemKey.startsWith("PRIVATE_LOAN_") && itemKey !== AGGREGATE_PRIVATE_LOAN_KEY;
}
