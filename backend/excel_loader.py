"""
Loads and parses all sheets from the Excel workbook into typed DataFrames.
Called once at startup; results are cached in the module-level `store` dict.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# Income types treated as cash income (for distributions table & totals)
INCOME_TYPES: set[str] = {"Dividend", "Coupon", "Distribution", "Sec. Lending"}

# Types that represent investor cash flows (deposits/withdrawals)
INVESTOR_FLOW_TYPES: set[str] = {"Deposit", "Withdrawal"}

# Types to exclude from portfolio IRR cash flows
NON_TRADE_TYPES: set[str] = {"Balance", "Tax"}


@dataclass
class WorkbookData:
    trade_log: pd.DataFrame
    holdings: pd.DataFrame
    portfolio_metrics: dict
    irr_investor: pd.DataFrame       # Date, Cash Flow columns
    irr_portfolio: pd.DataFrame      # Date, Cash Flow columns
    monthly_returns: pd.DataFrame
    cutoff_date: datetime
    loaded_at: datetime = field(default_factory=datetime.utcnow)


def _parse_trade_log(xl: pd.ExcelFile) -> pd.DataFrame:
    df = xl.parse("Trade Log", header=2, parse_dates=["Date", "Settlement"])
    # Drop empty trailing rows (template padding)
    df = df.dropna(subset=["Date", "Type"])
    # Exclude opening-balance snapshot rows — they are not transactions
    df = df[df["Type"] != "Balance"].copy()
    df["Date"] = pd.to_datetime(df["Date"])
    df["Amount (EUR)"] = pd.to_numeric(df["Amount (EUR)"], errors="coerce").fillna(0)
    df["Commission"] = pd.to_numeric(df["Commission"], errors="coerce").fillna(0)
    df["Net Amount"] = pd.to_numeric(df["Net Amount"], errors="coerce").fillna(0)
    df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce")
    df["Price"] = pd.to_numeric(df["Price"], errors="coerce")
    return df.reset_index(drop=True)


def _parse_holdings(xl: pd.ExcelFile) -> tuple[pd.DataFrame, datetime]:
    raw = xl.parse("Holdings", header=None)

    # Cutoff date is at row 2, col 6
    cutoff_date = pd.to_datetime(raw.iloc[2, 6])

    df = xl.parse("Holdings", header=4)
    df.columns = [
        "Security", "Asset Class", "Currency", "Shares Held",
        "Avg Cost", "Total Cost Basis", "Current Price",
        "Market Value", "Unrealized P&L", "P&L %", "Weight %",
    ]
    # Keep only real security rows (non-null Security, not the TOTAL row)
    df = df[df["Security"].notna() & (df["Security"] != "TOTAL")].copy()
    for col in ["Shares Held", "Avg Cost", "Total Cost Basis", "Current Price",
                "Market Value", "Unrealized P&L", "P&L %", "Weight %"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df.reset_index(drop=True), cutoff_date


def _parse_portfolio_metrics(xl: pd.ExcelFile) -> dict:
    raw = xl.parse("Portfolio Metrics", header=None)
    # Build a flat key→value dict by scanning col 0 (label) → col 1 (value)
    kv: dict = {}
    for _, row in raw.iterrows():
        label = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ""
        value = row.iloc[1] if pd.notna(row.iloc[1]) else None
        if label and value is not None:
            kv[label] = value

    # Also capture the right-side block (col 3 → col 4)
    for _, row in raw.iterrows():
        label = str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else ""
        value = row.iloc[4] if pd.notna(row.iloc[4]) else None
        if label and value is not None:
            kv[label] = value

    return kv


def _parse_irr_sheet(xl: pd.ExcelFile) -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = xl.parse("IRR Analysis", header=None)

    # ── Investor IRR (left side: cols 0–2, data starts row 9) ────────────────
    inv_rows = raw.iloc[9:, [0, 1]].copy()
    inv_rows.columns = ["Date", "Cash Flow"]
    inv_rows = inv_rows.dropna(subset=["Date", "Cash Flow"])
    inv_rows["Date"] = pd.to_datetime(inv_rows["Date"], errors="coerce")
    inv_rows["Cash Flow"] = pd.to_numeric(inv_rows["Cash Flow"], errors="coerce")
    inv_rows = inv_rows.dropna()

    # ── Portfolio IRR (right side: cols 4–5, data starts row 9) ──────────────
    port_rows = raw.iloc[9:, [4, 5]].copy()
    port_rows.columns = ["Date", "Cash Flow"]
    port_rows = port_rows.dropna(subset=["Date", "Cash Flow"])
    port_rows["Date"] = pd.to_datetime(port_rows["Date"], errors="coerce")
    port_rows["Cash Flow"] = pd.to_numeric(port_rows["Cash Flow"], errors="coerce")
    port_rows = port_rows.dropna()

    return inv_rows.reset_index(drop=True), port_rows.reset_index(drop=True)


def _parse_monthly_returns(xl: pd.ExcelFile) -> pd.DataFrame:
    df = xl.parse("Monthly Returns", header=4)
    df.columns = [
        "Month End", "Portfolio Value", "Deposits In Month",
        "Withdrawals In Month", "Monthly Return", "Cumulative Return",
    ]
    df = df.dropna(subset=["Month End", "Portfolio Value"])
    # Drop the summary rows at the bottom (non-date rows)
    df = df[pd.to_datetime(df["Month End"], errors="coerce").notna()].copy()
    df["Month End"] = pd.to_datetime(df["Month End"])
    for col in ["Portfolio Value", "Deposits In Month", "Withdrawals In Month",
                "Monthly Return", "Cumulative Return"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df.reset_index(drop=True)


# ── Public API ────────────────────────────────────────────────────────────────

def load_workbook(path: Path) -> WorkbookData:
    """Parse all relevant sheets from the Excel file into typed structures."""
    logger.info("Loading workbook: %s", path)
    xl = pd.ExcelFile(path, engine="openpyxl")

    trade_log = _parse_trade_log(xl)
    holdings, cutoff_date = _parse_holdings(xl)
    portfolio_metrics = _parse_portfolio_metrics(xl)
    irr_investor, irr_portfolio = _parse_irr_sheet(xl)
    monthly_returns = _parse_monthly_returns(xl)

    data = WorkbookData(
        trade_log=trade_log,
        holdings=holdings,
        portfolio_metrics=portfolio_metrics,
        irr_investor=irr_investor,
        irr_portfolio=irr_portfolio,
        monthly_returns=monthly_returns,
        cutoff_date=cutoff_date,
    )
    logger.info("Workbook loaded. %d trade rows, %d holdings, %d monthly rows.",
                len(trade_log), len(holdings), len(monthly_returns))
    return data
