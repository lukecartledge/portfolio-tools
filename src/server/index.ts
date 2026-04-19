import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadConfig } from '../config.js'
import { createApi } from './api.js'

import 'dotenv/config'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const config = loadConfig()
const app = new Hono()

const api = createApi(config)
app.route('/', api)

app.get('/', async (c) => {
  const html = await readFile(join(__dirname, 'public', 'index.html'), 'utf-8')
  return c.html(html)
})

const port = config.port
console.log(`Portfolio Tools running at http://localhost:${port}`)
serve({ fetch: app.fetch, port })
