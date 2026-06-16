#!/usr/bin/env python3
"""
Gemini Nano Browser Agent v2
Uses agent-browser (Vercel Labs) for browser control + Gemini Nano for brain.

Agent gets its OWN Chromium instance — no need to touch your main Chrome.

Usage:
    python3 agent.py "Go to github.com and find trending Python repos"
    python3 agent.py --interactive
"""

import asyncio
import json
import sys
import os
import subprocess
import base64
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Installing httpx...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx"])
    import httpx


# ══════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════

BRIDGE_URL = "http://localhost:8765"
AB_CMD = "agent-browser"  # CLI command

AGENT_SYSTEM = """You are a browser automation agent. You control a real Chromium browser via agent-browser commands.

CAPABILITIES:
- Navigate to URLs
- Click elements (by ref @e1, CSS selector, or text)
- Type/fill text into input fields
- Scroll the page
- Take screenshots and analyze them
- Read page content (accessibility tree)
- Submit forms, press keys
- Wait for page loads

HOW TO INTERACT:
You see the page as an accessibility tree with numbered refs (@e1, @e2, ...).
Each ref corresponds to a clickable/interactive element.
Use refs for precise element targeting.

OUTPUT FORMAT:
Always respond with ONE JSON action block:

{
    "thought": "What I observe and what I plan to do",
    "action": "navigate|click|fill|type|press|scroll|screenshot|snapshot|read|wait|done",
    "params": { ... }
}

ACTIONS:
- navigate:  {"url": "https://..."}
- click:     {"ref": "@e1"} or {"text": "Sign In"} or {"selector": "button.submit"}
- fill:      {"ref": "@e3", "text": "hello@example.com"}
- type:      {"ref": "@e3", "text": "hello world"}
- press:     {"key": "Enter"} or {"key": "Tab"}
- scroll:    {"direction": "down", "amount": 500}
- screenshot: {}  — capture page screenshot
- snapshot:  {}  — get accessibility tree (refs)
- read:      {}  — get visible text content
- wait:      {"seconds": 2}
- done:      {"result": "task completion summary"}

RULES:
1. Always start by taking a snapshot to see what's on the page
2. Use refs (@e1, @e2) when available — they're reliable
3. If an action fails, try a different approach
4. Max 25 steps — complete the task efficiently
5. When done, use the "done" action"""


# ══════════════════════════════════════════════════════════
# Gemini Nano Bridge Client
# ══════════════════════════════════════════════════════════

class GeminiBridge:
    def __init__(self):
        self.http = httpx.AsyncClient(base_url=BRIDGE_URL, timeout=120)

    async def chat(self, messages: list) -> str:
        resp = await self.http.post("/v1/chat/completions", json={
            "messages": messages,
            "temperature": 0.7,
        })
        data = resp.json()
        if "error" in data:
            raise Exception(f"Bridge error: {data['error']}")
        return data["choices"][0]["message"]["content"]

    async def analyze_image(self, image_b64: str, prompt: str) -> str:
        resp = await self.http.post("/v1/analyze-image", json={
            "image": image_b64,
            "prompt": prompt,
        })
        data = resp.json()
        return data.get("result", data.get("error", "No result"))

    async def health(self) -> bool:
        try:
            resp = await self.http.get("/health")
            return resp.json().get("status") == "ok"
        except Exception:
            return False


# ══════════════════════════════════════════════════════════
# Agent-Browser Wrapper
# ══════════════════════════════════════════════════════════

class AgentBrowser:
    """Wrap agent-browser CLI for the agent."""

    def __init__(self, session: str = "gemini-agent"):
        self.session = session
        self.processed = 0

    def run(self, *args, timeout: int = 30) -> dict:
        """Run an agent-browser command and return JSON result."""
        cmd = [AB_CMD, "--session", self.session, "--json"] + list(args)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            if result.stdout.strip():
                return json.loads(result.stdout.strip())
            return {"success": False, "error": result.stderr.strip() or "No output"}
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Command timed out"}
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"JSON parse error: {e}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def open(self, url: str) -> dict:
        return self.run("open", url)

    def close(self) -> dict:
        return self.run("close")

    def snapshot(self) -> str:
        """Get accessibility tree with refs."""
        result = self.run("snapshot", "-i")
        if result.get("success"):
            return json.dumps(result.get("data", {}), indent=2)
        return f"Snapshot error: {result.get('error', 'unknown')}"

    def screenshot(self, path: str = "/tmp/agent-screenshot.png") -> dict:
        return self.run("screenshot", path, "--annotate")

    def click(self, target: str) -> dict:
        return self.run("click", target)

    def fill(self, ref: str, text: str) -> dict:
        return self.run("fill", ref, text)

    def type_text(self, ref: str, text: str) -> dict:
        return self.run("type", ref, text)

    def press(self, key: str) -> dict:
        return self.run("press", key)

    def scroll(self, direction: str = "down", amount: int = 500) -> dict:
        return self.run("scroll", direction, str(amount))

    def get_text(self, ref: str = None) -> str:
        if ref:
            result = self.run("get", "text", ref)
        else:
            # Get all text from page
            result = self.run("eval", "document.body.innerText.substring(0, 8000)")
        if result.get("success"):
            return result.get("data", {}).get("text", "") or str(result.get("data", ""))
        return f"Get text error: {result.get('error', 'unknown')}"

    def get_title(self) -> str:
        result = self.run("get", "title")
        if result.get("success"):
            return result.get("data", {}).get("title", "")
        return ""

    def get_url(self) -> str:
        result = self.run("get", "url")
        if result.get("success"):
            return result.get("data", {}).get("url", "")
        return ""

    def screenshot_base64(self) -> str:
        """Take screenshot and return base64."""
        path = f"/tmp/agent-screenshot-{self.processed}.png"
        self.processed += 1
        result = self.screenshot(path)
        if result.get("success") and os.path.exists(path):
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode()
        return ""


# ══════════════════════════════════════════════════════════
# Agent Loop
# ══════════════════════════════════════════════════════════

class BrowserAgent:
    def __init__(self):
        self.gemini = GeminiBridge()
        self.browser = AgentBrowser()
        self.history = []
        self.max_steps = 25

    async def initialize(self):
        print("=" * 60)
        print("  Gemini Nano Browser Agent v2")
        print("  (agent-browser + Gemini Nano)")
        print("=" * 60)

        # Check bridge
        print("\n[1/3] Checking Gemini Nano bridge...")
        if await self.gemini.health():
            print("  ✅ Bridge connected")
        else:
            print("  ❌ Bridge not running!")
            print(f"     Start: cd /home/bobby/gemini-nano-demo/bridge && node server.js")
            return False

        # Check agent-browser
        print("[2/3] Checking agent-browser...")
        result = self.browser.run("--version")
        if result.get("success") or "version" in str(result.get("data", "")).lower():
            print("  ✅ agent-browser installed")
        else:
            # Try getting version differently
            try:
                r = subprocess.run([AB_CMD, "--version"], capture_output=True, text=True, timeout=5)
                if r.returncode == 0:
                    print(f"  ✅ agent-browser: {r.stdout.strip()}")
                else:
                    print("  ❌ agent-browser not found")
                    print("     Install: npm install -g agent-browser && agent-browser install")
                    return False
            except Exception:
                print("  ❌ agent-browser not working")
                return False

        # Launch browser
        print("[3/3] Launching Chromium instance...")
        result = self.browser.open("about:blank")
        if result.get("success"):
            print("  ✅ Chromium launched (own instance, not your Chrome)")
        else:
            print(f"  ❌ Failed to launch: {result.get('error')}")
            return False

        print("\n" + "=" * 60)
        return True

    async def run_task(self, task: str):
        print(f"\n📋 Task: {task}")
        print("-" * 60)

        self.history = [
            {"role": "system", "content": AGENT_SYSTEM},
            {"role": "user", "content": f"Task: {task}\n\nStart by taking a snapshot to see the current page state."},
        ]

        for step in range(self.max_steps):
            print(f"\n--- Step {step + 1}/{self.max_steps} ---")

            # Get Gemini Nano's action (with retry on bridge errors)
            response = None
            for retry in range(3):
                try:
                    response = await self.gemini.chat(self.history)
                    break
                except Exception as e:
                    print(f"  ⚠️ Bridge error (attempt {retry+1}/3): {e}")
                    if retry < 2:
                        await asyncio.sleep(3)
                    else:
                        print("  ❌ Bridge not responding after 3 attempts")
                        return "Bridge connection lost"

            # Show thought
            thought = self.extract_thought(response)
            if thought:
                print(f"🧠 {thought[:200]}")

            # Parse action
            action = self.parse_action(response)

            if not action:
                self.history.append({"role": "assistant", "content": response})
                self.history.append({"role": "user", "content": "Please respond with a JSON action block."})
                continue

            act = action.get("action", "")
            params = action.get("params", {})
            print(f"⚡ {act}({params})")

            # Execute action
            result = await self.execute_action(action)
            print(f"📋 {result[:200]}")

            # Feed result back
            self.history.append({"role": "assistant", "content": response})
            self.history.append({"role": "user", "content": f"Result: {result}"})

            if act == "done":
                print(f"\n✅ Complete: {action.get('params', {}).get('result', 'Done')}")
                return action.get("params", {}).get("result", "Done")

        print(f"\n⚠️ Max steps ({self.max_steps}) reached")
        return "Max steps reached"

    def extract_thought(self, response: str) -> str:
        import re
        match = re.search(r'"thought"\s*:\s*"([^"]+)"', response)
        return match.group(1) if match else ""

    def parse_action(self, response: str) -> dict:
        import re
        # Try code block first (most reliable)
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        # Try to find JSON with "action" key — handle nested braces
        depth = 0
        start = None
        for i, ch in enumerate(response):
            if ch == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0 and start is not None:
                    candidate = response[start:i+1]
                    if '"action"' in candidate:
                        try:
                            return json.loads(candidate)
                        except json.JSONDecodeError:
                            pass
                    start = None
        return None

    async def execute_action(self, action: dict) -> str:
        act = action.get("action", "")
        params = action.get("params", {})

        try:
            if act == "navigate":
                result = self.browser.open(params.get("url", ""))
                if result.get("success"):
                    await asyncio.sleep(2)
                    return f"Navigated to {params.get('url')}"
                return f"Navigation failed: {result.get('error')}"

            elif act == "click":
                if "ref" in params:
                    result = self.browser.click(params["ref"])
                elif "text" in params:
                    result = self.browser.click(f"text={params['text']}")
                elif "selector" in params:
                    result = self.browser.click(params["selector"])
                else:
                    return "No click target"
                return "Clicked" if result.get("success") else f"Click failed: {result.get('error')}"

            elif act == "fill":
                result = self.browser.fill(params.get("ref", ""), params.get("text", ""))
                return "Filled" if result.get("success") else f"Fill failed: {result.get('error')}"

            elif act == "type":
                result = self.browser.type_text(params.get("ref", ""), params.get("text", ""))
                return "Typed" if result.get("success") else f"Type failed: {result.get('error')}"

            elif act == "press":
                result = self.browser.press(params.get("key", "Enter"))
                return f"Pressed {params.get('key')}" if result.get("success") else f"Press failed"

            elif act == "scroll":
                result = self.browser.scroll(
                    params.get("direction", "down"),
                    params.get("amount", 500)
                )
                return "Scrolled" if result.get("success") else f"Scroll failed"

            elif act == "screenshot":
                b64 = self.browser.screenshot_base64()
                if b64:
                    analysis = await self.gemini.analyze_image(
                        b64,
                        "Describe this webpage screenshot in detail. What elements are visible? What can be clicked or interacted with? What text is shown?"
                    )
                    return f"Screenshot: {analysis[:2000]}"
                return "Screenshot failed"

            elif act == "snapshot":
                return self.browser.snapshot()[:4000]

            elif act == "read":
                return self.browser.get_text()[:4000]

            elif act == "wait":
                await asyncio.sleep(params.get("seconds", 2))
                return "Waited"

            elif act == "done":
                return params.get("result", "Task complete")

            else:
                return f"Unknown action: {act}"

        except Exception as e:
            return f"Error: {e}"

    async def close(self):
        self.browser.close()
        print("[Agent] Browser closed")


# ══════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════

async def main():
    agent = BrowserAgent()

    if not await agent.initialize():
        sys.exit(1)

    if len(sys.argv) > 1 and sys.argv[1] == "--interactive":
        print("\n🤖 Interactive mode. Type your task or 'quit' to exit.\n")
        while True:
            task = input("Task> ").strip()
            if task in ("quit", "exit", "q"):
                break
            if task:
                await agent.run_task(task)
    elif len(sys.argv) > 1:
        task = " ".join(sys.argv[1:])
        await agent.run_task(task)
    else:
        print("\nUsage:")
        print("  python3 agent.py 'Go to github.com and find trending Python repos'")
        print("  python3 agent.py --interactive")
        sys.exit(1)

    await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
