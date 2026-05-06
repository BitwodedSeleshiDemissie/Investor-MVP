import hmac
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import streamlit as st
from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).parent))

from cloud_db import (
    db_enabled,
    init_schema,
    insert_control,
    insert_manual_value,
    read_active_dictionary,
    read_controls,
    read_manual_values,
    upsert_asset_dictionary,
)
from config import settings


st.set_page_config(
    page_title="Ariete Admin Upload Portal",
    page_icon="⚙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

PREPROCESSING_DIR = Path(__file__).resolve().parents[2] / "Ariete preprocessing" / "preprocessing"
ADMIN_INPUTS_DIR = PREPROCESSING_DIR / "admin_inputs"
CONTROLS_PATH = ADMIN_INPUTS_DIR / "controls.csv"
DICTIONARY_PATH = ADMIN_INPUTS_DIR / "asset_dictionary.csv"
MANUAL_VALUES_PATH = ADMIN_INPUTS_DIR / "monthly_manual_values.csv"


def _is_authenticated() -> bool:
    return bool(st.session_state.get("admin_authenticated", False))


def _check_password(password: str) -> bool:
    expected = settings.dashboard_password or ""
    return bool(expected) and hmac.compare_digest(password, expected)


def require_authentication() -> None:
    if _is_authenticated():
        return
    st.title("Ariete Admin Upload Portal")
    if not settings.dashboard_password:
        st.error("Access is locked because DASHBOARD_PASSWORD is not configured.")
        st.stop()
    with st.form("admin_login", clear_on_submit=False):
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Sign in", use_container_width=True)
    if submitted:
        if _check_password(password):
            st.session_state["admin_authenticated"] = True
            st.rerun()
        st.error("Incorrect password.")
    st.stop()


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


def _append_row(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = _read_csv(path)
    pd.concat([existing, pd.DataFrame([row])], ignore_index=True).to_csv(path, index=False)


def _active_dictionary() -> pd.DataFrame:
    if db_enabled():
        return pd.DataFrame(read_active_dictionary())
    df = _read_csv(DICTIONARY_PATH)
    if df.empty:
        return df
    active = df.get("active", "true").astype(str).str.lower().isin(["true", "1", "yes"])
    return df[active].copy()


def _default_as_of_date() -> date:
    try:
        wb = load_workbook(settings.excel_path, data_only=True, read_only=True)
        value = wb["Holdings"]["G3"].value
        wb.close()
        if hasattr(value, "date"):
            return value.date()
        return pd.to_datetime(value).date()
    except Exception:
        return date.today()


def _save_dictionary(row: dict) -> None:
    if db_enabled():
        upsert_asset_dictionary(row)
        return
    local = row.copy()
    local["active"] = "true" if row.get("active", True) else "false"
    _append_row(DICTIONARY_PATH, local)


def _save_manual_value(row: dict) -> None:
    if db_enabled():
        insert_manual_value(row)
    else:
        _append_row(MANUAL_VALUES_PATH, row)


def _save_control(row: dict) -> None:
    if db_enabled():
        insert_control(row)
    else:
        _append_row(CONTROLS_PATH, row)


require_authentication()
if db_enabled():
    init_schema()
default_as_of_date = _default_as_of_date()

with st.sidebar:
    st.title("Portal actions")
    if st.button("Sign out", use_container_width=True):
        st.session_state["admin_authenticated"] = False
        st.rerun()

st.title("Ariete Admin Upload Portal")

upload_type = st.radio(
    "What are you adding?",
    ["Listed instruments", "Non-listed values", "Cash values", "Portfolio inputs"],
    horizontal=True,
)

if upload_type == "Listed instruments":
    st.subheader("Listed Instruments")
    uploads = st.file_uploader("Monthly statement CSV files", type=["csv"], accept_multiple_files=True)
    if st.button("Save listed files", use_container_width=True):
        if db_enabled():
            st.info("Listed files are saved. Non-listed/cash/portfolio inputs are committed immediately to cloud data.")
        saved = 0
        for upload in uploads or []:
            target = PREPROCESSING_DIR / Path(upload.name).name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(upload.getbuffer())
            saved += 1
        st.success(f"Saved {saved} file(s).")

elif upload_type == "Non-listed values":
    st.subheader("Non-Listed Values")
    dictionary = _active_dictionary()
    non_listed = dictionary[dictionary.get("item_type", "").astype(str) == "Non-Listed"] if not dictionary.empty else pd.DataFrame()

    with st.expander("Add non-listed asset"):
        with st.form("add_nonlisted_dictionary"):
            item_key = st.text_input("Asset key", placeholder="PRIVATE_EQUITY_002")
            display_name = st.text_input("Display name", placeholder="Private Equity Holding B")
            subcategory = st.text_input("Subcategory", placeholder="Private Equity")
            currency = st.text_input("Currency", value="EUR")
            sort_order = st.number_input("Sort order", min_value=0, step=1, value=10)
            submitted = st.form_submit_button("Add non-listed asset", use_container_width=True)
            if submitted and item_key:
                _save_dictionary(
                    {
                        "item_key": item_key,
                        "display_name": display_name,
                        "item_type": "Non-Listed",
                        "subcategory": subcategory,
                        "currency": currency,
                        "active": True,
                        "sort_order": sort_order,
                        "notes": "",
                    }
                )
                st.success("Non-listed asset added.")
                st.rerun()

    if non_listed.empty:
        st.info("No active non-listed assets are available yet.")
    else:
        labels = {row["item_key"]: f"{row['display_name']} ({row['subcategory']})" for _, row in non_listed.iterrows()}
        with st.form("nonlisted_value"):
            item_key = st.selectbox("Non-listed asset", list(labels.keys()), format_func=lambda k: labels[k])
            as_of_date = st.date_input("Valuation date", value=default_as_of_date)
            value = st.number_input("Latest approved value", min_value=0.0, step=1000.0)
            submitted = st.form_submit_button("Save non-listed value", use_container_width=True)
            if submitted:
                selected = non_listed[non_listed["item_key"].astype(str) == str(item_key)].iloc[0]
                _save_manual_value(
                    {
                        "as_of_date": as_of_date.isoformat(),
                        "item_key": item_key,
                        "value": value,
                        "currency": selected.get("currency", "EUR"),
                        "valuation_source": "Admin input",
                        "valuation_method": "Monthly approved value",
                        "notes": "",
                    }
                )
                st.success("Non-listed value saved.")

elif upload_type == "Cash values":
    st.subheader("Cash Values")
    dictionary = _active_dictionary()
    cash_items = dictionary[dictionary.get("item_type", "").astype(str) == "Cash"] if not dictionary.empty else pd.DataFrame()

    with st.expander("Add cash option"):
        with st.form("add_cash_dictionary"):
            item_key = st.text_input("Cash key", placeholder="EXTERNAL_CASH_USD")
            display_name = st.text_input("Display name", placeholder="External Cash USD")
            subcategory = st.text_input("Subcategory", placeholder="External Bank Cash")
            currency = st.text_input("Currency", value="EUR")
            sort_order = st.number_input("Sort order", min_value=0, step=1, value=20)
            submitted = st.form_submit_button("Add cash option", use_container_width=True)
            if submitted and item_key:
                _save_dictionary(
                    {
                        "item_key": item_key,
                        "display_name": display_name,
                        "item_type": "Cash",
                        "subcategory": subcategory,
                        "currency": currency,
                        "active": True,
                        "sort_order": sort_order,
                        "notes": "",
                    }
                )
                st.success("Cash option added.")
                st.rerun()

    if cash_items.empty:
        st.info("No active cash options are available yet.")
    else:
        labels = {row["item_key"]: f"{row['display_name']} ({row['subcategory']})" for _, row in cash_items.iterrows()}
        with st.form("cash_value"):
            item_key = st.selectbox("Cash option", list(labels.keys()), format_func=lambda k: labels[k])
            as_of_date = st.date_input("Balance date", value=default_as_of_date)
            value = st.number_input("Balance amount", min_value=0.0, step=1000.0)
            submitted = st.form_submit_button("Save cash value", use_container_width=True)
            if submitted:
                selected = cash_items[cash_items["item_key"].astype(str) == str(item_key)].iloc[0]
                _save_manual_value(
                    {
                        "as_of_date": as_of_date.isoformat(),
                        "item_key": item_key,
                        "value": value,
                        "currency": selected.get("currency", "EUR"),
                        "valuation_source": "Admin input",
                        "valuation_method": "Monthly cash value",
                        "notes": "",
                    }
                )
                st.success("Cash value saved.")

else:
    st.subheader("Portfolio Inputs")
    with st.form("controls"):
        as_of_date = st.date_input("As-of date", value=default_as_of_date)
        capital_committed = st.number_input("Capital committed", min_value=0.0, step=1000.0)
        submitted = st.form_submit_button("Save controls", use_container_width=True)
        if submitted:
            _save_control(
                {
                    "portfolio_id": settings.portfolio_id,
                    "investor_name": settings.investor_name,
                    "as_of_date": as_of_date.isoformat(),
                    "capital_committed": capital_committed,
                    "currency": "EUR",
                    "notes": "Admin-entered official capital commitment",
                }
            )
            st.success("Portfolio inputs saved.")

st.divider()
st.subheader("Current Admin Inputs")
tab1, tab2, tab3 = st.tabs(["Dictionary", "Monthly Values", "Portfolio Inputs"])
with tab1:
    df = pd.DataFrame(read_active_dictionary()) if db_enabled() else _read_csv(DICTIONARY_PATH)
    st.dataframe(df, use_container_width=True, hide_index=True)
with tab2:
    df = pd.DataFrame(read_manual_values()) if db_enabled() else _read_csv(MANUAL_VALUES_PATH)
    st.dataframe(df, use_container_width=True, hide_index=True)
with tab3:
    controls_df = pd.DataFrame(read_controls()) if db_enabled() else _read_csv(CONTROLS_PATH)
    visible_cols = [c for c in ["as_of_date", "capital_committed", "currency"] if c in controls_df.columns]
    st.dataframe(controls_df[visible_cols], use_container_width=True, hide_index=True)
