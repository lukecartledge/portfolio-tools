import { readdir, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import sharp from 'sharp'
import { Hono } from 'hono'
import type { Config } from '../config.js'
import type { PhotoWithMetadata, ApiResponse, UserEdits } from '../types.js'
import { mergeMetadata } from '../types.js'
import { IMAGE_EXTENSIONS } from '../config.js'
import { sidecarPathFor, readSidecar, writeSidecar, hasSidecar, patchSidecar } from '../sidecar.js'
import { publishPhoto } from '../publisher.js'
import { errorMessage } from '../utils.js'

export function createApi(config: Config): Hono {
  const app = new Hono()

  app.get('/api/photos', async (c) => {
    try {
      const photos = await scanPhotos(config.watchDir)
      return c.json<ApiResponse<PhotoWithMetadata[]>>({ ok: true, data: photos })
    } catch (error) {
      return c.json<ApiResponse<never>>({ ok: false, error: errorMessage(error) }, 500)
    }
  })

  app.patch('/api/photos/:collection/:filename', async (c) => {
    try {
      const { collection, filename } = c.req.param()
      const body = await c.req.json<{
        status?: string
        title?: string
        caption?: string
        tags?: string[]
      }>()
      const photoPath = join(config.watchDir, collection, filename)
      const sidecarPath = sidecarPathFor(photoPath)

      if (!hasSidecar(photoPath)) {
        return c.json<ApiResponse<never>>({ ok: false, error: 'Sidecar not found' }, 404)
      }

      const userEdits: UserEdits = {}
      if (body.title !== undefined) userEdits.title = body.title
      if (body.caption !== undefined) userEdits.caption = body.caption
      if (body.tags !== undefined) userEdits.tags = body.tags

      const hasEdits = Object.keys(userEdits).length > 0

      const sidecar = await patchSidecar(sidecarPath, {
        ...(body.status ? { status: body.status as 'pending' | 'approved' | 'published' } : {}),
        ...(hasEdits ? { userEdits } : {}),
      })

      return c.json<ApiResponse<{ status: string }>>({ ok: true, data: { status: sidecar.status } })
    } catch (error) {
      return c.json<ApiResponse<never>>({ ok: false, error: errorMessage(error) }, 500)
    }
  })

  app.post('/api/photos/:collection/:filename/approve', async (c) => {
    try {
      const { collection, filename } = c.req.param()
      const photoPath = join(config.watchDir, collection, filename)
      const sidecarPath = sidecarPathFor(photoPath)

      const sidecar = await readSidecar(sidecarPath)
      sidecar.status = 'approved'
      await writeSidecar(sidecarPath, sidecar)

      return c.json<ApiResponse<{ status: string }>>({ ok: true, data: { status: 'approved' } })
    } catch (error) {
      return c.json<ApiResponse<never>>({ ok: false, error: errorMessage(error) }, 500)
    }
  })

  app.post('/api/photos/:collection/:filename/publish', async (c) => {
    try {
      const { collection, filename } = c.req.param()
      const photoPath = join(config.watchDir, collection, filename)
      const sidecarPath = sidecarPathFor(photoPath)

      const sidecar = await readSidecar(sidecarPath)

      if (sidecar.status !== 'approved') {
        return c.json<ApiResponse<never>>(
          { ok: false, error: 'Photo must be approved before publishing' },
          400,
        )
      }

      const result = await publishPhoto(photoPath, sidecar, config)

      sidecar.status = 'published'
      sidecar.contentful.assetId = result.assetId
      sidecar.contentful.entryId = result.entryId
      sidecar.contentful.publishedAt = new Date().toISOString()
      await writeSidecar(sidecarPath, sidecar)

      return c.json<ApiResponse<typeof result>>({ ok: true, data: result })
    } catch (error) {
      return c.json<ApiResponse<never>>({ ok: false, error: errorMessage(error) }, 500)
    }
  })

  app.post('/api/collections', async (c) => {
    try {
      const { createCollection } = await import('../publisher.js')
      const body = await c.req.json<{ title: string }>()

      if (!body.title) {
        return c.json<ApiResponse<never>>({ ok: false, error: 'Title required' }, 400)
      }

      const id = await createCollection(config, body.title)
      return c.json<ApiResponse<{ id: string }>>({ ok: true, data: { id } })
    } catch (error) {
      return c.json<ApiResponse<never>>({ ok: false, error: errorMessage(error) }, 500)
    }
  })

  app.get('/api/collections', async (c) => {
    try {
      const { listCollections } = await import('../publisher.js')
      const collections = await listCollections(config)
      return c.json<ApiResponse<typeof collections>>({ ok: true, data: collections })
    } catch (error) {
      return c.json<ApiResponse<never>>({ ok: false, error: errorMessage(error) }, 500)
    }
  })

  app.get('/api/thumbnail/:collection/:filename', async (c) => {
    try {
      const { collection, filename } = c.req.param()
      const photoPath = join(config.watchDir, collection, filename)

      const thumbnail = await sharp(photoPath)
        .resize(400, 300, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer()

      return new Response(thumbnail, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch {
      return c.json<ApiResponse<never>>({ ok: false, error: 'Thumbnail generation failed' }, 500)
    }
  })

  return app
}

async function scanPhotos(watchDir: string): Promise<PhotoWithMetadata[]> {
  const photos: PhotoWithMetadata[] = []

  let collections: string[]
  try {
    collections = await readdir(watchDir)
  } catch {
    return photos
  }

  for (const collectionName of collections) {
    const collectionPath = join(watchDir, collectionName)
    const collectionStat = await stat(collectionPath).catch(() => null)

    if (!collectionStat?.isDirectory()) continue

    const files = await readdir(collectionPath)

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) continue

      const filePath = join(collectionPath, file)
      const sidecarPath = sidecarPathFor(filePath)

      if (!hasSidecar(filePath)) continue

      try {
        const sidecar = await readSidecar(sidecarPath)
        photos.push({
          filePath,
          name: basename(file, ext),
          collection: collectionName,
          sidecarPath,
          sidecar,
          effective: mergeMetadata(sidecar.ai, sidecar.userEdits),
        })
      } catch {
        continue
      }
    }
  }

  return photos.sort((a, b) => {
    const statusOrder = { pending: 0, approved: 1, published: 2 }
    const statusDiff = statusOrder[a.sidecar.status] - statusOrder[b.sidecar.status]
    if (statusDiff !== 0) return statusDiff
    return a.collection.localeCompare(b.collection)
  })
}
