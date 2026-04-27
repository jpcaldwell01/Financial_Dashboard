/**
 * Rocket Money Balance Scraper
 *
 * Logs into app.rocketmoney.com, then visits each account URL listed in
 * accounts.config.json and extracts the current balance.
 *
 * Output: ../AccountData/balances_YYYY-MM-DD.json  (timestamped snapshot)
 *         ../AccountData/balances_latest.json       (always overwritten)
 *
 * Setup:
 *   1. npm install
 *   2. npm run setup        (downloads Chromium)
 *   3. Copy .env.example → .env and fill in your credentials
 *   4. Copy accounts.config.example.json → accounts.config.json
 *      and fill in your account URLs from app.rocketmoney.com
 *   5. npm run scrape
 */

'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const readline = require('readline');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = process.env.OUTPUT_DIR
  || path.resolve(__dirname, '..', 'AccountData');

const ACCOUNTS_CONFIG = path.join(__dirname, 'accounts.config.json');

const LOGIN_URL       = 'https://app.rocketmoney.com/';
const TIMEOUT         = 30_000;
const POST_LOGIN_WAIT = 6_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function log(msg)  { console.log(`[scraper] ${msg}`); }
function warn(msg) { console.warn(`[scraper] ⚠  ${msg}`); }

async function tryFill(page, selectors, value, label) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 2_000, state: 'visible' });
      await page.fill(sel, value);
      log(`${label} → filled with selector "${sel}"`);
      return true;
    } catch { /* try next */ }
  }
  return false;
}

async function tryClick(page, selectors, label) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 2_000, state: 'visible' });
      await page.click(sel);
      log(`${label} → clicked with selector "${sel}"`);
      return true;
    } catch { /* try next */ }
  }
  return false;
}

async function screenshot(page, name) {
  const p = path.join(OUTPUT_DIR, `debug_${name}.png`);
  try { await page.screenshot({ path: p, fullPage: true }); log(`Screenshot: debug_${name}.png`); }
  catch { /* non-fatal */ }
}

/**
 * Visit a single account page and return the balance as a string (e.g. "$1,234.56").
 * Tries multiple selector strategies; falls back to scanning all dollar-like text nodes.
 */
async function scrapeAccountBalance(page, url, accountName) {
  log(`  Navigating to ${accountName} (${url})…`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  } catch {
    warn(`  domcontentloaded timed out for ${accountName} — proceeding anyway.`);
  }
  await page.waitForTimeout(3_000);

  const balance = await page.evaluate(() => {
    const dollarRe = /^-?\s*\$[\d,]+(\.\d{1,2})?$/;

    // Strategy A: explicit balance/amount data-testid attributes
    const testIds = [
      '[data-testid="account-balance"]',
      '[data-testid="balance"]',
      '[data-testid="current-balance"]',
      '[data-testid="amount"]',
      '[data-testid*="balance"]',
    ];
    for (const sel of testIds) {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.innerText || '').trim();
        if (dollarRe.test(t)) return t;
      }
    }

    // Strategy B: class-name patterns common in Rocket Money
    const classPatterns = [
      '[class*="balance" i]',
      '[class*="Balance"]',
      '[class*="amount" i]',
      '[class*="Amount"]',
      'h1', 'h2', 'h3',
    ];
    for (const sel of classPatterns) {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.innerText || '').trim().split(/\s+/)[0];
        if (dollarRe.test(t)) return t;
      }
    }

    // Strategy C: first dollar-formatted text node on the page
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').trim();
      if (dollarRe.test(t)) return t;
    }

    return null;
  });

  if (balance) {
    log(`  ${accountName}: ${balance}`);
  } else {
    warn(`  ${accountName}: could not extract balance — check debug screenshot.`);
    await screenshot(page, `balance_fail_${accountName.replace(/\W+/g, '_')}`);
  }

  return balance;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // Validate credentials
  const { ROCKET_EMAIL, ROCKET_PASSWORD } = process.env;
  if (!ROCKET_EMAIL || !ROCKET_PASSWORD) {
    console.error('\n  Missing credentials.\n  Copy .env.example → .env and fill in ROCKET_EMAIL and ROCKET_PASSWORD.\n');
    process.exit(1);
  }

  // Load account config
  if (!fs.existsSync(ACCOUNTS_CONFIG)) {
    console.error(`\n  Missing account config.\n  Copy accounts.config.example.json → accounts.config.json\n  and fill in your Rocket Money account URLs.\n`);
    process.exit(1);
  }
  const accountList = JSON.parse(fs.readFileSync(ACCOUNTS_CONFIG, 'utf8'));
  if (!Array.isArray(accountList) || accountList.length === 0) {
    console.error('\n  accounts.config.json is empty or invalid. Add at least one account entry.\n');
    process.exit(1);
  }
  log(`Loaded ${accountList.length} account(s) from accounts.config.json`);

  // Ensure output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  log('Launching browser…');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Navigate to login ──────────────────────────────────────────
    log(`Navigating to ${LOGIN_URL}…`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(2_000);
    await screenshot(page, '01_login_page');

    // ── Step 2: Fill email ─────────────────────────────────────────────────
    log('Filling email…');
    const emailFilled = await tryFill(page, [
      'input[type="email"]',
      'input[name="email"]',
      'input[id="email"]',
      'input[autocomplete="email"]',
      'input[placeholder*="email" i]',
    ], ROCKET_EMAIL, 'Email');

    if (!emailFilled) {
      await screenshot(page, '02_email_not_found');
      throw new Error('Could not locate the email field. Check debug_02_email_not_found.png.');
    }

    // Some flows show email first, then reveal password on the next screen
    await tryClick(page, [
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button[type="submit"]:has-text("Continue")',
    ], 'Continue (email step)');
    await page.waitForTimeout(1_500);

    // ── Step 3: Fill password ──────────────────────────────────────────────
    log('Filling password…');
    const passwordFilled = await tryFill(page, [
      'input[type="password"]',
      'input[name="password"]',
      'input[id="password"]',
      'input[autocomplete="current-password"]',
    ], ROCKET_PASSWORD, 'Password');

    if (!passwordFilled) {
      await screenshot(page, '03_password_not_found');
      throw new Error('Could not locate the password field. Check debug_03_password_not_found.png.');
    }

    // ── Step 4: Submit ─────────────────────────────────────────────────────
    log('Submitting login form…');
    const submitted = await tryClick(page, [
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Continue")',
      '[data-testid="login-submit"]',
    ], 'Submit');

    if (!submitted) {
      await page.keyboard.press('Enter');
      log('Submit → pressed Enter as fallback');
    }

    await page.waitForTimeout(POST_LOGIN_WAIT);
    await screenshot(page, '04_after_submit');

    // ── Step 5: Handle MFA ─────────────────────────────────────────────────
    const mfaSelectors = [
      'input[name="code"]',
      'input[name="otp"]',
      'input[autocomplete="one-time-code"]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verification" i]',
      '[data-testid*="otp"]',
      '[data-testid*="mfa"]',
      'input[inputmode="numeric"][maxlength]',
    ];

    let mfaVisible = false;
    for (const sel of mfaSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3_000, state: 'visible' });
        mfaVisible = true;
        log(`MFA field detected (${sel})`);
        break;
      } catch { /* not visible */ }
    }

    if (mfaVisible) {
      log('MFA required — check the browser window for prompts.');
      const code = await prompt('\n  Enter your verification / MFA code: ');
      const mfaFilled = await tryFill(page, mfaSelectors, code, 'MFA code');
      if (mfaFilled) {
        await tryClick(page, [
          'button[type="submit"]',
          'button:has-text("Verify")',
          'button:has-text("Continue")',
          'button:has-text("Submit")',
        ], 'MFA submit');
        await page.waitForTimeout(5_000);
      } else {
        warn('Could not auto-fill MFA — please complete it manually in the browser.');
        await prompt('  Press ENTER here once you are logged in… ');
      }
    } else {
      log('No MFA prompt detected.');
    }

    await screenshot(page, '05_post_mfa');

    // ── Step 6: Confirm logged in ──────────────────────────────────────────
    const currentUrl = page.url();
    log(`Current URL: ${currentUrl}`);
    if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
      warn('Still on login page — login may have failed.');
      await prompt('  Log in manually in the browser if needed, then press ENTER… ');
    }

    // ── Step 7: Visit each account URL and scrape balance ─────────────────
    log('\nScraping individual account pages…');
    const TYPE_PATTERNS = [
      { type: 'Checking',    re: /check|debit/i },
      { type: 'Savings',     re: /sav/i },
      { type: 'Credit Card', re: /credit|card|visa|mastercard|amex|discover/i },
      { type: 'Investment',  re: /invest|brokerage|401k|ira|retirement|roth|vanguard|fidelity|schwab/i },
      { type: 'Loan',        re: /loan|mortgage|student|auto\s*loan/i },
      { type: 'Cash',        re: /cash|wallet|venmo|paypal|apple\s*cash/i },
    ];

    const classified = [];
    for (const acct of accountList) {
      const { name, url, type: forcedType } = acct;
      if (!name || !url) {
        warn(`Skipping entry missing "name" or "url": ${JSON.stringify(acct)}`);
        continue;
      }

      const balanceStr = await scrapeAccountBalance(page, url, name);

      // Determine type: use explicit type from config, or classify by name
      let type = forcedType;
      if (!type) {
        const match = TYPE_PATTERNS.find(p => p.re.test(name));
        type = match ? match.type : 'Other';
      }

      // Parse numeric value
      let value = null;
      if (balanceStr) {
        const num = parseFloat(balanceStr.replace(/[^0-9.\-]/g, ''));
        value = isNaN(num) ? null : (balanceStr.trim().startsWith('-') ? -Math.abs(num) : num);
      }

      classified.push({ name, type, balance: balanceStr || 'N/A', value });
    }

    // ── Step 8: Calculate net worth summary ───────────────────────────────
    const ASSET_TYPES = new Set(['Checking', 'Savings', 'Investment', 'Cash']);
    const DEBT_TYPES  = new Set(['Credit Card', 'Loan']);

    const assets      = classified.filter(a => ASSET_TYPES.has(a.type));
    const debts       = classified.filter(a => DEBT_TYPES.has(a.type));
    const totalAssets = assets.reduce((s, a) => s + (a.value || 0), 0);
    const totalDebts  = debts.reduce((s, a)  => s + Math.abs(a.value || 0), 0);
    const netWorth    = totalAssets - totalDebts;

    // ── Step 9: Save output ────────────────────────────────────────────────
    const timestamp = new Date().toISOString();
    const dateStr   = timestamp.slice(0, 10);

    const output = {
      timestamp,
      date: dateStr,
      summary: {
        totalAssets: +totalAssets.toFixed(2),
        totalDebts:  +totalDebts.toFixed(2),
        netWorth:    +netWorth.toFixed(2),
      },
      accounts: classified,
    };

    const snapFile   = path.join(OUTPUT_DIR, `balances_${dateStr}.json`);
    const latestFile = path.join(OUTPUT_DIR, 'balances_latest.json');
    fs.writeFileSync(snapFile,   JSON.stringify(output, null, 2));
    fs.writeFileSync(latestFile, JSON.stringify(output, null, 2));

    // ── Step 10: Print summary ─────────────────────────────────────────────
    console.log('\n──────────────────────────────────────────');
    console.log('  Rocket Money Balance Snapshot');
    console.log(`  ${dateStr}`);
    console.log('──────────────────────────────────────────');

    if (classified.length === 0) {
      console.log('  ⚠  No accounts scraped.');
    } else {
      const maxName = Math.max(...classified.map(a => a.name.length), 12);
      const maxType = Math.max(...classified.map(a => a.type.length), 4);
      classified.forEach(a => {
        const name = a.name.padEnd(maxName);
        const type = a.type.padEnd(maxType);
        console.log(`  ${name}  ${type}  ${a.balance}`);
      });
      console.log('──────────────────────────────────────────');
      console.log(`  Assets   : $${totalAssets.toFixed(2)}`);
      console.log(`  Debts    : $${totalDebts.toFixed(2)}`);
      console.log(`  Net Worth: $${netWorth.toFixed(2)}`);
    }

    console.log(`\n  Saved → ${latestFile}`);
    console.log(`  Saved → ${snapFile}\n`);

  } catch (err) {
    console.error(`\n[scraper] Fatal error: ${err.message}\n`);
    await screenshot(page, 'ERROR');
    console.error('  A screenshot of the error state was saved to debug_ERROR.png');
  } finally {
    await browser.close();
  }
}

run();
