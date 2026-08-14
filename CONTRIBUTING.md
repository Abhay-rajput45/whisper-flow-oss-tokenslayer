# Contributing to Verbatim

Thanks for helping ship free, open dictation.

## Ground rules

- Keep the latency budget: never block paste on a slow polish call.
- No hardcoded secrets. Use `.env` / Settings only.
- macOS-first for now; Windows/Linux can land later behind feature flags.

## Dev loop

```bash
cp .env.example .env
npm install
npm run electron:dev
npm run self-check
```

## PR checklist

- [ ] `npm run self-check` passes
- [ ] No keys or PII in logs/commits
- [ ] README updated if UX or hotkey behavior changes

## Scope hints for good first issues

- Better HUD animations
- Per-app tone overrides in Settings
- Warm Hear socket between utterances
- Windows global hotkey + paste
