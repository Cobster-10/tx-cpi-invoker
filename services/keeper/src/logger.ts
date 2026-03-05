import { createWriteStream } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(process.cwd(), "logs.txt");
const fileStream = createWriteStream(LOG_FILE, { flags: "w" });

function serializeError(err: Error): object {
  const e = err as Error & { logs?: string[] };
  return {
    message: e.message,
    stack: e.stack,
    ...(e.logs && { logs: e.logs }),
  };
}

function serializeForLog(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify(serializeError(value));
  }
  if (typeof value === "object" && value !== null) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = v instanceof Error ? serializeError(v) : v;
    }
    return JSON.stringify(obj);
  }
  return String(value);
}

function formatForFile(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const msg = args.map(serializeForLog).join(" ");
  return `${ts} [${level}] [keeper] ${msg}\n`;
}

function writeToFile(level: string, ...args: unknown[]): void {
  fileStream.write(formatForFile(level, args));
}

// Logger writes to logs.txt; console.log in your code still goes to the terminal.
export const log = {
  info: (...args: unknown[]): void => {
    writeToFile("INFO", ...args);
  },
  warn: (...args: unknown[]): void => {
    writeToFile("WARN", ...args);
  },
  error: (...args: unknown[]): void => {
    writeToFile("ERROR", ...args);
  },
};
