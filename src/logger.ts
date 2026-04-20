type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVELS: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

function isLevel(value: string): value is Level {
  return value in LEVELS
}

function getThreshold(): number {
  const env = process.env.LOG_LEVEL?.toLowerCase() ?? ''
  return isLevel(env) ? LEVELS[env] : LEVELS.info
}

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= getThreshold()
}

export const log = {
  debug(...args: unknown[]) {
    if (shouldLog('debug')) console.debug(...args)
  },
  info(...args: unknown[]) {
    if (shouldLog('info')) console.log(...args)
  },
  warn(...args: unknown[]) {
    if (shouldLog('warn')) console.warn(...args)
  },
  error(...args: unknown[]) {
    if (shouldLog('error')) console.error(...args)
  },
}
