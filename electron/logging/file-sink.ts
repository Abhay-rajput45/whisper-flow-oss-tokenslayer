/**
 * Optional rotating file sink. OFF by default — enable with LOG_FILE=1.
 * Writes the same rendered line the terminal gets, so there is one format.
 * Node-only, so it lives here rather than in core/.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { LogSink } from "../../core/logging/logger";

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;
const FLUSH_MS = 250;

function logFilePath(): string {
  try {
    return path.join(app.getPath("userData"), "logs", "whisper-flow.log");
  } catch {
    return path.join(process.env.HOME ?? ".", ".whisper-flow", "whisper-flow.log");
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* rotation is best-effort */
  }
}

export function createFileSink(): LogSink {
  const file = logFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* fall through; writes will no-op */
  }

  let buffer: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (buffer.length === 0) return;
    const chunk = `${buffer.join("\n")}\n`;
    buffer = [];
    rotateIfNeeded(file);
    // Never block the dictation path on disk.
    fs.appendFile(file, chunk, { mode: 0o600 }, () => {
      /* ignore write errors */
    });
  };

  return (_record, line) => {
    buffer.push(line);
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  };
}
