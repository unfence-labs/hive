#!/usr/bin/env bash
# Hand-authored replay of codex refusing device-code auth because the ChatGPT
# workspace has it disabled. NOT captured from real codex — verify in S2.
set -eu

echo "Starting device code login..."                                    # (assumption)
echo "Error: Please contact your workspace admin to enable device code authentication."  # (assumption: exact wording)
exit 1
