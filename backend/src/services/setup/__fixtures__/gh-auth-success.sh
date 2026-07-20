#!/usr/bin/env bash
# Replay of `gh auth login --web` WITHOUT a TTY (verified on a provisioned
# server): gh prints the code + URL immediately and polls on its own.
set -eu

echo "! First copy your one-time code: AB12-CD34"
echo "Open this URL to continue in your web browser: https://github.com/login/device"
sleep 0.05
echo "✓ Authentication complete."
echo "✓ Logged in as octocat"
