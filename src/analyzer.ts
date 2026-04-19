import exifr from 'exifr'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'
import type { ExifData, AiMetadata, VisionContext } from './types.js'
import { emptyExif } from './types.js'
import { VISION_MODEL, VISION_MAX_DIMENSION } from './config.js'

interface ExifrResult {
  Make?: string
  Model?: string
  LensModel?: string
  Lens?: string
  FNumber?: number
  ExposureTime?: number
  ISO?: number
  FocalLength?: number
  DateTimeOriginal?: Date
  latitude?: number
  longitude?: number
}

export async function extractExif(filePath: string): Promise<ExifData> {
  try {
    const raw = (await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      iptc: true,
    })) as ExifrResult | undefined

    if (!raw) {
      return emptyExif()
    }

    return {
      camera: formatCamera(raw.Make, raw.Model),
      lens: raw.LensModel ?? raw.Lens ?? null,
      aperture: raw.FNumber ? `f/${raw.FNumber}` : null,
      shutterSpeed: formatShutter(raw.ExposureTime),
      iso: raw.ISO ?? null,
      focalLength: raw.FocalLength ? `${raw.FocalLength}mm` : null,
      dateTaken: raw.DateTimeOriginal?.toISOString() ?? null,
      gps:
        raw.latitude != null && raw.longitude != null
          ? { lat: raw.latitude, lng: raw.longitude }
          : null,
    }
  } catch {
    return emptyExif()
  }
}

export async function analyzeWithVision(
  filePath: string,
  apiKey: string,
  context?: VisionContext,
): Promise<AiMetadata> {
  const resized = await sharp(filePath)
    .resize(VISION_MAX_DIMENSION, VISION_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  const base64 = resized.toString('base64')

  const contextLines: string[] = []
  if (context) {
    contextLines.push(`- Collection: "${context.collection}"`)
    contextLines.push(`- Filename: "${context.filename}"`)
    if (context.dateTaken) contextLines.push(`- Date taken: ${context.dateTaken}`)
    if (context.gps) contextLines.push(`- GPS coordinates: ${context.gps.lat}, ${context.gps.lng}`)
  }

  const contextBlock =
    contextLines.length > 0 ? `\n\nContext about this photo:\n${contextLines.join('\n')}\n` : ''

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          {
            type: 'text',
            text: `You are cataloging a landscape/travel photograph for a portfolio website.${contextBlock}
Respond with ONLY valid JSON, no markdown fencing:
{
  "title": "Short evocative title (3-7 words, no quotes in the title)",
  "caption": "One or two sentences describing the scene, mood, and notable elements. Written for a photography portfolio — concise, atmospheric, not technical.",
  "tags": ["tag1", "tag2", ...] // 4-8 lowercase single-word or hyphenated tags (e.g. "landscape", "golden-hour", "mountains")
}`,
          },
        ],
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  const parsed = JSON.parse(text) as { title: string; caption: string; tags: string[] }

  const tags = [...parsed.tags]
  if (context) {
    const collectionTag = deriveCollectionTag(context.collection)
    if (collectionTag && !tags.includes(collectionTag)) {
      tags.push(collectionTag)
    }
  }

  return {
    title: parsed.title,
    caption: parsed.caption,
    tags,
    model: VISION_MODEL,
    generatedAt: new Date().toISOString(),
  }
}

export async function analyzePhoto(
  filePath: string,
  apiKey: string,
  context?: { collection: string; filename: string },
): Promise<{ exif: ExifData; ai: AiMetadata }> {
  const exif = await extractExif(filePath)

  const visionContext: VisionContext | undefined = context
    ? { ...context, dateTaken: exif.dateTaken, gps: exif.gps }
    : undefined

  const ai = await analyzeWithVision(filePath, apiKey, visionContext)
  return { exif, ai }
}

/** Derive a lowercase-hyphenated tag from a collection folder name */
export function deriveCollectionTag(collection: string): string {
  return collection
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatCamera(make: string | undefined, model: string | undefined): string | null {
  if (!model) return null
  if (make && !model.startsWith(make)) {
    return `${make} ${model}`
  }
  return model
}

function formatShutter(exposureTime: number | undefined): string | null {
  if (exposureTime == null) return null
  if (exposureTime >= 1) return `${exposureTime}s`
  return `1/${Math.round(1 / exposureTime)}`
}
