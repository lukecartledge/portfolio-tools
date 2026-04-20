import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from './config.js'
import type { Sidecar } from './types.js'

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => 'mock-read-stream'),
}))

vi.mock('slugify', () => ({
  default: vi.fn((str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, ''),
  ),
}))

const {
  mockUploadCreate,
  mockAssetCreate,
  mockAssetGet,
  mockAssetPublish,
  mockAssetProcessForAllLocales,
  mockEntryCreate,
  mockEntryGet,
  mockEntryGetMany,
  mockEntryPublish,
  mockEntryUpdate,
  mockClient,
} = vi.hoisted(() => {
  const mockUploadCreate = vi.fn()
  const mockAssetCreate = vi.fn()
  const mockAssetGet = vi.fn()
  const mockAssetPublish = vi.fn()
  const mockAssetProcessForAllLocales = vi.fn()
  const mockEntryCreate = vi.fn()
  const mockEntryGet = vi.fn()
  const mockEntryGetMany = vi.fn()
  const mockEntryPublish = vi.fn()
  const mockEntryUpdate = vi.fn()

  const mockClient = {
    upload: { create: mockUploadCreate },
    asset: {
      create: mockAssetCreate,
      get: mockAssetGet,
      publish: mockAssetPublish,
      processForAllLocales: mockAssetProcessForAllLocales,
    },
    entry: {
      create: mockEntryCreate,
      get: mockEntryGet,
      getMany: mockEntryGetMany,
      publish: mockEntryPublish,
      update: mockEntryUpdate,
    },
  }

  return {
    mockUploadCreate,
    mockAssetCreate,
    mockAssetGet,
    mockAssetPublish,
    mockAssetProcessForAllLocales,
    mockEntryCreate,
    mockEntryGet,
    mockEntryGetMany,
    mockEntryPublish,
    mockEntryUpdate,
    mockClient,
  }
})

vi.mock('contentful-management', () => ({
  createClient: vi.fn(() => mockClient),
}))

const {
  publishPhoto,
  listCollections,
  createCollection,
  checkSlugExists,
  findCollection,
  updateCollectionWithPhoto,
} = await import('./publisher.js')

function makeConfig(): Config {
  return {
    contentful: {
      spaceId: 'space-1',
      environment: 'master',
      managementToken: 'cma-token-1',
    },
    anthropic: { apiKey: 'anthropic-key' },
    watchDir: '/photos',
    port: 3000,
  }
}

function makeSidecar(overrides?: Partial<Sidecar>): Sidecar {
  return {
    schemaVersion: 1,
    status: 'approved',
    source: '/photos/iceland/aurora.jpg',
    collection: 'iceland',
    exif: {
      camera: 'Sony ILCE-7M4',
      lens: 'FE 24-70mm F2.8 GM II',
      aperture: 'f/8',
      shutterSpeed: '1/250',
      iso: 100,
      focalLength: '35mm',
      dateTaken: '2026-03-15T14:30:00.000Z',
      gps: null,
    },
    ai: {
      title: 'Northern Lights',
      caption: 'Aurora borealis dancing across the sky',
      tags: ['aurora', 'iceland', 'night'],
      model: 'claude-sonnet-4-6',
      generatedAt: '2026-03-15T15:00:00.000Z',
    },
    contentful: {
      assetId: null,
      entryId: null,
      publishedAt: null,
    },
    ...overrides,
  }
}

function setupPublishMocks() {
  mockUploadCreate.mockResolvedValue({ sys: { id: 'upload-1' } })

  mockAssetCreate.mockResolvedValue({
    sys: { id: 'asset-1' },
    fields: {},
  })

  mockAssetProcessForAllLocales.mockResolvedValue({
    sys: { id: 'asset-1' },
  })

  mockAssetGet.mockResolvedValue({
    sys: { id: 'asset-1' },
    fields: {
      file: { 'en-US': { url: '//images.ctfassets.net/asset-1.jpg' } },
    },
  })

  mockAssetPublish.mockResolvedValue({
    sys: { id: 'asset-1' },
  })

  mockEntryCreate.mockResolvedValue({
    sys: { id: 'entry-1' },
  })

  mockEntryPublish.mockResolvedValue({
    sys: { id: 'entry-1' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('publishPhoto', () => {
  it('uploads file and creates published asset and entry', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const result = await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    expect(result).toEqual({ assetId: 'asset-1', entryId: 'entry-1' })
    expect(mockUploadCreate).toHaveBeenCalledTimes(1)
    expect(mockAssetCreate).toHaveBeenCalledTimes(1)
    expect(mockAssetPublish).toHaveBeenCalledTimes(1)
    expect(mockEntryPublish).toHaveBeenCalledTimes(1)
  })

  it('sets correct asset fields from file path', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    const assetFields = mockAssetCreate.mock.calls[0]?.[1].fields
    expect(assetFields.title['en-US']).toBe('Northern Lights')
    expect(assetFields.file['en-US'].contentType).toBe('image/jpeg')
    expect(assetFields.file['en-US'].fileName).toBe('aurora.jpg')
    expect(assetFields.file['en-US'].uploadFrom.sys.id).toBe('upload-1')
  })

  it('creates entry with merged metadata and slugified title', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    expect(mockEntryCreate).toHaveBeenCalledWith(
      { contentTypeId: 'photo' },
      expect.objectContaining({
        fields: expect.objectContaining({
          title: { 'en-US': 'Northern Lights' },
          slug: { 'en-US': 'northern-lights' },
          caption: { 'en-US': 'Aurora borealis dancing across the sky' },
          tags: { 'en-US': ['aurora', 'iceland', 'night'] },
          featured: { 'en-US': false },
          seoMetaTitle: { 'en-US': 'Northern Lights' },
          seoMetaDescription: { 'en-US': 'Aurora borealis dancing across the sky' },
        }),
      }),
    )
  })

  it('links resolved collection in entry', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({
      items: [{ sys: { id: 'collection-iceland' } }],
    })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.collections['en-US']).toEqual([
      {
        sys: { type: 'Link', linkType: 'Entry', id: 'collection-iceland' },
      },
    ])
  })

  it('omits collection link when not found', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.collections).toBeUndefined()
  })

  it('uses user edits over AI metadata when present', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const sidecar = makeSidecar({
      userEdits: {
        title: 'Custom Title',
        caption: 'My custom caption',
        tags: ['custom-tag'],
      },
    })

    await publishPhoto('/photos/iceland/aurora.jpg', sidecar, makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.title['en-US']).toBe('Custom Title')
    expect(fields.slug['en-US']).toBe('custom-title')
    expect(fields.caption['en-US']).toBe('My custom caption')
    expect(fields.tags['en-US']).toEqual(['custom-tag'])
  })

  it('includes EXIF data in entry fields', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.camera['en-US']).toBe('Sony ILCE-7M4')
    expect(fields.lens['en-US']).toBe('FE 24-70mm F2.8 GM II')
    expect(fields.aperture['en-US']).toBe('f/8')
    expect(fields.shutterSpeed['en-US']).toBe('1/250')
    expect(fields.iso['en-US']).toBe(100)
    expect(fields.focalLength['en-US']).toBe('35mm')
    expect(fields.dateTaken['en-US']).toBe('2026-03-15T14:30:00.000Z')
  })

  it('sets seoOgImage to the uploaded asset', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.seoOgImage['en-US']).toEqual({
      sys: { type: 'Link', linkType: 'Asset', id: 'asset-1' },
    })
  })

  it('uses AI seoTitle and seoDescription when provided', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const sidecar = makeSidecar({
      ai: {
        title: 'Northern Lights',
        caption: 'Aurora borealis dancing across the sky',
        tags: ['aurora', 'iceland', 'night'],
        seoTitle: 'Northern Lights Aurora Iceland Photography',
        seoDescription: 'Stunning aurora borealis over Iceland. Fine art landscape photography.',
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-03-15T15:00:00.000Z',
      },
    })

    await publishPhoto('/photos/iceland/aurora.jpg', sidecar, makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.seoMetaTitle['en-US']).toBe('Northern Lights Aurora Iceland Photography')
    expect(fields.seoMetaDescription['en-US']).toBe(
      'Stunning aurora borealis over Iceland. Fine art landscape photography.',
    )
  })

  it('omits null EXIF fields from entry', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const sidecar = makeSidecar({
      exif: {
        camera: null,
        lens: null,
        aperture: null,
        shutterSpeed: null,
        iso: null,
        focalLength: null,
        dateTaken: null,
        gps: null,
      },
    })

    await publishPhoto('/photos/iceland/aurora.jpg', sidecar, makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.camera).toBeUndefined()
    expect(fields.lens).toBeUndefined()
    expect(fields.aperture).toBeUndefined()
    expect(fields.shutterSpeed).toBeUndefined()
    expect(fields.iso).toBeUndefined()
    expect(fields.focalLength).toBeUndefined()
    expect(fields.dateTaken).toBeUndefined()
  })

  it('omits tags when empty array', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const sidecar = makeSidecar({
      ai: {
        title: 'No Tags',
        caption: 'A photo with no tags',
        tags: [],
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-03-15T15:00:00.000Z',
      },
    })

    await publishPhoto('/photos/iceland/aurora.jpg', sidecar, makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.tags).toBeUndefined()
  })

  it('maps .png extension to image/png', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.png', makeSidecar(), makeConfig())

    const assetFields = mockAssetCreate.mock.calls[0]?.[1].fields
    expect(assetFields.file['en-US'].contentType).toBe('image/png')
  })

  it('maps .webp extension to image/webp', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.webp', makeSidecar(), makeConfig())

    const assetFields = mockAssetCreate.mock.calls[0]?.[1].fields
    expect(assetFields.file['en-US'].contentType).toBe('image/webp')
  })

  it('falls back to octet-stream for unknown extension', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.bmp', makeSidecar(), makeConfig())

    const assetFields = mockAssetCreate.mock.calls[0]?.[1].fields
    expect(assetFields.file['en-US'].contentType).toBe('application/octet-stream')
  })
})

describe('listCollections', () => {
  it('returns mapped collection entries', async () => {
    mockEntryGetMany.mockResolvedValue({
      items: [
        {
          sys: { id: 'c1' },
          fields: {
            title: { 'en-US': 'Iceland' },
            slug: { 'en-US': 'iceland' },
          },
        },
        {
          sys: { id: 'c2' },
          fields: {
            title: { 'en-US': 'Norway' },
            slug: { 'en-US': 'norway' },
          },
        },
      ],
    })

    const result = await listCollections(makeConfig())

    expect(result).toEqual([
      { id: 'c1', title: 'Iceland', slug: 'iceland' },
      { id: 'c2', title: 'Norway', slug: 'norway' },
    ])
  })

  it('returns empty array when no collections exist', async () => {
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const result = await listCollections(makeConfig())

    expect(result).toEqual([])
  })
})

describe('createCollection', () => {
  it('creates entry with title and slug then publishes', async () => {
    mockEntryCreate.mockResolvedValue({
      sys: { id: 'new-collection-1' },
    })
    mockEntryPublish.mockResolvedValue({
      sys: { id: 'new-collection-1' },
    })

    const id = await createCollection(makeConfig(), 'New Zealand')

    expect(mockEntryCreate).toHaveBeenCalledWith(
      { contentTypeId: 'collection' },
      {
        fields: {
          title: { 'en-US': 'New Zealand' },
          slug: { 'en-US': 'new-zealand' },
        },
      },
    )
    expect(mockEntryPublish).toHaveBeenCalledWith(
      { entryId: 'new-collection-1' },
      { sys: { id: 'new-collection-1' } },
    )
    expect(id).toBe('new-collection-1')
  })
})

describe('checkSlugExists', () => {
  it('returns entryId when slug matches an existing photo', async () => {
    mockEntryGetMany.mockResolvedValue({
      items: [{ sys: { id: 'existing-photo-1' } }],
    })

    const result = await checkSlugExists(makeConfig(), 'northern-lights')

    expect(result).toBe('existing-photo-1')
    expect(mockEntryGetMany).toHaveBeenCalledWith({
      query: {
        content_type: 'photo',
        'fields.slug': 'northern-lights',
        limit: 1,
      },
    })
  })

  it('returns null when no matching slug exists', async () => {
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const result = await checkSlugExists(makeConfig(), 'nonexistent-slug')

    expect(result).toBeNull()
  })
})

describe('findCollection', () => {
  it('returns collection ID when slug matches', async () => {
    mockEntryGetMany.mockResolvedValue({
      items: [{ sys: { id: 'collection-iceland' } }],
    })

    const result = await findCollection(makeConfig(), 'iceland')

    expect(result).toBe('collection-iceland')
  })

  it('returns null when no matching collection exists', async () => {
    mockEntryGetMany.mockResolvedValue({ items: [] })

    const result = await findCollection(makeConfig(), 'nonexistent')

    expect(result).toBeNull()
  })
})

describe('publishPhoto with collectionId option', () => {
  it('uses provided collectionId instead of resolving from sidecar', async () => {
    setupPublishMocks()

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig(), {
      collectionId: 'pre-resolved-collection',
    })

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.collections['en-US']).toEqual([
      { sys: { type: 'Link', linkType: 'Entry', id: 'pre-resolved-collection' } },
    ])
    // Should NOT have queried for collection since we provided the ID
    expect(mockEntryGetMany).not.toHaveBeenCalled()
  })

  it('omits collection link when collectionId is null', async () => {
    setupPublishMocks()

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig(), {
      collectionId: null,
    })

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.collections).toBeUndefined()
    expect(mockEntryGetMany).not.toHaveBeenCalled()
  })
})

function makeCollectionEntry(overrides?: {
  photos?: unknown[]
  coverPhoto?: unknown
  seoOgImage?: unknown
}) {
  return {
    sys: { id: 'collection-1', version: 3 },
    fields: {
      title: { 'en-US': 'Iceland' },
      slug: { 'en-US': 'iceland' },
      ...(overrides?.photos !== undefined ? { photos: { 'en-US': overrides.photos } } : {}),
      ...(overrides?.coverPhoto !== undefined
        ? { coverPhoto: { 'en-US': overrides.coverPhoto } }
        : {}),
      ...(overrides?.seoOgImage !== undefined
        ? { seoOgImage: { 'en-US': overrides.seoOgImage } }
        : {}),
    },
  }
}

describe('updateCollectionWithPhoto', () => {
  it('appends photo to empty collection photos array', async () => {
    const collection = makeCollectionEntry()
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue({ ...collection, sys: { ...collection.sys, version: 4 } })
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    const updateCall = mockEntryUpdate.mock.calls[0]
    expect(updateCall?.[0]).toEqual({ entryId: 'collection-1' })
    const updatedFields = updateCall?.[1].fields
    expect(updatedFields.photos['en-US']).toEqual([
      { sys: { type: 'Link', linkType: 'Entry', id: 'photo-1' } },
    ])
  })

  it('appends photo to existing collection photos array', async () => {
    const existingLink = { sys: { type: 'Link', linkType: 'Entry', id: 'existing-photo' } }
    const collection = makeCollectionEntry({ photos: [existingLink] })
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue({ ...collection, sys: { ...collection.sys, version: 4 } })
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    const updatedFields = mockEntryUpdate.mock.calls[0]?.[1].fields
    expect(updatedFields.photos['en-US']).toHaveLength(2)
    expect(updatedFields.photos['en-US'][1]).toEqual({
      sys: { type: 'Link', linkType: 'Entry', id: 'photo-1' },
    })
  })

  it('sets coverPhoto when none exists', async () => {
    const collection = makeCollectionEntry()
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue({ ...collection, sys: { ...collection.sys, version: 4 } })
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    const updatedFields = mockEntryUpdate.mock.calls[0]?.[1].fields
    expect(updatedFields.coverPhoto['en-US']).toEqual({
      sys: { type: 'Link', linkType: 'Entry', id: 'photo-1' },
    })
  })

  it('does not overwrite existing coverPhoto', async () => {
    const existingCover = { sys: { type: 'Link', linkType: 'Entry', id: 'cover-photo' } }
    const collection = makeCollectionEntry({ coverPhoto: existingCover })
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue({ ...collection, sys: { ...collection.sys, version: 4 } })
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    const updatedFields = mockEntryUpdate.mock.calls[0]?.[1].fields
    expect(updatedFields.coverPhoto['en-US']).toEqual(existingCover)
  })

  it('sets seoOgImage when none exists', async () => {
    const collection = makeCollectionEntry()
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue({ ...collection, sys: { ...collection.sys, version: 4 } })
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    const updatedFields = mockEntryUpdate.mock.calls[0]?.[1].fields
    expect(updatedFields.seoOgImage['en-US']).toEqual({
      sys: { type: 'Link', linkType: 'Asset', id: 'asset-1' },
    })
  })

  it('does not overwrite existing seoOgImage', async () => {
    const existingOg = { sys: { type: 'Link', linkType: 'Asset', id: 'existing-asset' } }
    const collection = makeCollectionEntry({ seoOgImage: existingOg })
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue({ ...collection, sys: { ...collection.sys, version: 4 } })
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    const updatedFields = mockEntryUpdate.mock.calls[0]?.[1].fields
    expect(updatedFields.seoOgImage['en-US']).toEqual(existingOg)
  })

  it('is idempotent when photo already linked', async () => {
    const existingLink = { sys: { type: 'Link', linkType: 'Entry', id: 'photo-1' } }
    const collection = makeCollectionEntry({ photos: [existingLink] })
    mockEntryGet.mockResolvedValue(collection)

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    expect(mockEntryUpdate).not.toHaveBeenCalled()
    expect(mockEntryPublish).not.toHaveBeenCalled()
  })

  it('re-publishes collection after update', async () => {
    const collection = makeCollectionEntry()
    const updatedCollection = { ...collection, sys: { ...collection.sys, version: 4 } }
    mockEntryGet.mockResolvedValue(collection)
    mockEntryUpdate.mockResolvedValue(updatedCollection)
    mockEntryPublish.mockResolvedValue({})

    await updateCollectionWithPhoto(makeConfig(), 'collection-1', 'photo-1', 'asset-1')

    expect(mockEntryPublish).toHaveBeenCalledWith({ entryId: 'collection-1' }, updatedCollection)
  })
})
