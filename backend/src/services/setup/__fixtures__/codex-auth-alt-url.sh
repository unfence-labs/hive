#!/usr/bin/env bash
# Hand-authored replay of the OTHER codex URL variant (`/device`, not
# `/codex/device`). NOT captured from real codex — verify in S2. Exists so a
# test can assert the parser handles both URL shapes.
set -eu

echo "Starting device code login..."                                    # (assumption)
echo "Visit https://auth.openai.com/device and enter code MNOP-2468"    # (assumption: /device variant + inline code)
sleep 0.05
echo "Successfully logged in."                                           # (assumption)
