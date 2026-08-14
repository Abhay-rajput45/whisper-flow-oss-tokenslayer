#!/usr/bin/env bash
# Stream Gemini chat completions (OpenAI-compatible SSE) and print tokens live.
#
# Usage:
#   export GEMINI_API_KEY=...            # or put it in .env at the repo root
#   ./scripts/whisper-oss-gemini.sh
#   ./scripts/whisper-oss-gemini.sh "your dictation text here"
#
#   GEMINI_MODEL=gemini-2.5-flash ./scripts/whisper-oss-gemini.sh "..."
#   TONE=casual ./scripts/whisper-oss-gemini.sh "..."
#
# Gemini exposes an OpenAI-compatible surface at /v1beta/openai, so the request
# and the SSE wire format match the NVIDIA script — only the URL, key, and model
# change. Tokens print as each SSE line arrives (via scripts/parse_sse_chat.py).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PARSE_SSE="${SCRIPT_DIR}/parse_sse_chat.py"
invoke_url='https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

# Fall back to .env so this works the same way the Electron app resolves the key.
if [[ -z "${GEMINI_API_KEY:-}" && -f "${REPO_DIR}/.env" ]]; then
  GEMINI_API_KEY="$(grep -E '^GEMINI_API_KEY=' "${REPO_DIR}/.env" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Set GEMINI_API_KEY in the environment or in .env (never hardcode it here)." >&2
  exit 1
fi

if [[ ! -f "$PARSE_SSE" ]]; then
  echo "Missing SSE parser: $PARSE_SSE" >&2
  exit 1
fi

MODEL="${GEMINI_MODEL:-gemini-flash-lite-latest}"
TONE="${TONE:-neutral}"

DICTATION="${1:-hey we\'re navigating ambiguous professional landscapes require more than analytic acumen it demands the capacity to make definitive commitments despite incomplete date those who thrive amidst volatility typically leverage calculated intuitions balancing regress risk assessment with the agility to pivot when and or unforeseen variables disrupt their initial trajectories}"

json_escape() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

case "$TONE" in
  casual)
    TONE_LINE="Tone: casual chat (Slack/IM). Keep it natural, concise, friendly. Contractions OK. No corporate fluff." ;;
  formal)
    TONE_LINE="Tone: professional email/document. Clear sentences, proper grammar, no slang. Stay warm but polished." ;;
  *)
    TONE_LINE="Tone: clear everyday writing. Neutral register, correct punctuation, no fluff." ;;
esac

# DICT="Kubernetes,Grafana,JustCall" mirrors the app's user dictionary.
if [[ -n "${DICT:-}" ]]; then
  DICT_LINE="Prefer these spellings/names when heard: ${DICT//,/, }."
else
  DICT_LINE="No custom dictionary."
fi

SYSTEM_PROMPT="You clean up voice dictation. Remove filler words (um, uh, like, you know, er, ah). Fix punctuation and capitalization. Apply mid-sentence self-corrections (e.g. actually). Return ONLY the rewritten text — no quotes, no preamble, no markdown."
USER_PROMPT="${TONE_LINE}
${DICT_LINE}

Dictation:
${DICTATION}"

SYSTEM_ESC="$(json_escape "$SYSTEM_PROMPT")"
USER_ESC="$(json_escape "$USER_PROMPT")"

# No thinking-control param here on purpose. Measured against this endpoint:
#   reasoning_effort:"none"                    -> HTTP 400 (both lite models)
#   extra_body.google.thinking_config          -> HTTP 400 (client-lib only, not REST)
#   reasoning_effort:"low"                     -> 1213ms, slower than omitting it
#   omitted                                    -> ~900ms
# The lite models don't over-think this prompt, so plain params are the fast path.
payload=$(cat <<EOF
{
  "model": "${MODEL}",
  "messages": [
    {"role": "system", "content": "${SYSTEM_ESC}"},
    {"role": "user", "content": "${USER_ESC}"}
  ],
  "temperature": 0.2,
  "top_p": 0.7,
  "max_tokens": 1024,
  "stream": true
}
EOF
)

# Live SSE: curl pipe → parser (no bash variable buffering).
curl --fail-with-body --silent --no-buffer --show-error \
  --request POST \
  --url "$invoke_url" \
  --header "Authorization: Bearer ${GEMINI_API_KEY}" \
  --header "Accept: text/event-stream" \
  --header "Content-Type: application/json" \
  --data "$payload" \
| python3 "$PARSE_SSE"
