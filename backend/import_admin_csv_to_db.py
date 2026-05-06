from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from cloud_db import init_schema, insert_control, insert_manual_value, upsert_asset_dictionary


def _to_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in {"1", "true", "yes", "y"}


def main() -> None:
    parser = argparse.ArgumentParser(description="One-time import of admin CSVs into Postgres.")
    parser.add_argument(
        "--admin-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "Ariete preprocessing" / "preprocessing" / "admin_inputs",
        help="Path to admin_inputs directory containing asset_dictionary.csv, controls.csv, monthly_manual_values.csv",
    )
    args = parser.parse_args()

    admin_dir = args.admin_dir
    dictionary_path = admin_dir / "asset_dictionary.csv"
    controls_path = admin_dir / "controls.csv"
    manual_values_path = admin_dir / "monthly_manual_values.csv"

    init_schema()

    dictionary_df = pd.read_csv(dictionary_path) if dictionary_path.exists() else pd.DataFrame()
    controls_df = pd.read_csv(controls_path) if controls_path.exists() else pd.DataFrame()
    manual_df = pd.read_csv(manual_values_path) if manual_values_path.exists() else pd.DataFrame()

    inserted_dictionary = 0
    inserted_controls = 0
    inserted_manual = 0

    for _, row in dictionary_df.iterrows():
        upsert_asset_dictionary(
            {
                "item_key": str(row.get("item_key", "")).strip(),
                "display_name": str(row.get("display_name", "")).strip(),
                "item_type": str(row.get("item_type", "")).strip(),
                "subcategory": str(row.get("subcategory", "")).strip(),
                "currency": str(row.get("currency", "EUR")).strip() or "EUR",
                "active": _to_bool(row.get("active", True)),
                "sort_order": int(row.get("sort_order", 0) or 0),
                "notes": str(row.get("notes", "")).strip(),
            }
        )
        inserted_dictionary += 1

    for _, row in controls_df.iterrows():
        insert_control(
            {
                "portfolio_id": str(row.get("portfolio_id", "")).strip(),
                "investor_name": str(row.get("investor_name", "")).strip(),
                "as_of_date": str(row.get("as_of_date", "")).strip(),
                "capital_committed": float(row.get("capital_committed", 0) or 0),
                "currency": str(row.get("currency", "EUR")).strip() or "EUR",
                "notes": str(row.get("notes", "")).strip(),
            }
        )
        inserted_controls += 1

    for _, row in manual_df.iterrows():
        insert_manual_value(
            {
                "as_of_date": str(row.get("as_of_date", "")).strip(),
                "item_key": str(row.get("item_key", "")).strip(),
                "value": float(row.get("value", 0) or 0),
                "currency": str(row.get("currency", "EUR")).strip() or "EUR",
                "valuation_source": str(row.get("valuation_source", "Admin input")).strip() or "Admin input",
                "valuation_method": str(row.get("valuation_method", "")).strip(),
                "notes": str(row.get("notes", "")).strip(),
            }
        )
        inserted_manual += 1

    print(
        f"Import completed: dictionary={inserted_dictionary}, "
        f"controls={inserted_controls}, manual_values={inserted_manual}"
    )


if __name__ == "__main__":
    main()
