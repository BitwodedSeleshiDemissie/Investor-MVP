from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query

from workbook_api import WorkbookAPI

app = FastAPI(
    title="Investor Portal API",
    version="0.1.0",
    description="API for querying investor metrics from the Ariete Excel workbook.",
)


def get_workbook() -> WorkbookAPI:
    return WorkbookAPI()


@app.get("/health")
def health() -> dict[str, str]:
    workbook = get_workbook()
    return {"status": "ok", "workbook": workbook.workbook_name}


@app.get("/sheets")
def list_sheets() -> dict[str, list[str]]:
    workbook = get_workbook()
    return {"sheets": workbook.sheet_names()}


@app.get("/sheets/{sheet_name}/preview")
def preview_sheet(
    sheet_name: str,
    rows: int = Query(default=10, ge=1, le=100),
) -> dict[str, object]:
    workbook = get_workbook()
    if sheet_name not in workbook.sheet_names():
        raise HTTPException(status_code=404, detail=f"Sheet not found: {sheet_name}")
    return {
        "sheet_name": sheet_name,
        "rows": rows,
        "preview": workbook.preview_sheet(sheet_name=sheet_name, rows=rows),
    }


@app.get("/metrics/summary")
def summary_metrics() -> dict[str, object]:
    return get_workbook().summary_metrics()


@app.get("/metrics/irr")
def irr_metrics() -> dict[str, object]:
    return get_workbook().irr_metrics()


@app.get("/metrics/monthly-returns")
def monthly_returns() -> dict[str, object]:
    return {"monthly_returns": get_workbook().monthly_returns()}


@app.get("/metrics/top-holdings")
def top_holdings() -> dict[str, object]:
    return {"top_holdings": get_workbook().top_holdings()}
