#!/usr/bin/env bash
# Hand-authored replay of gh device-code expiry. NOT captured from real gh.
set -eu

echo "! First copy your one-time code: WXYZ-9876"                       # (assumption)
echo "- Press Enter to open https://github.com/login/device in your browser..."  # (assumption)
read -r _ignored || true
echo "- Waiting for authentication..."                                  # (assumption)
sleep 0.05
echo "X The one-time code has expired. Please run the command again."   # (assumption: expiry wording)
exit 1
