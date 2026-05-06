import hmac
import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent))

from calculations import (
    BETA_UNAVAILABLE_WARNING,
    check_nav_reconciliation,
    compute_allocation,
    compute_distributions,
    compute_holdings,
    compute_irr,
    compute_kpis,
    compute_risk,
    compute_targets,
    compute_timeseries,
)
from cloud_db import db_enabled, init_schema, read_snapshot
from config import settings
from excel_loader import load_workbook

# ── Page config ───────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Ariete Invest — Investor Portal",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Colours ───────────────────────────────────────────────────────────────────

ORANGE = "#F97316"
GREEN  = "#22C55E"
RED    = "#EF4444"
MUTED  = "#6B7280"
BG     = "#1A1D27"
CARD   = "#23263A"

ALLOC_COLOURS = {
    "Stocks":     "#F97316",
    "Bonds":      "#3B82F6",
    "ETFs / ETCs":"#8B5CF6",
    "Crypto ETPs":"#F59E0B",
    "Cash":       "#6B7280",
}



def _is_authenticated() -> bool:
    return bool(st.session_state.get("authenticated", False))


def _check_password(password: str) -> bool:
    expected = settings.dashboard_password or ""
    return bool(expected) and hmac.compare_digest(password, expected)


def require_authentication() -> None:
    if _is_authenticated():
        return

    st.title("Ariete Invest Investor Portal")

    if not settings.dashboard_password:
        st.error("Access is locked because DASHBOARD_PASSWORD is not configured.")
        st.info("Set DASHBOARD_PASSWORD in Render environment variables, then redeploy.")
        st.stop()

    st.caption("Enter the company password to view the dashboard.")
    with st.form("login_form", clear_on_submit=False):
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Sign in", use_container_width=True)

    if submitted:
        if _check_password(password):
            st.session_state["authenticated"] = True
            st.rerun()
        st.error("Incorrect password.")

    st.stop()

# ── Data loading (cached) ─────────────────────────────────────────────────────

@st.cache_data(show_spinner="Loading workbook…")
def load_data(workbook_mtime_ns: int):
    _ = workbook_mtime_ns
    data = load_workbook(settings.excel_path)
    kpis   = compute_kpis(data, settings)
    ts     = compute_timeseries(data)
    alloc  = compute_allocation(data)
    irr    = compute_irr(data)
    risk   = compute_risk(data, settings)
    dist   = compute_distributions(data)
    tgt    = compute_targets(data, settings)
    holds  = compute_holdings(data)
    warns  = check_nav_reconciliation(data, settings.nav_reconciliation_tolerance)
    pm     = data.portfolio_metrics
    ds     = data.dashboard_summary
    return kpis, ts, alloc, irr, risk, dist, tgt, holds, warns, pm, ds


def _workbook_mtime_ns() -> int:
    try:
        return settings.excel_path.stat().st_mtime_ns
    except FileNotFoundError:
        return 0

require_authentication()
if db_enabled():
    init_schema()

kpis, ts, alloc, irr, risk, dist, tgt, holds, warns, pm, dashboard_summary = load_data(_workbook_mtime_ns())
cloud_snapshot = None
if db_enabled():
    try:
        cloud_snapshot = read_snapshot(holds.cutoff_date)
    except Exception as exc:
        st.warning(f"Cloud data unavailable: {exc}")
        cloud_snapshot = None

# ── Reload button ─────────────────────────────────────────────────────────────

with st.sidebar:
    st.title("Controls")
    if st.button("Sign out", use_container_width=True):
        st.session_state["authenticated"] = False
        st.rerun()
    if st.button("🔄 Reload Excel", use_container_width=True):
        st.cache_data.clear()
        st.rerun()
    st.caption(f"As of **{holds.cutoff_date}**")
    st.caption(f"Investor: **{settings.investor_name}**")
    st.caption(f"Portfolio: **{settings.portfolio_id}**")

# ── Header ────────────────────────────────────────────────────────────────────

st.markdown(f"## 📊 Ariete Invest — Investor Dashboard")
st.markdown(f"<span style='color:{MUTED}'>As of {holds.cutoff_date} &nbsp;·&nbsp; {settings.investor_name} &nbsp;·&nbsp; {settings.portfolio_id}</span>", unsafe_allow_html=True)

if warns:
    for w in warns:
        st.warning(f"**{w.code}**: {w.message}", icon="⚠️")

st.divider()

# ── Helper: colour a delta ────────────────────────────────────────────────────

def _pct(v: float) -> str:
    return f"{v:+.2%}"

def _eur(v: float) -> str:
    return f"€{v:,.0f}"

# ── KPI Cards ─────────────────────────────────────────────────────────────────

def _summary_rows(section: str) -> pd.DataFrame:
    if dashboard_summary.empty or "section" not in dashboard_summary.columns:
        return pd.DataFrame()
    return dashboard_summary[dashboard_summary["section"] == section].copy()

def _metric_value(*labels: str, default: float = 0.0) -> float:
    for label in labels:
        value = pm.get(label)
        if value is not None:
            return float(value)
    return default

def _summary_total(section: str) -> float:
    if cloud_snapshot is not None:
        if section == "Non-Listed":
            return float(cloud_snapshot.non_listed_total)
        if section == "Cash":
            return float(cloud_snapshot.cash_total)
    rows = _summary_rows(section)
    if rows.empty or "value" not in rows.columns:
        return 0.0
    return float(pd.to_numeric(rows["value"], errors="coerce").fillna(0).sum())

def _partition_values() -> dict[str, float]:
    return {
        "Listed": _summary_total("Listed"),
        "Non-Listed": _summary_total("Non-Listed"),
        "Cash": _summary_total("Cash"),
    }

def _partition_card(label: str, value: float, total: float, note: str, colour: str) -> None:
    weight = value / total if total else 0.0
    st.markdown(
        f"""
        <div style="border:1px solid #2D3147;border-radius:8px;padding:16px;background:{CARD};">
          <div style="font-size:13px;color:#AEB6C2;margin-bottom:6px;">{label}</div>
          <div style="font-size:28px;font-weight:700;color:#FAFAFA;">EUR {value:,.0f}</div>
          <div style="font-size:13px;color:{colour};margin-top:4px;">{weight:.1%} of total</div>
          <div style="font-size:12px;color:#AEB6C2;margin-top:8px;">{note}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

def _render_partition_block() -> None:
    partition = _partition_values()
    total = sum(partition.values())
    if not total:
        return

    st.subheader("Portfolio Composition by Data Source")
    c1, c2, c3 = st.columns(3)
    with c1:
        _partition_card(
            "Listed / Market-Priced",
            partition["Listed"],
            total,
            "Directa/Vasco listed instruments",
            ORANGE,
        )
    with c2:
        _partition_card(
            "Non-Listed / Approved Values",
            partition["Non-Listed"],
            total,
            "Admin-entered monthly values",
            "#A78BFA",
        )
    with c3:
        _partition_card(
            "Cash",
            partition["Cash"],
            total,
            "Directa cash plus external cash",
            "#94A3B8",
        )

    partition_df = pd.DataFrame([
        {
            "Source": key,
            "Value": value,
            "Weight": value / total if total else 0.0,
        }
        for key, value in partition.items()
    ])
    fig_partition = px.bar(
        partition_df,
        x="Weight",
        y=["Portfolio"] * len(partition_df),
        color="Source",
        orientation="h",
        text=partition_df["Weight"].map(lambda x: f"{x:.1%}"),
        color_discrete_map={
            "Listed": ORANGE,
            "Non-Listed": "#A78BFA",
            "Cash": "#94A3B8",
        },
        hover_data={"Value": ":,.0f", "Weight": ":.1%", "Source": True},
    )
    fig_partition.update_layout(
        paper_bgcolor=BG,
        plot_bgcolor=BG,
        font_color="#FAFAFA",
        xaxis=dict(visible=False, range=[0, 1]),
        yaxis=dict(visible=False),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(l=0, r=0, t=30, b=0),
        height=145,
        barmode="stack",
    )
    st.plotly_chart(fig_partition, use_container_width=True)

    st.caption(
        "Listed assets use market-priced Directa/Vasco data. "
        "Non-listed assets use monthly admin-approved values. "
        "Cash is separated so Directa cash and external cash are not hidden inside performance metrics."
    )

view = st.radio(
    "Dashboard section",
    ["Overview", "Listed", "Non-Listed", "Cash"],
    horizontal=True,
    label_visibility="collapsed",
)

if view == "Non-Listed":
    st.subheader("Non-Listed Assets")
    rows = _summary_rows("Non-Listed")
    if rows.empty:
        st.info("No non-listed monthly values have been entered yet.")
    else:
        st.metric("Total Non-Listed Value", _eur(_summary_total("Non-Listed")))
        st.caption("Latest monthly values entered by admin. These are not treated as market-priced positions.")
        display_cols = [
            "display_name", "subcategory", "value", "currency",
            "as_of_date", "source", "method", "notes",
        ]
        available = [c for c in display_cols if c in rows.columns]
        st.dataframe(
            rows[available].style.format({"value": "â‚¬{:,.0f}"}),
            use_container_width=True,
            hide_index=True,
        )
    st.stop()

if view == "Cash":
    st.subheader("Cash")
    rows = _summary_rows("Cash")
    if rows.empty:
        st.info("No cash breakdown is available yet.")
    else:
        st.metric("Total Cash", _eur(_summary_total("Cash")))
        st.caption("Directa cash is reconstructed automatically; external and restricted cash come from admin monthly values.")
        display_cols = [
            "display_name", "subcategory", "value", "currency",
            "as_of_date", "source", "method", "notes",
        ]
        available = [c for c in display_cols if c in rows.columns]
        st.dataframe(
            rows[available].style.format({"value": "â‚¬{:,.0f}"}),
            use_container_width=True,
            hide_index=True,
        )
    st.stop()

if view == "Listed":
    st.subheader("Listed / Market-Priced Assets")
    st.caption("This section uses the existing Directa/Vasco preprocessing flow and keeps listed-market metrics such as TWR, volatility, Sharpe, and drawdown.")

capital_committed_display = float(kpis.capital_committed)
if cloud_snapshot is not None and cloud_snapshot.capital_committed is not None:
    capital_committed_display = float(cloud_snapshot.capital_committed)
    kpis = kpis.model_copy(
        update={
            "capital_committed": capital_committed_display,
            "pct_since_entry": ((kpis.total_portfolio_value - capital_committed_display) / capital_committed_display)
            if capital_committed_display
            else 0.0,
            "moic": ((kpis.total_portfolio_value + kpis.distributions_total) / capital_committed_display)
            if capital_committed_display
            else 0.0,
        }
    )

c1, c2, c3, c4, c5, c6 = st.columns(6)

c1.metric("Portfolio Value",  _eur(kpis.total_portfolio_value),
          delta=_pct(kpis.pct_since_entry))

c2.metric("Capital Committed", _eur(capital_committed_display))

c3.metric("MOIC",
          f"{kpis.moic:.3f}×",
          delta=f"target {kpis.moic_target:.1f}×",
          delta_color="off")

c4.metric("Investor IRR",  _pct(irr.investor_irr))

c5.metric("Current Yield", _pct(kpis.current_yield))

c6.metric("Total Income",
          _eur(kpis.distributions_total),
          delta=f"{kpis.distributions_count} payments",
          delta_color="off")

listed_total = _summary_total("Listed")
nonlisted_total = _summary_total("Non-Listed")
cash_total = _summary_total("Cash")
if listed_total or nonlisted_total or cash_total:
    _render_partition_block()

st.divider()

# ── NAV Chart + Allocation ────────────────────────────────────────────────────

col_nav, col_alloc = st.columns([3, 2])

with col_nav:
    st.subheader("Portfolio Value Over Time")

    nav_df = pd.DataFrame([
        {"Month": p.month_end, "NAV (€)": p.nav, "TWR Return": p.cumulative_return}
        for p in ts.series
    ])

    fig_nav = go.Figure()
    fig_nav.add_trace(go.Scatter(
        x=nav_df["Month"], y=nav_df["NAV (€)"],
        mode="lines+markers",
        name="NAV",
        line=dict(color=ORANGE, width=2.5),
        marker=dict(size=5),
        hovertemplate="%{x|%b %Y}<br>€%{y:,.0f}<extra></extra>",
    ))
    # Dashed TWR index on secondary axis
    twr_base = nav_df["TWR Return"].iloc[0] if not nav_df.empty else 0
    fig_nav.add_trace(go.Scatter(
        x=nav_df["Month"],
        y=(1 + nav_df["TWR Return"]) * 100,
        mode="lines",
        name="TWR Index (base 100)",
        line=dict(color=GREEN, width=1.5, dash="dash"),
        yaxis="y2",
        hovertemplate="%{x|%b %Y}<br>TWR index: %{y:.1f}<extra></extra>",
    ))
    fig_nav.update_layout(
        paper_bgcolor=BG, plot_bgcolor=BG,
        font_color="#FAFAFA",
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        yaxis=dict(title="NAV (€)", tickformat="€,.0f", gridcolor="#2D3147"),
        yaxis2=dict(title="TWR Index", overlaying="y", side="right",
                    tickformat=".0f", gridcolor="#2D3147"),
        xaxis=dict(gridcolor="#2D3147"),
        margin=dict(l=0, r=0, t=30, b=0),
        hovermode="x unified",
    )
    st.plotly_chart(fig_nav, use_container_width=True)

with col_alloc:
    st.subheader("Current Allocation")

    alloc_df = pd.DataFrame([
        {"Asset Class": s.asset_class, "Value": s.market_value, "Weight": s.weight}
        for s in alloc.slices
    ])
    colours = [ALLOC_COLOURS.get(ac, "#CBD5E1") for ac in alloc_df["Asset Class"]]

    fig_pie = go.Figure(go.Pie(
        labels=alloc_df["Asset Class"],
        values=alloc_df["Weight"],
        hole=0.55,
        marker_colors=colours,
        textinfo="label+percent",
        hovertemplate="%{label}<br>€%{customdata:,.0f}<br>%{percent}<extra></extra>",
        customdata=alloc_df["Value"],
    ))
    fig_pie.update_layout(
        paper_bgcolor=BG,
        font_color="#FAFAFA",
        showlegend=False,
        margin=dict(l=0, r=0, t=10, b=0),
    )
    st.plotly_chart(fig_pie, use_container_width=True)

st.divider()

# ── Risk + IRR + Target ───────────────────────────────────────────────────────

col_risk, col_irr, col_target = st.columns(3)

with col_risk:
    st.subheader("Risk Metrics")
    st.metric("Sharpe Ratio",       f"{risk.sharpe_ratio:.3f}")
    st.metric("Ann. Volatility",    _pct(risk.volatility_annualized))
    st.metric("Max Drawdown",       _pct(risk.max_drawdown))
    st.metric("Ann. Return (TWR)",  _pct(risk.annualized_return))
    st.metric("Risk-Free Rate",     _pct(risk.risk_free_rate))
    st.metric("Data Window",        f"{risk.data_window_months} months")
    if risk.beta_vs_msci_world is None:
        st.caption("β vs MSCI World: n/a (no benchmark data)")

with col_irr:
    st.subheader("IRR Analysis")
    st.metric("Investor IRR",  _pct(irr.investor_irr))
    st.metric("Fund IRR",      _pct(irr.fund_irr))
    st.metric("Valuation Date", str(irr.valuation_date))
    st.divider()
    st.subheader("P&L Breakdown")
    st.metric("Unrealized P&L", _eur(_metric_value("Unrealized P&L", "Total Unrealized P&L")))
    st.metric("Realized P&L",   _eur(_metric_value("Realized P&L", "Total Realized P&L")))
    st.metric("Net Total P&L",  _eur(_metric_value("Net Total P&L")))

with col_target:
    st.subheader("Target vs Actual")

    target_df = pd.DataFrame([
        {"Class": "Equities", "Target": tgt.target_equity_pct,   "Actual": tgt.current_equity_pct},
        {"Class": "Bonds",    "Target": tgt.target_bond_pct,     "Actual": tgt.current_bond_pct},
        {"Class": "Alts",     "Target": tgt.target_alt_pct,      "Actual": tgt.current_alt_pct},
        {"Class": "Cash",     "Target": 0.0,                      "Actual": tgt.current_cash_pct},
    ])
    target_long = target_df.melt(id_vars="Class", var_name="Series", value_name="Weight")

    fig_bar = px.bar(
        target_long, x="Class", y="Weight", color="Series",
        barmode="group",
        color_discrete_map={"Target": ORANGE, "Actual": GREEN},
        labels={"Weight": "Allocation"},
        text_auto=".0%",
    )
    fig_bar.update_layout(
        paper_bgcolor=BG, plot_bgcolor=BG,
        font_color="#FAFAFA",
        yaxis=dict(tickformat=".0%", gridcolor="#2D3147"),
        xaxis=dict(gridcolor="#2D3147"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        margin=dict(l=0, r=0, t=30, b=0),
    )
    st.plotly_chart(fig_bar, use_container_width=True)

st.divider()

# ── Distributions Table ───────────────────────────────────────────────────────

st.subheader(f"Income Received  ·  Total: **{_eur(dist.total)}**")

dist_df = pd.DataFrame([
    {"Date": e.date, "Security": e.security, "Type": e.income_type, "Amount (€)": e.amount}
    for e in dist.events
])

if not dist_df.empty:
    dist_df = dist_df.sort_values("Date", ascending=False)
    st.dataframe(
        dist_df.style.format({"Amount (€)": "€{:,.2f}"}),
        use_container_width=True,
        hide_index=True,
        height=300,
    )

st.divider()

# ── Holdings Table ────────────────────────────────────────────────────────────

st.subheader(f"Holdings  ·  {len([h for h in holds.holdings if h.shares > 0])} open positions")

holds_df = pd.DataFrame([
    {
        "Security":    h.security,
        "Class":       h.asset_class,
        "CCY":         h.currency,
        "Shares":      h.shares,
        "Avg Cost":    h.avg_cost,
        "Market Val":  h.market_value,
        "Unreal. P&L": h.unrealized_pnl,
        "P&L %":       h.pnl_pct,
        "Weight":      h.weight,
    }
    for h in holds.holdings
    if h.shares > 0   # only open positions
])

def _colour_pnl(val: float) -> str:
    return f"color: {GREEN}" if val >= 0 else f"color: {RED}"

if not holds_df.empty:
    holds_df = holds_df.sort_values("Market Val", ascending=False)
    st.dataframe(
        holds_df.style.format({
            "Avg Cost":    "{:.3f}",
            "Market Val":  "€{:,.0f}",
            "Unreal. P&L": "€{:,.0f}",
            "P&L %":       "{:.2%}",
            "Weight":      "{:.2%}",
        }).map(_colour_pnl, subset=["P&L %", "Unreal. P&L"]),
        use_container_width=True,
        hide_index=True,
        height=500,
    )
