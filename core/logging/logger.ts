/**
 * The one logging module for the whole app.
 *
 * Pure on purpose — no electron, no node built-ins — so main and both sandboxed
 * renderers can import it. Hosts decide where records go by installing sinks
 * (see electron/logging/index.ts). Terminal output is the default; the same
 * formatted line is what a file sink writes, so there is only ever one format.
 *
 * ── Turning logging off ────────────────────────────────────────────────────
 * Everything routes through `state` below, so there is exactly one switch:
 *     setLoggingEnabled(false)          // programmatic
 *     LOG=0            (env)            // host passes it via readLoggingConfigFromEnv
 *     LOG_LEVEL=silent (env)
 * Any of the three silences every namespace in every process.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";
export type EmitLevel = Exclude<LogLevel, "silent">;
export type LogFormat = "text" | "json";
export type LogFields = Record<string, unknown>;
export type EnvLike = Record<string, string | undefined>;

export type LogRecord = {
  ts: string;
  level: EmitLevel;
  ns: string;
  msg: string;
  fields: LogFields;
};

/** A sink receives both the structured record and the rendered line. */
export type LogSink = (record: LogRecord, line: string) => void;

const RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

type State = {
  enabled: boolean;
  level: LogLevel;
  /** Namespace globs; empty = everything. */
  namespaces: string[];
  format: LogFormat;
  sinks: LogSink[];
};

const state: State = {
  enabled: true,
  level: "info",
  namespaces: [],
  format: "text",
  sinks: [],
};

// ─── configuration ─────────────────────────────────────────────────────────

export function setLoggingEnabled(on: boolean): void {
  state.enabled = on;
}

export function configureLogging(patch: {
  enabled?: boolean;
  level?: LogLevel;
  namespaces?: string[];
  format?: LogFormat;
}): void {
  if (patch.enabled !== undefined) state.enabled = patch.enabled;
  if (patch.level !== undefined) state.level = patch.level;
  if (patch.namespaces !== undefined) state.namespaces = patch.namespaces;
  if (patch.format !== undefined) state.format = patch.format;
}

function isLevel(v: string): v is LogLevel {
  return Object.prototype.hasOwnProperty.call(RANK, v);
}

/**
 * LOG=0|false        master off
 * LOG_LEVEL=silent|error|warn|info|debug|trace
 * LOG_NS=llm.*,stt.hear
 * LOG_FORMAT=text|json
 */
export function readLoggingConfigFromEnv(env: EnvLike): {
  enabled?: boolean;
  level?: LogLevel;
  namespaces?: string[];
  format?: LogFormat;
} {
  const out: ReturnType<typeof readLoggingConfigFromEnv> = {};

  const master = String(env.LOG ?? "").trim().toLowerCase();
  if (master === "0" || master === "false" || master === "off") out.enabled = false;
  if (master === "1" || master === "true" || master === "on") out.enabled = true;

  const lvl = String(env.LOG_LEVEL ?? "").trim().toLowerCase();
  if (isLevel(lvl)) out.level = lvl;

  const ns = String(env.LOG_NS ?? "").trim();
  if (ns) out.namespaces = ns.split(",").map((s) => s.trim()).filter(Boolean);

  const fmt = String(env.LOG_FORMAT ?? "").trim().toLowerCase();
  if (fmt === "json" || fmt === "text") out.format = fmt;

  return out;
}

export function addSink(sink: LogSink): () => void {
  state.sinks.push(sink);
  return () => {
    const i = state.sinks.indexOf(sink);
    if (i >= 0) state.sinks.splice(i, 1);
  };
}

export function clearSinks(): void {
  state.sinks.length = 0;
}

// ─── redaction ─────────────────────────────────────────────────────────────
// Applied centrally so a careless call site cannot leak a key.

const SECRET_FIELD_RE =
  /(api[-_]?key|authorization|auth|token|secret|bearer|password|credential)/i;

const SECRET_VALUE_RES: RegExp[] = [
  /^Bearer\s+\S+/i,
  /^sk-[A-Za-z0-9_-]{8,}/,
  /^nvapi-[A-Za-z0-9_-]{8,}/,
  /^AIza[A-Za-z0-9_-]{8,}/,
  /^AQ\.[A-Za-z0-9_.-]{8,}/,
  /^pyai[-_]?key[.-]\S+/i,
  /^[A-Za-z0-9_-]{40,}$/,
];

const SECRET_QUERY_PARAMS = ["key", "token", "access_token", "api_key", "apikey"];

function mask(value: string): string {
  if (value.length <= 4) return "***";
  return `${value.slice(0, 4)}…[${value.length}]`;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    let touched = false;
    for (const p of SECRET_QUERY_PARAMS) {
      if (url.searchParams.has(p)) {
        url.searchParams.set(p, "***");
        touched = true;
      }
    }
    return touched ? url.toString() : value;
  } catch {
    return value;
  }
}

function redactString(value: string): string {
  for (const re of SECRET_VALUE_RES) {
    if (re.test(value)) return mask(value);
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? redactUrl(value) : value;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (SECRET_FIELD_RE.test(key)) {
    if (typeof value === "string") return value ? mask(value) : "";
    return value === undefined || value === null ? value : "***";
  }
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) {
    return depth >= 4
      ? "[…]"
      : value.map((v, i) => redactValue(String(i), v, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= 4) return "{…}";
    const out: LogFields = {};
    for (const [k, v] of Object.entries(value as LogFields)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue; // absent reads better than `reason=undefined`
    out[k] = redactValue(k, v, 0);
  }
  return out;
}

// ─── formatting ────────────────────────────────────────────────────────────

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return /[\s="]/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function formatRecord(record: LogRecord, format: LogFormat): string {
  if (format === "json") {
    return JSON.stringify({
      ts: record.ts,
      level: record.level,
      ns: record.ns,
      msg: record.msg,
      ...record.fields,
    });
  }
  const head = `${record.ts} ${record.level.toUpperCase().padEnd(5)} ${record.ns} ${record.msg}`;
  const entries = Object.entries(record.fields);
  if (entries.length === 0) return head;
  return `${head} ${entries.map(([k, v]) => `${k}=${formatScalar(v)}`).join(" ")}`;
}

// ─── sinks ─────────────────────────────────────────────────────────────────

/** Terminal output. Works in main (stdout) and renderers (DevTools). */
export const consoleSink: LogSink = (record, line) => {
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);
};

// ─── emit ──────────────────────────────────────────────────────────────────

function nsMatches(ns: string): boolean {
  if (state.namespaces.length === 0) return true;
  return state.namespaces.some((pattern) => {
    if (pattern === "*") return true;
    const re = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    return re.test(ns);
  });
}

function enabledFor(ns: string, level: EmitLevel): boolean {
  if (!state.enabled) return false;
  if (state.level === "silent") return false;
  if (RANK[level] > RANK[state.level]) return false;
  if (state.sinks.length === 0) return false;
  return nsMatches(ns);
}

function emit(ns: string, level: EmitLevel, msg: string, fields?: LogFields): void {
  if (!enabledFor(ns, level)) return;
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    ns,
    msg,
    fields: fields ? redactFields(fields) : {},
  };
  const line = formatRecord(record, state.format);
  for (const sink of state.sinks) {
    try {
      sink(record, line);
    } catch {
      /* a broken sink must never break the caller */
    }
  }
}

// ─── logger ────────────────────────────────────────────────────────────────

export type Logger = {
  readonly ns: string;
  error(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  trace(msg: string, fields?: LogFields): void;
  /** True when the level would actually be emitted — guard expensive fields. */
  isEnabled(level: EmitLevel): boolean;
  child(sub: string): Logger;
  /** Returns an end() that logs the elapsed duration_ms at info. */
  span(msg: string, fields?: LogFields): (extra?: LogFields) => void;
};

export function getLogger(ns: string): Logger {
  return {
    ns,
    error: (msg, fields) => emit(ns, "error", msg, fields),
    warn: (msg, fields) => emit(ns, "warn", msg, fields),
    info: (msg, fields) => emit(ns, "info", msg, fields),
    debug: (msg, fields) => emit(ns, "debug", msg, fields),
    trace: (msg, fields) => emit(ns, "trace", msg, fields),
    isEnabled: (level) => enabledFor(ns, level),
    child: (sub) => getLogger(`${ns}.${sub}`),
    span: (msg, fields) => {
      const startedAt = Date.now();
      return (extra) =>
        emit(ns, "info", msg, {
          ...fields,
          ...extra,
          duration_ms: Date.now() - startedAt,
        });
    },
  };
}
