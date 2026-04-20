import { readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { multiselect, confirm, spinner, isCancel, cancel } from '@clack/prompts'
import type { Config } from '../config.js'
import { IMAGE_EXTENSIONS } from '../config.js'
import { hasSidecar, sidecarPathFor, readSidecar, markPublished } from '../sidecar.js'
import { publishPhoto } from '../publisher.js'
import { errorMessage } from '../utils.js'
import { mergeMetadata } from '../types.js'
import type { Sidecar } from '../types.js'
import { log } from '../logger.js'

interface ApprovedPhoto {
  filePath: string
  sidecarPath: string
  collection: string
  filename: string
  sidecar: Sidecar
}

async function scanApprovedPhotos(watchDir: string): Promise<ApprovedPhoto[]> {
  const collections = await readdir(watchDir)
  const approved: ApprovedPhoto[] = []

  for (const collectionName of collections) {
    const collectionPath = join(watchDir, collectionName)
    const collectionStat = await stat(collectionPath).catch(() => null)
    if (!collectionStat?.isDirectory()) continue

    const files = await readdir(collectionPath)

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) continue

      const filePath = join(collectionPath, file)
      if (!hasSidecar(filePath)) continue

      const sidecarPath = sidecarPathFor(filePath)
      const sidecar = await readSidecar(sidecarPath)
      if (sidecar.status !== 'approved') continue

      approved.push({ filePath, sidecarPath, collection: collectionName, filename: file, sidecar })
    }
  }

  return approved
}

function printPublishTable(photos: ApprovedPhoto[]): void {
  for (const photo of photos) {
    const effective = mergeMetadata(photo.sidecar.ai, photo.sidecar.userEdits)
    log.info(`  ${photo.collection}/${photo.filename}`)
    log.info(`    Title: ${effective.title}`)
    log.info(`    Tags:  ${effective.tags.join(', ') || '(none)'}`)
  }
}

async function publishSinglePhoto(photo: ApprovedPhoto, config: Config): Promise<boolean> {
  const effective = mergeMetadata(photo.sidecar.ai, photo.sidecar.userEdits)
  const s = spinner()
  s.start(`Publishing: ${photo.collection}/${photo.filename}`)

  try {
    const result = await publishPhoto(photo.filePath, photo.sidecar, config)
    await markPublished(photo.sidecarPath, photo.sidecar, result)
    s.stop(`Published: ${effective.title} (${result.entryId})`)
    return true
  } catch (error) {
    s.stop(`Failed: ${photo.collection}/${photo.filename} — ${errorMessage(error)}`)
    return false
  }
}

export interface PublishOptions {
  dryRun: boolean
  all: boolean
}

export async function runPublish(config: Config, options: PublishOptions): Promise<void> {
  const photos = await scanApprovedPhotos(config.watchDir)

  if (photos.length === 0) {
    log.info('No approved photos to publish.')
    return
  }

  log.info(`Found ${photos.length} approved photo${photos.length === 1 ? '' : 's'}:\n`)
  printPublishTable(photos)

  if (options.dryRun) {
    return
  }

  let toPublish: ApprovedPhoto[]

  if (options.all || !process.stdout.isTTY) {
    toPublish = photos
  } else {
    log.info('')
    const selected = await multiselect({
      message: 'Select photos to publish:',
      options: photos.map((photo) => {
        const effective = mergeMetadata(photo.sidecar.ai, photo.sidecar.userEdits)
        return {
          value: photo.filePath,
          label: `${photo.collection}/${photo.filename}`,
          hint: effective.title,
        }
      }),
    })

    if (isCancel(selected)) {
      cancel('Publish cancelled.')
      return
    }

    toPublish = photos.filter((p) => selected.includes(p.filePath))
  }

  if (toPublish.length === 0) {
    log.info('No photos selected.')
    return
  }

  if (!options.all && process.stdout.isTTY) {
    const proceed = await confirm({
      message: `Publish ${toPublish.length} photo${toPublish.length === 1 ? '' : 's'} to Contentful?`,
    })

    if (isCancel(proceed) || !proceed) {
      cancel('Publish cancelled.')
      return
    }
  }

  let published = 0
  let errors = 0

  for (const photo of toPublish) {
    const ok = await publishSinglePhoto(photo, config)
    if (ok) {
      published++
    } else {
      errors++
    }
  }

  log.info(`\nDone. Published: ${published}, Errors: ${errors}`)
}
