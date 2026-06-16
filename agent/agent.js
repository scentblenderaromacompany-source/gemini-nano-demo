#!/usr/bin/env node
/**
 * Gemini Nano Browser Agent (Node.js)
 * ====================================
 * Autonomous browser agent powered by Chrome's on-device Gemini Nano.
 * Uses agent-browser for browser control + Gemini Nano bridge for reasoning.
 *
 * Usage:
 *   node agent.js "Find AI news on Hacker News"
 *   node agent.js "Search wikipedia for quantum computing" --headed
 *   node agent.js "Fill out contact form on example.com" --max-steps 15
 */

import { execSync } from 'child_process';
import http from 'http';

const AGENT_BROWSER = process.env.AGENT_BROWSER_BIN ||
  '/home/bobby/.local/lib/node_modules/agent-browser/bin/agent-browser.js';
const BRIDGE_URL = 'http://localhost:8765/v1/chat/completions';
const SESSION = 'gemini-nano-agent';
const DEFAULT_MAX_STEPS = 20;

const SYSTEM_PROMPT = `You are a browser automation agent. You control a web browser via accessibility tree snapshots.

Your job: complete the user's task by deciding the next browser action.

AVAILABLE ACTIONS (respond with JSON only):
- {"action": "click", "ref": "@eN"}        — Click element N
- {"action": "fill", "ref": "@eN", "value": "text"} — Clear and fill an input
- {"action": "type", "ref": "@eN", "value": "text"}  — Type into input (append)
- {"action": "press", "key": "Enter"}       — Press a keyboard key
- {"action": "scroll", "direction": "down", "amount": 500} — Scroll page
- {"action": "navigate", "url": "https://..."} — Go to URL
- {"action": "done", "result": "summary"}   — Task is complete
- {"action": "stuck", "reason": "why"}      — Cannot proceed

RULES:
1. Always respond with valid JSON matching one of the actions above
2. Use refs from the accessibility tree (e.g., @e3, @e12)
3. After each action, you'll see the updated page state
4. Prefer clicking links/buttons over typing URLs
5. If a page needs loading, just say done for this step
6. If you can't find the right element, try scrolling
7. Be concise — just the JSON action, no explanation`;

function runAB(...args) {
  const headed = args.includes('--headed');
  const cleanArgs = args.filter(a => a !== '--headed');
  const cmd = [AGENT_BROWSER, '--session', SESSION, '--json'];
  if (headed) cmd.push('--headed');
  cmd.push(...cleanArgs.map(String));

  try {
    const out = execSync(cmd.join(' '), {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (out.trim()) {
      try { return JSON.parse(out); } catch { return { raw: out.trim() }; }
    }
    return {};
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    const stdout = e.stdout?.toString().trim();
    if (stdout) {
      try { return JSON.parse(stdout); } catch { return { raw: stdout }; }
    }
    return { error: stderr || e.message };
  }
}

function getSnapshot(headed = false) {
  const result = runAB('snapshot', ...(headed ? ['--headed'] : []));
  if (result.error) return null, result.error;

  const data = result.data;
  if (!data) return null, JSON.stringify(result);

  const parsed = typeof data === 'string' ? safeParse(data) : data;
  if (!parsed) return null, String(data);

  const tree = parsed.tree || parsed.snapshot || '';
  const url = parsed.url || 'unknown';
  const title = parsed.title || 'untitled';
  return tree, `URL: ${url}\nTitle: ${title}\n\n${tree}`;
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function geminiChat(messages, temperature = 0.3) {
  const payload = JSON.stringify({
    model: 'gemini-nano',
    messages,
    temperature,
    max_tokens: 256,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(BRIDGE_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.choices?.[0]?.message?.content?.trim() || '');
        } catch {
          resolve('{"action": "stuck", "reason": "Invalid bridge response"}');
        }
      });
    });
    req.on('error', e => resolve(`{"action": "stuck", "reason": "Bridge error: ${e.message}"}`));
    req.on('timeout', () => { req.destroy(); resolve('{"action": "stuck", "reason": "Bridge timeout"}'); });
    req.write(payload);
    req.end();
  });
}

function parseAction(text) {
  let t = text.trim();
  // Strip markdown code fences
  if (t.startsWith('```')) {
    t = t.split('\n').filter(l => !l.startsWith('```')).join('\n').trim();
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end)); } catch {}
  }
  return { action: 'stuck', reason: `Could not parse: ${t.slice(0, 200)}` };
}

function executeAction(action, headed = false) {
  const act = action.action;
  switch (act) {
    case 'click':
      runAB('click', action.ref, ...(headed ? ['--headed'] : []));
      sleep(1000);
      return 'ok';
    case 'fill':
      runAB('fill', action.ref, action.value || '', ...(headed ? ['--headed'] : []));
      sleep(500);
      return 'ok';
    case 'type':
      runAB('type', action.ref, action.value || '', ...(headed ? ['--headed'] : []));
      sleep(300);
      return 'ok';
    case 'press':
      runAB('press', action.key || 'Enter', ...(headed ? ['--headed'] : []));
      sleep(1000);
      return 'ok';
    case 'scroll':
      runAB('scroll', action.direction || 'down', String(action.amount || 500), ...(headed ? ['--headed'] : []));
      sleep(500);
      return 'ok';
    case 'navigate':
      runAB('open', action.url, ...(headed ? ['--headed'] : []));
      sleep(2000);
      return 'ok';
    case 'done':
      console.log(`\n✅ TASK COMPLETE: ${action.result || 'Done'}`);
      return 'done';
    case 'stuck':
      console.log(`\n❌ STUCK: ${action.reason || 'Unknown'}`);
      return 'stuck';
    default:
      console.log(`\n⚠️ Unknown: ${act}`);
      return 'unknown';
  }
}

function sleep(ms) { const end = Date.now() + ms; while (Date.now() < end); }

async function checkBridge() {
  return new Promise(resolve => {
    const req = http.get('http://localhost:8765/health', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const h = JSON.parse(body);
          console.log(`🏥 Bridge: ${h.status} (model: ${h.model})`);
          resolve(true);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => { console.log('❌ Bridge not running!'); resolve(false); });
  });
}

async function runAgent(task, maxSteps = DEFAULT_MAX_STEPS, headed = false) {
  console.log('🌐 Gemini Nano Browser Agent');
  console.log(`   Task: ${task}`);
  console.log(`   Max steps: ${maxSteps}`);
  console.log(`   Browser: ${headed ? 'headed' : 'headless'}`);
  console.log();

  let messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Task: ${task}\n\nI'll show you the page. Respond with your next action as JSON.` },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    console.log(`── Step ${step}/${maxSteps} ──`);

    const [tree, pageInfo] = (() => {
      const result = runAB('snapshot', ...(headed ? ['--headed'] : []));
      if (result.error) return [null, result.error];
      const data = result.data;
      if (!data) return [null, JSON.stringify(result)];
      const parsed = typeof data === 'string' ? safeParse(data) : data;
      if (!parsed) return [null, String(data)];
      const tree = parsed.tree || parsed.snapshot || '';
      const url = parsed.url || 'unknown';
      const title = parsed.title || 'untitled';
      return [tree, `URL: ${url}\nTitle: ${title}\n\n${tree}`];
    })();

    if (!tree) {
      console.log(`   ⚠️ Snapshot failed: ${pageInfo}`);
      if (step === 1) {
        messages.push({ role: 'user', content: 'No page is currently open. Navigate to a URL first.' });
      } else {
        messages.push({ role: 'user', content: `Snapshot failed: ${pageInfo}. Try a different action.` });
      }
    } else {
      const context = pageInfo.length > 4000 ? pageInfo.slice(0, 4000) + '\n... (truncated)' : pageInfo;
      messages.push({ role: 'user', content: `Current page:\n${context}` });
    }

    // Trim history
    if (messages.length > 12) {
      messages = [messages[0], ...messages.slice(-10)];
    }

    console.log('   🤔 Asking Gemini Nano...');
    const response = await geminiChat(messages);
    console.log(`   💬 Response: ${response.slice(0, 150)}...`);

    const action = parseAction(response);
    console.log(`   🎯 Action: ${JSON.stringify(action)}`);

    messages.push({ role: 'assistant', content: response });

    const result = executeAction(action, headed);
    if (result === 'done' || result === 'stuck') break;
  }

  console.log('\n🧹 Cleaning up browser...');
  runAB('close', '--all');
  console.log('Done.');
}

// ── Main ──
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node agent.js "<task>" [--headed] [--max-steps N]');
  process.exit(1);
}

const task = args[0];
const headed = args.includes('--headed');
const maxStepsIdx = args.indexOf('--max-steps');
const maxSteps = maxStepsIdx >= 0 ? parseInt(args[maxStepsIdx + 1]) || DEFAULT_MAX_STEPS : DEFAULT_MAX_STEPS;

checkBridge().then(ok => {
  if (!ok) {
    console.log('Start bridge: cd ~/gemini-nano-demo/bridge && node server.js &');
    process.exit(1);
  }
  runAgent(task, maxSteps, headed);
});
