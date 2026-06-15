# noon online dashboard — Node.js edition

A marketplace store-manager for a noon seller. Express backend, vanilla-JS
dashboard, and local JSON files for storage. No database, no build step.

Currently runs on **deterministic mock data** so every screen works out of the
box. Fill in real API keys in `config.json` and each adapter switches itself
from mock to the live call.

## Requirements
- Node.js 18+ (developed on Node 24)

## Setup & run
```bash
npm install
npm start            # serves http://localhost:7080
```
On Windows you can also just double-click **`start.bat`**, which sets the port
and opens the browser for you. Use a different port with `PORT=9090 npm start`.
For auto-restart on file changes during development: `npm run dev`.

## Command-line tool
`cli.js` replaces the old standalone PowerShell scripts. Same logic as the web
app, no server needed:

```bash
node cli.js dashboard [--date 2026-06-06]     # was Get-Dashboard.ps1
node cli.js minprice ABC100                    # was Get-MinimumPrice.ps1
node cli.js create ABC100                      # was New-Product.ps1
node cli.js create --file samples/products.csv # bulk -> writes *-results.csv
node cli.js sync --all                         # was Sync-Stock.ps1 -All
node cli.js sync --file samples/products.csv   # bulk by file
node cli.js report [--date 2026-06-05]         # was Send-DailyReport.ps1
```

npm shortcuts exist too (pass args after `--`), e.g. `npm run minprice -- ABC100`.
Bulk input is CSV (a `productCode` / `code` / `sku` column, or one code per line);
export `.xlsx` to CSV first.

## Project layout
```
server.js            Express app — serves public/ and the /api/* endpoints
cli.js               command-line tool (replaces the old .ps1 scripts)
src/
  config.js          loads + caches config.json
  store.js           JSON "database" (one file per table under data/)
  util.js            seed / date / id helpers
  adapters.js        the ONLY code that calls external services (mock or real)
  services.js        all business logic (pricing, products, stock, AI, etc.)
public/
  index.html         dashboard markup
  styles.css         styles
  app.js             frontend logic
data/*.json          Product, DailyMetric, PricingHistory, StockHistory, ...
samples/*.csv        example bulk-upload files
config.json          currency, pricing math, API keys, SMTP
```

## Status: runs on MOCK data
The marketplace, product-panel, and image APIs are stubbed with deterministic
demo data so everything works today. When you have the real APIs:

1. Open `config.json` and fill in `marketplaceApiBase` + `marketplaceApiKey`
   and/or `panelApiBase` + `panelApiKey`, `imageApiBase` + `imageApiKey`, and
   `anthropicApiKey` to turn on AI pricing/copy.
2. In `src/adapters.js`, complete the calls marked `// TODO(api):`. The mock
   block below each TODO shows the exact return shape the rest of the code
   expects. (A couple of panel-catalog TODOs also live in `src/services.js`.)

As soon as a base+key pair is filled in, that adapter automatically switches
from mock to the real call.

## Where data lives
`data/*.json` — Product, DailyMetric, PricingHistory, StockHistory,
AutomationLog, Note, CalendarEvent, AiOutput, Aplus, CompetitorPrice, Return.
Delete a file to reset that table. Files are read/written as plain UTF-8 JSON
(legacy byte-order marks from the old PowerShell edition are stripped on read).

## Email
Daily reports and FBN low-stock alerts are emailed via `nodemailer` when
`smtp.host` and `smtp.to` are set in `config.json`. With no SMTP configured the
report is saved as an HTML file under `data/` instead.

## AI
Pricing, the assistant, and keyword/title generation call Claude only if
`anthropicApiKey` is set in `config.json`; otherwise they fall back to a
formula / template (`source: formula`). The pricing floor is never below the
break-even price.

## API endpoints
All return JSON. Read endpoints accept `GET`; mutating ones accept `POST`
(the server accepts either method for convenience).

| Endpoint | Purpose |
|---|---|
| `/api/dashboard?date=` | KPIs for a day |
| `/api/sales-range?days=` | sales history for the chart |
| `/api/products` `/api/pricing` `/api/stock` `/api/automations` | raw tables |
| `/api/minprice?code=` | minimum-price calculator |
| `/api/create?code=` | create / update a listing |
| `/api/syncstock` | sync all live stock |
| `/api/orders` `/api/deals` `/api/ads` `/api/netprofit` | modules |
| `/api/returns` · `/api/returns/status?id=&status=` | returns / RMA |
| `/api/stock/fbp` `/api/stock/fbn` · `/api/fbn/alert` | fulfillment stock |
| `/api/action-items` · `/api/aplus` · `/api/aplus/set?code=&uploaded=` | listing health |
| `/api/bestsellers` `/api/dealoptimizer` `/api/pricecompare?code=` | insights |
| `/api/assistant?q=` `/api/keywords?code=|category=` `/api/image?prompt=` | AI |
| `/api/listings-pricing` · `/api/match-price?code=` | competitor matching |
| `/api/newarrivals` · `/api/autocreate/url` · `/api/autocreate/bulk` | sourcing |
| `/api/notes` (+ `/update`, `/delete`) · `/api/calendar` (+ `/delete`) | notes & calendar |
