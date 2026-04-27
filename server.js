/**
 * Financial Dashboard Server
 *
 * Serves financial_dashboard.html and two API endpoints that read local
 * folders so the dashboard can auto-load on startup.
 *
 * Usage:  node server.js
 *         Then open  http://localhost:3000
 */

'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');

// ── Paths ─────────────────────────────────────────────────────────────────────

const PORT         = process.env.PORT || 3000;
const DASHBOARD    = path.join(__dirname, 'financial_dashboard.html');
const SPENDING_DIR = process.env.SPENDING_DIR
  || path.join(__dirname, 'RocketMoneyCSVs');
const BALANCES_DIR = process.env.BALANCES_DIR
  || path.join(__dirname, 'AccountData');

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readDir(dir, filterFn) {
  try {
    return fs.readdirSync(dir)
      .filter(filterFn)
      .map(name => {
        try {
          return { name, content: fs.readFileSync(path.join(dir, name), 'utf8') };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // Serve dashboard HTML
  if (url === '/' || url === '/index.html') {
    try {
      const html = fs.readFileSync(DASHBOARD, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500); res.end('Could not read financial_dashboard.html');
    }
    return;
  }

  // API: spending CSVs
  if (url === '/api/spending') {
    const files = readDir(SPENDING_DIR, n => n.toLowerCase().endsWith('.csv'));
    json(res, { dir: SPENDING_DIR, files });
    return;
  }

  // API: balance snapshots
  if (url === '/api/balances') {
    const files = readDir(BALANCES_DIR, n => /^balances.*\.json$/i.test(n));
    json(res, { dir: BALANCES_DIR, files });
    return;
  }

  // API: launch scraper in a new terminal window
  if (url === '/api/run-scraper' && req.method === 'POST') {
    const script = path.join(__dirname, 'run_scraper.ps1');
    exec(`start "Rocket Money Scraper" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}"`);
    json(res, { ok: true });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Financial Dashboard running at  http://localhost:${PORT}\n`);
  console.log(`  Spending CSVs  : ${SPENDING_DIR}`);
  console.log(`  Balance data   : ${BALANCES_DIR}\n`);
});
