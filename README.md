# Verbatim

**Type with your voice, everywhere.** Free, open-source dictation for macOS — live words while you speak, then a clean paste into whatever app is focused.

Built for a hackathon on [PyAI Hear streaming](https://docs.pyai.com/use-cases/build-your-own-wispr-flow) (first partial ~185–205 ms in-region) plus a fast polish pass for fillers, punctuation, app-aware tone, and your jargon dictionary.

> Wispr Flow is the polished consumer product. This is the OSS skeleton: one hotkey, every app, minutes that compound.

## Demo (60 seconds)

1. Open **Slack**, focus a message box.
2. Tap **⌥ Space** (default) → speak like a normal person: *“um hey can we um push the Tokenslayer demo to Friday actually Thursday”*.
3. Grey words appear in the floating HUD while you talk.
4. Tap **⌥ Space** again → polish runs (≤400 ms or raw fallback) → clean casual text pastes at the caret.
5. Repeat in **Mail** → same ramble lands more formal.

## Requirements

- macOS (Accessibility + Microphone)
- Node 20+
- PyAI API key with `hear:stream` (+ chat/NFuse for polish)

Mint a sandbox key (no signup):

```bash
export PYAI_API_KEY="$(
  curl -sS -X POST https://api.pyai.com/v1/sandbox/keys \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["api_key"])'
)"
```

## Run

```bash
cp .env.example .env   # put PYAI_API_KEY in .env or paste in Settings
npm install
npm run electron:dev
```

Production-ish build:

```bash
npm run build
npm start
```

Self-check (session + tone map):

```bash
npm run self-check
```

## Permissions

On first paste, macOS will ask for **Accessibility** (System Settings → Privacy & Security → Accessibility → enable Verbatim / Electron / Terminal). Mic access is requested when you start a session. Use **Settings → Check mic + Accessibility**.

## How it works

```
hotkey → mic PCM16 @ 16 kHz → PyAI Hear WebSocket
      → HUD: grey partials / solid finals
release → {"type":"commit"} → NFuse polish (tone + dictionary) → Cmd+V
```

- **Live UX:** always-on-top overlay (no jittery mid-app keystroke injection).
- **Latency:** ~20 ms audio frames, no client batching; polish `AbortSignal` so paste never waits forever.
- **Tone map:** Slack/Discord/Messages → casual; Mail/Outlook/Docs → formal; else neutral.
- **Dictionary:** local terms injected into the polish prompt (stored in Electron `userData`, not git).

## Hotkey

Default: `Alt+Space`. **Tap to start / tap to finish** (Electron `globalShortcut` has no reliable key-up). Change it in Settings (e.g. `Command+Shift+Space`, `F6`).

## Security

- Never commit `.env` or real keys.
- Settings file is written mode `0600` under Electron userData.
- The key is passed to the overlay renderer only for the active Hear/polish session; it is not logged.

## Stack

- Electron + Vite + TypeScript
- [PyAI Hear streaming](https://docs.pyai.com/guides/streaming-stt)
- PyAI OpenAI-compatible `/v1/chat/completions` (`pyai-nfuse`) for polish

## Publish (public GitHub)

`gh` is required and must be logged in once:

```bash
gh auth login
git branch -m main
git tag v0.1.0-hackathon
gh repo create whisper-flow-oss-tokenslayer --public --source=. --remote=origin --push
git push origin v0.1.0-hackathon
```

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.
