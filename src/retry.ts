import { log } from './logger.js'

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504])

export interface RetryOptions {
  /** Not counting the initial call */
  maxRetries: number
  /** Doubles each attempt (ms) */
  baseDelayMs: number
  /** Cap on delay (ms) */
  maxDelayMs: number
  /** Label for log messages (e.g. "Contentful asset.create") */
  label?: string
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
}

/**
 * Retries: 429, 500, 502, 503, 504, and network errors
 * (ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.)
 *
 * Does NOT retry: 400, 401, 403, 404, 409, 422
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const status = getStatusCode(error)
  if (status !== null) {
    return TRANSIENT_STATUS_CODES.has(status)
  }

  const code = getErrorCode(error)
  if (code !== null) {
    const networkCodes = new Set([
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EPIPE',
      'EAI_AGAIN',
      'UND_ERR_CONNECT_TIMEOUT',
    ])
    return networkCodes.has(code)
  }

  return false
}

function getStatusCode(error: Error): number | null {
  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return null
}

function getErrorCode(error: Error): string | null {
  if ('code' in error && typeof error.code === 'string') {
    return error.code
  }
  return null
}

export function getRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof Error)) return null

  if ('headers' in error) {
    const headers = error.headers as Record<string, string> | undefined
    const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After']
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!Number.isNaN(seconds) && seconds > 0) {
        return seconds * 1000
      }
    }
  }

  if ('retryAfter' in error && typeof error.retryAfter === 'number') {
    return error.retryAfter * 1000
  }

  return null
}

/** min(maxDelay, baseDelay × 2^attempt) × random(0.5, 1.5) */
export function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay = options.baseDelayMs * 2 ** attempt
  const capped = Math.min(exponentialDelay, options.maxDelayMs)
  const jitter = 0.5 + Math.random()
  return Math.round(capped * jitter)
}

/**
 * Retry on transient failures with exponential backoff + jitter.
 * Respects Retry-After headers from rate-limited responses.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options }
  const label = opts.label ?? 'operation'

  let lastError: unknown

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt >= opts.maxRetries || !isTransientError(error)) {
        break
      }

      const retryAfter = getRetryAfterMs(error)
      const backoffDelay = calculateDelay(attempt, opts)
      const delayMs = retryAfter !== null ? Math.max(retryAfter, backoffDelay) : backoffDelay

      const status = error instanceof Error ? getStatusCode(error) : null
      const statusSuffix = status !== null ? ` (HTTP ${status})` : ''

      log.warn(
        `${label}: transient error${statusSuffix}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${opts.maxRetries})`,
      )

      await delay(delayMs)
    }
  }

  throw lastError
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
