#!/usr/bin/env bash
# Bridge startup script with environment

GEMINI_API_KEY=*** MEM0_API_KEY=m0-2FI... node /home/bobby/gemini-nano-demo/bridge/server.js
cd /home/bobby/gemini-nano-demo/bridge
exec node server.js