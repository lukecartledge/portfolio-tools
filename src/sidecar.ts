import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Sidecar } from './types.js'

export function sidecarPathFor(photoPath: string): string {
  return photoPath.replace(/\.[^.]+$/, '.json')
}

/** Check if a sidecar file exists for the given photo */
export function hasSidecar(photoPath: string): boolean {
  return existsSync(sidecarPathFor(photoPath))
}

/** Read and parse a sidecar JSON file */
export async function readSidecar(sidecarPath: string): Promise<Sidecar> {
  const raw = await readFile(sidecarPath, 'utf-8')
  return JSON.parse(raw) as Sidecar
}

/** Write a sidecar JSON file (pretty-printed) */
export async function writeSidecar(sidecarPath: string, sidecar: Sidecar): Promise<void> {
  await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf-8')
}

/** Create a fresh sidecar with default values */
export function createEmptySidecar(source: string, collection: string): Sidecar {
  return {
    status: 'pending',
    source,
    collection,
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
    ai: {
      title: '',
      caption: '',
      tags: [],
      model: '',
      generatedAt: '',
    },
    contentful: {
      assetId: null,
      entryId: null,
      publishedAt: null,
    },
  }
}
