import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExifData } from './types.js'

vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(),
  },
}))

vi.mock('sharp', () => {
  const resizeMock = vi.fn().mockReturnThis()
  const jpegMock = vi.fn().mockReturnThis()
  const toBufferMock = vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-data'))
  const sharpFn = vi.fn(() => ({
    resize: resizeMock,
    jpeg: jpegMock,
    toBuffer: toBufferMock,
  }))
  return {
    default: Object.assign(sharpFn, { resize: resizeMock, jpeg: jpegMock, toBuffer: toBufferMock }),
  }
})

const anthropicCreateMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: anthropicCreateMock }
    },
  }
})

import exifr from 'exifr'
import sharp from 'sharp'

const { extractExif, analyzeWithVision, analyzePhoto } = await import('./analyzer.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractExif', () => {
  it('returns formatted EXIF data from raw values', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({
      Make: 'Sony',
      Model: 'ILCE-7M4',
      LensModel: 'FE 24-70mm F2.8 GM II',
      FNumber: 8,
      ExposureTime: 1 / 250,
      ISO: 100,
      FocalLength: 35,
      DateTimeOriginal: new Date('2026-03-15T14:30:00Z'),
      latitude: 64.0,
      longitude: -20.0,
    })

    const result = await extractExif('/photos/iceland/photo.jpg')

    expect(result.camera).toBe('Sony ILCE-7M4')
    expect(result.lens).toBe('FE 24-70mm F2.8 GM II')
    expect(result.aperture).toBe('f/8')
    expect(result.shutterSpeed).toBe('1/250')
    expect(result.iso).toBe(100)
    expect(result.focalLength).toBe('35mm')
    expect(result.dateTaken).toBe('2026-03-15T14:30:00.000Z')
    expect(result.gps).toEqual({ lat: 64.0, lng: -20.0 })
  })

  it('does not duplicate make in camera when model starts with make', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({
      Make: 'Canon',
      Model: 'Canon EOS R5',
    })

    const result = await extractExif('/photos/photo.jpg')

    expect(result.camera).toBe('Canon EOS R5')
  })

  it('returns null GPS when coordinates are missing', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({
      Make: 'Sony',
      Model: 'ILCE-7M4',
    })

    const result = await extractExif('/photos/photo.jpg')

    expect(result.gps).toBeNull()
  })

  it('returns null fields when EXIF data is minimal', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({})

    const result = await extractExif('/photos/photo.jpg')

    expect(result.camera).toBeNull()
    expect(result.lens).toBeNull()
    expect(result.aperture).toBeNull()
    expect(result.shutterSpeed).toBeNull()
    expect(result.iso).toBeNull()
    expect(result.focalLength).toBeNull()
    expect(result.dateTaken).toBeNull()
    expect(result.gps).toBeNull()
  })

  it('returns empty EXIF when parse returns null', async () => {
    vi.mocked(exifr.parse).mockResolvedValue(null)

    const result = await extractExif('/photos/photo.jpg')

    expect(result).toEqual<ExifData>({
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

  it('returns empty EXIF when parse throws', async () => {
    vi.mocked(exifr.parse).mockRejectedValue(new Error('Corrupt file'))

    const result = await extractExif('/photos/corrupt.jpg')

    expect(result.camera).toBeNull()
    expect(result.iso).toBeNull()
  })

  it('formats shutter speed >= 1s without fraction', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({ ExposureTime: 2 })

    const result = await extractExif('/photos/photo.jpg')

    expect(result.shutterSpeed).toBe('2s')
  })

  it('uses Lens field as fallback when LensModel missing', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({ Lens: 'EF 50mm f/1.4 USM' })

    const result = await extractExif('/photos/photo.jpg')

    expect(result.lens).toBe('EF 50mm f/1.4 USM')
  })
})

describe('analyzeWithVision', () => {
  it('resizes image before sending to API', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Mountain Vista',
            caption: 'A sweeping view of the mountains',
            tags: ['landscape', 'mountains'],
          }),
        },
      ],
    })

    await analyzeWithVision('/photos/photo.jpg', 'test-api-key')

    expect(sharp).toHaveBeenCalledWith('/photos/photo.jpg')
  })

  it('parses AI response into AiMetadata', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Northern Lights',
            caption: 'Aurora borealis dancing across the sky',
            tags: ['aurora', 'iceland', 'night'],
          }),
        },
      ],
    })

    const result = await analyzeWithVision('/photos/photo.jpg', 'test-api-key')

    expect(result.title).toBe('Northern Lights')
    expect(result.caption).toBe('Aurora borealis dancing across the sky')
    expect(result.tags).toEqual(['aurora', 'iceland', 'night'])
    expect(result.model).toContain('claude')
    expect(result.generatedAt).toBeTruthy()
  })

  it('sends base64 encoded image to Anthropic', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ title: 'Test', caption: 'Test', tags: [] }),
        },
      ],
    })

    await analyzeWithVision('/photos/photo.jpg', 'test-api-key')

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1)
    const callArgs = anthropicCreateMock.mock.calls[0]?.[0]
    expect(callArgs.messages[0].content[0].type).toBe('image')
    expect(callArgs.messages[0].content[0].source.type).toBe('base64')
    expect(callArgs.messages[0].content[1].type).toBe('text')
  })

  it('throws when API response has no text content', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'test', name: 'test', input: {} }],
    })

    await expect(analyzeWithVision('/photos/photo.jpg', 'test-key')).rejects.toThrow()
  })

  it('throws when API returns invalid JSON', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json' }],
    })

    await expect(analyzeWithVision('/photos/photo.jpg', 'test-key')).rejects.toThrow()
  })
})

describe('analyzePhoto', () => {
  it('runs EXIF extraction and vision analysis in parallel', async () => {
    vi.mocked(exifr.parse).mockResolvedValue({
      Make: 'Sony',
      Model: 'ILCE-7M4',
      ISO: 100,
    })

    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Test Photo',
            caption: 'A test photo',
            tags: ['test'],
          }),
        },
      ],
    })

    const result = await analyzePhoto('/photos/photo.jpg', 'test-key')

    expect(result.exif.camera).toBe('Sony ILCE-7M4')
    expect(result.exif.iso).toBe(100)
    expect(result.ai.title).toBe('Test Photo')
    expect(result.ai.tags).toEqual(['test'])
  })
})
