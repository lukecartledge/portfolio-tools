import 'dotenv/config'
import { createClient } from 'contentful-management'
import type { PlainClientAPI } from 'contentful-management'
import { log } from './logger.js'
import { PHOTO_CONTENT_TYPE, COLLECTION_CONTENT_TYPE } from './config.js'

function getClient(): PlainClientAPI {
  const spaceId = process.env.CONTENTFUL_SPACE_ID
  const accessToken = process.env.CONTENTFUL_MANAGEMENT_TOKEN
  const environmentId = process.env.CONTENTFUL_ENVIRONMENT ?? 'master'

  if (!spaceId || !accessToken) {
    throw new Error(
      'Missing required env vars: CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN',
    )
  }

  return createClient({ accessToken }, { type: 'plain', defaults: { spaceId, environmentId } })
}

async function contentTypeExists(client: PlainClientAPI, id: string): Promise<boolean> {
  try {
    await client.contentType.get({ contentTypeId: id })
    return true
  } catch {
    return false
  }
}

async function createCollectionType(client: PlainClientAPI): Promise<void> {
  if (await contentTypeExists(client, COLLECTION_CONTENT_TYPE)) {
    log.info(`  "${COLLECTION_CONTENT_TYPE}" already exists — skipping`)
    return
  }

  log.info(`  Creating "${COLLECTION_CONTENT_TYPE}"...`)
  const ct = await client.contentType.createWithId(
    { contentTypeId: COLLECTION_CONTENT_TYPE },
    {
      name: 'Collection',
      displayField: 'title',
      fields: [
        {
          id: 'title',
          name: 'Title',
          type: 'Symbol',
          required: true,
          localized: true,
        },
        {
          id: 'slug',
          name: 'Slug',
          type: 'Symbol',
          required: true,
          localized: false,
          validations: [{ unique: true }],
        },
        {
          id: 'description',
          name: 'Description',
          type: 'Text',
          required: false,
          localized: true,
        },
      ],
    },
  )
  await client.contentType.publish({ contentTypeId: COLLECTION_CONTENT_TYPE }, ct)
  log.info(`  Published "${COLLECTION_CONTENT_TYPE}"`)
}

async function createPhotoType(client: PlainClientAPI): Promise<void> {
  if (await contentTypeExists(client, PHOTO_CONTENT_TYPE)) {
    log.info(`  "${PHOTO_CONTENT_TYPE}" already exists — skipping`)
    return
  }

  log.info(`  Creating "${PHOTO_CONTENT_TYPE}"...`)
  const ct = await client.contentType.createWithId(
    { contentTypeId: PHOTO_CONTENT_TYPE },
    {
      name: 'Photo',
      displayField: 'title',
      fields: [
        {
          id: 'title',
          name: 'Title',
          type: 'Symbol',
          required: true,
          localized: true,
        },
        {
          id: 'slug',
          name: 'Slug',
          type: 'Symbol',
          required: true,
          localized: false,
          validations: [{ unique: true }],
        },
        {
          id: 'image',
          name: 'Image',
          type: 'Link',
          linkType: 'Asset',
          required: true,
          localized: false,
          validations: [{ linkMimetypeGroup: ['image'] }],
        },
        {
          id: 'caption',
          name: 'Caption',
          type: 'Text',
          required: false,
          localized: true,
        },
        {
          id: 'location',
          name: 'Location',
          type: 'Symbol',
          required: false,
          localized: true,
        },
        {
          id: 'dateTaken',
          name: 'Date Taken',
          type: 'Date',
          required: false,
          localized: false,
        },
        {
          id: 'camera',
          name: 'Camera',
          type: 'Symbol',
          required: false,
          localized: false,
        },
        {
          id: 'lens',
          name: 'Lens',
          type: 'Symbol',
          required: false,
          localized: false,
        },
        {
          id: 'aperture',
          name: 'Aperture',
          type: 'Symbol',
          required: false,
          localized: false,
        },
        {
          id: 'shutterSpeed',
          name: 'Shutter Speed',
          type: 'Symbol',
          required: false,
          localized: false,
        },
        {
          id: 'iso',
          name: 'ISO',
          type: 'Integer',
          required: false,
          localized: false,
        },
        {
          id: 'focalLength',
          name: 'Focal Length',
          type: 'Symbol',
          required: false,
          localized: false,
        },
        {
          id: 'tags',
          name: 'Tags',
          type: 'Array',
          required: false,
          localized: true,
          items: { type: 'Symbol', validations: [] },
        },
        {
          id: 'collections',
          name: 'Collections',
          type: 'Array',
          required: false,
          localized: false,
          items: {
            type: 'Link',
            linkType: 'Entry',
            validations: [{ linkContentType: [COLLECTION_CONTENT_TYPE] }],
          },
        },
        {
          id: 'featured',
          name: 'Featured',
          type: 'Boolean',
          required: false,
          localized: false,
        },
        {
          id: 'displayOrder',
          name: 'Display Order',
          type: 'Integer',
          required: false,
          localized: false,
        },
      ],
    },
  )
  await client.contentType.publish({ contentTypeId: PHOTO_CONTENT_TYPE }, ct)
  log.info(`  Published "${PHOTO_CONTENT_TYPE}"`)
}

async function main(): Promise<void> {
  log.info('Setting up Contentful content model...\n')
  const client = getClient()

  // Collection must exist before photo (photo references it)
  await createCollectionType(client)
  await createPhotoType(client)

  log.info('\nDone. Content model is ready.')
}

main().catch((error: unknown) => {
  console.error('Setup failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
