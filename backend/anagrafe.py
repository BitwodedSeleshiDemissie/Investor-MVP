from __future__ import annotations

import re
from difflib import SequenceMatcher
from io import BytesIO
from pathlib import Path

import pandas as pd

from cloud_db import db_enabled, read_latest_anagrafe_baseline


PREPROCESSING_DIR = Path(__file__).resolve().parents[2] / "Ariete preprocessing" / "preprocessing"
ANAGRAFE_REPORTS_DIR = PREPROCESSING_DIR / "anagrafe_reports"
ANAGRAFE_BASELINE_PATH = ANAGRAFE_REPORTS_DIR / "current_anagrafe.xlsx"


_LEGAL_SUFFIXES = {
    "spa",
    "s",
    "p",
    "a",
    "srl",
    "nv",
    "inc",
    "corp",
    "corporation",
    "holding",
    "holdings",
    "group",
    "sa",
    "siiq",
}


def _clean_column_name(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip().lower()


def _find_column(df: pd.DataFrame, contains: str, fallback_index: int | None = None) -> str | None:
    matches = [column for column in df.columns if contains in _clean_column_name(column)]
    if matches:
        return matches[0]
    if fallback_index is not None and len(df.columns) > fallback_index:
        return df.columns[fallback_index]
    return None


def _normalize_name(value: object) -> str:
    text = re.sub(r"\([^)]*\)", " ", str(value or "").lower())
    text = text.replace("&", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = [token for token in text.split() if token not in _LEGAL_SUFFIXES]
    return " ".join(tokens)


def _compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _compact_variants(value: str) -> set[str]:
    tokens = _normalize_name(value).split()
    variants = {"".join(tokens)}
    for index, token in enumerate(tokens):
        if len(token) == 3 and token[1] == "e":
            alias_tokens = list(tokens)
            alias_tokens[index] = token[0] + token[2]
            variants.add("".join(alias_tokens))
    return {variant for variant in variants if variant}


def _extract_isin(value: object) -> str:
    match = re.search(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b", str(value or "").upper())
    return match.group(1) if match else ""


def _score_match(security: pd.Series, candidate: pd.Series) -> tuple[int, str]:
    security_isin = _extract_isin(security.get("Security", ""))
    candidate_isin = str(candidate.get("isin", "") or "").upper()
    if security_isin and candidate_isin and security_isin == candidate_isin:
        return 120, "isin"

    security_key = _normalize_name(security.get("Security", ""))
    candidate_key = str(candidate.get("match_name", ""))
    if not security_key or not candidate_key:
        return 0, ""

    security_compact = _compact(security_key)
    candidate_compact = str(candidate.get("match_compact", ""))
    security_tokens = set(security_key.split())
    candidate_tokens = set(candidate_key.split())

    if security_compact and security_compact == candidate_compact:
        return 100, "exact_name"
    if _compact_variants(security_key) & _compact_variants(candidate_key):
        return 96, "alias_name"
    if security_tokens and security_tokens <= candidate_tokens:
        return 88, "security_tokens_subset"
    if candidate_tokens and candidate_tokens <= security_tokens:
        return 84, "anagrafe_tokens_subset"

    overlap = len(security_tokens & candidate_tokens)
    token_score = int(70 * overlap / max(len(security_tokens), len(candidate_tokens), 1))
    ratio_score = int(100 * SequenceMatcher(None, security_key, candidate_key).ratio())
    score = max(token_score, ratio_score)
    return score, "fuzzy_name" if score else ""


def _best_anagrafe_match(security: pd.Series, candidates: pd.DataFrame) -> tuple[pd.Series | None, int, str, bool]:
    scored: list[tuple[int, str, pd.Series]] = []
    for _, candidate in candidates.iterrows():
        score, reason = _score_match(security, candidate)
        if score:
            scored.append((score, reason, candidate))
    if not scored:
        return None, 0, "", False

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, reason, best_row = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None
    ambiguous = bool(runner_up and runner_up[0] >= 75 and best_score - runner_up[0] < 12)
    if best_score < 84 or ambiguous:
        return best_row, best_score, reason, ambiguous
    return best_row, best_score, reason, False


def anagrafe_mtime_ns() -> int:
    if db_enabled():
        latest = read_latest_anagrafe_baseline(include_content=False)
        if latest:
            return int(latest["id"])
    try:
        return ANAGRAFE_BASELINE_PATH.stat().st_mtime_ns
    except FileNotFoundError:
        return 0


def load_current_anagrafe(path: Path = ANAGRAFE_BASELINE_PATH) -> pd.DataFrame:
    source = path
    if db_enabled():
        latest = read_latest_anagrafe_baseline(include_content=True)
        if latest:
            source = BytesIO(bytes(latest["content"]))

    if isinstance(source, Path) and not source.exists():
        return pd.DataFrame()

    with pd.ExcelFile(source, engine="openpyxl") as workbook:
        sheet_name = next(
            (sheet for sheet in workbook.sheet_names if "anagrafe" in sheet.lower()),
            workbook.sheet_names[0],
        )
        raw = pd.read_excel(workbook, sheet_name=sheet_name)

    if raw.empty:
        return pd.DataFrame()

    open_col = _find_column(raw, "apertura", 0)
    close_col = _find_column(raw, "chiusura", 1)
    code_col = _find_column(raw, "codice univoco", 2)
    name_col = _find_column(raw, "denominazione", 5)
    tax_col = _find_column(raw, "codice fiscale", 6)
    address_col = _find_column(raw, "indirizzo", 7)
    if name_col is None:
        return pd.DataFrame()

    result = pd.DataFrame(
        {
            "anagrafe_open_date": raw[open_col] if open_col else "",
            "anagrafe_close_date": raw[close_col] if close_col else "",
            "anagrafe_code": raw[code_col] if code_col else "",
            "legal_name": raw[name_col],
            "tax_code": raw[tax_col] if tax_col else "",
            "registered_office": raw[address_col] if address_col else "",
        }
    )
    result = result[result["legal_name"].notna()].copy()
    result["isin"] = result["legal_name"].map(_extract_isin)
    result["match_name"] = result["legal_name"].map(_normalize_name)
    result["match_compact"] = result["match_name"].map(_compact)
    result["is_open"] = result["anagrafe_close_date"].isna() | (result["anagrafe_close_date"].astype(str).str.strip() == "")
    return result.reset_index(drop=True)


def sync_current_anagrafe_from_database(path: Path = ANAGRAFE_BASELINE_PATH) -> Path | None:
    if not db_enabled():
        return path if path.exists() else None

    latest = read_latest_anagrafe_baseline(include_content=True)
    if not latest:
        return path if path.exists() else None

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(latest["content"]))
    return path


def enrich_holdings_with_anagrafe(holdings: pd.DataFrame, anagrafe: pd.DataFrame) -> pd.DataFrame:
    if holdings.empty or anagrafe.empty or "Security" not in holdings.columns:
        return holdings

    open_anagrafe = anagrafe[anagrafe["is_open"]].copy()
    if open_anagrafe.empty:
        open_anagrafe = anagrafe.copy()

    enriched = holdings.copy()
    for column in [
        "Legal Name",
        "ISIN",
        "Anagrafe Code",
        "Tax Code",
        "Registered Office",
        "Anagrafe Match",
    ]:
        if column not in enriched.columns:
            enriched[column] = ""

    for index, row in enriched.iterrows():
        best_row, best_score, reason, ambiguous = _best_anagrafe_match(row, open_anagrafe)
        if best_row is None:
            enriched.at[index, "Anagrafe Match"] = "missing"
            continue
        if best_score < 84 or ambiguous:
            enriched.at[index, "Anagrafe Match"] = (
                f"needs review ({reason}, score {best_score})"
            )
            continue

        enriched.at[index, "Legal Name"] = str(best_row.get("legal_name", "") or "")
        enriched.at[index, "ISIN"] = str(best_row.get("isin", "") or "")
        enriched.at[index, "Anagrafe Code"] = str(best_row.get("anagrafe_code", "") or "")
        enriched.at[index, "Tax Code"] = str(best_row.get("tax_code", "") or "")
        enriched.at[index, "Registered Office"] = str(best_row.get("registered_office", "") or "")
        enriched.at[index, "Anagrafe Match"] = f"{reason} ({best_score})"

    return enriched
