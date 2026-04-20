import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Config } from '../config.js'
import { createApi } from './api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function startServer(config: Config): ServerType {
  const app = new Hono()

  const api = createApi(config)
  app.route('/', api)

  app.get('/', async (c) => {
    const html = await readFile(join(__dirname, 'public', 'index.html'), 'utf-8')
    return c.html(html)
  })

  console.log(`Portfolio Tools running at http://localhost:${config.port}`)
  return serve({ fetch: app.fetch, port: config.port })
}
