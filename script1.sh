#!/usr/bin/env bash
# Stream NVIDIA OpenAI-compatible chat completions (SSE) and print tokens live.
#
# Usage:
#   export NVIDIA_API_KEY=nvapi-...
#   ./scripts/whisper-oss.sh
#   ./scripts/whisper-oss.sh "your dictation text here"
#
# With stream:true the API returns Server-Sent Events:
#   data: {"choices":[{"delta":{"content":"Hello"}}]}
#   data: {"choices":[{"delta":{"content":" world"}}]}
#   data: [DONE]
# Tokens are printed as each SSE line arrives (via scripts/parse_sse_chat.py).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSE_SSE="${SCRIPT_DIR}/parse_sse_chat.py"
invoke_url='https://integrate.api.nvidia.com/v1/chat/completions'

if [[ -z "${NVIDIA_API_KEY:-}" ]]; then
  echo "Set NVIDIA_API_KEY in the environment (do not hardcode it in this file)." >&2
  exit 1
fi

DICTATION="${1:-hey we\'re navigating ambiguous professional landscapes require more than analytic acumen it demands the capacity to make definitive commitments despite incomplete date those who thrive amidst volatility typically leverage calculated intuitions balancing regress risk assessment with the agility to pivot when and or unforeseen variables disrupt their initial trajectories}"

json_escape() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

SYSTEM_PROMPT="You clean up voice dictation. Remove filler words (um, uh, like, you know, er, ah). Fix punctuation and capitalization. Apply mid-sentence self-corrections (e.g. actually). Return ONLY the rewritten text — no quotes, no preamble, no markdown."
USER_PROMPT="Tone: clear everyday writing. Neutral register, correct punctuation, no fluff.
No custom dictionary.

Dictation:
${DICTATION}"

SYSTEM_ESC="$(json_escape "$SYSTEM_PROMPT")"
USER_ESC="$(json_escape "$USER_PROMPT")"

payload=$(cat <<EOF
{
  "model": "meta/llama-3.1-70b-instruct",
  "messages": [
    {"role": "system", "content": "${SYSTEM_ESC}"},
    {"role": "user", "content": "${USER_ESC}"}
  ],
  "temperature": 0.2,
  "top_p": 0.7,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "max_tokens": 1024,
  "stream": true
}
EOF
)

# Live SSE: curl pipe → parser (no bash variable buffering).
curl --fail --silent --no-buffer --show-error \
  --request POST \
  --url "$invoke_url" \
  --header "Authorization: Bearer ${NVIDIA_API_KEY}" \
  --header "Accept: text/event-stream" \
  --header "Content-Type: application/json" \
  --data "$payload" \
| python3 "$PARSE_SSE"