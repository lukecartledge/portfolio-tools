import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadConfig,
  IMAGE_EXTENSIONS,
  PHOTO_CONTENT_TYPE,
  COLLECTION_CONTENT_TYPE,
  VISION_MODEL,
  VISION_MAX_DIMENSION,
  WRITE_STABILITY_THRESHOLD,
  WRITE_POLL_INTERVAL,
} from './config.js'

const REQUIRED_ENV = {
  CONTENTFUL_SPACE_ID: 'test-space-id',
  CONTENTFUL_MANAGEMENT_TOKEN: 'test-management-token',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
}

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  Object.assign(process.env, REQUIRED_ENV)
})

afterEach(() => {
  process.env = savedEnv
})

describe('loadConfig', () => {
  it('loads required env vars', () => {
    const config = loadConfig()

    expect(config.contentful.spaceId).toBe('test-space-id')
    expect(config.contentful.managementToken).toBe('test-management-token')
    expect(config.anthropic.apiKey).toBe('test-anthropic-key')
  })

  it('throws when CONTENTFUL_SPACE_ID is missing', () => {
    delete process.env.CONTENTFUL_SPACE_ID

    expect(() => loadConfig()).toThrow('Missing required environment variable: CONTENTFUL_SPACE_ID')
  })

  it('throws when CONTENTFUL_MANAGEMENT_TOKEN is missing', () => {
    delete process.env.CONTENTFUL_MANAGEMENT_TOKEN

    expect(() => loadConfig()).toThrow(
      'Missing required environment variable: CONTENTFUL_MANAGEMENT_TOKEN',
    )
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY

    expect(() => loadConfig()).toThrow('Missing required environment variable: ANTHROPIC_API_KEY')
  })

  it('uses default environment when CONTENTFUL_ENVIRONMENT not set', () => {
    const config = loadConfig()
    expect(config.contentful.environment).toBe('master')
  })

  it('uses custom environment when CONTENTFUL_ENVIRONMENT is set', () => {
    process.env.CONTENTFUL_ENVIRONMENT = 'staging'
    const config = loadConfig()
    expect(config.contentful.environment).toBe('staging')
  })

  it('uses default port when PORT not set', () => {
    const config = loadConfig()
    expect(config.port).toBe(3000)
  })

  it('parses custom PORT as integer', () => {
    process.env.PORT = '8080'
    const config = loadConfig()
    expect(config.port).toBe(8080)
  })

  it('expands ~ in default WATCH_DIR', () => {
    const config = loadConfig()
    expect(config.watchDir).not.toContain('~')
    expect(config.watchDir).toContain('Pictures/Portfolio')
  })

  it('uses custom WATCH_DIR when set', () => {
    process.env.WATCH_DIR = '/tmp/photos'
    const config = loadConfig()
    expect(config.watchDir).toBe('/tmp/photos')
  })

  it('expands ~ in custom WATCH_DIR', () => {
    process.env.WATCH_DIR = '~/my-photos'
    const config = loadConfig()
    expect(config.watchDir).not.toContain('~')
    expect(config.watchDir).toContain('my-photos')
  })
})

describe('constants', () => {
  it('IMAGE_EXTENSIONS includes common photo formats', () => {
    expect(IMAGE_EXTENSIONS.has('.jpg')).toBe(true)
    expect(IMAGE_EXTENSIONS.has('.jpeg')).toBe(true)
    expect(IMAGE_EXTENSIONS.has('.tif')).toBe(true)
    expect(IMAGE_EXTENSIONS.has('.tiff')).toBe(true)
    expect(IMAGE_EXTENSIONS.has('.png')).toBe(true)
    expect(IMAGE_EXTENSIONS.has('.webp')).toBe(true)
  })

  it('IMAGE_EXTENSIONS excludes non-image formats', () => {
    expect(IMAGE_EXTENSIONS.has('.json')).toBe(false)
    expect(IMAGE_EXTENSIONS.has('.txt')).toBe(false)
    expect(IMAGE_EXTENSIONS.has('.mp4')).toBe(false)
  })

  it('PHOTO_CONTENT_TYPE is photo', () => {
    expect(PHOTO_CONTENT_TYPE).toBe('photo')
  })

  it('COLLECTION_CONTENT_TYPE is collection', () => {
    expect(COLLECTION_CONTENT_TYPE).toBe('collection')
  })

  it('VISION_MODEL is a claude model', () => {
    expect(VISION_MODEL).toContain('claude')
  })

  it('VISION_MAX_DIMENSION is 1568', () => {
    expect(VISION_MAX_DIMENSION).toBe(1568)
  })

  it('WRITE_STABILITY_THRESHOLD is a positive number', () => {
    expect(WRITE_STABILITY_THRESHOLD).toBeGreaterThan(0)
  })

  it('WRITE_POLL_INTERVAL is a positive number', () => {
    expect(WRITE_POLL_INTERVAL).toBeGreaterThan(0)
  })
})
