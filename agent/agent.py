#!/usr/bin/env python3
"""
Gemini Nano Browser Agent
========================
Autonomous browser agent powered by Chrome's on-device Gemini Nano.
Uses agent-browser for browser control + Gemini Nano bridge for reasoning.

Architecture:
  agent-browser (own Chromium) → snapshot → Gemini Nano decides → agent-browser acts → repeat

Usage:
  python3 agent.py "Find the latest news about AI on Hacker News"
  python3 agent.py "Go to wikipedia.org and search for quantum computing" --headed
  python3 agent.py "Fill out the contact form on example.com" --max-steps 15
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

# ── Configuration ──
AGENT_BROWSER = str(Path.home() / ".local/lib/node_modules/agent-browser/bin/agent-browser.js")
BRIDGE_URL = "http://localhost:8765/v1/chat/completions"
SESSION_NAME = "gemini-nano-agent"
DEFAULT_MAX_STEPS = 20

SYSTEM_PROMPT = """You are a browser automation agent. You control a web browser via accessibility tree snapshots.

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
5. If a page needs loading, just say done for this step — the next snapshot will show the loaded page
6. If you can't find the right element, try scrolling
7. Be concise — just the JSON action, no explanation"""

def run_ab(*args, headed=False, timeout=30):
    """Run an agent-browser command and return parsed JSON."""
    cmd = [AGENT_BROWSER, "--session", SESSION_NAME, "--json"]
    if headed:
        cmd.append("--headed")
    cmd.extend(str(a) for a in args)
    
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        if result.stdout.strip():
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return {"raw": result.stdout.strip()}
        if result.returncode != 0:
            return {"error": result.stderr.strip() or f"Exit code {result.returncode}"}
        return {}
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"error": str(e)}


def get_snapshot(headed=False):
    """Get the accessibility tree snapshot."""
    result = run_ab("snapshot", headed=headed)
    if isinstance(result, dict) and "error" in result:
        return None, result["error"]
    
    # Extract the tree text from the response
    if isinstance(result, dict) and "data" in result:
        data = result["data"]
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                return None, data
        if isinstance(data, dict):
            tree = data.get("tree", data.get("snapshot", ""))
            url = data.get("url", "unknown")
            title = data.get("title", "untitled")
            return tree, f"URL: {url}\nTitle: {title}\n\n{tree}"
    
    return None, str(result)


def gemini_nano_chat(messages, temperature=0.3):
    """Send a chat completion to Gemini Nano via the bridge."""
    import urllib.request
    
    payload = json.dumps({
        "model": "gemini-nano",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 256,
    }).encode()
    
    req = urllib.request.Request(
        BRIDGE_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            content = data["choices"][0]["message"]["content"]
            return content.strip()
    except Exception as e:
        return f'{{"action": "stuck", "reason": "Bridge error: {e}"}}'


def parse_action(response_text):
    """Parse the agent's action from its response."""
    # Try to extract JSON from the response
    text = response_text.strip()
    
    # Remove markdown code blocks if present
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        text = "\n".join(lines).strip()
    
    # Find JSON object in the text
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass
    
    return {"action": "stuck", "reason": f"Could not parse action from: {text[:200]}"}


def execute_action(action, headed=False):
    """Execute a browser action via agent-browser."""
    act = action.get("action")
    
    if act == "click":
        ref = action.get("ref", "")
        result = run_ab("click", ref, headed=headed)
        time.sleep(1)  # Wait for page reaction
    
    elif act == "fill":
        ref = action.get("ref", "")
        value = action.get("value", "")
        result = run_ab("fill", ref, value, headed=headed)
        time.sleep(0.5)
    
    elif act == "type":
        ref = action.get("ref", "")
        value = action.get("value", "")
        result = run_ab("type", ref, value, headed=headed)
        time.sleep(0.3)
    
    elif act == "press":
        key = action.get("key", "Enter")
        result = run_ab("press", key, headed=headed)
        time.sleep(1)
    
    elif act == "scroll":
        direction = action.get("direction", "down")
        amount = action.get("amount", 500)
        result = run_ab("scroll", direction, str(amount), headed=headed)
        time.sleep(0.5)
    
    elif act == "navigate":
        url = action.get("url", "")
        result = run_ab("open", url, headed=headed)
        time.sleep(2)  # Wait for page load
    
    elif act == "done":
        print(f"\n✅ TASK COMPLETE: {action.get('result', 'Done')}")
        return "done"
    
    elif act == "stuck":
        print(f"\n❌ STUCK: {action.get('reason', 'Unknown reason')}")
        return "stuck"
    
    else:
        print(f"\n⚠️ Unknown action: {act}")
        return "unknown"
    
    return "ok"


def run_agent(task, max_steps=DEFAULT_MAX_STEPS, headed=False):
    """Run the browser agent loop."""
    print(f"🌐 Gemini Nano Browser Agent")
    print(f"   Task: {task}")
    print(f"   Max steps: {max_steps}")
    print(f"   Browser: {'headed' if headed else 'headless'}")
    print()
    
    # Build conversation history
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Task: {task}\n\nI'll show you the page. Respond with your next action as JSON."}
    ]
    
    for step in range(1, max_steps + 1):
        print(f"── Step {step}/{max_steps} ──")
        
        # Get current page state
        tree_text, page_info = get_snapshot(headed=headed)
        
        if tree_text is None:
            print(f"   ⚠️ Snapshot failed: {page_info}")
            # Try to recover by navigating
            if step == 1:
                print("   No page open — agent will need to navigate first")
                messages.append({"role": "user", "content": "No page is currently open. Navigate to a URL first."})
            else:
                messages.append({"role": "user", "content": f"Snapshot failed: {page_info}. Try a different action."})
        else:
            # Truncate snapshot if too long
            if len(page_info) > 4000:
                page_info = page_info[:4000] + "\n... (truncated)"
            messages.append({"role": "user", "content": f"Current page:\n{page_info}"})
        
        # Trim history to prevent context overflow
        if len(messages) > 12:
            # Keep system prompt + last 10 messages
            messages = [messages[0]] + messages[-10:]
        
        # Ask Gemini Nano for next action
        print(f"   🤔 Asking Gemini Nano...")
        response = gemini_nano_chat(messages)
        print(f"   💬 Response: {response[:150]}...")
        
        # Parse action
        action = parse_action(response)
        print(f"   🎯 Action: {json.dumps(action)}")
        
        # Record in history
        messages.append({"role": "assistant", "content": response})
        
        # Execute action
        result = execute_action(action, headed=headed)
        
        if result in ("done", "stuck"):
            break
    
    else:
        print(f"\n⏰ Max steps ({max_steps}) reached")
    
    # Cleanup
    print("\n🧹 Cleaning up browser...")
    run_ab("close", "--all")
    print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Gemini Nano Browser Agent — autonomous browsing with on-device AI"
    )
    parser.add_argument("task", help="The browsing task to accomplish")
    parser.add_argument("--max-steps", type=int, default=DEFAULT_MAX_STEPS,
                        help=f"Maximum agent steps (default: {DEFAULT_MAX_STEPS})")
    parser.add_argument("--headed", action="store_true",
                        help="Run browser in headed mode (visible window)")
    
    args = parser.parse_args()
    
    # Verify bridge is running
    import urllib.request
    try:
        req = urllib.request.Request("http://localhost:8765/health")
        with urllib.request.urlopen(req, timeout=5) as resp:
            health = json.loads(resp.read().decode())
            print(f"🏥 Bridge: {health.get('status')} (model: {health.get('model')})")
    except Exception:
        print("❌ Bridge server not running! Start it first:")
        print("   cd ~/gemini-nano-demo/bridge && node server.js &")
        sys.exit(1)
    
    run_agent(args.task, max_steps=args.max_steps, headed=args.headed)


if __name__ == "__main__":
    main()
