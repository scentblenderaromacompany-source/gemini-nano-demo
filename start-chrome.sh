#!/bin/bash
# Launch Chrome with remote debugging for Browser Harness

echo "Launching Chrome with CDP enabled..."
echo "The bridge will connect automatically."
echo ""

google-chrome \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --no-first-run \
    --disable-default-apps \
    "$@" &
