#!/usr/bin/env python3
"""
Read OpenAI-compatible SSE chat completions on stdin, print tokens live.

Wire format:
    data: {"choices":[{"delta":{"content":"Hello"}}]}
    data: {"choices":[{"delta":{"content":" world"}}]}
    data: [DONE]

Token text goes to stdout so it can be piped/captured. Timing and diagnostics
go to stderr so they never contaminate the polished text.
"""
import json
import sys
import time

# Some providers use [DONE], others DONE; accept either.
DONE_MARKERS = {"[DONE]", "DONE"}


def main() -> int:
    start = time.monotonic()
    ttft_ms = None
    chunks = 0
    pieces = []
    # A non-streaming error body arrives as plain JSON with no "data:" prefix.
    stray = []

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        if not line.startswith("data:"):
            stray.append(line)
            continue

        payload = line[len("data:"):].strip()
        if payload in DONE_MARKERS:
            break

        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            print(f"[sse] unparseable chunk: {payload[:200]}", file=sys.stderr)
            continue

        if isinstance(obj, dict) and obj.get("error"):
            err = obj["error"]
            msg = err.get("message", err) if isinstance(err, dict) else err
            print(f"[sse] API error: {msg}", file=sys.stderr)
            return 1

        for choice in obj.get("choices") or []:
            delta = choice.get("delta") or {}
            # Gemini/OpenAI put visible text in delta.content. Thinking models may
            # also emit reasoning_content — surface it on stderr, not in the text.
            reasoning = delta.get("reasoning_content") or delta.get("reasoning")
            if reasoning:
                print(f"[sse] (thinking {len(reasoning)} chars)", file=sys.stderr)

            content = delta.get("content")
            if not content:
                continue
            if ttft_ms is None:
                ttft_ms = (time.monotonic() - start) * 1000
            chunks += 1
            pieces.append(content)
            sys.stdout.write(content)
            sys.stdout.flush()

    total_ms = (time.monotonic() - start) * 1000
    sys.stdout.write("\n")
    sys.stdout.flush()

    if stray and not pieces:
        joined = " ".join(stray)[:400]
        print(f"[sse] non-SSE response body: {joined}", file=sys.stderr)
        return 1

    if not pieces:
        print("[sse] no content received", file=sys.stderr)
        return 1

    ttft_str = f"{ttft_ms:.0f}ms" if ttft_ms is not None else "n/a"
    print(
        f"[sse] ttft={ttft_str} total={total_ms:.0f}ms chunks={chunks} "
        f"chars={len(''.join(pieces))}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except BrokenPipeError:
        sys.exit(0)
