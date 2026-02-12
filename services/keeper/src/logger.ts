// Placeholder logger module for future structured logging.
export const log = {
  info: (...args: unknown[]): void => {
    console.log("[keeper]", ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn("[keeper]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[keeper]", ...args);
  },
};
