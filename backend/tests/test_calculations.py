"""
Unit tests for financial math in calculations.py.
Uses small synthetic datasets — never touches the live Excel file.
"""
from __future__ import annotations

import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from calculations import (
    _xirr_safe,
    check_nav_reconciliation,
    compute_allocation,
    compute_distributions,
    compute_irr,
    compute_kpis,
    compute_risk,
    compute_targets,
    compute_timeseries,
)
from config import Settings
from excel_loader import WorkbookData


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _settings(**overrides) -> Settings:
    base = dict(
        excel_path=Path("dummy.xlsx"),
        investor_name="Test",
        portfolio_id="T-001",
        risk_free_rate=0.035,
        moic_target=2.0,
        target_equity_pct=0.70,
        target_bond_pct=0.20,
        target_alt_pct=0.10,
        nav_reconciliation_tolerance=0.005,
    )
    base.update(overrides)
    return Settings(**base)


def _make_workbook(
    *,
    portfolio_value: float = 1_167_851.68,
    capital_committed: float = 1_250_000.0,
    cash: float = 97_547.74,
    holdings_mv: float = 1_070_303.94,
    total_income: float = 4_674.71,
    monthly_returns: list[tuple] | None = None,
    trade_log_rows: list[dict] | None = None,
    holdings_rows: list[dict] | None = None,
    irr_inv_rows: list[dict] | None = None,
    irr_port_rows: list[dict] | None = None,
) -> WorkbookData:
    pm = {
        "Total Invested Capital": capital_committed,
        "Total Withdrawals": -30_000,
        "Net Capital Deployed": capital_committed - 30_000,
        "Total Market Value (Holdings)": holdings_mv,
        "Cash Balance (est.)": cash,
        "Total Portfolio Value": portfolio_value,
        "Total Income (Div+Cpn+Dist)": total_income,
        "Annualized Return (TWR)": 0.010104,
        "Monthly Std Dev": 0.027455,
        "Investor IRR": -0.061552,
        "Company IRR": -0.087395,
    }

    if monthly_returns is None:
        monthly_returns = [
            (date(2025, 1, 31), 9_246.42, 0, 0, 0.0, 0.0),
            (date(2025, 2, 28), 9_509.36, 0, 0, 0.028437, 0.028437),
            (date(2025, 3, 31), 362_517.02, 350_000, 0, 0.008366, 0.037041),
        ]
    mr = pd.DataFrame(monthly_returns, columns=[
        "Month End", "Portfolio Value", "Deposits In Month",
        "Withdrawals In Month", "Monthly Return", "Cumulative Return",
    ])
    mr["Month End"] = pd.to_datetime(mr["Month End"])

    tl_rows = trade_log_rows or [
        {"Date": date(2025, 8, 6), "Security": "ASML", "Type": "Dividend",
         "Category": "Income", "Net Amount": 27.2, "Amount (EUR)": 27.2, "Commission": 0},
        {"Date": date(2025, 9, 19), "Security": "PIAGGIO", "Type": "Dividend",
         "Category": "Income", "Net Amount": 200.0, "Amount (EUR)": 200.0, "Commission": 0},
        {"Date": date(2025, 10, 3), "Security": "SOME BOND", "Type": "Coupon",
         "Category": "Income", "Net Amount": 500.0, "Amount (EUR)": 500.0, "Commission": 0},
    ]
    tl = pd.DataFrame(tl_rows)
    tl["Date"] = pd.to_datetime(tl["Date"])

    h_rows = holdings_rows or [
        {"Security": "MONCLER", "Asset Class": "Stock", "Currency": "EUR",
         "Shares Held": 3000, "Avg Cost": 49.22, "Total Cost Basis": -147_660,
         "Current Price": 51.4, "Market Value": 154_200, "Unrealized P&L": 6_540,
         "P&L %": 0.044, "Weight %": 0.144},
        {"Security": "BTP AUG26", "Asset Class": "Bond", "Currency": "EUR",
         "Shares Held": 100_000, "Avg Cost": 1.006, "Total Cost Basis": -100_600,
         "Current Price": 1.003, "Market Value": 100_300, "Unrealized P&L": -300,
         "P&L %": -0.003, "Weight %": 0.094},
    ]
    h = pd.DataFrame(h_rows)

    irr_inv = pd.DataFrame(irr_inv_rows or [
        {"Date": date(2025, 3, 26), "Cash Flow": -350_000},
        {"Date": date(2025, 6, 17), "Cash Flow": -100_000},
    ])
    irr_port = pd.DataFrame(irr_port_rows or [
        {"Date": date(2025, 5, 30), "Cash Flow": -30_555},
        {"Date": date(2025, 8, 6), "Cash Flow": 27.2},
    ])
    for df in [irr_inv, irr_port]:
        df["Date"] = pd.to_datetime(df["Date"])

    return WorkbookData(
        trade_log=tl,
        holdings=h,
        portfolio_metrics=pm,
        irr_investor=irr_inv,
        irr_portfolio=irr_port,
        monthly_returns=mr,
        cutoff_date=datetime(2026, 3, 31),
    )


# ── XIRR ──────────────────────────────────────────────────────────────────────

class TestXIRRSafe:
    def test_simple_positive_irr(self):
        # Invest 1000, get back 1100 one year later → ~10%
        dates = [date(2024, 1, 1), date(2025, 1, 1)]
        flows = [-1000.0, 1100.0]
        result = _xirr_safe(dates, flows)
        assert result is not None
        assert abs(result - 0.10) < 0.001

    def test_simple_negative_irr(self):
        dates = [date(2024, 1, 1), date(2025, 1, 1)]
        flows = [-1000.0, 900.0]
        result = _xirr_safe(dates, flows)
        assert result is not None
        assert result < 0

    def test_returns_none_on_degenerate_input(self):
        # All same-sign flows — no solution
        result = _xirr_safe([date(2024, 1, 1)], [-1000.0])
        assert result is None or not np.isfinite(result if result is not None else float("nan"))


# ── KPIs ──────────────────────────────────────────────────────────────────────

class TestKPIs:
    def test_total_portfolio_value(self):
        data = _make_workbook(portfolio_value=1_167_851.68)
        kpis = compute_kpis(data, _settings())
        assert kpis.total_portfolio_value == pytest.approx(1_167_851.68)

    def test_capital_committed(self):
        data = _make_workbook(capital_committed=1_250_000)
        kpis = compute_kpis(data, _settings())
        assert kpis.capital_committed == 1_250_000

    def test_pct_since_entry(self):
        # (1_100_000 - 1_000_000) / 1_000_000 = 10%
        data = _make_workbook(portfolio_value=1_100_000, capital_committed=1_000_000)
        kpis = compute_kpis(data, _settings())
        assert kpis.pct_since_entry == pytest.approx(0.10)

    def test_moic_formula(self):
        # MOIC = (NAV + total_income) / committed
        data = _make_workbook(portfolio_value=1_000_000, capital_committed=1_000_000, total_income=50_000)
        kpis = compute_kpis(data, _settings())
        assert kpis.moic == pytest.approx(1.05)

    def test_distributions_count_excludes_negative(self):
        tl_rows = [
            {"Date": date(2025, 9, 10), "Security": "ISHARES HY", "Type": "Distribution",
             "Category": "Income", "Net Amount": 604.33, "Amount (EUR)": 604.33, "Commission": 0},
            {"Date": date(2025, 9, 10), "Security": "ISHARES HY", "Type": "Distribution",
             "Category": "Income", "Net Amount": -156.73, "Amount (EUR)": -156.73, "Commission": 0},
        ]
        data = _make_workbook(trade_log_rows=tl_rows)
        kpis = compute_kpis(data, _settings())
        assert kpis.distributions_count == 1   # only the positive row

    def test_distributions_total_nets_withholding(self):
        tl_rows = [
            {"Date": date(2025, 9, 10), "Security": "ISHARES HY", "Type": "Distribution",
             "Category": "Income", "Net Amount": 604.33, "Amount (EUR)": 604.33, "Commission": 0},
            {"Date": date(2025, 9, 10), "Security": "ISHARES HY", "Type": "Distribution",
             "Category": "Income", "Net Amount": -156.73, "Amount (EUR)": -156.73, "Commission": 0},
        ]
        data = _make_workbook(trade_log_rows=tl_rows)
        kpis = compute_kpis(data, _settings())
        assert kpis.distributions_total == pytest.approx(447.60, abs=0.01)


# ── Time Series ───────────────────────────────────────────────────────────────

class TestTimeSeries:
    def test_normalized_first_point_is_100(self):
        data = _make_workbook()
        ts = compute_timeseries(data)
        assert ts.series[0].normalized == pytest.approx(100.0)

    def test_normalized_subsequent_points(self):
        data = _make_workbook()
        ts = compute_timeseries(data)
        # nav[1] / nav[0] * 100
        expected = 9_509.36 / 9_246.42 * 100
        assert ts.series[1].normalized == pytest.approx(expected, rel=1e-4)

    def test_month_count_matches_input(self):
        data = _make_workbook()
        ts = compute_timeseries(data)
        assert len(ts.series) == 3


# ── Sharpe / Risk ─────────────────────────────────────────────────────────────

class TestRiskMetrics:
    def _data_with_returns(self, returns: list[float]) -> WorkbookData:
        nav = 100_000.0
        rows = []
        for i, r in enumerate(returns):
            nav = nav * (1 + r)
            rows.append((date(2024, i + 1, 28), nav, 0, 0, r, 0))
        return _make_workbook(monthly_returns=rows)

    def test_volatility_formula(self):
        returns = [0.01, -0.02, 0.03, -0.01, 0.02]
        data = self._data_with_returns(returns)
        risk = compute_risk(data, _settings(risk_free_rate=0.0))
        expected_vol = np.std(returns, ddof=1) * np.sqrt(12)
        assert risk.volatility_annualized == pytest.approx(expected_vol, rel=1e-4)

    def test_sharpe_zero_rf(self):
        returns = [0.01] * 12  # constant 1% per month
        data = self._data_with_returns(returns)
        risk = compute_risk(data, _settings(risk_free_rate=0.0))
        # With constant returns, std=0, Sharpe should be 0 (avoid div/0)
        assert risk.sharpe_ratio == 0.0

    def test_max_drawdown_is_negative(self):
        returns = [0.05, 0.03, -0.10, 0.02]
        data = self._data_with_returns(returns)
        risk = compute_risk(data, _settings())
        assert risk.max_drawdown < 0

    def test_max_drawdown_monotone_up(self):
        # No drawdown if NAV only goes up
        returns = [0.01, 0.02, 0.03]
        data = self._data_with_returns(returns)
        risk = compute_risk(data, _settings())
        assert risk.max_drawdown == pytest.approx(0.0, abs=1e-6)

    def test_beta_is_none(self):
        data = _make_workbook()
        risk = compute_risk(data, _settings())
        assert risk.beta_vs_msci_world is None


# ── Max drawdown (isolated) ───────────────────────────────────────────────────

class TestMaxDrawdown:
    def test_known_drawdown(self):
        # NAV: 100 → 120 → 90 → 95 — drawdown = (90-120)/120 = -25%
        navs = np.array([100.0, 120.0, 90.0, 95.0])
        running_max = np.maximum.accumulate(navs)
        dd = float(np.min(navs / running_max - 1))
        assert dd == pytest.approx(-0.25, abs=1e-4)


# ── Reconciliation ────────────────────────────────────────────────────────────

class TestReconciliation:
    def test_no_warning_within_tolerance(self):
        # Holdings sum to 254_500; set pm to match exactly
        data = _make_workbook()
        holdings_sum = float(data.holdings["Market Value"].sum())
        data.portfolio_metrics["Total Market Value (Holdings)"] = holdings_sum
        warnings = check_nav_reconciliation(data, tolerance=0.005)
        assert len(warnings) == 0

    def test_warning_exceeds_tolerance(self):
        data = _make_workbook(holdings_mv=1_000_000)
        data.portfolio_metrics["Total Market Value (Holdings)"] = 900_000  # 10% off
        warnings = check_nav_reconciliation(data, tolerance=0.005)
        assert len(warnings) == 1
        assert warnings[0].code == "NAV_RECONCILIATION_MISMATCH"
