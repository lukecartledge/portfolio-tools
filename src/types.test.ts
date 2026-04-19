import { describe, it, expect } from 'vitest'
import { mergeMetadata, CURRENT_SCHEMA_VERSION } from './types.js'
import type { AiMetadata, UserEdits } from './types.js'

function makeAi(overrides?: Partial<AiMetadata>): AiMetadata {
  return {
    title: 'AI Title',
    caption: 'AI caption text',
    tags: ['landscape', 'mountains'],
    model: 'claude-sonnet-4-20250514',
    generatedAt: '2026-04-19T10:00:00Z',
    ...overrides,
  }
}

describe('mergeMetadata', () => {
  it('returns AI values when no user edits provided', () => {
    const ai = makeAi()
    const result = mergeMetadata(ai)

    expect(result).toEqual({
      title: 'AI Title',
      caption: 'AI caption text',
      tags: ['landscape', 'mountains'],
    })
  })

  it('returns AI values when user edits is undefined', () => {
    const ai = makeAi()
    const result = mergeMetadata(ai, undefined)

    expect(result).toEqual({
      title: 'AI Title',
      caption: 'AI caption text',
      tags: ['landscape', 'mountains'],
    })
  })

  it('returns AI values when user edits is empty object', () => {
    const ai = makeAi()
    const edits: UserEdits = {}
    const result = mergeMetadata(ai, edits)

    expect(result).toEqual({
      title: 'AI Title',
      caption: 'AI caption text',
      tags: ['landscape', 'mountains'],
    })
  })

  it('overrides title when user provides one', () => {
    const ai = makeAi()
    const result = mergeMetadata(ai, { title: 'Custom Title' })

    expect(result.title).toBe('Custom Title')
    expect(result.caption).toBe('AI caption text')
    expect(result.tags).toEqual(['landscape', 'mountains'])
  })

  it('overrides caption when user provides one', () => {
    const ai = makeAi()
    const result = mergeMetadata(ai, { caption: 'Custom caption' })

    expect(result.title).toBe('AI Title')
    expect(result.caption).toBe('Custom caption')
    expect(result.tags).toEqual(['landscape', 'mountains'])
  })

  it('overrides tags when user provides them', () => {
    const ai = makeAi()
    const result = mergeMetadata(ai, { tags: ['aurora', 'night'] })

    expect(result.title).toBe('AI Title')
    expect(result.caption).toBe('AI caption text')
    expect(result.tags).toEqual(['aurora', 'night'])
  })

  it('overrides all fields when all user edits provided', () => {
    const ai = makeAi()
    const edits: UserEdits = {
      title: 'My Title',
      caption: 'My caption',
      tags: ['custom-tag'],
    }
    const result = mergeMetadata(ai, edits)

    expect(result).toEqual({
      title: 'My Title',
      caption: 'My caption',
      tags: ['custom-tag'],
    })
  })

  it('handles empty string user edits as valid overrides', () => {
    const ai = makeAi()
    const result = mergeMetadata(ai, { title: '', caption: '' })

    expect(result.title).toBe('')
    expect(result.caption).toBe('')
  })

  it('handles empty array tags as valid override', () => {
    const ai = makeAi({ tags: ['landscape', 'mountains'] })
    const result = mergeMetadata(ai, { tags: [] })

    expect(result.tags).toEqual([])
  })

  it('does not mutate the original AI metadata', () => {
    const ai = makeAi()
    const originalTags = [...ai.tags]
    mergeMetadata(ai, { title: 'New Title' })

    expect(ai.title).toBe('AI Title')
    expect(ai.tags).toEqual(originalTags)
  })
})

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true)
  })
})
