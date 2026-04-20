import { vi, describe, test, expect, beforeEach } from 'vitest'

const mockReaddir = vi.fn()
const mockStat = vi.fn()
vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args) as unknown,
  stat: (...args: unknown[]) => mockStat(...args) as unknown,
}))

const mockSpinner = { start: vi.fn(), stop: vi.fn() }
vi.mock('@clack/prompts', () => ({
  spinner: () => mockSpinner,
}))

const mockHasSidecar = vi.fn()
const mockSidecarPathFor = vi.fn()
const mockReadSidecar = vi.fn()
const mockWriteSidecar = vi.fn()
const mockCreateEmptySidecar = vi.fn()
vi.mock('../sidecar.js', () => ({
  hasSidecar: (...args: unknown[]) => mockHasSidecar(...args) as unknown,
  sidecarPathFor: (...args: unknown[]) => mockSidecarPathFor(...args) as unknown,
  readSidecar: (...args: unknown[]) => mockReadSidecar(...args) as unknown,
  writeSidecar: (...args: unknown[]) => mockWriteSidecar(...args) as unknown,
  createEmptySidecar: (...args: unknown[]) => mockCreateEmptySidecar(...args) as unknown,
}))

const mockAnalyzePhoto = vi.fn()
vi.mock('../analyzer.js', () => ({
  analyzePhoto: (...args: unknown[]) => mockAnalyzePhoto(...args) as unknown,
}))

vi.mock('../logger.js', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runAnalyze } from './analyze.js'
import type { Config } from '../config.js'
import type { Sidecar } from '../types.js'

function makeConfig(): Config {
  return {
    watchDir: '/photos',
    port: 3000,
    contentful: {
      spaceId: 'space',
      environment: 'master',
      managementToken: 'token',
    },
    anthropic: { apiKey: 'key' },
  } as Config
}

function makeSidecar(overrides?: Partial<Sidecar>): Sidecar {
  return {
    schemaVersion: 1,
    status: 'approved',
    source: 'photo.jpg',
    collection: 'iceland',
    exif: {
      camera: 'Canon EOS R5',
      lens: 'RF 24-70mm',
      aperture: 'f/8',
      shutterSpeed: '1/250',
      iso: 200,
      focalLength: '35mm',
      dateTaken: '2025-06-15T14:30:00Z',
      gps: null,
    },
    ai: {
      title: 'Old Title',
      caption: 'Old caption',
      tags: ['old-tag'],
      seoTitle: 'Old SEO Title',
      seoDescription: 'Old SEO description',
      model: 'claude-sonnet-4-6',
      generatedAt: '2025-06-15T00:00:00Z',
    },
    userEdits: {
      title: 'Human Title',
      tags: ['human-tag'],
    },
    contentful: {
      assetId: 'asset-123',
      entryId: 'entry-456',
      publishedAt: '2025-06-16T00:00:00Z',
    },
    ...overrides,
  }
}

const aiResult = {
  exif: {
    camera: 'Canon EOS R5',
    lens: 'RF 24-70mm',
    aperture: 'f/8',
    shutterSpeed: '1/250',
    iso: 200,
    focalLength: '35mm',
    dateTaken: '2025-06-15T14:30:00Z',
    gps: null,
  },
  ai: {
    title: 'New Title',
    caption: 'New caption',
    tags: ['new-tag', 'iceland'],
    seoTitle: 'New SEO Title',
    seoDescription: 'New SEO description',
    model: 'claude-sonnet-4-6',
    generatedAt: '2025-07-01T00:00:00Z',
  },
}

beforeEach(() => {
  vi.clearAllMocks()

  mockReaddir.mockImplementation((dir: string) => {
    if (dir === '/photos') return Promise.resolve(['iceland'])
    if (dir === '/photos/iceland') return Promise.resolve(['photo.jpg', 'photo.json'])
    return Promise.resolve([])
  })
  mockStat.mockResolvedValue({ isDirectory: () => true })
  mockSidecarPathFor.mockReturnValue('/photos/iceland/photo.json')
  mockCreateEmptySidecar.mockReturnValue({
    schemaVersion: 1,
    status: 'pending',
    source: 'photo.jpg',
    collection: 'iceland',
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
    ai: { title: '', caption: '', tags: [], model: '', generatedAt: '' },
    contentful: { assetId: null, entryId: null, publishedAt: null },
  })
  mockAnalyzePhoto.mockResolvedValue(aiResult)
  mockWriteSidecar.mockResolvedValue(undefined)
})

describe('runAnalyze', () => {
  test('skips photos with existing sidecars by default', async () => {
    mockHasSidecar.mockReturnValue(true)

    await runAnalyze(makeConfig())

    expect(mockAnalyzePhoto).not.toHaveBeenCalled()
    expect(mockWriteSidecar).not.toHaveBeenCalled()
  })

  test('analyzes photos without sidecars', async () => {
    mockHasSidecar.mockReturnValue(false)

    await runAnalyze(makeConfig())

    expect(mockAnalyzePhoto).toHaveBeenCalledOnce()
    expect(mockWriteSidecar).toHaveBeenCalledOnce()
    const written = mockWriteSidecar.mock.calls[0]![1] as Sidecar
    expect(written.ai.title).toBe('New Title')
    expect(written.status).toBe('pending')
  })

  test('--force re-analyzes photos with existing sidecars', async () => {
    mockHasSidecar.mockReturnValue(true)
    mockReadSidecar.mockResolvedValue(makeSidecar())

    await runAnalyze(makeConfig(), { force: true })

    expect(mockAnalyzePhoto).toHaveBeenCalledOnce()
    expect(mockWriteSidecar).toHaveBeenCalledOnce()
  })

  test('--force preserves userEdits from existing sidecar', async () => {
    mockHasSidecar.mockReturnValue(true)
    mockReadSidecar.mockResolvedValue(makeSidecar())

    await runAnalyze(makeConfig(), { force: true })

    const written = mockWriteSidecar.mock.calls[0]![1] as Sidecar
    expect(written.userEdits).toEqual({
      title: 'Human Title',
      tags: ['human-tag'],
    })
  })

  test('--force preserves contentful state from existing sidecar', async () => {
    mockHasSidecar.mockReturnValue(true)
    mockReadSidecar.mockResolvedValue(makeSidecar())

    await runAnalyze(makeConfig(), { force: true })

    const written = mockWriteSidecar.mock.calls[0]![1] as Sidecar
    expect(written.contentful).toEqual({
      assetId: 'asset-123',
      entryId: 'entry-456',
      publishedAt: '2025-06-16T00:00:00Z',
    })
  })

  test('--force resets status to pending', async () => {
    mockHasSidecar.mockReturnValue(true)
    mockReadSidecar.mockResolvedValue(makeSidecar({ status: 'published' }))

    await runAnalyze(makeConfig(), { force: true })

    const written = mockWriteSidecar.mock.calls[0]![1] as Sidecar
    expect(written.status).toBe('pending')
  })

  test('--force updates ai fields with new analysis', async () => {
    mockHasSidecar.mockReturnValue(true)
    mockReadSidecar.mockResolvedValue(makeSidecar())

    await runAnalyze(makeConfig(), { force: true })

    const written = mockWriteSidecar.mock.calls[0]![1] as Sidecar
    expect(written.ai.title).toBe('New Title')
    expect(written.ai.caption).toBe('New caption')
    expect(written.ai.tags).toEqual(['new-tag', 'iceland'])
  })

  test('--force updates exif fields from current file', async () => {
    mockHasSidecar.mockReturnValue(true)
    const old = makeSidecar()
    old.exif.camera = 'Old Camera'
    mockReadSidecar.mockResolvedValue(old)

    await runAnalyze(makeConfig(), { force: true })

    const written = mockWriteSidecar.mock.calls[0]![1] as Sidecar
    expect(written.exif.camera).toBe('Canon EOS R5')
  })

  test('--force does not write empty sidecar on failure', async () => {
    mockHasSidecar.mockReturnValue(true)
    mockReadSidecar.mockResolvedValue(makeSidecar())
    mockAnalyzePhoto.mockRejectedValue(new Error('API error'))

    await runAnalyze(makeConfig(), { force: true })

    expect(mockWriteSidecar).not.toHaveBeenCalled()
  })

  test('without --force writes empty sidecar on failure for new photos', async () => {
    mockHasSidecar.mockReturnValue(false)
    mockAnalyzePhoto.mockRejectedValue(new Error('API error'))

    await runAnalyze(makeConfig())

    expect(mockWriteSidecar).toHaveBeenCalledOnce()
  })
})
