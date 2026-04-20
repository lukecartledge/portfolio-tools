import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from '../config.js'
import type { Sidecar, ApiResponse, PhotoWithMetadata } from '../types.js'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('../sidecar.js', () => ({
  sidecarPathFor: vi.fn((p: string) => p.replace(/\.\w+$/, '.json')),
  readSidecar: vi.fn(),
  writeSidecar: vi.fn().mockResolvedValue(undefined),
  hasSidecar: vi.fn(),
  patchSidecar: vi.fn(),
  markPublished: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../publisher.js', () => ({
  publishPhoto: vi.fn(),
  listCollections: vi.fn(),
  createCollection: vi.fn(),
}))

vi.mock('sharp', () => {
  const toBufferMock = vi.fn().mockResolvedValue(Buffer.from('fake-thumbnail'))
  return {
    default: vi.fn(() => ({
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: toBufferMock,
    })),
  }
})

import { readdir, stat } from 'node:fs/promises'
import { readSidecar, writeSidecar, hasSidecar, patchSidecar, markPublished } from '../sidecar.js'
import { publishPhoto, listCollections, createCollection } from '../publisher.js'
import sharp from 'sharp'

const { createApi } = await import('./api.js')

function makeConfig(): Config {
  return {
    contentful: {
      spaceId: 'space-1',
      environment: 'master',
      managementToken: 'cma-token',
    },
    anthropic: { apiKey: 'anthropic-key' },
    watchDir: '/photos',
    port: 3000,
  }
}

function makeSidecar(overrides?: Partial<Sidecar>): Sidecar {
  return {
    schemaVersion: 1,
    status: 'pending',
    source: '/photos/iceland/aurora.jpg',
    collection: 'iceland',
    exif: {
      camera: 'Sony ILCE-7M4',
      lens: null,
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

function setupScanMocks(sidecar: Sidecar) {
  vi.mocked(readdir).mockImplementation(async (dir) => {
    const d = String(dir)
    if (d === '/photos') return ['iceland'] as never
    if (d.endsWith('/iceland')) return ['aurora.jpg'] as never
    return [] as never
  })
  vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
  vi.mocked(hasSidecar).mockReturnValue(true)
  vi.mocked(readSidecar).mockResolvedValue(sidecar)
}

let app: ReturnType<typeof createApi>

beforeEach(() => {
  vi.clearAllMocks()
  app = createApi(makeConfig())
})

describe('GET /api/photos', () => {
  it('returns photos with sidecar data', async () => {
    const sidecar = makeSidecar()
    setupScanMocks(sidecar)

    const res = await app.request('/api/photos')
    const body = (await res.json()) as ApiResponse<PhotoWithMetadata[]>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data![0]!.collection).toBe('iceland')
    expect(body.data![0]!.effective.title).toBe('Northern Lights')
  })

  it('returns empty data when watch directory is missing', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'))

    const res = await app.request('/api/photos')
    const body = (await res.json()) as ApiResponse<PhotoWithMetadata[]>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  })

  it('skips files without sidecars', async () => {
    vi.mocked(readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === '/photos') return ['iceland'] as never
      if (d.endsWith('/iceland')) return ['aurora.jpg', 'sunset.jpg'] as never
      return [] as never
    })
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    vi.mocked(hasSidecar).mockReturnValueOnce(true).mockReturnValueOnce(false)
    vi.mocked(readSidecar).mockResolvedValue(makeSidecar())

    const res = await app.request('/api/photos')
    const body = (await res.json()) as ApiResponse<PhotoWithMetadata[]>

    expect(body.data).toHaveLength(1)
  })

  it('sorts by status then collection name', async () => {
    const approved = makeSidecar({ status: 'approved', collection: 'bbb' })
    const pending = makeSidecar({ status: 'pending', collection: 'aaa' })

    vi.mocked(readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === '/photos') return ['bbb', 'aaa'] as never
      if (d.endsWith('/bbb')) return ['one.jpg'] as never
      if (d.endsWith('/aaa')) return ['two.jpg'] as never
      return [] as never
    })
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    vi.mocked(hasSidecar).mockReturnValue(true)
    vi.mocked(readSidecar).mockResolvedValueOnce(approved).mockResolvedValueOnce(pending)

    const res = await app.request('/api/photos')
    const body = (await res.json()) as ApiResponse<PhotoWithMetadata[]>

    expect(body.data![0]!.sidecar.status).toBe('pending')
    expect(body.data![1]!.sidecar.status).toBe('approved')
  })
})

describe('PATCH /api/photos/:collection/:filename', () => {
  it('patches sidecar with user edits and status', async () => {
    vi.mocked(hasSidecar).mockReturnValue(true)
    vi.mocked(patchSidecar).mockResolvedValue(makeSidecar({ status: 'approved' }))

    const res = await app.request('/api/photos/iceland/aurora.jpg', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        title: 'Custom Title',
        caption: 'Custom caption',
        tags: ['custom'],
      }),
    })
    const body = (await res.json()) as ApiResponse<{ status: string }>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data!.status).toBe('approved')

    const patchCall = vi.mocked(patchSidecar).mock.calls[0]
    expect(patchCall?.[1]).toEqual({
      status: 'approved',
      userEdits: { title: 'Custom Title', caption: 'Custom caption', tags: ['custom'] },
    })
  })

  it('returns 404 when sidecar not found', async () => {
    vi.mocked(hasSidecar).mockReturnValue(false)

    const res = await app.request('/api/photos/iceland/aurora.jpg', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    const body = (await res.json()) as ApiResponse<never>

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Sidecar not found')
  })

  it('patches status only when no user edits provided', async () => {
    vi.mocked(hasSidecar).mockReturnValue(true)
    vi.mocked(patchSidecar).mockResolvedValue(makeSidecar({ status: 'approved' }))

    await app.request('/api/photos/iceland/aurora.jpg', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const patchCall = vi.mocked(patchSidecar).mock.calls[0]
    expect(patchCall?.[1]).toEqual({ status: 'approved' })
  })

  it('round-trips tags through PATCH and GET with effective merge', async () => {
    const editedTags = ['edited-tag', 'new-tag']
    const editedSidecar = makeSidecar({
      userEdits: { tags: editedTags },
    })

    vi.mocked(hasSidecar).mockReturnValue(true)
    vi.mocked(patchSidecar).mockResolvedValue(editedSidecar)

    const patchRes = await app.request('/api/photos/iceland/aurora.jpg', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: editedTags }),
    })
    const patchBody = (await patchRes.json()) as ApiResponse<{ status: string }>
    expect(patchBody.ok).toBe(true)

    const patchCall = vi.mocked(patchSidecar).mock.calls[0]
    expect(patchCall?.[1]).toEqual({ userEdits: { tags: editedTags } })

    setupScanMocks(editedSidecar)

    const getRes = await app.request('/api/photos')
    const getBody = (await getRes.json()) as ApiResponse<PhotoWithMetadata[]>

    expect(getBody.data![0]!.effective.tags).toEqual(editedTags)
  })
})

describe('POST /api/photos/:collection/:filename/approve', () => {
  it('sets status to approved and writes sidecar', async () => {
    const sidecar = makeSidecar({ status: 'pending' })
    vi.mocked(readSidecar).mockResolvedValue(sidecar)

    const res = await app.request('/api/photos/iceland/aurora.jpg/approve', {
      method: 'POST',
    })
    const body = (await res.json()) as ApiResponse<{ status: string }>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data!.status).toBe('approved')
    expect(vi.mocked(writeSidecar)).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/photos/:collection/:filename/publish', () => {
  it('publishes approved photo and updates sidecar', async () => {
    const sidecar = makeSidecar({ status: 'approved' })
    vi.mocked(readSidecar).mockResolvedValue(sidecar)
    vi.mocked(publishPhoto).mockResolvedValue({
      assetId: 'asset-1',
      entryId: 'entry-1',
    })

    const res = await app.request('/api/photos/iceland/aurora.jpg/publish', {
      method: 'POST',
    })
    const body = (await res.json()) as ApiResponse<{ assetId: string; entryId: string }>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({ assetId: 'asset-1', entryId: 'entry-1' })

    expect(vi.mocked(markPublished)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(markPublished)).toHaveBeenCalledWith(
      '/photos/iceland/aurora.jpg'.replace(/\.\w+$/, '.json'),
      sidecar,
      { assetId: 'asset-1', entryId: 'entry-1' },
    )
  })

  it('rejects with 400 when photo is not approved', async () => {
    vi.mocked(readSidecar).mockResolvedValue(makeSidecar({ status: 'pending' }))

    const res = await app.request('/api/photos/iceland/aurora.jpg/publish', {
      method: 'POST',
    })
    const body = (await res.json()) as ApiResponse<never>

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Photo must be approved before publishing')
    expect(vi.mocked(publishPhoto)).not.toHaveBeenCalled()
  })
})

describe('POST /api/collections', () => {
  it('creates collection and returns id', async () => {
    vi.mocked(createCollection).mockResolvedValue('new-collection-1')

    const res = await app.request('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Zealand' }),
    })
    const body = (await res.json()) as ApiResponse<{ id: string }>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data!.id).toBe('new-collection-1')
  })

  it('returns 400 when title is empty', async () => {
    const res = await app.request('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    const body = (await res.json()) as ApiResponse<never>

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Title required')
  })
})

describe('GET /api/collections', () => {
  it('returns list of collections', async () => {
    vi.mocked(listCollections).mockResolvedValue([
      { id: 'c1', title: 'Iceland', slug: 'iceland' },
      { id: 'c2', title: 'Norway', slug: 'norway' },
    ])

    const res = await app.request('/api/collections')
    const body = (await res.json()) as ApiResponse<{ id: string; title: string; slug: string }[]>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.data![0]!.title).toBe('Iceland')
  })
})

describe('GET /api/thumbnail/:collection/:filename', () => {
  it('returns JPEG thumbnail with correct headers', async () => {
    const res = await app.request('/api/thumbnail/iceland/aurora.jpg')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')

    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf).toEqual(Buffer.from('fake-thumbnail'))
    expect(sharp).toHaveBeenCalledWith('/photos/iceland/aurora.jpg')
  })

  it('returns 500 when thumbnail generation fails', async () => {
    vi.mocked(sharp).mockImplementationOnce(() => {
      throw new Error('Sharp failed')
    })

    const res = await app.request('/api/thumbnail/iceland/aurora.jpg')
    const body = (await res.json()) as ApiResponse<never>

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Thumbnail generation failed')
  })
})
