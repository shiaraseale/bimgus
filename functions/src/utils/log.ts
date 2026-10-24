import * as logger from 'firebase-functions/logger';

/**
 * Structured logging (4.5): Cloud Logging gets a severity and fields it can filter on, which also
 * makes the error alert (0.9) precise. Under the test runner it writes through console instead,
 * because the Firebase logger keeps its own copy of console and tests watch console.
 */
const underTest = Boolean(process.env.VITEST);

export const log = {
  debug: (...args: unknown[]) => (underTest ? console.debug(...args) : logger.debug(...args)),
  info: (...args: unknown[]) => (underTest ? console.log(...args) : logger.info(...args)),
  warn: (...args: unknown[]) => (underTest ? console.warn(...args) : logger.warn(...args)),
  error: (...args: unknown[]) => (underTest ? console.error(...args) : logger.error(...args)),
};

/** True for "not found" and "forbidden" API errors, which mean "nothing there" rather than a failure. */
export function isExpectedApiMiss(err: any): boolean {
  const status = err?.response?.status;
  return status === 404 || status === 403;
}
