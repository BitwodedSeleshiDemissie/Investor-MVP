export interface InvestorPerfRow {
  name: string;
  type: string;
  subscriptionDate: Date;
  capitalEur: number;
  units: number;
  yearsElapsed: number;
  navUnitAtSub: number;
  currentValueEur: number;
  moic: number;
  irrAnnualized: number;
}

export interface WorkbookData {
  tradeLog: TradeRow[];
  holdings: HoldingRow[];
  portfolioMetrics: Record<string, number | string>;
  irrInvestor: CashFlowRow[];
  irrPortfolio: CashFlowRow[];
  monthlyReturns: MonthlyReturnRow[];
  cutoffDate: Date;
  investorPerformance: InvestorPerfRow[];
  manualItems?: WorkbookManualItem[];
}

export interface WorkbookManualItem {
  itemKey: string;
  displayName: string;
  itemType: "Non-Listed" | "Cash";
  subcategory: string;
  value: number;
  notes: string;
  sortOrder: number;
}

export interface TradeRow {
  date: Date;
  security: string;
  assetClass: string;
  currency: string;
  type: string;
  shares: number;
  price: number;
  netAmount: number;
}

export interface HoldingRow {
  security: string;
  isin?: string;
  assetClass: string;
  currency: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  pnlPct: number;
  weight: number;
}

export interface CashFlowRow {
  date: Date;
  cashFlow: number;
}

export interface MonthlyReturnRow {
  monthEnd: Date;
  nav: number;
  monthlyReturn: number;
  cumulativeReturn?: number;
}

export const INCOME_TYPES = new Set([
  "DIVIDEND", "INTEREST", "ETF_INCOME", "COUPON", "LOAN_INT", "OTHER",
  "Dividend", "Coupon", "Distribution", "Sec. Lending", "Income",
]);

export const INVESTOR_FLOW_TYPES = new Set(["Deposit", "Withdrawal"]);
