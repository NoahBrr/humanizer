/**
 * Structured logger. JSON lines in production (machine-ingestable), readable
 * key=value in development. Deliberately dependency-free; swap the transport
 * for pino/OpenTelemetry when an observability stack lands.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";

function emit(level: Level, message: string, fields: Fields = {}) {
  const entry = { level, message, time: new Date().toISOString(), ...fields };
  const line = isProd
    ? JSON.stringify(entry)
    : `[${level.toUpperCase()}] ${message} ${Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(" ")}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Fields) => emit("debug", message, fields),
  info: (message: string, fields?: Fields) => emit("info", message, fields),
  warn: (message: string, fields?: Fields) => emit("warn", message, fields),
  error: (message: string, fields?: Fields) => emit("error", message, fields),
};
