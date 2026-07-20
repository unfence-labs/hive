#!/usr/bin/env bash
# Replay of gh device-code expiry without a TTY.
set -eu

echo "! First copy your one-time code: WXYZ-9876"
echo "Open this URL to continue in your web browser: https://github.com/login/device"
sleep 0.05
echo "X The one-time code has expired. Please run the command again."
exit 1
