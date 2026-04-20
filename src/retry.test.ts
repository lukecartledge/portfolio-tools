import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isTransientError, getRetryAfterMs, calculateDelay, withRetry } from './retry.js'

function httpError(status: number): Error {
  const err = new Error(`HTTP ${status}`)
  ;(err as Error & { status: number }).status = status
  return err
}

function networkError(code: string): Error {
  const err = new Error(`Network error: ${code}`)
  ;(err as Error & { code: string }).code = code
  return err
}

function rateLimitError(retryAfterSeconds: number): Error {
  const err = new Error('Rate limited')
  ;(err as Error & { status: number; headers: Record<string, string> }).status = 429
  ;(err as Error & { headers: Record<string, string> }).headers = {
    'retry-after': String(retryAfterSeconds),
  }
  return err
}

describe('isTransientError', () => {
  it('returns true for HTTP 429', () => {
    expect(isTransientError(httpError(429))).toBe(true)
  })

  it('returns true for HTTP 500', () => {
    expect(isTransientError(httpError(500))).toBe(true)
  })

  it('returns true for HTTP 502', () => {
    expect(isTransientError(httpError(502))).toBe(true)
  })

  it('returns true for HTTP 503', () => {
    expect(isTransientError(httpError(503))).toBe(true)
  })

  it('returns true for HTTP 504', () => {
    expect(isTransientError(httpError(504))).toBe(true)
  })

  it('returns false for HTTP 400', () => {
    expect(isTransientError(httpError(400))).toBe(false)
  })

  it('returns false for HTTP 401', () => {
    expect(isTransientError(httpError(401))).toBe(false)
  })

  it('returns false for HTTP 403', () => {
    expect(isTransientError(httpError(403))).toBe(false)
  })

  it('returns false for HTTP 404', () => {
    expect(isTransientError(httpError(404))).toBe(false)
  })

  it('returns false for HTTP 422', () => {
    expect(isTransientError(httpError(422))).toBe(false)
  })

  it('returns true for ECONNRESET', () => {
    expect(isTransientError(networkError('ECONNRESET'))).toBe(true)
  })

  it('returns true for ETIMEDOUT', () => {
    expect(isTransientError(networkError('ETIMEDOUT'))).toBe(true)
  })

  it('returns true for ECONNREFUSED', () => {
    expect(isTransientError(networkError('ECONNREFUSED'))).toBe(true)
  })

  it('returns true for ENOTFOUND', () => {
    expect(isTransientError(networkError('ENOTFOUND'))).toBe(true)
  })

  it('returns false for non-Error values', () => {
    expect(isTransientError('string error')).toBe(false)
    expect(isTransientError(42)).toBe(false)
    expect(isTransientError(null)).toBe(false)
  })

  it('returns false for plain Error without status or code', () => {
    expect(isTransientError(new Error('plain error'))).toBe(false)
  })

  it('reads statusCode field (Contentful SDK variant)', () => {
    const err = new Error('rate limited')
    ;(err as Error & { statusCode: number }).statusCode = 429
    expect(isTransientError(err)).toBe(true)
  })
})

describe('getRetryAfterMs', () => {
  it('extracts retry-after from headers in seconds', () => {
    expect(getRetryAfterMs(rateLimitError(5))).toBe(5000)
  })

  it('extracts retry-after from retryAfter field', () => {
    const err = new Error('rate limited')
    ;(err as Error & { retryAfter: number }).retryAfter = 10
    expect(getRetryAfterMs(err)).toBe(10_000)
  })

  it('returns null when no retry-after info', () => {
    expect(getRetryAfterMs(new Error('plain'))).toBeNull()
  })

  it('returns null for non-Error values', () => {
    expect(getRetryAfterMs('string')).toBeNull()
  })

  it('ignores invalid retry-after header values', () => {
    const err = new Error('bad header')
    ;(err as Error & { headers: Record<string, string> }).headers = { 'retry-after': 'invalid' }
    expect(getRetryAfterMs(err)).toBeNull()
  })

  it('ignores zero or negative retry-after', () => {
    expect(getRetryAfterMs(rateLimitError(0))).toBeNull()
    expect(getRetryAfterMs(rateLimitError(-1))).toBeNull()
  })
})

describe('calculateDelay', () => {
  const options = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000 }

  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  it('doubles base delay each attempt', () => {
    const d0 = calculateDelay(0, options)
    const d1 = calculateDelay(1, options)
    const d2 = calculateDelay(2, options)

    expect(d0).toBe(1000)
    expect(d1).toBe(2000)
    expect(d2).toBe(4000)
  })

  it('caps at maxDelayMs', () => {
    const smallMax = { ...options, maxDelayMs: 3000 }
    expect(calculateDelay(5, smallMax)).toBe(3000)
  })

  it('applies jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0)
    const low = calculateDelay(0, options)

    vi.spyOn(Math, 'random').mockReturnValue(1.0)
    const high = calculateDelay(0, options)

    expect(low).toBe(500)
    expect(high).toBe(1500)
  })
})

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  const fastOpts = { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, label: 'test' }

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, fastOpts)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries on transient error and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(429)).mockResolvedValue('recovered')

    const result = await withRetry(fn, fastOpts)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting all retries', async () => {
    const err = httpError(503)
    const fn = vi.fn().mockRejectedValue(err)

    await expect(withRetry(fn, fastOpts)).rejects.toThrow(err)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('does not retry non-transient errors', async () => {
    const err = httpError(404)
    const fn = vi.fn().mockRejectedValue(err)

    await expect(withRetry(fn, fastOpts)).rejects.toThrow(err)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('does not retry non-Error values', async () => {
    const fn = vi.fn().mockRejectedValue('string error')

    await expect(withRetry(fn, fastOpts)).rejects.toBe('string error')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('respects Retry-After header over calculated backoff', async () => {
    const err = rateLimitError(2)
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok')

    const result = await withRetry(fn, { ...fastOpts, baseDelayMs: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('uses default options when none provided', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
  })
})
