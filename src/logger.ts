/**
 * Simple console logger with colored prefixes.
 * No external dependency — just wraps console.log with timestamps and tags.
 */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${COLORS.dim}${timestamp()}${COLORS.reset} ${COLORS.cyan}[${tag}]${COLORS.reset} ${msg}`, ...args);
  },
  success(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${COLORS.dim}${timestamp()}${COLORS.reset} ${COLORS.green}✓ [${tag}]${COLORS.reset} ${msg}`, ...args);
  },
  warn(tag: string, msg: string, ...args: unknown[]) {
    console.warn(`${COLORS.dim}${timestamp()}${COLORS.reset} ${COLORS.yellow}⚠ [${tag}]${COLORS.reset} ${msg}`, ...args);
  },
  error(tag: string, msg: string, ...args: unknown[]) {
    console.error(`${COLORS.dim}${timestamp()}${COLORS.reset} ${COLORS.red}✗ [${tag}]${COLORS.reset} ${msg}`, ...args);
  },
  step(tag: string, msg: string) {
    console.log(`${COLORS.dim}${timestamp()}${COLORS.reset} ${COLORS.magenta}→ [${tag}]${COLORS.reset} ${msg}`);
  },
};
