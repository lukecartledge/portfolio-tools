import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Sidecar, UserEdits } from './types.js'
import { CURRENT_SCHEMA_VERSION } from './types.js'

export function sidecarPathFor(photoPath: string): string {
  return photoPath.replace(/\.[^.]+$/, '.json')
}

export function hasSidecar(photoPath: string): boolean {
  return existsSync(sidecarPathFor(photoPath))
}

export async function readSidecar(sidecarPath: string): Promise<Sidecar> {
  const raw = await readFile(sidecarPath, 'utf-8')
  const parsed = JSON.parse(raw) as Sidecar

  if (!parsed.schemaVersion) {
    parsed.schemaVersion = CURRENT_SCHEMA_VERSION
  }

  return parsed
}

export async function writeSidecar(sidecarPath: string, sidecar: Sidecar): Promise<void> {
  await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf-8')
}

export async function patchSidecar(
  sidecarPath: string,
  patch: { userEdits?: UserEdits; status?: Sidecar['status'] },
): Promise<Sidecar> {
  const sidecar = await readSidecar(sidecarPath)

  if (patch.status) {
    sidecar.status = patch.status
  }

  if (patch.userEdits) {
    const existing = sidecar.userEdits ?? {}
    sidecar.userEdits = { ...existing, ...patch.userEdits }
  }

  await writeSidecar(sidecarPath, sidecar)
  return sidecar
}

export function createEmptySidecar(source: string, collection: string): Sidecar {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
