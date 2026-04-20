import { resolve } from 'node:path'
import { homedir } from 'node:os'

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

/** Expand ~ to home directory */
function expandHome(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return resolve(homedir(), path.slice(2))
  }
  return resolve(path)
}

export function loadConfig() {
  return {
    contentful: {
      spaceId: requiredEnv('CONTENTFUL_SPACE_ID'),
      environment: optionalEnv('CONTENTFUL_ENVIRONMENT', 'master'),
      managementToken: requiredEnv('CONTENTFUL_MANAGEMENT_TOKEN'),
    },
    anthropic: {
      apiKey: requiredEnv('ANTHROPIC_API_KEY'),
    },
    watchDir: expandHome(optionalEnv('WATCH_DIR', '~/Pictures/Portfolio')),
    port: parseInt(optionalEnv('PORT', '3000'), 10),
  } as const
}

export type Config = ReturnType<typeof loadConfig>

/** Supported image extensions */
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.png', '.webp'])

/** Contentful locale for all field values */
export const CONTENTFUL_LOCALE = optionalEnv('CONTENTFUL_LOCALE', 'en-US')

/** Contentful photo content type ID */
export const PHOTO_CONTENT_TYPE = optionalEnv('PHOTO_CONTENT_TYPE', 'photo')

/** Contentful collection content type ID */
export const COLLECTION_CONTENT_TYPE = optionalEnv('COLLECTION_CONTENT_TYPE', 'collection')

/** Claude model for vision analysis */
export const VISION_MODEL = optionalEnv('VISION_MODEL', 'claude-sonnet-4-6')

/** Max image dimension for AI vision input */
export const VISION_MAX_DIMENSION = 1568

/** Chokidar stability threshold for file writes (ms) */
export const WRITE_STABILITY_THRESHOLD = parseInt(
  optionalEnv('WRITE_STABILITY_THRESHOLD', '3000'),
  10,
)

/** Chokidar poll interval (ms) */
export const WRITE_POLL_INTERVAL = 500

export const MAX_RETRIES = parseInt(optionalEnv('MAX_RETRIES', '3'), 10)

export const RETRY_BASE_DELAY_MS = parseInt(optionalEnv('RETRY_BASE_DELAY_MS', '1000'), 10)
