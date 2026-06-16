#!/bin/bash
# Gemini Nano Agent — Full Stack Launcher
# Starts: Bridge + Agent (browser launches automatically)

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Gemini Nano Agent v2                           ║"
echo "║  agent-browser + Gemini Nano bridge             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check agent-browser
if ! command -v agent-browser &>/dev/null; then
    echo "❌ agent-browser not found. Installing..."
    npm install -g agent-browser
    agent-browser install
    echo ""
fi

# Start bridge
echo "[1/2] Starting API bridge on port 8765..."
cd "$DIR/bridge"

# Kill existing bridge if running
if lsof -ti:8765 &>/dev/null; then
    echo "  Stopping existing bridge..."
    kill $(lsof -ti:8765) 2>/dev/null
    sleep 1
fi

node server.js &
BRIDGE_PID=$!
sleep 2

if curl -s http://localhost:8765/health > /dev/null 2>&1; then
    echo "  ✅ Bridge running (PID: $BRIDGE_PID)"
else
    echo "  ❌ Bridge failed to start"
    kill $BRIDGE_PID 2>/dev/null
    exit 1
fi

echo ""
echo "[2/2] Ready! The agent launches its own Chromium instance."
echo ""
echo "  Quick test:"
echo "    cd $DIR/agent && ./run.sh --interactive"
echo ""
echo "  Or with a task:"
echo "    cd $DIR/agent && ./run.sh 'Go to example.com and get the title'"
echo ""
echo "  The browser agent does NOT use your main Chrome."
echo "  It launches its own Chromium via agent-browser."
echo ""
echo "  Bridge: http://localhost:8765/v1"
echo "  Chrome Extension: Ctrl+Shift+G (in your main Chrome)"
echo ""
echo "Press Ctrl+C to stop the bridge"
echo ""

# Handle cleanup
trap "echo ''; echo 'Stopping bridge...'; kill $BRIDGE_PID 2>/dev/null; exit 0" INT TERM
wait $BRIDGE_PID
