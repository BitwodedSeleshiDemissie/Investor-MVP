export interface KPIs {
  totalPortfolioValue: number;
  capitalCommitted: number;
  pctSinceEntry: number;
  moic: number;
  moicTarget: number;
  currentYield: number;
  distributionsTotal: number;
  distributionsCount: number;
  distributionsLastDate: string | null;
  totalIncome: number;
}

export interface NavPoint {
  monthEnd: string;
  nav: number;
  normalized: number;
  monthlyReturn: number;
  cumulativeReturn: number;
}

export interface AllocationSlice {
  assetClass: string;
  marketValue: number;
  weight: number;
}

export interface IRRData {
  fundIrr: number | null;
  investorIrr: number | null;
  valuationDate: string;
}

export interface RiskMetrics {
  sharpeRatio: number;
  volatilityAnnualized: number;
  maxDrawdown: number;
  annualizedReturn: number;
  riskFreeRate: number;
  dataWindowMonths: number;
  betaVsMsciWorld: number | null;
}

export interface DistributionEvent {
  date: string;
  security: string;
  incomeType: string;
  amount: number;
}

export interface TargetVsActual {
  targetEquityPct: number;
  targetBondPct: number;
  targetAltPct: number;
  currentEquityPct: number;
  currentBondPct: number;
  currentAltPct: number;
  currentCashPct: number;
}

export interface Holding {
  security: string;
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

export interface PortfolioComposition {
  listed: number;
  nonListed: number;
  cash: number;
  total: number;
}

export interface PnLBreakdown {
  unrealized: number;
  realized: number;
  netTotal: number;
}

export interface InvestorPerf {
  name: string;
  type: string;
  subscriptionDate: string;
  capitalEur: number;
  units: number;
  yearsElapsed: number;
  navUnitAtSub: number;
  currentValueEur: number;
  moic: number;
  irrAnnualized: number;
}

export interface OverlaySources {
  capitalCommitted: number;
  nonListedValue: number;
  externalCash: number;
  overlayItemCount: number;
  investorProfileCount: number;
  cashFormula?: CashFormulaBreakdown;
  // Per-item breakdown frozen at upload time — absent on snapshots predating this field.
  manualItems?: Array<{
    item_key: string;
    item_type: string;
    value: number;
    value_date?: string | null;
    display_name?: string | null;
    subcategory?: string | null;
  }>;
  source?: string;
}

export interface CashFormulaBreakdown {
  source: string;
  formula: string;
  baseCutoffDate: string;
  capitalCollected: number;
  listedNetTradeCost: number;
  income: number;
  baseParticipationNetCost: number;
  baseLoanNetPrincipal: number;
  participationNetCost: number;
  loanNetPrincipal: number;
  operatingPnl: number;
  postCutoffParticipationNetCost: number;
  postCutoffLoanNetPrincipal: number;
  cash: number;
}

export interface PortfolioSnapshot {
  kpis: KPIs;
  timeseries: NavPoint[];
  allocation: AllocationSlice[];
  irr: IRRData;
  risk: RiskMetrics;
  distributions: DistributionEvent[];
  targets: TargetVsActual;
  holdings: Holding[];
  composition: PortfolioComposition;
  pnl: PnLBreakdown;
  directaCash: number;
  cutoffDate: string;
  investorName: string;
  portfolioId: string;
  warnings: string[];
  investorPerformance: InvestorPerf[];
  // Immutability metadata — present on all snapshots created after the freeze system was introduced.
  // Absence means legacy snapshot: use raw payload without live overlay re-reads.
  overlaysFrozen?: boolean;
  frozenAt?: string;
  overlaySources?: OverlaySources;
}

export interface DataWarning {
  code: string;
  message: string;
}

export interface AdminDictionaryItem {
  id?: number;
  itemKey: string;
  displayName: string;
  itemType: "non_listed" | "cash";
  subcategory: string | null;
  currency: string;
  sortOrder: number;
}

export interface ManualValueRow {
  id?: number;
  itemKey: string;
  displayName: string;
  itemType: "non_listed" | "cash";
  valueDate: string;
  value: number;
  holdingName: string | null;
  createdAt?: string;
}

export interface ControlRow {
  id?: number;
  asOfDate: string;
  capitalCommitted: number;
  createdAt?: string;
}

export interface AdminData {
  dictionary: AdminDictionaryItem[];
  manualValues: ManualValueRow[];
  controls: ControlRow[];
}

export interface InvestorProfile {
  id?: number;
  name: string;
  investorType: string;
  capitalEur: number;
  units: number;
  subscriptionDate: string;
  navUnitAtSub: number;
  active: boolean;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}
