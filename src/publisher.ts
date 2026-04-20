import { createReadStream } from 'node:fs'
import { basename, extname } from 'node:path'
import { createClient } from 'contentful-management'
import type { PlainClientAPI } from 'contentful-management'
import slugify from 'slugify'
import type { Config } from './config.js'
import type { Sidecar } from './types.js'
import { mergeMetadata } from './types.js'
import { CONTENTFUL_LOCALE, PHOTO_CONTENT_TYPE, COLLECTION_CONTENT_TYPE } from './config.js'

const CONTENTFUL_RATE_LIMIT_DELAY_MS = 150

interface PublishResult {
  assetId: string
  entryId: string
}

function localField<T>(value: T | null | undefined): Record<string, T> | undefined {
  if (value == null) return undefined
  return { [CONTENTFUL_LOCALE]: value }
}

function getClient(config: Config): PlainClientAPI {
  return createClient(
    {
      accessToken: config.contentful.managementToken,
    },
    {
      type: 'plain',
      defaults: {
        spaceId: config.contentful.spaceId,
        environmentId: config.contentful.environment,
      },
    },
  )
}

export async function publishPhoto(
  filePath: string,
  sidecar: Sidecar,
  config: Config,
): Promise<PublishResult> {
  const client = getClient(config)
  const effective = mergeMetadata(sidecar.ai, sidecar.userEdits)

  const fileName = basename(filePath)
  const contentType = mimeTypeFor(extname(filePath))

  const upload = (await client.upload.create({}, { file: createReadStream(filePath) })) as {
    sys: { id: string }
  }
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const asset = await client.asset.create(
    {},
    {
      fields: {
        title: { [CONTENTFUL_LOCALE]: effective.title },
        file: {
          [CONTENTFUL_LOCALE]: {
            contentType,
            fileName,
            uploadFrom: {
              sys: { type: 'Link', linkType: 'Upload', id: upload.sys.id },
            },
          },
        },
      },
    },
  )
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  await client.asset.processForAllLocales({}, asset)
  await waitForAssetProcessing(client, asset.sys.id)
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const latestAsset = await client.asset.get({ assetId: asset.sys.id })
  await client.asset.publish({ assetId: latestAsset.sys.id }, latestAsset)
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  const collectionId = await resolveCollection(client, sidecar.collection)

  const slug = slugify(effective.title, { lower: true, strict: true })
  const entry = await client.entry.create(
    { contentTypeId: PHOTO_CONTENT_TYPE },
    {
      fields: {
        title: { [CONTENTFUL_LOCALE]: effective.title },
        slug: { [CONTENTFUL_LOCALE]: slug },
        image: {
          [CONTENTFUL_LOCALE]: {
            sys: { type: 'Link', linkType: 'Asset', id: latestAsset.sys.id },
          },
        },
        caption: localField(effective.caption || null),
        dateTaken: localField(sidecar.exif.dateTaken),
        camera: localField(sidecar.exif.camera),
        lens: localField(sidecar.exif.lens),
        aperture: localField(sidecar.exif.aperture),
        shutterSpeed: localField(sidecar.exif.shutterSpeed),
        iso: localField(sidecar.exif.iso),
        focalLength: localField(sidecar.exif.focalLength),
        tags: effective.tags.length > 0 ? { [CONTENTFUL_LOCALE]: effective.tags } : undefined,
        ...(collectionId
          ? {
              collections: {
                [CONTENTFUL_LOCALE]: [
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
        featured: { [CONTENTFUL_LOCALE]: false },
      },
    },
  )
  await delay(CONTENTFUL_RATE_LIMIT_DELAY_MS)

  await client.entry.publish({ entryId: entry.sys.id }, entry)

  return {
    assetId: latestAsset.sys.id,
    entryId: entry.sys.id,
  }
}

export async function listCollections(
  config: Config,
): Promise<{ id: string; title: string; slug: string }[]> {
  const client = getClient(config)

  const entries = await client.entry.getMany({
    query: { content_type: COLLECTION_CONTENT_TYPE },
  })

  return entries.items.map((entry) => ({
    id: entry.sys.id,
    title: (entry.fields.title as Record<string, string>)[CONTENTFUL_LOCALE] ?? '',
    slug: (entry.fields.slug as Record<string, string>)[CONTENTFUL_LOCALE] ?? '',
  }))
}

export async function createCollection(config: Config, title: string): Promise<string> {
  const client = getClient(config)

  const slug = slugify(title, { lower: true, strict: true })

  const entry = await client.entry.create(
    { contentTypeId: COLLECTION_CONTENT_TYPE },
    {
      fields: {
        title: { [CONTENTFUL_LOCALE]: title },
        slug: { [CONTENTFUL_LOCALE]: slug },
      },
    },
  )

  await client.entry.publish({ entryId: entry.sys.id }, entry)
  return entry.sys.id
}

async function resolveCollection(
  client: PlainClientAPI,
  collectionName: string,
): Promise<string | null> {
  const slug = slugify(collectionName, { lower: true, strict: true })

  const entries = await client.entry.getMany({
    query: {
      content_type: COLLECTION_CONTENT_TYPE,
      'fields.slug': slug,
      limit: 1,
    },
  })

  if (entries.items.length > 0) {
    const first = entries.items[0]
    if (first) return first.sys.id
  }

  return null
}

async function waitForAssetProcessing(
  client: PlainClientAPI,
  assetId: string,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const asset = await client.asset.get({ assetId })
    const file = (asset.fields.file as Record<string, unknown>)[CONTENTFUL_LOCALE] as
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
