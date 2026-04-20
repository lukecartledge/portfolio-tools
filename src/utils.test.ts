import { describe, it, expect } from 'vitest'
import { errorMessage, toCollectionTitle } from './utils.js'

describe('toCollectionTitle', () => {
  it('converts hyphenated folder name to title case', () => {
    expect(toCollectionTitle('new-zealand')).toBe('New Zealand')
  })

  it('converts underscored folder name to title case', () => {
    expect(toCollectionTitle('south_island')).toBe('South Island')
  })

  it('handles single word', () => {
    expect(toCollectionTitle('iceland')).toBe('Iceland')
  })

  it('handles multiple consecutive separators', () => {
    expect(toCollectionTitle('new--zealand')).toBe('New Zealand')
  })

  it('handles mixed separators', () => {
    expect(toCollectionTitle('new-zealand_north')).toBe('New Zealand North')
  })
})

describe('errorMessage', () => {
  it('extracts message from Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('converts strings to string', () => {
    expect(errorMessage('something went wrong')).toBe('something went wrong')
  })

  it('converts numbers to string', () => {
    expect(errorMessage(42)).toBe('42')
  })

  it('converts null to string', () => {
    expect(errorMessage(null)).toBe('null')
  })

  it('converts undefined to string', () => {
    expect(errorMessage(undefined)).toBe('undefined')
  })

  it('extracts message from subclassed errors', () => {
    class CustomError extends Error {
      constructor() {
        super('custom')
      }
    }
    expect(errorMessage(new CustomError())).toBe('custom')
  })
})
