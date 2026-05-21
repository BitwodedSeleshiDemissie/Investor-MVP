export const GLOSSARY = {
  portfolioValue:
    "The current total market value of all assets in the fund — listed securities, private investments, and cash — valued at today's prices.",
  capitalCommitted:
    "The total capital invested into the fund by all investors. This is your cost basis before any returns or distributions.",
  moic:
    "Multiple on Invested Capital. How many times the portfolio is worth relative to total capital invested, including distributions already paid out. A MOIC of 1.3× means every €1 invested is currently worth €1.30.",
  investorIrr:
    "Your personal annualized return rate, calculated from the exact dates and amounts of your cash flows. Two investors in the same fund can have different IRRs based on when they subscribed.",
  fundIrr:
    "The annualized return of the overall fund portfolio, based on listed market prices and approved private valuations. Measures fund performance independently of any individual investor's entry date.",
  nav: "Net Asset Value — the total value of all fund assets minus any liabilities. NAV divided by units outstanding gives the price per unit, used for subscriptions and performance reporting.",
  sharpeRatio:
    "How much return the portfolio earns per unit of risk. Above 1.0 is generally good: it means you earn more than 1% of excess return for each 1% of volatility taken.",
  annVolatility:
    "Annualized Volatility. How much the portfolio's monthly returns fluctuate from month to month, scaled to a full year. Lower volatility means more consistent, predictable returns.",
  maxDrawdown:
    "The largest peak-to-trough decline in portfolio value during the measured period. A −15% Max Drawdown means the portfolio fell 15% from its highest point before recovering.",
  annReturn:
    "Annualized Time-Weighted Return (TWR). The fund's compound annual growth rate, adjusted to remove the effect of investor cash flows — the standard way to measure investment manager performance.",
  riskFreeRate:
    "The theoretical return of a risk-free investment (typically short-term government bonds). Used as the baseline in the Sharpe Ratio: only returns earned above this rate count as reward for risk taken.",
  dataWindow:
    "The number of months of return history used to calculate the volatility, Sharpe Ratio, and Max Drawdown shown here. More months produce more statistically reliable estimates.",
  unrealizedPnl:
    "Gain or loss on positions currently held and not yet sold. This changes as market prices move and only becomes fixed when the position is closed.",
  realizedPnl:
    "Gain or loss locked in from positions that have been fully sold or closed. Unlike unrealized P&L, this is a permanent, settled figure.",
  netTotalPnl:
    "The sum of unrealized and realized gains and losses. Represents total profit or loss on all capital deployed, regardless of whether positions are still open.",
  irrPerInvestor:
    "Internal Rate of Return — the annualized return that equates the present value of all cash flows to zero. Each investor's IRR differs based on their personal subscription date and amount.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
