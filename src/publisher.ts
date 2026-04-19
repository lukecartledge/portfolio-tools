import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import contentful from 'contentful-management'
import slugify from 'slugify'
import type { Config } from './config.js'
import type { Sidecar } from './types.js'
import { PHOTO_CONTENT_TYPE, COLLECTION_CONTENT_TYPE } from './config.js'

const CONTENTFUL_RATE_LIMIT_DELAY_MS = 150

interface PublishResult {
  assetId: string
  entryId: string
}

async function getCmaEnvironment(config: Config) {
  const client = contentful.createClient({
    accessToken: config.contentful.managementToken,
  })
  const space = await client.getSpace(config.contentful.spaceId)
  return space.getEnvironment(config.contentful.environment)
}

type CmaEnvironment = Awaited<ReturnType<typeof getCmaEnvironment>>

export async function publishPhoto(
  filePath: string,
  sidecar: Sidecar,
  config: Config,
): Promise<PublishResult> {
  const env = await getCmaEnvironment(config)

  const fileName = basename(filePath)
  const contentType = mimeTypeFor(extname(filePath))

  const upload = await env.createUpload({ file: createReadStream(filePath) })
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const asset = await env.createAsset({
    fields: {
      title: { 'en-US': sidecar.ai.title },
      file: {
        'en-US': {
          contentType,
          fileName,
          uploadFrom: {
            sys: { type: 'Link', linkType: 'Upload', id: upload.sys.id },
          },
        },
      },
    },
  })
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const processedAsset = await asset.processForAllLocales()
  await waitForAssetProcessing(env, processedAsset.sys.id)
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const latestAsset = await env.getAsset(processedAsset.sys.id)
  await latestAsset.publish()
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const collectionId = await resolveCollection(env, sidecar.collection)

  const slug = slugify(sidecar.ai.title, { lower: true, strict: true })
  const entry = await env.createEntry(PHOTO_CONTENT_TYPE, {
    fields: {
      title: { 'en-US': sidecar.ai.title },
      slug: { 'en-US': slug },
      image: {
        'en-US': {
          sys: { type: 'Link', linkType: 'Asset', id: latestAsset.sys.id },
        },
      },
      caption: sidecar.ai.caption ? { 'en-US': sidecar.ai.caption } : undefined,
      dateTaken: sidecar.exif.dateTaken ? { 'en-US': sidecar.exif.dateTaken } : undefined,
      camera: sidecar.exif.camera ? { 'en-US': sidecar.exif.camera } : undefined,
      lens: sidecar.exif.lens ? { 'en-US': sidecar.exif.lens } : undefined,
      aperture: sidecar.exif.aperture ? { 'en-US': sidecar.exif.aperture } : undefined,
      shutterSpeed: sidecar.exif.shutterSpeed ? { 'en-US': sidecar.exif.shutterSpeed } : undefined,
      iso: sidecar.exif.iso ? { 'en-US': sidecar.exif.iso } : undefined,
      focalLength: sidecar.exif.focalLength ? { 'en-US': sidecar.exif.focalLength } : undefined,
      tags: sidecar.ai.tags.length > 0 ? { 'en-US': sidecar.ai.tags } : undefined,
      ...(collectionId
        ? {
            collections: {
              'en-US': [
                {
                  sys: {
                    type: 'Link',
                    linkType: 'Entry',
                    id: collectionId,
                  },
                },
              ],
            },
          }
        : {}),
      featured: { 'en-US': false },
    },
  })
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  await entry.publish()

  return {
    assetId: latestAsset.sys.id,
    entryId: entry.sys.id,
  }
}

export async function listCollections(
  config: Config,
): Promise<Array<{ id: string; title: string; slug: string }>> {
  const env = await getCmaEnvironment(config)

  const entries = await env.getEntries({
    content_type: COLLECTION_CONTENT_TYPE,
  })

  return entries.items.map((entry) => ({
    id: entry.sys.id,
    title: (entry.fields.title as Record<string, string>)?.['en-US'] ?? '',
    slug: (entry.fields.slug as Record<string, string>)?.['en-US'] ?? '',
  }))
}

export async function createCollection(config: Config, title: string): Promise<string> {
  const env = await getCmaEnvironment(config)

  const slug = slugify(title, { lower: true, strict: true })

  const entry = await env.createEntry(COLLECTION_CONTENT_TYPE, {
    fields: {
      title: { 'en-US': title },
      slug: { 'en-US': slug },
    },
  })

  await entry.publish()
  return entry.sys.id
}

async function resolveCollection(
  env: CmaEnvironment,
  collectionName: string,
): Promise<string | null> {
  const slug = slugify(collectionName, { lower: true, strict: true })

  const entries = await env.getEntries({
    content_type: COLLECTION_CONTENT_TYPE,
    'fields.slug': slug,
    limit: 1,
  })

  if (entries.items.length > 0) {
    return entries.items[0]!.sys.id
  }

  return null
}

async function waitForAssetProcessing(
  env: CmaEnvironment,
  assetId: string,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const asset = await env.getAsset(assetId)
    const file = (asset.fields.file as Record<string, unknown>)?.['en-US'] as
      | { url?: string }
      | undefined

    if (file?.url) return

    await delay(1000)
  }
  throw new Error(`Asset ${assetId} processing timed out after ${maxAttempts}s`)
}

function mimeTypeFor(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
