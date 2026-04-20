import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { log } from './logger.js'

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = savedEnv
})

describe('log', () => {
  it('info writes to console.log at default level', () => {
    delete process.env.LOG_LEVEL
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log.info('hello')

    expect(spy).toHaveBeenCalledWith('hello')
  })

  it('debug is suppressed at default info level', () => {
    delete process.env.LOG_LEVEL
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    log.debug('hidden')

    expect(spy).not.toHaveBeenCalled()
  })

  it('debug is shown when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug'
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    log.debug('visible')

    expect(spy).toHaveBeenCalledWith('visible')
  })

  it('error writes to console.error', () => {
    delete process.env.LOG_LEVEL
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    log.error('bad thing')

    expect(spy).toHaveBeenCalledWith('bad thing')
  })

  it('warn writes to console.warn', () => {
    delete process.env.LOG_LEVEL
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    log.warn('careful')

    expect(spy).toHaveBeenCalledWith('careful')
  })

  it('silent suppresses all output', () => {
    process.env.LOG_LEVEL = 'silent'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    log.info('nope')
    log.error('nope')

    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('passes multiple arguments through', () => {
    delete process.env.LOG_LEVEL
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log.info('count:', 42, { key: 'val' })

    expect(spy).toHaveBeenCalledWith('count:', 42, { key: 'val' })
  })
})
