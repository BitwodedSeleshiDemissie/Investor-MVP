from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
from typing import Optional

import psycopg
from psycopg.rows import dict_row

from config import settings


@dataclass
class CloudAdminSnapshot:
    capital_committed: Optional[float]
    non_listed_total: float
    cash_total: float


def _db_url() -> Optional[str]:
    return settings.database_url


def db_enabled() -> bool:
    return bool(_db_url())


def _conn():
    url = _db_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg.connect(url, row_factory=dict_row)


def init_schema() -> None:
    if not db_enabled():
        return
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS asset_dictionary (
                    item_key TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    item_type TEXT NOT NULL,
                    subcategory TEXT NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'EUR',
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    notes TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_controls (
                    id BIGSERIAL PRIMARY KEY,
                    portfolio_id TEXT NOT NULL,
                    investor_name TEXT NOT NULL,
                    as_of_date DATE NOT NULL,
                    capital_committed DOUBLE PRECISION NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'EUR',
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_manual_values (
                    id BIGSERIAL PRIMARY KEY,
                    as_of_date DATE NOT NULL,
                    item_key TEXT NOT NULL REFERENCES asset_dictionary(item_key),
                    value DOUBLE PRECISION NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'EUR',
                    valuation_source TEXT NOT NULL DEFAULT 'Admin input',
                    valuation_method TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_anagrafe_baselines (
                    id BIGSERIAL PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    content BYTEA NOT NULL,
                    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_anagrafe_json_store (
                    store_key TEXT PRIMARY KEY,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_admin_controls_asof
                ON admin_controls (as_of_date, created_at);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_admin_manual_values_key_asof
                ON admin_manual_values (item_key, as_of_date, created_at);
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_admin_anagrafe_uploaded
                ON admin_anagrafe_baselines (uploaded_at DESC, id DESC);
                """
            )
            # Backward-compatibility rename requested by CFO.
            cur.execute(
                """
                UPDATE asset_dictionary
                SET display_name = 'Short Term Receivable EUR',
                    subcategory = 'Short Term Receivable'
                WHERE item_key = 'RESTRICTED_CASH_EUR';
                """
            )
        conn.commit()


def upsert_asset_dictionary(row: dict) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO asset_dictionary
                    (item_key, display_name, item_type, subcategory, currency, active, sort_order, notes, updated_at)
                VALUES
                    (%(item_key)s, %(display_name)s, %(item_type)s, %(subcategory)s, %(currency)s, %(active)s, %(sort_order)s, %(notes)s, NOW())
                ON CONFLICT (item_key) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    item_type = EXCLUDED.item_type,
                    subcategory = EXCLUDED.subcategory,
                    currency = EXCLUDED.currency,
                    active = EXCLUDED.active,
                    sort_order = EXCLUDED.sort_order,
                    notes = EXCLUDED.notes,
                    updated_at = NOW();
                """,
                row,
            )
        conn.commit()


def insert_control(row: dict) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_controls
                    (portfolio_id, investor_name, as_of_date, capital_committed, currency, notes)
                VALUES
                    (%(portfolio_id)s, %(investor_name)s, %(as_of_date)s, %(capital_committed)s, %(currency)s, %(notes)s);
                """,
                row,
            )
        conn.commit()


def insert_manual_value(row: dict) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_manual_values
                    (as_of_date, item_key, value, currency, valuation_source, valuation_method, notes)
                VALUES
                    (%(as_of_date)s, %(item_key)s, %(value)s, %(currency)s, %(valuation_source)s, %(valuation_method)s, %(notes)s);
                """,
                row,
            )
        conn.commit()


def insert_anagrafe_baseline(file_name: str, content: bytes) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_anagrafe_baselines (file_name, content)
                VALUES (%s, %s);
                """,
                (file_name, content),
            )
        conn.commit()


def read_latest_anagrafe_baseline(include_content: bool = True) -> dict | None:
    columns = "id, file_name, uploaded_at, content" if include_content else "id, file_name, uploaded_at"
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {columns}
                FROM admin_anagrafe_baselines
                ORDER BY uploaded_at DESC, id DESC
                LIMIT 1;
                """
            )
            row = cur.fetchone()
            return dict(row) if row else None


def write_anagrafe_json_store(store_key: str, payload: dict | list) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_anagrafe_json_store (store_key, payload, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (store_key) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    updated_at = NOW();
                """,
                (store_key, json.dumps(payload)),
            )
        conn.commit()


def read_anagrafe_json_store(store_key: str) -> dict | list | None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT payload
                FROM admin_anagrafe_json_store
                WHERE store_key = %s;
                """,
                (store_key,),
            )
            row = cur.fetchone()
            return row["payload"] if row else None


def read_active_dictionary() -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT item_key, display_name, item_type, subcategory, currency, active, sort_order, notes
                FROM asset_dictionary
                WHERE active = TRUE
                ORDER BY sort_order, item_key;
                """
            )
            return list(cur.fetchall())


def read_controls() -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT portfolio_id, investor_name, as_of_date, capital_committed, currency, notes, created_at
                FROM admin_controls
                ORDER BY as_of_date DESC, created_at DESC;
                """
            )
            return list(cur.fetchall())


def read_manual_values() -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT as_of_date, item_key, value, currency, valuation_source, valuation_method, notes, created_at
                FROM admin_manual_values
                ORDER BY as_of_date DESC, created_at DESC;
                """
            )
            return list(cur.fetchall())


def read_snapshot(cutoff: date) -> CloudAdminSnapshot:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT capital_committed
                FROM admin_controls
                WHERE as_of_date <= %s
                ORDER BY as_of_date DESC, created_at DESC
                LIMIT 1;
                """,
                (cutoff,),
            )
            control = cur.fetchone()
            capital_committed = float(control["capital_committed"]) if control else None

            cur.execute(
                """
                WITH picked AS (
                    SELECT DISTINCT ON (mv.item_key)
                        mv.item_key,
                        mv.value
                    FROM admin_manual_values mv
                    JOIN asset_dictionary d
                      ON d.item_key = mv.item_key
                    WHERE mv.as_of_date <= %s
                      AND d.active = TRUE
                    ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
                )
                SELECT d.item_type, COALESCE(SUM(p.value), 0) AS total
                FROM picked p
                JOIN asset_dictionary d ON d.item_key = p.item_key
                GROUP BY d.item_type;
                """,
                (cutoff,),
            )
            totals = {row["item_type"]: float(row["total"]) for row in cur.fetchall()}
            return CloudAdminSnapshot(
                capital_committed=capital_committed,
                non_listed_total=totals.get("Non-Listed", 0.0),
                cash_total=totals.get("Cash", 0.0),
            )


def read_latest_manual_rows(cutoff: date, item_type: str) -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH picked AS (
                    SELECT DISTINCT ON (mv.item_key)
                        mv.item_key,
                        mv.as_of_date,
                        mv.value,
                        mv.currency,
                        mv.valuation_source,
                        mv.valuation_method,
                        mv.notes
                    FROM admin_manual_values mv
                    WHERE mv.as_of_date <= %s
                    ORDER BY mv.item_key, mv.as_of_date DESC, mv.created_at DESC
                )
                SELECT
                    d.display_name,
                    d.subcategory,
                    p.value,
                    COALESCE(NULLIF(p.currency, ''), d.currency, 'EUR') AS currency,
                    p.as_of_date,
                    p.valuation_source AS source,
                    p.valuation_method AS method,
                    p.notes
                FROM picked p
                JOIN asset_dictionary d ON d.item_key = p.item_key
                WHERE d.active = TRUE
                  AND d.item_type = %s
                ORDER BY d.sort_order, d.item_key;
                """,
                (cutoff, item_type),
            )
            return list(cur.fetchall())
