#!/usr/bin/env node
/**
 * Capture screenshots of Clawser features for the README.
 * Connects to the RUNNING Chrome instance via CDP for real workspace data.
 * Usage: node scripts/screenshots.mjs
 * Requires: Chrome running with --remote-debugging-port=9222
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const BASE = 'http://localhost:3000';

async function switchPanel(page, panelName) {
  await page.evaluate((name) => {
    // Use the app's own activatePanel function via the router
    const btn = document.querySelector(`button[data-panel="${name}"]`);
    if (btn) btn.click();
  }, panelName);
  await page.waitForTimeout(800);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Navigate directly into the workspace
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(1500);

  // Click on the workspace card to enter it
  await page.evaluate(() => {
    const wsCard = document.querySelector('.ws-card');
    if (wsCard) wsCard.click();
  });
  await page.waitForTimeout(2000);

  // Verify we're in workspace view
  const inWorkspace = await page.evaluate(() => {
    return document.querySelector('.workspace')?.classList.contains('active-view') ||
           document.getElementById('viewWorkspace')?.classList.contains('active-view');
  });

  if (!inWorkspace) {
    // Try hash navigation
    await page.goto(BASE + '/#workspace/default');
    await page.waitForTimeout(2000);
  }

  // -- 1. Chat panel --
  console.log('1. Chat panel');
  await switchPanel(page, 'chat');
  await page.screenshot({ path: join(outDir, '01-chat.png') });

  // -- 2. Terminal panel --
  console.log('2. Terminal panel');
  await switchPanel(page, 'terminal');
  // Run help command
  await page.evaluate(() => {
    const input = document.getElementById('terminalInput');
    if (input) {
      input.value = 'help';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, '02-terminal.png') });

  // -- 3. Tool Management - Browser Tools --
  console.log('3. Tool Management - Browser Tools');
  await switchPanel(page, 'toolMgmt');
  await page.screenshot({ path: join(outDir, '03-tools-browser.png') });

  // -- 4. Tool Management - Shell Commands --
  console.log('4. Tool Management - Shell Commands');
  await page.evaluate(() => {
    const tab = document.querySelector('.tool-mgmt-tab[data-tab="shell-commands"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '04-tools-shell.png') });

  // -- 5. Files panel --
  console.log('5. Files panel');
  await switchPanel(page, 'files');
  await page.screenshot({ path: join(outDir, '05-files.png') });

  // -- 6. Memory panel --
  console.log('6. Memory panel');
  await switchPanel(page, 'memory');
  await page.screenshot({ path: join(outDir, '06-memory.png') });

  // -- 7. Goals panel --
  console.log('7. Goals panel');
  await switchPanel(page, 'goals');
  await page.screenshot({ path: join(outDir, '07-goals.png') });

  // -- 8. Skills panel --
  console.log('8. Skills panel');
  await switchPanel(page, 'skills');
  await page.screenshot({ path: join(outDir, '08-skills.png') });

  // -- 9. Config panel --
  console.log('9. Config panel');
  await switchPanel(page, 'config');
  await page.screenshot({ path: join(outDir, '09-config.png') });

  // -- 10. Dashboard panel --
  console.log('10. Dashboard panel');
  await switchPanel(page, 'dashboard');
  await page.screenshot({ path: join(outDir, '10-dashboard.png') });

  // -- 11. Agents panel --
  console.log('11. Agents panel');
  await switchPanel(page, 'agents');
  await page.screenshot({ path: join(outDir, '11-agents.png') });

  // -- 12. Command Palette overlay --
  console.log('12. Command Palette');
  await switchPanel(page, 'chat');
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', code: 'KeyK', metaKey: true, bubbles: true, cancelable: true
    }));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '12-cmd-palette.png') });

  await browser.close();
  console.log(`\nDone! 12 screenshots saved to ${outDir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
