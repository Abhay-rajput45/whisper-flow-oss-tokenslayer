/**
 * Main-process logging host. Call installLogging() once at startup.
 *
 *   LOG=0                 turn everything off (single switch)
 *   LOG_LEVEL=debug       error|warn|info|debug|trace|silent   (default info)
 *   LOG_NS=llm.*          comma-separated namespace globs      (default all)
 *   LOG_FORMAT=json       text|json                            (default text)
 *   LOG_FILE=1            also append to userData/logs/        (default off)
 */
import {
  addSink,
  configureLogging,
  consoleSink,
  getLogger,
  readLoggingConfigFromEnv,
} from "../../core/logging/logger";
import { createFileSink } from "./file-sink";

export function installLogging(env: NodeJS.ProcessEnv = process.env): void {
  configureLogging(readLoggingConfigFromEnv(env));

  // Terminal is the default destination.
  addSink(consoleSink);

  const wantFile = String(env.LOG_FILE ?? "").trim().toLowerCase();
  const fileEnabled = wantFile === "1" || wantFile === "true";
  if (fileEnabled) addSink(createFileSink());

  getLogger("app").debug("logging ready", {
    level: env.LOG_LEVEL ?? "info",
    ns: env.LOG_NS ?? "*",
    file: fileEnabled,
  });
}
