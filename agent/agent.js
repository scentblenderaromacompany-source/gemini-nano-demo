#!/usr/bin/env node
/**
 * Gemini Nano Browser Agent (Node.js)
 * Autonomous browser agent powered by Chrome's on-device Gemini Nano.
 * Uses agent-browser for browser control + Gemini Nano bridge for reasoning.
 *
 * Usage:
 *   node agent.js "Find AI news on Hacker News"
 *   node agent.js "Search Wikipedia for quantum computing" --headed
 *   node agent.js "Fill out contact form on example.com" --max-steps 15
 */

import { execFile } from 'child_process';
import http from 'http';

const AGENT_BROWSER = process.env.AGENT_BROWSER_BIN ||
  '/home/bobby/.local/lib/node_modules/agent-browser/bin/agent-browser.js';
const BRIDGE_URL = 'http://localhost:8765/v1/chat/completions';
const SESSION = 'gemini-nano-agent';
const DEFAULT_MAX_STEPS = 20;
const REQUEST_TIMEOUT = 120000; // 2 minutes for chat completions
const ACTION_TIMEOUT = 60000;   // 1 minute for agent-browser actions

const SYSTEM_PROMPT = `You are a browser automation agent. You control a web browser via accessibility tree snapshots AND WebMCP tools AND vision (screenshots).

Your job: complete the user's task by deciding the next action.

AVAILABLE ACTIONS (respond with JSON only):
- {"action": "click", "ref": "@eN"}        — Click element by accessibility ref
- {"action": "fill", "ref": "@eN", "value": "text"} — Clear and fill an input
- {"action": "type", "ref": "@eN", "value": "text"}  — Type into input (append)
- {"action": "press", "key": "Enter"}       — Press a keyboard key
- {"action": "scroll", "direction": "down", "amount": 500} — Scroll page
- {"action": "navigate", "url": "https://..."} — Go to URL
- {"action": "webmcp", "tool": "name", "args": {...}} — Call a WebMCP tool on the page
- {"action": "screenshot", "annotate": true}   — Take annotated screenshot (returns base64 PNG)
- {"action": "vision", "prompt": "describe...", "image": "base64"} — Analyze image with Gemini Nano (provide base64 from screenshot action)
- {"action": "done", "result": "summary"}   — Task is complete
- {"action": "stuck", "reason": "why"}      — Cannot proceed

RULES:
1. Always respond with valid JSON matching one of the actions above
2. Use refs from the accessibility tree (e.g., @e3, @e12)
3. WebMCP tools are semantic page capabilities — prefer them over raw clicks when available
4. Common WebMCP tools: search_page, extract_links, extract_forms, get_page_metadata, click_element, fill_form, scroll_to
5. VISION: Use "screenshot" to capture annotated image, then "vision" with prompt + that image to analyze visually
6. After each action, you'll see the updated page state
7. If a page needs loading, just say done for this step
8. If you can't find the right element, try scrolling
9. Be concise — just the JSON action, no explanation`;

function runAB(...args) {
  return new Promise((resolve, reject) => {
    const headed = args.includes('--headed');
    const cleanArgs = args.filter(a => a !== '--headed');
    const cmdArgs = [AGENT_BROWSER, '--session', SESSION, '--json', ...cleanArgs.map(String)];
    if (headed) cmdArgs.push('--headed');

    const child = execFile(AGENT_BROWSER, ['--session', SESSION, '--json', ...cleanArgs], {
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10, // 10MB
    }, (error, stdout, stderr) => {
      if (error) {
        if (stdout) {
          try { return resolve(JSON.parse(stdout)); } catch { return resolve({ raw: stdout.trim() }); }
        }
        return reject(new Error(stderr?.trim() || error.message));
      }
      if (stdout.trim()) {
        try { resolve(JSON.parse(stdout)); }
        catch { resolve({ raw: stdout.trim() }); }
      } else {
        resolve({ ok: true });
      }
    });
  });
}

function getSnapshot(headed = false) {
  return runAB('snapshot', ...(headed ? ['--headed'] : []));
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

  return new Promise((resolve) => {
    const url = new URL('http://localhost:8765/v1/chat/completions');
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
    req.write(JSON.stringify({ model: 'gemini-nano', messages, temperature: 0.3, max_tokens: 256 }));
    req.end();
  });
}

function parseAction(text) {
  let t = text.trim();
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

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms));
}

async function executeAction(action, headed = false) {
  const act = action.action;
  const asyncCases = ['screenshot', 'vision'];
  if (asyncCases.includes(act)) {
    return executeActionAsync(action, headed);
  }

  try {
    switch (action.action) {
      case 'click':
        await runAB('click', action.ref, ...(headed ? ['--headed'] : []));
        await sleep(1000);
        return 'ok';
      case 'fill':
        await runAB('fill', action.ref, action.value || '', ...(headed ? ['--headed'] : []));
        await sleep(500);
        return 'ok';
      case 'type':
        await runAB('type', action.ref, action.value || '', ...(headed ? ['--headed'] : []));
        await sleep(300);
        return 'ok';
      case 'press':
        await runAB('press', action.key || 'Enter', ...(headed ? ['--headed'] : []));
        await sleep(1000);
        return 'ok';
      case 'scroll':
        await runAB('scroll', action.direction || 'down', String(action.amount || 500), ...(headed ? ['--headed'] : []));
        await sleep(500);
        return 'ok';
      case 'navigate':
        await runAB('open', action.url, ...(headed ? ['--headed'] : []));
        await sleep(2000);
        return 'ok';
      case 'webmcp':
        console.log(`   🔌 Calling WebMCP tool: ${action.tool} with args: ${JSON.stringify(action.args)}`);
        const result = await webmcpCall(action.tool, action.args || {});
        console.log(`   🔌 WebMCP result: ${JSON.stringify(result).slice(0, 200)}`);
        await sleep(1500);
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
  } catch (error) {
    console.log(`   ⚠️ Action error: ${error.message}`);
    return { error: error.message };
  }
}

async function executeActionAsync(action, headed = false) {
  const act = action.action;
  switch (act) {
    case 'screenshot':
      console.log(`   📸 Taking ${action.annotate ? 'annotated ' : ''}screenshot...`);
      const shot = await takeScreenshot(action.annotate !== false);
      console.log(`   📸 Screenshot result: ${JSON.stringify(shot).slice(0, 200)}`);
      lastScreenshot = shot;
      await sleep(1000);
      return 'ok';
    case 'vision':
      if (!action.image && !lastScreenshot) {
        console.log(`   👁️ Vision: No image provided and no recent screenshot`);
        return 'ok';
      }
      let imageData = action.image;
      if (action.image === 'base64' || !action.image) {
        imageData = lastScreenshot?.base64 || lastScreenshot?.data || lastScreenshot?.result;
      }
      if (!imageData) {
        console.log(`   👁️ Vision: No image data available`);
        return 'ok';
      }
      console.log(`   👁️ Analyzing image with prompt: ${action.prompt?.slice(0, 100)}...`);
      const visionResult = await analyzeImageWithNano(action.prompt, imageData);
      console.log(`   👁️ Vision result: ${JSON.stringify(visionResult).slice(0, 300)}`);
      await sleep(1500);
      return 'ok';
    default:
      return executeAction(action, headed);
  }
}

// ── Multimodal Vision Helpers ──
let lastScreenshot = null;

async function takeScreenshot(annotate = true) {
  const cmdArgs = ['screenshot'];
  if (annotate) cmdArgs.push('--annotate');
  return runAB('screenshot', ...cmdArgs);
}

async function analyzeImageWithNano(prompt, imageBase64) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8765,
      path: '/v1/analyze-image',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.result || data);
        } catch {
          resolve({ error: 'Parse error' });
        }
      });
    });
    req.on('error', e => reject(new Error(`Network error: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(JSON.stringify({ image: imageBase64, prompt }));
    req.end();
  });
}

// ── WebMCP Helpers ──
async function webmcpDiscover() {
  return new Promise(resolve => {
    const req = http.request({
      hostname: 'localhost', port: 8765, path: '/v1/webmcp/discover',
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ tools: [] }); }});
    });
    req.on('error', () => resolve({ tools: [] }));
    req.write(JSON.stringify({ tabId: 1 }));
    req.end();
  });
}

async function webmcpCall(toolName, args) {
  return new Promise(resolve => {
    const req = http.request({
      hostname: 'localhost', port: 8765, path: '/v1/webmcp/call',
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: 'Parse error' }); }});
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(JSON.stringify({ tabId: 1, toolName, args }));
    req.end();
  });
}

async function discoverWebMcpTools() {
  return [];
}

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

async function runAgent(task, maxSteps = 20, headed = false) {
  console.log('🌐 Gemini Nano Browser Agent');
  console.log(`   Task: ${task}`);
  console.log(`   Max steps: ${maxSteps}`);
  console.log(`   Browser: ${headed ? 'headed' : 'headless'}`);
  console.log();

  let messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Task: ${task}\n\nI'll show you the page. Respond with your next action as JSON.` },
  ];

  for (let step = 1; step <= 20; step++) {
    console.log(`── Step ${step}/20 ──`);

    // Get page snapshot
    let pageInfo;
    try {
      const result = await runAB('snapshot');
      if (result.error) throw new Error(result.error);
      const data = result.data || result;
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const tree = parsed.tree || parsed.snapshot || JSON.stringify(parsed);
      const url = parsed.url || 'unknown';
      const title = parsed.title || 'untitled';
      pageInfo = `URL: ${url}\nTitle: ${title}\n\n${tree}`;
    } catch (error) {
      pageInfo = `Could not get snapshot: ${error.message}`;
    }

    if (pageInfo.startsWith('Could not')) {
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

    const result = await executeAction(action, false);
    
    // Include action result in conversation for the model to see
    if (result && typeof result === 'object') {
      messages.push({ role: 'user', content: `Action result: ${JSON.stringify(result).slice(0, 1000)}` });
    } else if (result && result !== 'ok' && result !== 'done' && result !== 'stuck') {
      messages.push({ role: 'user', content: `Action result: ${result}` });
    }

    if (result === 'done' || result === 'stuck') break;
  }

  console.log('\n🧹 Cleaning up browser...');
  await runAB('close', '--all');
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
const maxSteps = maxStepsIdx >= 0 ? parseInt(args[maxStepsIdx + 1]) || 20 : 20;

checkBridge().then(ok => {
  if (!ok) {
    console.log('Start bridge: cd ~/gemini-nano-demo/bridge && node server.js &');
    process.exit(1);
  }
  runAgent(task, 20, headed).catch(e => {
    console.error('Agent error:', e);
    process.exit(1);
  });
});

export { runAgent, checkBridge };