import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  sidecarPathFor,
  hasSidecar,
  readSidecar,
  writeSidecar,
  patchSidecar,
  createEmptySidecar,
  markPublished,
} from './sidecar.js'
import { CURRENT_SCHEMA_VERSION } from './types.js'
import type { Sidecar } from './types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'sidecar-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makeSidecar(overrides?: Partial<Sidecar>): Sidecar {
  return {
    ...createEmptySidecar('photo.jpg', 'iceland'),
    ...overrides,
  }
}

describe('sidecarPathFor', () => {
  it('replaces image extension with .json', () => {
    expect(sidecarPathFor('/photos/iceland/photo.jpg')).toBe('/photos/iceland/photo.json')
  })

  it('handles .jpeg extension', () => {
    expect(sidecarPathFor('/photos/photo.jpeg')).toBe('/photos/photo.json')
  })

  it('handles .tiff extension', () => {
    expect(sidecarPathFor('/photos/photo.tiff')).toBe('/photos/photo.json')
  })

  it('handles .png extension', () => {
    expect(sidecarPathFor('/photos/photo.png')).toBe('/photos/photo.json')
  })

  it('only replaces the last extension', () => {
    expect(sidecarPathFor('/photos/my.photo.jpg')).toBe('/photos/my.photo.json')
  })
})

describe('hasSidecar', () => {
  it('returns false when no sidecar exists', () => {
    expect(hasSidecar(join(tempDir, 'nonexistent.jpg'))).toBe(false)
  })

  it('returns true when sidecar exists', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    expect(hasSidecar(join(tempDir, 'photo.jpg'))).toBe(true)
  })
})

describe('createEmptySidecar', () => {
  it('includes current schema version', () => {
    const sidecar = createEmptySidecar('photo.jpg', 'iceland')
    expect(sidecar.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('sets status to pending', () => {
    const sidecar = createEmptySidecar('photo.jpg', 'iceland')
    expect(sidecar.status).toBe('pending')
  })

  it('sets source and collection', () => {
    const sidecar = createEmptySidecar('sunset.tiff', 'new-zealand')
    expect(sidecar.source).toBe('sunset.tiff')
    expect(sidecar.collection).toBe('new-zealand')
  })

  it('initializes all exif fields as null', () => {
    const sidecar = createEmptySidecar('photo.jpg', 'iceland')
    expect(sidecar.exif).toEqual({
      camera: null,
      lens: null,
      aperture: null,
      shutterSpeed: null,
      iso: null,
      focalLength: null,
      dateTaken: null,
      gps: null,
    })
  })

  it('initializes AI fields as empty', () => {
    const sidecar = createEmptySidecar('photo.jpg', 'iceland')
    expect(sidecar.ai).toEqual({
      title: '',
      caption: '',
      tags: [],
      model: '',
      generatedAt: '',
    })
  })

  it('initializes contentful state as null', () => {
    const sidecar = createEmptySidecar('photo.jpg', 'iceland')
    expect(sidecar.contentful).toEqual({
      assetId: null,
      entryId: null,
      publishedAt: null,
    })
  })

  it('does not include userEdits by default', () => {
    const sidecar = createEmptySidecar('photo.jpg', 'iceland')
    expect(sidecar.userEdits).toBeUndefined()
  })
})

describe('writeSidecar and readSidecar', () => {
  it('round-trips a sidecar through write and read', async () => {
    const original = makeSidecar({
      ai: {
        title: 'Northern Lights',
        caption: 'Aurora borealis over the lagoon',
        tags: ['aurora', 'iceland'],
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-04-19T10:00:00Z',
      },
    })
    const sidecarPath = join(tempDir, 'photo.json')

    await writeSidecar(sidecarPath, original)
    const loaded = await readSidecar(sidecarPath)

    expect(loaded).toEqual(original)
  })

  it('writes valid JSON with trailing newline', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    const raw = await readFile(sidecarPath, 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('writes pretty-printed JSON (2 space indent)', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    const raw = await readFile(sidecarPath, 'utf-8')
    expect(raw).toContain('  "schemaVersion"')
  })
})

describe('readSidecar schema backfill', () => {
  it('backfills schemaVersion when missing from legacy sidecar', async () => {
    const sidecarPath = join(tempDir, 'legacy.json')
    const legacy = makeSidecar()
    const { schemaVersion: _, ...withoutVersion } = legacy
    const { writeFile: rawWrite } = await import('node:fs/promises')
    await rawWrite(sidecarPath, JSON.stringify(withoutVersion, null, 2) + '\n', 'utf-8')

    const loaded = await readSidecar(sidecarPath)
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})

describe('patchSidecar', () => {
  it('updates status without touching other fields', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    const patched = await patchSidecar(sidecarPath, { status: 'approved' })

    expect(patched.status).toBe('approved')
    expect(patched.source).toBe('photo.jpg')
    expect(patched.collection).toBe('iceland')
  })

  it('adds user edits to sidecar without existing edits', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    const patched = await patchSidecar(sidecarPath, {
      userEdits: { title: 'Custom Title' },
    })

    expect(patched.userEdits).toEqual({ title: 'Custom Title' })
  })

  it('merges new user edits with existing ones', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar({ userEdits: { title: 'Old Title' } }))

    const patched = await patchSidecar(sidecarPath, {
      userEdits: { caption: 'New Caption' },
    })

    expect(patched.userEdits).toEqual({
      title: 'Old Title',
      caption: 'New Caption',
    })
  })

  it('overwrites existing user edit field when provided', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(
      sidecarPath,
      makeSidecar({ userEdits: { title: 'Old Title', tags: ['old-tag'] } }),
    )

    const patched = await patchSidecar(sidecarPath, {
      userEdits: { title: 'New Title' },
    })

    expect(patched.userEdits?.title).toBe('New Title')
    expect(patched.userEdits?.tags).toEqual(['old-tag'])
  })

  it('applies both status and user edits in one call', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    const patched = await patchSidecar(sidecarPath, {
      status: 'approved',
      userEdits: { tags: ['aurora', 'night'] },
    })

    expect(patched.status).toBe('approved')
    expect(patched.userEdits).toEqual({ tags: ['aurora', 'night'] })
  })

  it('persists changes to disk', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    await writeSidecar(sidecarPath, makeSidecar())

    await patchSidecar(sidecarPath, { status: 'approved' })

    const reloaded = await readSidecar(sidecarPath)
    expect(reloaded.status).toBe('approved')
  })

  it('returns the full updated sidecar', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    const original = makeSidecar({
      ai: {
        title: 'Test',
        caption: 'Test caption',
        tags: ['test'],
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-04-19T10:00:00Z',
      },
    })
    await writeSidecar(sidecarPath, original)

    const patched = await patchSidecar(sidecarPath, { status: 'approved' })

    expect(patched.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(patched.ai.title).toBe('Test')
    expect(patched.status).toBe('approved')
  })
})

describe('markPublished', () => {
  it('sets status to published and stores contentful IDs', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    const sidecar = makeSidecar({ status: 'approved' })
    await writeSidecar(sidecarPath, sidecar)

    await markPublished(sidecarPath, sidecar, {
      assetId: 'asset_abc',
      entryId: 'entry_xyz',
    })

    expect(sidecar.status).toBe('published')
    expect(sidecar.contentful.assetId).toBe('asset_abc')
    expect(sidecar.contentful.entryId).toBe('entry_xyz')
    expect(sidecar.contentful.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('persists changes to disk', async () => {
    const sidecarPath = join(tempDir, 'photo.json')
    const sidecar = makeSidecar({ status: 'approved' })
    await writeSidecar(sidecarPath, sidecar)

    await markPublished(sidecarPath, sidecar, {
      assetId: 'asset_abc',
      entryId: 'entry_xyz',
    })

    const reloaded = await readSidecar(sidecarPath)
    expect(reloaded.status).toBe('published')
    expect(reloaded.contentful.assetId).toBe('asset_abc')
    expect(reloaded.contentful.entryId).toBe('entry_xyz')
    expect(reloaded.contentful.publishedAt).toBeTruthy()
  })
})
