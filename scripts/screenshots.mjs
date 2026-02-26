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

  // Close the command palette before continuing
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
    }));
  });
  await page.waitForTimeout(300);

  // ======================================================================
  // NEW SCREENSHOTS (13–28) for tutorials
  // ======================================================================

  // -- 13. Home screen with workspace card and Accounts --
  console.log('13. Home screen');
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, '13-home-screen.png') });

  // -- 14. Workspace entry (fresh workspace view) --
  console.log('14. Workspace entry');
  await page.evaluate(() => {
    const wsCard = document.querySelector('.ws-card');
    if (wsCard) wsCard.click();
  });
  await page.waitForTimeout(2000);
  // Fallback if click didn't work
  const inWs14 = await page.evaluate(() =>
    document.getElementById('viewWorkspace')?.classList.contains('active-view'));
  if (!inWs14) {
    await page.goto(BASE + '/#workspace/default');
    await page.waitForTimeout(2000);
  }
  await switchPanel(page, 'chat');
  await page.screenshot({ path: join(outDir, '14-workspace-entry.png') });

  // -- 15. Events panel with seeded events --
  console.log('15. Events panel');
  await page.evaluate(() => {
    // Seed some event entries into the event log UI
    const log = document.getElementById('eventLog');
    if (!log) return;
    const events = [
      { type: 'tool_call', detail: 'browser_fetch → https://api.example.com/data', time: '12:01:03' },
      { type: 'memory_store', detail: 'Stored: "user prefers dark mode"', time: '12:01:15' },
      { type: 'tool_call', detail: 'browser_fs_write → /notes/summary.md', time: '12:01:22' },
      { type: 'goal_update', detail: 'Goal "Research API docs" → completed', time: '12:01:30' },
      { type: 'tool_call', detail: 'browser_web_search → "playwright testing"', time: '12:02:01' },
      { type: 'message', detail: 'Agent response (284 tokens, $0.003)', time: '12:02:05' },
    ];
    log.innerHTML = '';
    events.forEach(e => {
      const row = document.createElement('div');
      row.className = 'event-row';
      row.innerHTML = `<span class="event-time">${e.time}</span>
        <span class="event-type badge badge-${e.type === 'tool_call' ? 'tool' : e.type}">${e.type}</span>
        <span class="event-detail">${e.detail}</span>`;
      log.appendChild(row);
    });
    // Update badge
    const badge = document.getElementById('eventCount');
    if (badge) badge.textContent = '6';
  });
  await switchPanel(page, 'events');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '15-events-panel.png') });

  // -- 16. Conversation item bar dropdown --
  console.log('16. Conversation item bar');
  await switchPanel(page, 'chat');
  await page.evaluate(() => {
    // Seed some conversation items if the item-bar container exists
    const container = document.getElementById('convBarContainer');
    if (!container) return;
    // Click the dropdown toggle if it exists
    const toggle = container.querySelector('.item-bar-toggle, .ib-toggle, button');
    if (toggle) toggle.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '16-conv-item-bar.png') });
  // Close dropdown
  await page.evaluate(() => {
    const container = document.getElementById('convBarContainer');
    if (!container) return;
    const toggle = container.querySelector('.item-bar-toggle, .ib-toggle, button');
    if (toggle) toggle.click();
  });
  await page.waitForTimeout(300);

  // -- 17. Memory with seeded entries --
  console.log('17. Memory with entries');
  await switchPanel(page, 'memory');
  await page.evaluate(() => {
    const results = document.getElementById('memResults');
    if (!results) return;
    const entries = [
      { key: 'preferred_language', content: 'User prefers TypeScript for all projects', category: 'user' },
      { key: 'api_pattern', content: 'REST endpoints follow /api/v1/{resource} convention', category: 'learned' },
      { key: 'project_name', content: 'Current project is called "Clawser"', category: 'core' },
      { key: 'deploy_target', content: 'Deploys to Cloudflare Pages with Docker fallback', category: 'context' },
      { key: 'test_framework', content: 'Uses browser-based test.html with custom assertions', category: 'learned' },
    ];
    results.innerHTML = '';
    entries.forEach(e => {
      const row = document.createElement('div');
      row.className = 'mem-row';
      row.innerHTML = `<div class="mem-row-header">
          <span class="mem-key">${e.key}</span>
          <span class="mem-cat badge">${e.category}</span>
        </div>
        <div class="mem-content">${e.content}</div>`;
      results.appendChild(row);
    });
    const badge = document.getElementById('memCount');
    if (badge) badge.textContent = '5';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '17-memory-with-entries.png') });

  // -- 18. Goals with seeded entries --
  console.log('18. Goals with entries');
  await switchPanel(page, 'goals');
  await page.evaluate(() => {
    const goalList = document.getElementById('goalList');
    if (!goalList) return;
    goalList.innerHTML = '';
    const goals = [
      { desc: 'Build tutorial documentation', status: 'active', progress: 60, children: [
        { desc: 'Write getting-started guide', status: 'completed', progress: 100 },
        { desc: 'Write advanced tutorials', status: 'active', progress: 30 },
      ]},
      { desc: 'Add screenshot automation', status: 'completed', progress: 100, children: [] },
      { desc: 'Update README with tutorial links', status: 'active', progress: 0, children: [] },
    ];
    goals.forEach(g => {
      const el = document.createElement('div');
      el.className = 'goal-item';
      const statusClass = g.status === 'completed' ? 'goal-completed' : 'goal-active';
      el.innerHTML = `<div class="goal-header ${statusClass}">
          <span class="goal-status-icon">${g.status === 'completed' ? '✓' : '◉'}</span>
          <span class="goal-desc">${g.desc}</span>
          <span class="goal-progress">${g.progress}%</span>
        </div>
        <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${g.progress}%"></div></div>`;
      if (g.children.length) {
        const sub = document.createElement('div');
        sub.className = 'goal-children';
        g.children.forEach(c => {
          const cel = document.createElement('div');
          cel.className = 'goal-item goal-child';
          const cClass = c.status === 'completed' ? 'goal-completed' : 'goal-active';
          cel.innerHTML = `<div class="goal-header ${cClass}">
              <span class="goal-status-icon">${c.status === 'completed' ? '✓' : '◉'}</span>
              <span class="goal-desc">${c.desc}</span>
              <span class="goal-progress">${c.progress}%</span>
            </div>`;
          sub.appendChild(cel);
        });
        el.appendChild(sub);
      }
      goalList.appendChild(el);
    });
    const badge = document.getElementById('goalCount');
    if (badge) badge.textContent = '3';
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '18-goals-with-entries.png') });

  // -- 19. Files with seeded directory tree --
  console.log('19. Files with content');
  await switchPanel(page, 'files');
  await page.evaluate(() => {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    fileList.innerHTML = '';
    const tree = [
      { name: '📁 docs/', indent: 0 },
      { name: '📁 tutorials/', indent: 1 },
      { name: '📄 01-getting-started.md (2.1 KB)', indent: 2 },
      { name: '📄 02-chat-and-conversations.md (1.8 KB)', indent: 2 },
      { name: '📄 README.md (0.9 KB)', indent: 2 },
      { name: '📁 notes/', indent: 0 },
      { name: '📄 summary.md (4.2 KB)', indent: 1 },
      { name: '📄 research.json (12.0 KB)', indent: 1 },
      { name: '📁 scripts/', indent: 0 },
      { name: '📄 analyze.js (1.5 KB)', indent: 1 },
      { name: '📄 config.json (0.3 KB)', indent: 0 },
    ];
    tree.forEach(f => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.style.paddingLeft = `${12 + f.indent * 20}px`;
      row.textContent = f.name;
      fileList.appendChild(row);
    });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '19-files-with-content.png') });

  // -- 20. Terminal showing pipe command --
  console.log('20. Terminal pipe');
  await switchPanel(page, 'terminal');
  await page.evaluate(() => {
    const output = document.getElementById('terminalOutput');
    if (!output) return;
    // Clear and seed pipe example
    output.innerHTML = '';
    const lines = [
      { prompt: true, text: '~ $ echo "hello world" | wc' },
      { prompt: false, text: '       1       2      12' },
      { prompt: true, text: '~ $ ls docs/ | sort' },
      { prompt: false, text: 'API.md\nCLI.md\nCONFIG.md\nFEATURES.md\nMODULES.md\nTOOLS.md\ntutorials/' },
      { prompt: true, text: '~ $ cat notes/summary.md | grep -i "important" | wc -l' },
      { prompt: false, text: '3' },
    ];
    lines.forEach(l => {
      const div = document.createElement('div');
      div.className = l.prompt ? 'term-line term-prompt' : 'term-line term-output';
      div.textContent = l.text;
      if (l.text.includes('\n')) div.style.whiteSpace = 'pre';
      output.appendChild(div);
    });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '20-terminal-pipe.png') });

  // -- 21. Terminal showing clawser status --
  console.log('21. Terminal clawser status');
  await page.evaluate(() => {
    const output = document.getElementById('terminalOutput');
    if (!output) return;
    output.innerHTML = '';
    const lines = [
      { prompt: true, text: '~ $ clawser status' },
      { prompt: false, text: `Provider:    openai (gpt-4o)
Model:       gpt-4o
Autonomy:    supervised
History:     24 messages
Memory:      5 entries
Goals:       3 (1 completed)
Jobs:        0 scheduled
Cost:        $0.12 this session
Uptime:      14m 32s` },
    ];
    lines.forEach(l => {
      const div = document.createElement('div');
      div.className = l.prompt ? 'term-line term-prompt' : 'term-line term-output';
      div.style.whiteSpace = 'pre';
      div.textContent = l.text;
      output.appendChild(div);
    });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '21-terminal-clawser-status.png') });

  // -- 22. Terminal session bar dropdown --
  console.log('22. Terminal sessions');
  await page.evaluate(() => {
    const container = document.getElementById('termSessionBarContainer');
    if (!container) return;
    const toggle = container.querySelector('.item-bar-toggle, .ib-toggle, button');
    if (toggle) toggle.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '22-terminal-sessions.png') });
  // Close dropdown
  await page.evaluate(() => {
    const container = document.getElementById('termSessionBarContainer');
    if (!container) return;
    const toggle = container.querySelector('.item-bar-toggle, .ib-toggle, button');
    if (toggle) toggle.click();
  });
  await page.waitForTimeout(300);

  // -- 23. Config Autonomy & Costs section --
  console.log('23. Config autonomy');
  await switchPanel(page, 'config');
  await page.evaluate(() => {
    const toggle = document.getElementById('autonomyToggle');
    if (toggle) {
      toggle.click();
      toggle.setAttribute('aria-expanded', 'true');
    }
    const section = document.getElementById('autonomySection');
    if (section) section.classList.remove('config-section-hidden');
  });
  await page.waitForTimeout(500);
  // Scroll to the autonomy section
  await page.evaluate(() => {
    const section = document.getElementById('autonomySection');
    if (section) section.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '23-config-autonomy.png') });

  // -- 24. Config MCP section --
  console.log('24. Config MCP');
  await page.evaluate(() => {
    // Collapse autonomy
    const aToggle = document.getElementById('autonomyToggle');
    if (aToggle) aToggle.click();
    // Expand MCP
    const toggle = document.getElementById('mcpToggle');
    if (toggle) {
      toggle.click();
      toggle.setAttribute('aria-expanded', 'true');
    }
    const section = document.getElementById('mcpSection');
    if (section) {
      section.classList.remove('config-section-hidden');
      section.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '24-config-mcp.png') });

  // -- 25. Browser Tools tab with one tool expanded --
  console.log('25. Tool detail expanded');
  await switchPanel(page, 'toolMgmt');
  await page.evaluate(() => {
    // Click "Browser Tools" tab
    const tab = document.querySelector('.tool-mgmt-tab[data-tab="browser-tools"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    // Expand the first tool row
    const rows = document.querySelectorAll('.tool-row, .tool-item, [class*="tool"]');
    for (const row of rows) {
      const toggle = row.querySelector('.tool-expand, .tool-toggle, button, summary');
      if (toggle) { toggle.click(); break; }
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '25-tool-detail-expanded.png') });

  // -- 26. Shell Commands tab with one command expanded --
  console.log('26. Shell cmd expanded');
  await page.evaluate(() => {
    const tab = document.querySelector('.tool-mgmt-tab[data-tab="shell-commands"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    // Expand first shell command
    const items = document.querySelectorAll('.shell-cmd-item, .cmd-row, details');
    for (const item of items) {
      if (item.tagName === 'DETAILS') { item.open = true; break; }
      const toggle = item.querySelector('.cmd-expand, button, summary');
      if (toggle) { toggle.click(); break; }
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '26-shell-cmd-expanded.png') });

  // -- 27. Command palette with a tool selected and params visible --
  console.log('27. Cmd palette params');
  await switchPanel(page, 'chat');
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', code: 'KeyK', metaKey: true, bubbles: true, cancelable: true
    }));
  });
  await page.waitForTimeout(500);
  // Type a search query to filter tools
  await page.evaluate(() => {
    const search = document.getElementById('cmdSearch');
    if (search) {
      search.value = 'fetch';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(400);
  // Click the first tool result to show params
  await page.evaluate(() => {
    const list = document.getElementById('cmdToolList');
    if (!list) return;
    const first = list.querySelector('.cmd-tool-item, button, div[role="option"]');
    if (first) first.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '27-cmd-palette-params.png') });
  // Close palette
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
    }));
  });
  await page.waitForTimeout(300);

  // -- 28. Agents panel showing edit form --
  console.log('28. Agents form');
  await switchPanel(page, 'agents');
  await page.waitForTimeout(500);
  // Try clicking the first agent or "New Agent" button to open the form
  await page.evaluate(() => {
    // Look for a new-agent button or an existing agent card to click
    const newBtn = document.querySelector('[class*="agent-new"], [class*="agent-add"], button[class*="add"]');
    if (newBtn) { newBtn.click(); return; }
    // Otherwise click the first agent card
    const card = document.querySelector('.agent-card, .agent-item, [class*="agent"]');
    if (card) card.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, '28-agents-form.png') });

  await browser.close();
  console.log(`\nDone! 28 screenshots saved to ${outDir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
