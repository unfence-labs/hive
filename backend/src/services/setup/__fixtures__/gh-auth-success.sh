#!/usr/bin/env bash
# Hand-authored replay of `gh auth login --web` device-flow output.
# NOT captured from the real gh CLI — verify each line in Spike S2.
# The driver must inject Enter (\r) after the code is shown; this stub reads one
# line from stdin to emulate gh waiting for that keystroke before it "polls".
set -eu

echo "! First copy your one-time code: AB12-CD34"                       # (assumption: label + XXXX-XXXX)
echo "- Press Enter to open https://github.com/login/device in your browser..."  # (assumption)
# gh blocks here until the user presses Enter (cli/cli#12925).
read -r _ignored || true
echo "- Waiting for authentication..."                                  # (assumption)
sleep 0.05
echo "✓ Authentication complete."                                       # (assumption)
echo "✓ Logged in as octocat"                                           # (assumption)
