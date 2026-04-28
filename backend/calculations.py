"""
All financial metric computations.
Each function is pure (no side-effects) and documented with its formula.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Optional

import numpy as np
import pandas as pd
from pyxirr import xirr

from config import Settings
from excel_loader import INCOME_TYPES, WorkbookData
from models import (
    Allocation,
    AllocationSlice,
    DataWarning,
    DistributionEvent,
    Distributions,
    Holdings,
    Holding,
    IRR,
    KPIs,
    NavPoint,
    RiskMetrics,
    TargetVsActual,
    TimeSeries,
)

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_date(val) -> date:
    if isinstance(val, date):
        return val
    return pd.Timestamp(val).date()


def _nav_series(data: WorkbookData) -> pd.Series:
    """Return Portfolio Value indexed by Month End timestamp."""
    mr = data.monthly_returns.set_index("Month End")["Portfolio Value"]
    return mr.sort_index()


# ── KPIs ──────────────────────────────────────────────────────────────────────

def compute_kpis(data: WorkbookData, settings: Settings) -> KPIs:
    pm = data.portfolio_metrics
    tl = data.trade_log

    # Total Portfolio Value = Holdings market value + cash (pre-computed)
    total_portfolio_value: float = float(pm.get("Total Portfolio Value", 0))

    # Capital committed = total deposits ever made
    capital_committed: float = float(pm.get("Total Invested Capital", 0))

    # % since entry = (NAV - committed) / committed
    pct_since_entry: float = (total_portfolio_value - capital_committed) / capital_committed

    # MOIC = (NAV + total income received) / capital_committed
    # Formula: total return to investor if they liquidated today (NAV) plus
    # cash already received (income), divided by total cash ever put in.
    total_income: float = float(pm.get("Total Income (Div+Cpn+Dist)", 0))
    moic: float = (total_portfolio_value + total_income) / capital_committed

    # Current yield = TTM income / NAV
    # We use total income as a proxy for TTM (portfolio is ~15 months old)
    current_yield: float = total_income / total_portfolio_value if total_portfolio_value else 0.0

    # Distributions (all income types) from trade log
    income_rows = tl[tl["Type"].isin(INCOME_TYPES)].copy()
    # Net out negative rows (withholding tax rows paired with gross distribution)
    distributions_total: float = float(income_rows["Net Amount"].sum())
    distributions_count: int = len(income_rows[income_rows["Net Amount"] > 0])
    last_income = income_rows[income_rows["Net Amount"] > 0]["Date"]
    distributions_last_date: Optional[date] = (
        _to_date(last_income.max()) if not last_income.empty else None
    )

    return KPIs(
        total_portfolio_value=total_portfolio_value,
        capital_committed=capital_committed,
        pct_since_entry=pct_since_entry,
        moic=moic,
        moic_target=settings.moic_target,
        current_yield=current_yield,
        distributions_total=distributions_total,
        distributions_count=distributions_count,
        distributions_last_date=distributions_last_date,
    )


# ── Time series ───────────────────────────────────────────────────────────────

def compute_timeseries(data: WorkbookData) -> TimeSeries:
    """
    Monthly NAV series from Monthly Returns sheet.
    Normalized index: nav[t] / nav[0] * 100, so the first month = 100.
    """
    mr = data.monthly_returns.copy()
    if mr.empty:
        return TimeSeries(series=[])

    nav0 = mr.iloc[0]["Portfolio Value"]
    points: list[NavPoint] = []
    for _, row in mr.iterrows():
        nav = float(row["Portfolio Value"])
        normalized = (nav / nav0 * 100) if nav0 else 100.0
        points.append(NavPoint(
            month_end=_to_date(row["Month End"]),
            nav=nav,
            normalized=round(normalized, 4),
            monthly_return=float(row["Monthly Return"]),
            cumulative_return=float(row["Cumulative Return"]),
        ))
    return TimeSeries(series=points)


# ── Allocation ────────────────────────────────────────────────────────────────

# Maps Holdings "Asset Class" values → canonical dashboard labels
_CLASS_LABEL: dict[str, str] = {
    "Stock": "Stocks",
    "Bond": "Bonds",
    "ETF/ETC": "ETFs / ETCs",
    "Crypto ETP": "Crypto ETPs",
}


def compute_allocation(data: WorkbookData) -> Allocation:
    """
    Group Holdings by Asset Class, sum Market Value, compute weight.
    Add Cash from Portfolio Metrics (not represented as a holding).
    """
    pm = data.portfolio_metrics
    h = data.holdings[data.holdings["Market Value"] > 0].copy()

    groups = (
        h.groupby("Asset Class")["Market Value"]
        .sum()
        .rename(index=_CLASS_LABEL)
        .to_dict()
    )
    cash = float(pm.get("Cash Balance (est.)", 0))
    if cash > 0:
        groups["Cash"] = cash

    total = sum(groups.values())
    slices = [
        AllocationSlice(
            asset_class=ac,
            market_value=round(mv, 2),
            weight=round(mv / total, 6) if total else 0.0,
        )
        for ac, mv in sorted(groups.items(), key=lambda x: -x[1])
    ]
    return Allocation(slices=slices)


# ── IRR ───────────────────────────────────────────────────────────────────────

def _xirr_safe(dates: list[date], cashflows: list[float]) -> Optional[float]:
    """
    Wrapper around pyxirr.xirr.
    Returns None if convergence fails or inputs are degenerate.
    pyxirr expects dates as date objects and amounts as floats.
    Sign convention: outflows negative, inflows positive.
    """
    try:
        result = xirr(dates, cashflows)
        if result is None or not np.isfinite(result):
            return None
        return float(result)
    except Exception as exc:
        logger.warning("XIRR failed: %s", exc)
        return None


def _build_investor_cashflows(data: WorkbookData) -> tuple[list[date], list[float]]:
    """
    Investor perspective cash flows:
      - Deposits as outflows (negative from investor's wallet)
      - Withdrawals as inflows (positive back to investor)
      - Terminal value = Total Portfolio Value (NAV + cash) as final inflow
    """
    inv = data.irr_investor.copy()
    dates = [_to_date(d) for d in inv["Date"]]
    flows = [float(cf) for cf in inv["Cash Flow"]]

    # Append terminal value at cutoff date
    nav = float(data.portfolio_metrics.get("Total Portfolio Value", 0))
    dates.append(_to_date(data.cutoff_date))
    flows.append(nav)
    return dates, flows


def _build_portfolio_cashflows(data: WorkbookData) -> tuple[list[date], list[float]]:
    """
    Portfolio (fund) perspective cash flows:
      - Buy/investment outflows (negative)
      - Sell/income inflows (positive)
      - Terminal value = Market Value of open positions (no cash) as final inflow
    """
    port = data.irr_portfolio.copy()
    dates = [_to_date(d) for d in port["Date"]]
    flows = [float(cf) for cf in port["Cash Flow"]]

    mktval = float(data.portfolio_metrics.get("Total Market Value (Holdings)", 0))
    dates.append(_to_date(data.cutoff_date))
    flows.append(mktval)
    return dates, flows


def compute_irr(data: WorkbookData) -> IRR:
    """
    Compute XIRR for both investor and fund perspectives using pyxirr.
    Falls back to pre-computed Excel values if XIRR fails to converge.
    """
    pm = data.portfolio_metrics

    inv_dates, inv_flows = _build_investor_cashflows(data)
    investor_irr = _xirr_safe(inv_dates, inv_flows)
    if investor_irr is None:
        logger.warning("Investor XIRR failed — using pre-computed value from Excel.")
        investor_irr = float(pm.get("Investor IRR", 0))

    port_dates, port_flows = _build_portfolio_cashflows(data)
    fund_irr = _xirr_safe(port_dates, port_flows)
    if fund_irr is None:
        logger.warning("Fund XIRR failed — using pre-computed value from Excel.")
        fund_irr = float(pm.get("Company IRR", 0))

    return IRR(
        fund_irr=round(fund_irr, 6),
        investor_irr=round(investor_irr, 6),
        valuation_date=_to_date(data.cutoff_date),
    )


# ── Risk metrics ──────────────────────────────────────────────────────────────

def compute_risk(data: WorkbookData, settings: Settings) -> RiskMetrics:
    """
    Sharpe  = (annualized_return - risk_free_rate) / annualized_volatility
    Volatility (ann) = std(monthly_returns, ddof=1) * sqrt(12)

    Max drawdown (CFA/GIPS standard for portfolios with external cash flows):
      Build a TWR index from the monthly return series, then compute the
      peak-to-trough decline on that index.
      Using raw NAV would overstate peaks (deposits inflate NAV but are not
      performance), so TWR index is the correct basis.
      TWR_index[0] = 1.0; TWR_index[t] = TWR_index[t-1] * (1 + r_t)
      MDD = min( TWR_index[t] / running_max(TWR_index[:t]) - 1 )

    Risk-free rate: read from Excel Portfolio Metrics sheet first; fall back
    to config value if the cell is absent (e.g. on an older workbook version).
    """
    mr = data.monthly_returns.copy()
    returns = mr["Monthly Return"].dropna().values

    monthly_std = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
    vol_ann = monthly_std * np.sqrt(12)

    ann_return = float(data.portfolio_metrics.get("Annualized Return (TWR)", 0))

    # Risk-free rate: Excel is authoritative; config is the fallback
    rf_from_excel = data.portfolio_metrics.get("Risk-Free Rate (annual)")
    rf = float(rf_from_excel) if rf_from_excel is not None else settings.risk_free_rate

    sharpe = (ann_return - rf) / vol_ann if vol_ann > 1e-10 else 0.0

    # TWR index: compound the monthly returns (first period return may be 0)
    twr_index = np.cumprod(1 + returns)
    running_max = np.maximum.accumulate(twr_index)
    drawdowns = twr_index / running_max - 1
    max_drawdown = float(np.min(drawdowns)) if len(drawdowns) > 0 else 0.0

    return RiskMetrics(
        sharpe_ratio=round(sharpe, 5),
        volatility_annualized=round(vol_ann, 6),
        max_drawdown=round(max_drawdown, 6),
        annualized_return=round(ann_return, 6),
        risk_free_rate=rf,
        data_window_months=len(mr),
        beta_vs_msci_world=None,   # no benchmark data in workbook
    )


# ── Distributions ─────────────────────────────────────────────────────────────

def compute_distributions(data: WorkbookData) -> Distributions:
    """
    All income events from Trade Log (Dividend, Coupon, Distribution, Sec. Lending).
    Rows with negative Net Amount are withholding-tax offsets — included to give
    accurate net totals; filtered from the event list if amount ≤ 0.
    """
    tl = data.trade_log
    income = tl[tl["Type"].isin(INCOME_TYPES)].copy()
    income = income.sort_values("Date")

    events = [
        DistributionEvent(
            date=_to_date(row["Date"]),
            security=str(row["Security"]),
            income_type=str(row["Type"]),
            amount=round(float(row["Net Amount"]), 2),
        )
        for _, row in income.iterrows()
    ]
    total = round(float(income["Net Amount"].sum()), 2)
    return Distributions(events=events, total=total)


# ── Target vs Actual ──────────────────────────────────────────────────────────

def compute_targets(data: WorkbookData, settings: Settings) -> TargetVsActual:
    """
    Actual weights come from Portfolio Metrics asset-class block.
    Alternatives = ETF/ETC + Crypto ETP (combined to match the 3-bucket target).
    """
    pm = data.portfolio_metrics
    total_nav = float(pm.get("Total Portfolio Value", 1))

    def _w(label: str) -> float:
        v = pm.get(label, 0)
        return float(v) / total_nav if total_nav else 0.0

    # Asset class market values from the pre-computed block
    h = data.holdings
    stock_mv = float(h[h["Asset Class"] == "Stock"]["Market Value"].sum())
    bond_mv = float(h[h["Asset Class"] == "Bond"]["Market Value"].sum())
    etf_mv = float(h[h["Asset Class"] == "ETF/ETC"]["Market Value"].sum())
    crypto_mv = float(h[h["Asset Class"] == "Crypto ETP"]["Market Value"].sum())
    cash_mv = float(pm.get("Cash Balance (est.)", 0))

    equity_pct = stock_mv / total_nav
    bond_pct = bond_mv / total_nav
    alt_pct = (etf_mv + crypto_mv) / total_nav
    cash_pct = cash_mv / total_nav

    return TargetVsActual(
        target_equity_pct=settings.target_equity_pct,
        target_bond_pct=settings.target_bond_pct,
        target_alt_pct=settings.target_alt_pct,
        current_equity_pct=round(equity_pct, 6),
        current_bond_pct=round(bond_pct, 6),
        current_alt_pct=round(alt_pct, 6),
        current_cash_pct=round(cash_pct, 6),
    )


# ── Holdings ──────────────────────────────────────────────────────────────────

def compute_holdings(data: WorkbookData) -> Holdings:
    h = data.holdings.copy()
    # Include all rows (including zero-share closed positions) for audit purposes
    items = [
        Holding(
            security=str(row["Security"]),
            asset_class=str(row["Asset Class"]),
            currency=str(row["Currency"]),
            shares=float(row["Shares Held"]),
            avg_cost=float(row["Avg Cost"]),
            cost_basis=float(row["Total Cost Basis"]),
            current_price=float(row["Current Price"]) if row["Current Price"] != 0 else None,
            market_value=float(row["Market Value"]),
            unrealized_pnl=float(row["Unrealized P&L"]),
            pnl_pct=float(row["P&L %"]),
            weight=float(row["Weight %"]),
        )
        for _, row in h.iterrows()
    ]
    return Holdings(
        holdings=items,
        total_market_value=round(float(h["Market Value"].sum()), 3),
        total_cost_basis=round(float(h["Total Cost Basis"].sum()), 3),
        total_unrealized_pnl=round(float(h["Unrealized P&L"].sum()), 3),
        cutoff_date=_to_date(data.cutoff_date),
    )


# ── Reconciliation check ──────────────────────────────────────────────────────

def check_nav_reconciliation(data: WorkbookData, tolerance: float) -> list[DataWarning]:
    """
    Compare Holdings sum of Market Value against Portfolio Metrics Total Market Value.
    Warn if discrepancy exceeds tolerance fraction.
    """
    warnings: list[DataWarning] = []
    holdings_mv = float(data.holdings["Market Value"].sum())
    pm_mv = float(data.portfolio_metrics.get("Total Market Value (Holdings)", 0))

    if pm_mv == 0:
        return warnings

    diff_pct = abs(holdings_mv - pm_mv) / pm_mv
    if diff_pct > tolerance:
        warnings.append(DataWarning(
            code="NAV_RECONCILIATION_MISMATCH",
            message=(
                f"Holdings market value ({holdings_mv:,.2f}) differs from "
                f"Portfolio Metrics NAV ({pm_mv:,.2f}) by {diff_pct:.2%}, "
                f"exceeding {tolerance:.2%} threshold."
            ),
        ))
    return warnings


# ── Beta note ─────────────────────────────────────────────────────────────────

BETA_UNAVAILABLE_WARNING = DataWarning(
    code="BETA_UNAVAILABLE",
    message="beta_vs_msci_world is null: no MSCI World benchmark data found in the workbook.",
)
