from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    excel_path: Path = Path(__file__).parent.parent / "Ariete Invest - Report Model.xlsx"

    # Investor identity (cosmetic labels only)
    investor_name: str = "Vasco Varão"
    portfolio_id: str = "AI-0042"

    # Financial config
    risk_free_rate: float = 0.035        # annual, used for Sharpe
    moic_target: float = 2.0

    # Target allocation (must sum to 1.0)
    target_equity_pct: float = 0.70
    target_bond_pct: float = 0.20
    target_alt_pct: float = 0.10         # alternatives = ETF/ETC + Crypto ETP

    # Reconciliation tolerance
    nav_reconciliation_tolerance: float = 0.005   # 0.5%


settings = Settings()
