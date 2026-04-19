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
  mockEntryGetMany,
  mockEntryPublish,
  mockClient,
} = vi.hoisted(() => {
  const mockUploadCreate = vi.fn()
  const mockAssetCreate = vi.fn()
  const mockAssetGet = vi.fn()
  const mockAssetPublish = vi.fn()
  const mockAssetProcessForAllLocales = vi.fn()
  const mockEntryCreate = vi.fn()
  const mockEntryGetMany = vi.fn()
  const mockEntryPublish = vi.fn()

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
      getMany: mockEntryGetMany,
      publish: mockEntryPublish,
    },
  }

  return {
    mockUploadCreate,
    mockAssetCreate,
    mockAssetGet,
    mockAssetPublish,
    mockAssetProcessForAllLocales,
    mockEntryCreate,
    mockEntryGetMany,
    mockEntryPublish,
    mockClient,
  }
})

vi.mock('contentful-management', () => ({
  default: {
    createClient: vi.fn(() => mockClient),
  },
}))

const { publishPhoto, listCollections, createCollection } = await import('./publisher.js')

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
      model: 'claude-sonnet-4-20250514',
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
      file: { 'en-GB': { url: '//images.ctfassets.net/asset-1.jpg' } },
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
    expect(assetFields.title['en-GB']).toBe('Northern Lights')
    expect(assetFields.file['en-GB'].contentType).toBe('image/jpeg')
    expect(assetFields.file['en-GB'].fileName).toBe('aurora.jpg')
    expect(assetFields.file['en-GB'].uploadFrom.sys.id).toBe('upload-1')
  })

  it('creates entry with merged metadata and slugified title', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    expect(mockEntryCreate).toHaveBeenCalledWith(
      { contentTypeId: 'photo' },
      expect.objectContaining({
        fields: expect.objectContaining({
          title: { 'en-GB': 'Northern Lights' },
          slug: { 'en-GB': 'northern-lights' },
          caption: { 'en-GB': 'Aurora borealis dancing across the sky' },
          tags: { 'en-GB': ['aurora', 'iceland', 'night'] },
          featured: { 'en-GB': false },
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
    expect(fields.collections['en-GB']).toEqual([
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
    expect(fields.title['en-GB']).toBe('Custom Title')
    expect(fields.slug['en-GB']).toBe('custom-title')
    expect(fields.caption['en-GB']).toBe('My custom caption')
    expect(fields.tags['en-GB']).toEqual(['custom-tag'])
  })

  it('includes EXIF data in entry fields', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.jpg', makeSidecar(), makeConfig())

    const fields = mockEntryCreate.mock.calls[0]?.[1].fields
    expect(fields.camera['en-GB']).toBe('Sony ILCE-7M4')
    expect(fields.lens['en-GB']).toBe('FE 24-70mm F2.8 GM II')
    expect(fields.aperture['en-GB']).toBe('f/8')
    expect(fields.shutterSpeed['en-GB']).toBe('1/250')
    expect(fields.iso['en-GB']).toBe(100)
    expect(fields.focalLength['en-GB']).toBe('35mm')
    expect(fields.dateTaken['en-GB']).toBe('2026-03-15T14:30:00.000Z')
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
        model: 'claude-sonnet-4-20250514',
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
    expect(assetFields.file['en-GB'].contentType).toBe('image/png')
  })

  it('maps .webp extension to image/webp', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.webp', makeSidecar(), makeConfig())

    const assetFields = mockAssetCreate.mock.calls[0]?.[1].fields
    expect(assetFields.file['en-GB'].contentType).toBe('image/webp')
  })

  it('falls back to octet-stream for unknown extension', async () => {
    setupPublishMocks()
    mockEntryGetMany.mockResolvedValue({ items: [] })

    await publishPhoto('/photos/iceland/aurora.bmp', makeSidecar(), makeConfig())

    const assetFields = mockAssetCreate.mock.calls[0]?.[1].fields
    expect(assetFields.file['en-GB'].contentType).toBe('application/octet-stream')
  })
})

describe('listCollections', () => {
  it('returns mapped collection entries', async () => {
    mockEntryGetMany.mockResolvedValue({
      items: [
        {
          sys: { id: 'c1' },
          fields: {
            title: { 'en-GB': 'Iceland' },
            slug: { 'en-GB': 'iceland' },
          },
        },
        {
          sys: { id: 'c2' },
          fields: {
            title: { 'en-GB': 'Norway' },
            slug: { 'en-GB': 'norway' },
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
          title: { 'en-GB': 'New Zealand' },
          slug: { 'en-GB': 'new-zealand' },
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
