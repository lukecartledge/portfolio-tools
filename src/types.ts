export const CURRENT_SCHEMA_VERSION = 1

export type SidecarStatus = 'pending' | 'approved' | 'published'

export interface ExifData {
  camera: string | null
  lens: string | null
  aperture: string | null
  shutterSpeed: string | null
  iso: number | null
  focalLength: string | null
  dateTaken: string | null
  gps: { lat: number; lng: number } | null
}

/** AI-generated metadata */
export interface AiMetadata {
  title: string
  caption: string
  tags: string[]
  model: string
  generatedAt: string
}

/** Human corrections to AI-generated metadata */
export interface UserEdits {
  title?: string
  caption?: string
  tags?: string[]
}

/** Contentful publishing state */
export interface ContentfulState {
  assetId: string | null
  entryId: string | null
  publishedAt: string | null
}

/** Sidecar JSON file structure — lives alongside each photo */
export interface Sidecar {
  schemaVersion: number
  status: SidecarStatus
  source: string
  collection: string
  exif: ExifData
  ai: AiMetadata
  userEdits?: UserEdits
  contentful: ContentfulState
}

/** Photo with its filesystem context */
export interface PhotoFile {
  /** Absolute path to the image file */
  filePath: string
  /** Filename without extension */
  name: string
  /** Collection name (parent folder name) */
  collection: string
  /** Absolute path to the sidecar JSON */
  sidecarPath: string
}

/** Effective metadata after merging AI output with user edits */
export interface EffectiveMetadata {
  title: string
  caption: string
  tags: string[]
}

/** Photo with full metadata (sidecar loaded) */
export interface PhotoWithMetadata extends PhotoFile {
  sidecar: Sidecar
  /** Merged AI + userEdits for display/publishing */
  effective: EffectiveMetadata
  /** Base64 thumbnail for UI display */
  thumbnail?: string
}

/** API response wrapper */
export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Contentful photo entry fields (for creation) */
export interface ContentfulPhotoFields {
  title: string
  slug: string
  image: { sys: { type: 'Link'; linkType: 'Asset'; id: string } }
  caption?: string
  location?: string
  dateTaken?: string
  camera?: string
  lens?: string
  aperture?: string
  shutterSpeed?: string
  iso?: number
  focalLength?: string
  tags?: string[]
  collections?: Array<{ sys: { type: 'Link'; linkType: 'Entry'; id: string } }>
  featured?: boolean
  displayOrder?: number
}

/** Merge AI metadata with user edits (user edits take precedence) */
export function mergeMetadata(ai: AiMetadata, userEdits?: UserEdits): EffectiveMetadata {
  return {
    title: userEdits?.title ?? ai.title,
    caption: userEdits?.caption ?? ai.caption,
    tags: userEdits?.tags ?? ai.tags,
  }
}
