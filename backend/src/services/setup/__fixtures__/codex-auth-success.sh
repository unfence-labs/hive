#!/usr/bin/env bash
# Hand-authored replay of `codex login --device-auth`. NOT captured from real
# codex — verify in Spike S2. Uses the `/codex/device` URL variant on purpose
# so the parser's non-hardcoded URL scraping is exercised.
set -eu

echo "Starting device code login..."                                    # (assumption)
echo "Open this URL in your browser: https://auth.openai.com/codex/device"  # (assumption: /codex/device variant)
echo "Enter the code: QWER-7890"                                        # (assumption: bare XXXX-XXXX)
sleep 0.05
echo "Waiting for authorization..."                                      # (assumption)
sleep 0.05
echo "Successfully logged in to ChatGPT."                                # (assumption: success wording)
