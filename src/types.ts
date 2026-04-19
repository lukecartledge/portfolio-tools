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

/** Contentful publishing state */
export interface ContentfulState {
  assetId: string | null
  entryId: string | null
  publishedAt: string | null
}

/** Sidecar JSON file structure — lives alongside each photo */
export interface Sidecar {
  status: SidecarStatus
  source: string
  collection: string
  exif: ExifData
  ai: AiMetadata
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

/** Photo with full metadata (sidecar loaded) */
export interface PhotoWithMetadata extends PhotoFile {
  sidecar: Sidecar
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
