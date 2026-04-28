from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Shared primitives ────────────────────────────────────────────────────────

class DataWarning(BaseModel):
    code: str
    message: str


# ── KPIs ─────────────────────────────────────────────────────────────────────

class KPIs(BaseModel):
    total_portfolio_value: float
    capital_committed: float
    pct_since_entry: float          # (NAV - committed) / committed
    moic: float
    moic_target: float
    current_yield: float            # TTM income / NAV
    distributions_total: float
    distributions_count: int
    distributions_last_date: Optional[date]


# ── Time series ───────────────────────────────────────────────────────────────

class NavPoint(BaseModel):
    month_end: date
    nav: float
    normalized: float               # nav / nav[0] * 100
    monthly_return: float
    cumulative_return: float


class TimeSeries(BaseModel):
    series: list[NavPoint]


# ── Allocation ────────────────────────────────────────────────────────────────

class AllocationSlice(BaseModel):
    asset_class: str
    market_value: float
    weight: float


class Allocation(BaseModel):
    slices: list[AllocationSlice]


# ── IRR ───────────────────────────────────────────────────────────────────────

class IRR(BaseModel):
    fund_irr: float
    investor_irr: float
    valuation_date: date


# ── Risk / Sharpe block ───────────────────────────────────────────────────────

class RiskMetrics(BaseModel):
    sharpe_ratio: float
    volatility_annualized: float
    max_drawdown: float
    annualized_return: float
    risk_free_rate: float
    data_window_months: int
    beta_vs_msci_world: Optional[float] = None   # not available — no benchmark data


# ── Distributions table ───────────────────────────────────────────────────────

class DistributionEvent(BaseModel):
    date: date
    security: str
    income_type: str                # Dividend | Coupon | Distribution | Sec. Lending
    amount: float


class Distributions(BaseModel):
    events: list[DistributionEvent]
    total: float


# ── Target vs Actual ─────────────────────────────────────────────────────────

class TargetVsActual(BaseModel):
    target_equity_pct: float
    target_bond_pct: float
    target_alt_pct: float
    current_equity_pct: float
    current_bond_pct: float
    current_alt_pct: float          # ETF/ETC + Crypto ETP
    current_cash_pct: float


# ── Holdings ──────────────────────────────────────────────────────────────────

class Holding(BaseModel):
    security: str
    asset_class: str
    currency: str
    shares: float
    avg_cost: float
    cost_basis: float
    current_price: Optional[float]
    market_value: float
    unrealized_pnl: float
    pnl_pct: float
    weight: float


class Holdings(BaseModel):
    holdings: list[Holding]
    total_market_value: float
    total_cost_basis: float
    total_unrealized_pnl: float
    cutoff_date: date


# ── Full dashboard payload ────────────────────────────────────────────────────

class Dashboard(BaseModel):
    investor_name: str
    portfolio_id: str
    as_of_date: date
    kpis: KPIs
    timeseries: TimeSeries
    allocation: Allocation
    irr: IRR
    risk: RiskMetrics
    distributions: Distributions
    targets: TargetVsActual
    data_warnings: list[DataWarning] = Field(default_factory=list)


# ── Reload response ───────────────────────────────────────────────────────────

class ReloadResponse(BaseModel):
    status: str
    loaded_at: datetime
    data_warnings: list[DataWarning] = Field(default_factory=list)
