# Personal Finance Dashboard

A local, single-page financial dashboard that visualises Rocket Money spending data and account balances, with a built-in balance scraper and multi-year forecasting tools.

---

## To Do

- [ ] Pull Rocket Money CSV data automatically instead of loading files manually
- [ ] Export charts or summary data as PDF / PNG

---

## Overview

| File / Folder | Purpose |
|---|---|
| `financial_dashboard.html` | The entire front-end — HTML, CSS, and JS in one file. Served by the Node server or opened directly in a browser. |
| `server.js` | Tiny Node HTTP server. Serves the dashboard and two read-only API endpoints for spending CSVs and balance JSON files. Also exposes `POST /api/run-scraper` to launch the scraper from the dashboard UI. |
| `run_scraper.ps1` | PowerShell helper that `cd`s into the scraper folder, runs `npm run scrape`, and keeps the terminal open when finished. Launched automatically by the server when you click **Run Scraper** in the dashboard. |
| `scraper/` | Playwright-based Rocket Money balance scraper (see below). |

---

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- Windows (the scraper launcher uses PowerShell; the scraper itself is cross-platform)

---

## Quick Start

### 1. Start the server

```powershell
node server.js
```

Then open **http://localhost:3000** in your browser.

### 2. Set up the scraper (first time only)

```powershell
cd scraper
npm install
npm run setup          # downloads Chromium
copy .env.example .env # then fill in your Rocket Money credentials
copy accounts.config.example.json accounts.config.json  # then fill in your account URLs
```

**`.env`**
```
ROCKET_EMAIL=you@example.com
ROCKET_PASSWORD=yourpassword
```

**`accounts.config.json`** — add one entry per account you want to track. Find the URL for each account by navigating to it on `app.rocketmoney.com` and copying the address bar.

```json
[
  { "name": "Chase Checking", "type": "Checking",    "url": "https://app.rocketmoney.com/accounts/YOUR_ID" },
  { "name": "Chase Sapphire", "type": "Credit Card", "url": "https://app.rocketmoney.com/accounts/YOUR_ID" },
  { "name": "Fidelity",       "type": "Investment",  "url": "https://app.rocketmoney.com/accounts/YOUR_ID" }
]
```

Valid `type` values: `Checking`, `Savings`, `Credit Card`, `Investment`, `Loan`, `Cash`, `Other`.

### 3. Run the scraper

Click **▶ Run Scraper** on the **Accounts & Net Worth** tab. A terminal window will open, log into Rocket Money (prompting for MFA if required), scrape each account, and save a timestamped snapshot to your `AccountData` folder. Refresh the dashboard when it finishes to load the new data.

You can also run the scraper directly:

```powershell
cd scraper
npm run scrape
```

---

## Dashboard Tabs

### Spending

Load one or more Rocket Money CSV exports via **Manual Load** or by placing them in the `RocketMoneyCSVs` folder (loaded automatically on server start). Displays income vs. spending charts, category breakdowns, and a filterable transaction table.

### Accounts & Net Worth

Loads balance snapshots from the `AccountData` folder. Shows total assets, total debts, and net worth cards, a historical net worth chart, and a per-account balance table with change-since-last-run indicators.

### Forecast

Projects investment account growth and cash balance (checking + savings) over a user-defined time horizon. Supports:

- Per-account annual return rate and contribution settings
- Monthly income override
- **Planned Purchases** — one-time, monthly, bi-annual, or yearly expenses plotted as vertical markers on the chart

---

## Data Directories

The server reads from two folders, configurable via environment variables:

| Variable | Default |
|---|---|
| `SPENDING_DIR` | `RocketMoneyCSVs/` (relative to `server.js`) |
| `BALANCES_DIR` | `AccountData/` (relative to `server.js`) |

Override at startup:

```powershell
$env:SPENDING_DIR = "D:\my-csvs"; $env:BALANCES_DIR = "D:\my-balances"; node server.js
```

---

## Security Notes

- Credentials live only in `scraper/.env`, which is listed in `.gitignore` and never committed.
- `accounts.config.json` is also gitignored.
- The server binds to `localhost` only and has no authentication — do not expose it to a network.
