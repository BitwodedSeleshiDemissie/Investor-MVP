import hmac
import importlib
import json
import sys
import re
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import streamlit as st
from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).parent))

from cloud_db import (
    db_enabled,
    init_schema,
    insert_anagrafe_baseline,
    insert_control,
    insert_manual_value,
    read_anagrafe_json_store,
    read_active_dictionary,
    read_controls,
    read_manual_values,
    write_anagrafe_json_store,
    upsert_asset_dictionary,
)
from config import settings
from anagrafe import sync_current_anagrafe_from_database


st.set_page_config(
    page_title="Ariete Admin Upload Portal",
    page_icon="âš™ï¸",
    layout="wide",
    initial_sidebar_state="expanded",
)

APP_CSS = """
<style>
    :root {
        --app-bg: #0f1117;
        --panel-bg: #1a1d27;
        --panel-border: #2a2f3d;
        --ink: #f0f2f6;
        --muted: #8b93a7;
        --accent: #F97316;
        --accent-strong: #ea6a0a;
        --accent-dim: rgba(249,115,22,0.15);
        --radius: 10px;
    }

    /* ── Base ─────────────────────────────── */
    .stApp { background: var(--app-bg) !important; color: var(--ink) !important; }
    .main, .main > div, .block-container { background: var(--app-bg) !important; }
    .block-container { max-width: 1100px; padding-top: 2.25rem; padding-bottom: 5rem; }

    /* ── Sidebar ──────────────────────────── */
    [data-testid="stSidebar"] {
        background: #080b12 !important;
        border-right: 1px solid var(--panel-border) !important;
    }
    [data-testid="stSidebar"] * { color: #c9d0de !important; }
    [data-testid="stSidebar"] .stButton > button {
        background: rgba(255,255,255,0.06) !important;
        color: #c9d0de !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        border-radius: 8px !important;
        font-size: 13px !important;
        margin-top: 12px;
    }
    [data-testid="stSidebar"] .stButton > button:hover {
        background: rgba(255,255,255,0.11) !important;
        border-color: rgba(255,255,255,0.2) !important;
    }

    /* ── Metrics ──────────────────────────── */
    div[data-testid="stMetric"] {
        background: var(--panel-bg) !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: var(--radius) !important;
        padding: 16px 20px !important;
    }
    div[data-testid="stMetric"] label { color: var(--muted) !important; font-size: 12px !important; }
    div[data-testid="stMetric"] [data-testid="stMetricValue"] { color: var(--ink) !important; }

    /* ── Forms ────────────────────────────── */
    div[data-testid="stForm"] {
        background: var(--panel-bg) !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: var(--radius) !important;
        padding: 22px 24px !important;
    }

    /* ── Expanders ────────────────────────── */
    div[data-testid="stExpander"] details {
        background: var(--panel-bg) !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: var(--radius) !important;
    }
    div[data-testid="stExpander"] summary {
        color: var(--ink) !important;
        font-weight: 600 !important;
        font-size: 14px !important;
    }
    div[data-testid="stExpander"] summary:hover { color: var(--accent) !important; }

    /* ── Input fields ─────────────────────── */
    label,
    .stTextInput label, .stNumberInput label,
    .stDateInput label, .stSelectbox label {
        color: var(--muted) !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
    }
    .stTextInput input, .stNumberInput input, .stDateInput input {
        background: #13161f !important;
        color: var(--ink) !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 7px !important;
        font-size: 14px !important;
    }
    .stTextInput input:focus, .stNumberInput input:focus {
        border-color: var(--accent) !important;
        box-shadow: 0 0 0 2px var(--accent-dim) !important;
    }
    .stTextInput input::placeholder, .stNumberInput input::placeholder {
        color: #4a5168 !important;
    }

    /* ── Selectbox ────────────────────────── */
    div[data-testid="stSelectbox"] > div > div {
        background: #13161f !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 7px !important;
        color: var(--ink) !important;
    }

    /* ── File uploader ────────────────────── */
    div[data-testid="stFileUploader"] section {
        background: #13161f !important;
        border: 1.5px dashed var(--panel-border) !important;
        border-radius: var(--radius) !important;
    }
    div[data-testid="stFileUploader"] section:hover {
        border-color: var(--accent) !important;
        background: var(--accent-dim) !important;
    }
    div[data-testid="stFileUploaderDropzone"] button,
    div[data-testid="stFileUploader"] button {
        background: var(--panel-bg) !important;
        color: var(--ink) !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 7px !important;
        font-weight: 600 !important;
        font-size: 13px !important;
    }
    div[data-testid="stFileUploaderDropzone"] button:hover,
    div[data-testid="stFileUploader"] button:hover {
        border-color: var(--accent) !important;
        color: var(--accent) !important;
    }
    div[data-testid="stFileUploader"] small,
    div[data-testid="stFileUploaderDropzone"] small { color: var(--muted) !important; }

    /* ── Buttons ──────────────────────────── */
    .stButton > button, .stDownloadButton > button {
        background: var(--panel-bg) !important;
        color: var(--ink) !important;
        border: 1px solid var(--panel-border) !important;
        border-radius: 8px !important;
        font-weight: 600 !important;
        font-size: 14px !important;
        transition: border-color 0.15s, background 0.15s;
    }
    .stButton > button:hover, .stDownloadButton > button:hover {
        border-color: var(--accent) !important;
        color: var(--accent) !important;
        background: var(--accent-dim) !important;
    }
    .stButton > button[kind="primary"],
    .stButton > button[data-testid="baseButton-primary"] {
        background: var(--accent) !important;
        border-color: var(--accent) !important;
        color: #ffffff !important;
        font-weight: 700 !important;
    }
    .stButton > button[kind="primary"]:hover,
    .stButton > button[data-testid="baseButton-primary"]:hover {
        background: var(--accent-strong) !important;
        border-color: var(--accent-strong) !important;
        color: #ffffff !important;
    }
    .stButton > button:disabled, .stDownloadButton > button:disabled {
        opacity: 0.4 !important;
    }

    /* ── Tabs ─────────────────────────────── */
    .stTabs [data-testid="stTab"] {
        font-weight: 600 !important;
        font-size: 13px !important;
        color: var(--muted) !important;
        background: transparent !important;
    }
    .stTabs [aria-selected="true"] {
        color: var(--accent) !important;
        border-bottom-color: var(--accent) !important;
    }

    /* ── Dataframe ────────────────────────── */
    div[data-testid="stDataFrame"] {
        border: 1px solid var(--panel-border) !important;
        border-radius: var(--radius) !important;
        overflow: hidden;
    }

    /* ── Alerts ───────────────────────────── */
    div[data-testid="stAlert"] { border-radius: 8px !important; font-size: 13px !important; }

    /* ── Radio ────────────────────────────── */
    .stRadio [data-testid="stMarkdownContainer"] p {
        font-size: 14px !important;
        font-weight: 500 !important;
        color: var(--ink) !important;
    }

    /* ── Divider ──────────────────────────── */
    hr { border-color: var(--panel-border) !important; }

    /* ── Custom HTML components ───────────── */
    .app-hero {
        background: var(--panel-bg);
        border: 1px solid var(--panel-border);
        border-left: 3px solid var(--accent);
        border-radius: var(--radius);
        padding: 24px 28px;
        margin-bottom: 20px;
    }
    .app-eyebrow {
        color: var(--accent);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 6px;
    }
    .app-title { color: var(--ink); font-size: 26px; font-weight: 750; margin: 0; }
    .app-subtitle { color: var(--muted); font-size: 14px; margin-top: 6px; line-height: 1.55; }

    .status-card {
        background: var(--panel-bg);
        border: 1px solid var(--panel-border);
        border-radius: var(--radius);
        padding: 16px 20px;
        min-height: 80px;
    }
    .status-label {
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        margin-bottom: 6px;
    }
    .status-value { color: var(--ink); font-size: 15px; font-weight: 700; word-break: break-word; }

    .section-heading { color: var(--ink); font-size: 17px; font-weight: 700; margin: 0 0 4px 0; }
    .section-note { color: var(--muted); font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
</style>
"""


def _apply_admin_theme() -> None:
    st.markdown(APP_CSS, unsafe_allow_html=True)


def _page_header(eyebrow: str, title: str, subtitle: str) -> None:
    st.markdown(
        f"""
        <div class="app-hero">
            <div class="app-eyebrow">{eyebrow}</div>
            <div class="app-title">{title}</div>
            <div class="app-subtitle">{subtitle}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _status_card(label: str, value: str) -> None:
    st.markdown(
        f"""
        <div class="status-card">
            <div class="status-label">{label}</div>
            <div class="status-value">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _section_note(text: str) -> None:
    st.markdown(f'<p class="section-note">{text}</p>', unsafe_allow_html=True)


def _section_heading(title: str, note: str = "") -> None:
    note_html = f'<p class="section-note">{note}</p>' if note else ""
    st.markdown(
        f'<p class="section-heading">{title}</p>{note_html}',
        unsafe_allow_html=True,
    )


_apply_admin_theme()

PREPROCESSING_DIR = Path(__file__).resolve().parents[2] / "Ariete preprocessing" / "preprocessing"
ADMIN_INPUTS_DIR = PREPROCESSING_DIR / "admin_inputs"
CONTROLS_PATH = ADMIN_INPUTS_DIR / "controls.csv"
DICTIONARY_PATH = ADMIN_INPUTS_DIR / "asset_dictionary.csv"
MANUAL_VALUES_PATH = ADMIN_INPUTS_DIR / "monthly_manual_values.csv"
ANAGRAFE_TOOLKIT_DIR = Path(__file__).resolve().parents[2] / "anagraph" / "directa-anagrafe-toolkit"
ANAGRAFE_REPORTS_DIR = PREPROCESSING_DIR / "anagrafe_reports"
ANAGRAFE_CACHE_PATH = ANAGRAFE_REPORTS_DIR / "company-data.openai.json"
ANAGRAFE_BASELINE_PATH = ANAGRAFE_REPORTS_DIR / "current_anagrafe.xlsx"
ANAGRAFE_STORE_DEFAULTS = {
    "instrument_type_overrides": {},
    "metadata_cache": {"companies": []},
    "match_overrides": {},
    "ignore_list": [],
    "resolutions_log": [],
}
ANAGRAFE_STORE_FILES = {
    "instrument_type_overrides": ANAGRAFE_REPORTS_DIR / "instrument_type_overrides.json",
    "metadata_cache": ANAGRAFE_CACHE_PATH,
    "match_overrides": ANAGRAFE_REPORTS_DIR / "match_overrides.json",
    "ignore_list": ANAGRAFE_REPORTS_DIR / "ignore_list.json",
    "resolutions_log": ANAGRAFE_REPORTS_DIR / "resolutions_log.json",
}


def _is_authenticated() -> bool:
    return bool(st.session_state.get("admin_authenticated", False))


def _check_password(password: str) -> bool:
    expected = settings.dashboard_password or ""
    return bool(expected) and hmac.compare_digest(password, expected)


def require_authentication() -> None:
    if _is_authenticated():
        return
    _page_header(
        "Admin access",
        "Ariete Admin Upload Portal",
        "Sign in to manage monthly reports, cash balances, non-listed values, and portfolio inputs.",
    )
    if not settings.dashboard_password:
        st.error("Access is locked because DASHBOARD_PASSWORD is not configured.")
        st.stop()
    with st.form("admin_login", clear_on_submit=False):
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Sign in", width="stretch")
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
        df = pd.DataFrame(read_active_dictionary())
        if not df.empty and "item_key" in df.columns:
            mask = df["item_key"].astype(str) == "RESTRICTED_CASH_EUR"
            if "display_name" in df.columns:
                df.loc[mask, "display_name"] = "Short Term Receivable EUR"
            if "subcategory" in df.columns:
                df.loc[mask, "subcategory"] = "Short Term Receivable"
        return df
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


def _latest_completed_month() -> date:
    pattern = re.compile(r"Estratto Conto (\d{4})-(\d{2})-(\d{2})\.csv$", re.IGNORECASE)
    latest: date | None = None
    for path in PREPROCESSING_DIR.glob("Estratto Conto *.csv"):
        match = pattern.match(path.name)
        if not match:
            continue
        candidate = date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if latest is None or candidate > latest:
            latest = candidate
    return latest or default_as_of_date


def _month_label(value: date) -> str:
    return value.strftime("%B %Y")


def _report_month_from_uploads(*upload_groups) -> date:
    uploads = []
    for group in upload_groups:
        if group is None:
            continue
        if isinstance(group, (list, tuple)):
            uploads.extend(group)
        else:
            uploads.append(group)
    for upload in uploads:
        name = Path(upload.name).name
        statement_match = re.search(r"Ec30_(\d{1,2})_(\d{4})", name, re.IGNORECASE)
        if statement_match:
            return date(int(statement_match.group(2)), int(statement_match.group(1)), 1)
        try:
            text = upload.getvalue().decode("utf-8-sig", errors="ignore")
            period_match = re.search(
                r"dal\"?;(\d{1,2})/(\d{1,2})/(\d{4});\"?al\"?;(\d{1,2})/(\d{1,2})/(\d{4})",
                text,
                re.IGNORECASE,
            )
            if period_match:
                return date(int(period_match.group(6)), int(period_match.group(5)), 1)
        except Exception:
            pass
    for upload in uploads:
        match = re.search(r"(\d{1,2})_(\d{1,2})_(\d{4})", Path(upload.name).name)
        if match:
            return date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
    return _latest_completed_month()


def _save_uploaded_files(uploads, target_dir: Path) -> list[Path]:
    saved_paths: list[Path] = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for upload in uploads or []:
        target = target_dir / Path(upload.name).name
        target.write_bytes(upload.getbuffer())
        saved_paths.append(target)
    return saved_paths


def _save_uploaded_file(upload, target_dir: Path) -> Path | None:
    if upload is None:
        return None
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / Path(upload.name).name
    target.write_bytes(upload.getbuffer())
    return target


def _import_anagrafe_builder():
    toolkit_src = ANAGRAFE_TOOLKIT_DIR / "src"
    if not toolkit_src.exists():
        raise FileNotFoundError(f"Anagrafe toolkit not found at {toolkit_src}")
    if str(toolkit_src) not in sys.path:
        sys.path.insert(0, str(toolkit_src))
    module = importlib.import_module("directa_anagrafe.report")
    return module.build_enriched_report_from_raw


def _import_anagrafe_review():
    toolkit_src = ANAGRAFE_TOOLKIT_DIR / "src"
    if str(toolkit_src) not in sys.path:
        sys.path.insert(0, str(toolkit_src))
    return importlib.import_module("directa_anagrafe.review")


def _read_json_file(path: Path, default):
    if not path.exists():
        return default.copy() if isinstance(default, dict) else list(default)
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_file(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _sync_review_stores_from_backend() -> None:
    ANAGRAFE_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    for key, path in ANAGRAFE_STORE_FILES.items():
        if db_enabled():
            payload = read_anagrafe_json_store(key)
            if payload is not None:
                _write_json_file(path, payload)
                continue
        if not path.exists():
            _write_json_file(path, ANAGRAFE_STORE_DEFAULTS[key])


def _persist_review_stores_to_backend() -> None:
    if not db_enabled():
        return
    for key, path in ANAGRAFE_STORE_FILES.items():
        if path.exists():
            write_anagrafe_json_store(key, _read_json_file(path, ANAGRAFE_STORE_DEFAULTS[key]))


def _latest_review_queue_path() -> Path | None:
    candidates = sorted(
        ANAGRAFE_REPORTS_DIR.rglob("review_queue.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def _load_review_items() -> list[dict]:
    result = st.session_state.get("latest_anagrafe_result") or {}
    items = result.get("needs_review") or (result.get("review_queue") or {}).get("items") or []
    if items:
        return list(items)
    queue_path = _latest_review_queue_path()
    if queue_path and queue_path.exists():
        return list((_read_json_file(queue_path, {"items": []}).get("items") or []))
    return []


def _can_promote_result(result: dict) -> tuple[bool, str]:
    if not result.get("schema_valid", True):
        return False, "Header schema validation failed."
    if result.get("formula_errors"):
        return False, "Formula/error cells were found."
    return True, ""


def _promote_output(output_path: Path) -> None:
    ANAGRAFE_BASELINE_PATH.write_bytes(output_path.read_bytes())
    if db_enabled():
        insert_anagrafe_baseline(output_path.name, output_path.read_bytes())


def _list_generated_reports() -> pd.DataFrame:
    ANAGRAFE_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(
        ANAGRAFE_REPORTS_DIR.rglob("*.xlsx"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    ):
        rows.append(
            {
                "file_name": path.name,
                "folder": str(path.parent.relative_to(ANAGRAFE_REPORTS_DIR)),
                "updated_at": datetime.fromtimestamp(path.stat().st_mtime),
                "size_kb": round(path.stat().st_size / 1024, 1),
            }
        )
    return pd.DataFrame(rows)


def _latest_generated_report_path() -> Path | None:
    reports = sorted(
        ANAGRAFE_REPORTS_DIR.rglob("anagrafe-*.xlsx"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return reports[0] if reports else None


def _count_anagrafe_rows(path: Path | None) -> int:
    if path is None or not path.exists():
        return 0
    with pd.ExcelFile(path, engine="openpyxl") as workbook:
        sheet_name = next(
            (sheet for sheet in workbook.sheet_names if "anagrafe" in sheet.lower()),
            workbook.sheet_names[0],
        )
        return len(pd.read_excel(workbook, sheet_name=sheet_name).dropna(how="all"))


def _current_baseline_path() -> Path | None:
    synced = sync_current_anagrafe_from_database()
    if synced is not None:
        return synced
    if ANAGRAFE_BASELINE_PATH.exists():
        return ANAGRAFE_BASELINE_PATH
    return _latest_generated_report_path()


def _render_reports_tab() -> None:
    report_month = _latest_completed_month()
    latest_baseline = _current_baseline_path()

    _page_header(
        "Reports",
        "Holding Reports",
        "Start from the current anagrafe, then append new listed holdings or update closures from the latest Directa exports.",
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        _status_card("Report month", _month_label(report_month))
    with c2:
        _status_card("Baseline", latest_baseline.name if latest_baseline is not None else "Not available")
    with c3:
        _status_card("Storage", "Cloud database" if db_enabled() else "Local CSV files")

    st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)

    # ── Current baseline ──────────────────────────────────────────────────────
    _section_heading(
        "Current baseline",
        "Upload a replacement workbook only when the saved baseline needs to become the new source of truth.",
    )

    manual_baseline_upload = st.file_uploader(
        "Anagrafe workbook (.xlsx)",
        type=["xlsx"],
        key="anagrafe_manual_baseline_upload",
        help="Upload a new baseline only to replace the saved source of truth.",
    )
    if st.button("Update latest anagrafe from upload", width="stretch"):
        if manual_baseline_upload is None:
            st.error("Choose an anagrafe workbook to upload.")
        else:
            baseline_bytes = manual_baseline_upload.getvalue()
            ANAGRAFE_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            ANAGRAFE_BASELINE_PATH.write_bytes(baseline_bytes)
            if db_enabled():
                insert_anagrafe_baseline(Path(manual_baseline_upload.name).name, baseline_bytes)
            st.session_state["latest_anagrafe_output"] = str(ANAGRAFE_BASELINE_PATH)
            st.success("Latest anagrafe baseline updated and saved as the database default.")
            st.rerun()

    if latest_baseline is not None:
        st.info(f"Using current anagrafe baseline: `{latest_baseline.name}`")
    else:
        st.warning("No baseline report is available yet. Add the initial anagrafe workbook before launch.")

    st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)

    # ── Monthly source files ──────────────────────────────────────────────────
    _section_heading(
        "Monthly source files",
        "Upload the monthly Directa statement CSV and the end-of-period positions CSV.",
    )

    col_statement, col_positions = st.columns(2)
    with col_statement:
        statement_upload = st.file_uploader(
            "Ec statement CSV",
            type=["csv"],
            key="anagrafe_statement_upload",
            help="Example: Ec30_04_2026.csv",
        )
    with col_positions:
        positions_upload = st.file_uploader(
            "Ec_X positions CSV",
            type=["csv"],
            key="anagrafe_positions_upload",
            help="Example: Ec_X_8_05_2026.csv",
        )

    raw_uploads = st.file_uploader(
        "Additional Directa raw export files (optional)",
        type=["csv"],
        accept_multiple_files=True,
        key="anagrafe_raw_uploads",
    )

    st.markdown("<div style='height:4px'></div>", unsafe_allow_html=True)

    if st.button("Update the anagrafe", width="stretch", type="primary"):
        if latest_baseline is None:
            st.error("No baseline anagrafe is available yet.")
        elif statement_upload is None or positions_upload is None:
            st.error("Upload both the statement CSV and positions CSV to continue.")
        else:
            report_month = _report_month_from_uploads(raw_uploads, statement_upload, positions_upload)
            report_key = report_month.strftime("%Y-%m")
            work_dir = ANAGRAFE_REPORTS_DIR / report_key
            raw_dir = work_dir / f"directa_raw_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            work_dir.mkdir(parents=True, exist_ok=True)

            baseline_path = latest_baseline
            saved_raw_paths = _save_uploaded_files(raw_uploads, raw_dir)
            required_paths = [
                _save_uploaded_file(statement_upload, raw_dir),
                _save_uploaded_file(positions_upload, raw_dir),
            ]
            saved_raw_paths.extend([path for path in required_paths if path is not None])

            output_path = work_dir / f"anagrafe-{report_key}.xlsx"
            build_report = _import_anagrafe_builder()
            baseline_rows = _count_anagrafe_rows(baseline_path)

            with st.spinner("Generating anagrafe report..."):
                _sync_review_stores_from_backend()
                result = build_report(
                    raw_dir,
                    output_path,
                    metadata_output=ANAGRAFE_CACHE_PATH,
                    company_data=ANAGRAFE_CACHE_PATH if ANAGRAFE_CACHE_PATH.exists() else None,
                    baseline_report=baseline_path,
                    use_web_search=False,
                    batch_size=1,
                )

            output_rows = _count_anagrafe_rows(output_path)
            if output_rows < baseline_rows:
                st.error(
                    "Generated anagrafe has fewer rows than the current baseline "
                    f"({output_rows} vs {baseline_rows}). The baseline was not replaced."
                )
                st.stop()

            st.session_state["latest_anagrafe_output"] = str(output_path)
            st.session_state["latest_anagrafe_result"] = result
            st.session_state["latest_anagrafe_run"] = {
                "raw_dir": str(raw_dir),
                "baseline_path": str(baseline_path),
                "output_path": str(output_path),
                "report_key": report_key,
            }
            needs_review = result.get("needs_review") or []
            formula_errors = result.get("formula_errors") or []
            if needs_review:
                st.warning(
                    f"Generated a draft report. {len(needs_review)} holding(s) were skipped because "
                    "they need metadata or a manual decision, but the generated workbook can still be promoted."
                )
                st.dataframe(pd.DataFrame(needs_review), use_container_width=True, hide_index=True)
            elif not result.get("schema_valid", True):
                st.error("Generated a draft report, but the anagrafe header schema did not match the baseline.")
            elif formula_errors:
                st.error("Generated a draft report, but formula/error cells were found. The baseline was not replaced.")
                st.dataframe(pd.DataFrame({"formula_error": formula_errors}), use_container_width=True, hide_index=True)
            else:
                st.success(
                    f"Generated clean draft with {result['rows_added']} added row(s), "
                    f"{result['rows_closed']} closed row(s), and {len(saved_raw_paths)} raw file(s)."
                )
                st.info("Review passed. Promote the draft explicitly when you are ready.")

    latest_output = st.session_state.get("latest_anagrafe_output")
    output_path = Path(latest_output) if latest_output else _latest_generated_report_path()
    if output_path is not None and output_path.exists():
        st.caption(f"Download target: `{output_path.parent.name}/{output_path.name}`")
        result = st.session_state.get("latest_anagrafe_result") or {}
        can_promote, promote_blocker = _can_promote_result(result)
        if st.button("Promote generated anagrafe to baseline", disabled=not can_promote, width="stretch"):
            _promote_output(output_path)
            st.success("Generated anagrafe promoted to the saved baseline.")
            st.rerun()
        if promote_blocker:
            st.caption(f"Promotion blocked: {promote_blocker}")
        st.download_button(
            "Download latest generated anagrafe",
            data=output_path.read_bytes(),
            file_name=output_path.name,
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            width="stretch",
        )

    reports_df = _list_generated_reports()
    if not reports_df.empty:
        st.divider()
        _section_heading("Generated reports")
        st.dataframe(reports_df, width="stretch", hide_index=True)


def _render_review_tab() -> None:
    _sync_review_stores_from_backend()
    _page_header(
        "Review",
        "Anagrafe Review Queue",
        "Resolve draft-blocking items, persist decisions, and re-run the v2 engine with those resolutions.",
    )
    items = _load_review_items()
    c1, c2, c3 = st.columns(3)
    with c1:
        _status_card("Open review items", str(len(items)))
    with c2:
        _status_card("Store backend", "Cloud database" if db_enabled() else "Local JSON")
    with c3:
        _status_card("Last queue", _latest_review_queue_path().name if _latest_review_queue_path() else "None")

    if not items:
        st.info("No review items are currently pending.")
        result = st.session_state.get("latest_anagrafe_result") or {}
        can_promote, _ = _can_promote_result(result)
        if can_promote and st.session_state.get("latest_anagrafe_output"):
            st.success("The latest generated draft is clean. Return to Reports to promote it to baseline.")
            if st.button("Open Reports section", width="stretch"):
                st.session_state["portal_section"] = "Reports"
                st.rerun()
        return

    df = pd.DataFrame(items)
    reason_filter = st.multiselect("Reason", sorted(df["reason"].dropna().unique().tolist()))
    visible = df[df["reason"].isin(reason_filter)] if reason_filter else df
    st.dataframe(
        visible[["id", "reason", "ticker", "isin", "name_csv"]],
        use_container_width=True,
        hide_index=True,
    )

    ids = visible["id"].tolist()
    selected_id = st.selectbox("Review item", ids, format_func=lambda value: _review_label(items, value))
    selected = next(item for item in items if item["id"] == selected_id)
    _render_review_action_panel(selected)

    st.divider()
    _section_heading("Bulk resolution", "Only items with one shared reason and action type can be resolved together.")
    selected_ids = st.multiselect("Items", ids, format_func=lambda value: _review_label(items, value), key="bulk_review_ids")
    bulk_items = [item for item in items if item["id"] in selected_ids]
    if bulk_items:
        reasons = {item.get("reason") for item in bulk_items}
        action_types = {
            (item.get("suggested_resolution") or {}).get("action_type", "ignore")
            for item in bulk_items
        }
        st.caption(f"Selected: {len(bulk_items)} item(s)")
        if len(reasons) == 1 and len(action_types) == 1:
            action_type = next(iter(action_types))
            if action_type == "set_instrument_type":
                instrument_type = st.selectbox(
                    "Set all to instrument type",
                    ["ETF", "ETP", "ETC", "BOND_SOVEREIGN", "BOND_CORPORATE", "FUND", "DERIVATIVE", "DIRECT_EQUITY"],
                    key="bulk_instrument_type",
                )
                if st.button("Apply bulk resolution", width="stretch"):
                    _resolve_items(bulk_items, action_type, {item["id"]: {"instrument_type": instrument_type} for item in bulk_items})
            elif action_type == "ignore":
                if st.button("Ignore selected permanently", width="stretch"):
                    _resolve_items(bulk_items, "ignore", {item["id"]: {"scope": "permanent"} for item in bulk_items})
            else:
                st.info("Bulk form for this action needs per-item values; resolve these one by one.")
        else:
            st.warning("Bulk resolution requires one shared reason and one shared action type.")

    st.divider()
    if st.button("Re-run with resolutions", type="primary", width="stretch"):
        _rerun_latest_anagrafe()


def _review_label(items: list[dict], item_id: str) -> str:
    item = next((candidate for candidate in items if candidate.get("id") == item_id), {})
    return f"{item.get('reason', '')} · {item.get('ticker', '')} · {item.get('name_csv', '')}"


def _render_review_action_panel(item: dict) -> None:
    _section_heading("Action panel")
    st.json(
        {
            "id": item.get("id"),
            "reason": item.get("reason"),
            "suggested_resolution": item.get("suggested_resolution"),
            "context": item.get("context"),
        },
        expanded=False,
    )
    reason = item.get("reason")
    suggested = item.get("suggested_resolution") or {}
    action_type = suggested.get("action_type", "ignore")
    with st.form(f"resolve_{item['id']}"):
        payload = {}
        if action_type == "set_instrument_type":
            payload["instrument_type"] = st.selectbox(
                "Instrument type",
                ["ETF", "ETP", "ETC", "BOND_SOVEREIGN", "BOND_CORPORATE", "FUND", "DERIVATIVE", "DIRECT_EQUITY"],
            )
        elif action_type == "update_metadata":
            payload["denominazione"] = st.text_input("Denominazione", value=item.get("name_csv", ""))
            payload["codice_fiscale"] = st.text_input("Codice fiscale")
            payload["indirizzo"] = st.text_input("Indirizzo")
            payload["issuer_country"] = st.text_input("Issuer country", value="IT")
        elif action_type == "set_match_override":
            candidates = item.get("candidates") or suggested.get("candidates") or []
            payload["denomination"] = st.selectbox("Matched anagrafe row", candidates) if candidates else st.text_input("Denomination")
            payload["unique_code"] = st.text_input("Unique code (optional)")
        else:
            action_type = "ignore"
            payload["scope"] = st.selectbox("Ignore scope", ["permanent"])
        submitted = st.form_submit_button("Save resolution", width="stretch")
    if submitted:
        _resolve_items([item], action_type, {item["id"]: payload})


def _resolve_items(items: list[dict], action_type: str, payload_by_id: dict[str, dict]) -> None:
    review = _import_anagrafe_review()
    review.bulk_resolve_review_items(
        stores_dir=ANAGRAFE_REPORTS_DIR,
        items=items,
        action_type=action_type,
        payload_by_id=payload_by_id,
        operator="admin",
    )
    _persist_review_stores_to_backend()
    st.success(f"Saved {len(items)} resolution(s).")


def _rerun_latest_anagrafe() -> None:
    latest_run = st.session_state.get("latest_anagrafe_run")
    if not latest_run:
        st.error("No previous anagrafe run is available to re-run.")
        return
    _sync_review_stores_from_backend()
    build_report = _import_anagrafe_builder()
    raw_dir = Path(latest_run["raw_dir"])
    baseline_path = Path(latest_run["baseline_path"])
    report_key = latest_run.get("report_key") or datetime.now().strftime("%Y-%m")
    output_path = raw_dir.parent / f"anagrafe-{report_key}-rerun.xlsx"
    with st.spinner("Re-running anagrafe with saved resolutions..."):
        result = build_report(
            raw_dir,
            output_path,
            metadata_output=ANAGRAFE_CACHE_PATH,
            company_data=ANAGRAFE_CACHE_PATH if ANAGRAFE_CACHE_PATH.exists() else None,
            baseline_report=baseline_path,
            use_web_search=False,
            batch_size=1,
        )
    st.session_state["latest_anagrafe_output"] = str(output_path)
    st.session_state["latest_anagrafe_result"] = result
    st.session_state["latest_anagrafe_run"]["output_path"] = str(output_path)
    st.success(
        f"Re-run complete: {result.get('rows_added', 0)} added, "
        f"{result.get('rows_closed', 0)} closed, {len(result.get('needs_review') or [])} review item(s)."
    )
    st.rerun()


require_authentication()
if db_enabled():
    init_schema()
default_as_of_date = _default_as_of_date()

with st.sidebar:
    st.title("Ariete")
    st.caption("Admin workspace")
    portal_section = st.radio(
        "Section",
        ["Reports", "Investor Portal"],
        key="portal_section",
        label_visibility="collapsed",
    )
    if st.button("Sign out", width="stretch"):
        st.session_state["admin_authenticated"] = False
        st.rerun()

if portal_section == "Reports":
    _render_reports_tab()
else:
    _page_header(
        "Investor portal",
        "Admin Inputs",
        "Maintain the values that feed the investor dashboard: listed files, approved non-listed values, cash balances, and capital inputs.",
    )

    dictionary_count = len(_active_dictionary())
    manual_count = len(pd.DataFrame(read_manual_values()) if db_enabled() else _read_csv(MANUAL_VALUES_PATH))
    controls_count = len(pd.DataFrame(read_controls()) if db_enabled() else _read_csv(CONTROLS_PATH))
    c1, c2, c3 = st.columns(3)
    with c1:
        st.metric("Dictionary Items", dictionary_count)
    with c2:
        st.metric("Monthly Values", manual_count)
    with c3:
        st.metric("Portfolio Inputs", controls_count)

    st.markdown("<div style='height:12px'></div>", unsafe_allow_html=True)

    upload_type = st.radio(
        "What are you adding?",
        ["Listed instruments", "Non-listed values", "Cash values", "Portfolio inputs"],
        horizontal=True,
    )

    st.markdown("<div style='height:4px'></div>", unsafe_allow_html=True)

    if upload_type == "Listed instruments":
        _section_heading("Listed Instruments", "Upload monthly statement CSV files for the current period.")
        uploads = st.file_uploader("Monthly statement CSV files", type=["csv"], accept_multiple_files=True)
        if st.button("Save listed files", width="stretch"):
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
        _section_heading("Non-Listed Values", "Enter approved valuations for private / non-listed holdings.")
        dictionary = _active_dictionary()
        non_listed = dictionary[dictionary.get("item_type", "").astype(str) == "Non-Listed"] if not dictionary.empty else pd.DataFrame()

        with st.expander("+ Add a new non-listed company to the dictionary"):
            with st.form("add_nonlisted_dictionary"):
                col_a, col_b = st.columns(2)
                with col_a:
                    item_key = st.text_input("Company key", placeholder="BENDING_SPOONS")
                    subcategory = st.text_input("Category", placeholder="Private Equity")
                with col_b:
                    display_name = st.text_input("Company name", placeholder="Bending Spoons")
                    currency = st.text_input("Currency", value="EUR")
                sort_order = st.number_input("Sort order", min_value=0, step=1, value=10)
                submitted = st.form_submit_button("Add non-listed company", width="stretch")
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
                item_key = st.selectbox("Non-listed company", list(labels.keys()), format_func=lambda k: labels[k])
                col_v, col_d = st.columns(2)
                with col_v:
                    value = st.number_input("Latest approved valuation", min_value=0.0, step=1000.0)
                with col_d:
                    as_of_date = st.date_input("Valuation date", value=default_as_of_date)
                holding_name = st.text_input("Holding name (optional)", help="Leave blank to keep the existing company name.")
                submitted = st.form_submit_button("Save non-listed value", width="stretch")
                if submitted:
                    selected = non_listed[non_listed["item_key"].astype(str) == str(item_key)].iloc[0]
                    if holding_name.strip():
                        _save_dictionary(
                            {
                                "item_key": item_key,
                                "display_name": holding_name.strip(),
                                "item_type": "Non-Listed",
                                "subcategory": str(selected.get("subcategory", "Non-Listed")),
                                "currency": str(selected.get("currency", "EUR")),
                                "active": True,
                                "sort_order": int(selected.get("sort_order", 0) or 0),
                                "notes": str(selected.get("notes", "")),
                            }
                        )
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
        _section_heading("Cash Values", "Record external cash balances for the current period.")
        dictionary = _active_dictionary()
        cash_items = dictionary[dictionary.get("item_type", "").astype(str) == "Cash"] if not dictionary.empty else pd.DataFrame()

        with st.expander("+ Add a new cash option to the dictionary"):
            with st.form("add_cash_dictionary"):
                col_a, col_b = st.columns(2)
                with col_a:
                    item_key = st.text_input("Cash key", placeholder="EXTERNAL_CASH_USD")
                    subcategory = st.text_input("Subcategory", placeholder="External Bank Cash")
                with col_b:
                    display_name = st.text_input("Display name", placeholder="External Cash USD")
                    currency = st.text_input("Currency", value="EUR")
                sort_order = st.number_input("Sort order", min_value=0, step=1, value=20)
                submitted = st.form_submit_button("Add cash option", width="stretch")
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
                col_v, col_d = st.columns(2)
                with col_v:
                    value = st.number_input("Balance amount", min_value=0.0, step=1000.0)
                with col_d:
                    as_of_date = st.date_input("Balance date", value=default_as_of_date)
                submitted = st.form_submit_button("Save cash value", width="stretch")
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
        _section_heading("Portfolio Inputs", "Set the official committed capital figure for this portfolio.")
        with st.form("controls"):
            col_v, col_d = st.columns(2)
            with col_v:
                capital_committed = st.number_input("Capital committed", min_value=0.0, step=1000.0)
            with col_d:
                as_of_date = st.date_input("As-of date", value=default_as_of_date)
            submitted = st.form_submit_button("Save controls", width="stretch")
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
    _section_heading("Current Admin Inputs")
    tab1, tab2, tab3 = st.tabs(["Dictionary", "Monthly Values", "Portfolio Inputs"])
    with tab1:
        df = pd.DataFrame(read_active_dictionary()) if db_enabled() else _read_csv(DICTIONARY_PATH)
        st.dataframe(df, width="stretch", hide_index=True)
    with tab2:
        df = pd.DataFrame(read_manual_values()) if db_enabled() else _read_csv(MANUAL_VALUES_PATH)
        st.dataframe(df, width="stretch", hide_index=True)
    with tab3:
        controls_df = pd.DataFrame(read_controls()) if db_enabled() else _read_csv(CONTROLS_PATH)
        visible_cols = [c for c in ["as_of_date", "capital_committed", "currency"] if c in controls_df.columns]
        st.dataframe(controls_df[visible_cols], width="stretch", hide_index=True)
