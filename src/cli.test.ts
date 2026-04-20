import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const TSX = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx')
const CLI = join(__dirname, 'cli.ts')

/** Minimal env vars so loadConfig() succeeds in subprocess tests */
const CONFIG_ENV = {
  CONTENTFUL_SPACE_ID: 'test-space',
  CONTENTFUL_MANAGEMENT_TOKEN: 'test-token',
  ANTHROPIC_API_KEY: 'test-key',
}

interface CliResult {
  stdout: string
  stderr: string
  code: number
}

async function runCli(args: string[], env?: Record<string, string>): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec(TSX, [CLI, ...args], {
      env: { ...process.env, ...env },
      timeout: 15000,
    })
    return { stdout, stderr, code: 0 }
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; code?: number | null }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: e.code ?? 1,
    }
  }
}

describe('CLI flags', () => {
  test('--version prints version string', async () => {
    const { stdout, code } = await runCli(['--version'])
    expect(code).toBe(0)
    expect(stdout.trim()).toMatch(/^portfolio-tools v\d+\.\d+\.\d+$/)
  })

  test('-v is shorthand for --version', async () => {
    const { stdout, code } = await runCli(['-v'])
    expect(code).toBe(0)
    expect(stdout.trim()).toMatch(/^portfolio-tools v\d+\.\d+\.\d+$/)
  })

  test('--help prints usage with all commands', async () => {
    const { stdout, code } = await runCli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage:')
    for (const cmd of ['analyze', 'watch', 'publish', 'dev']) {
      expect(stdout).toContain(cmd)
    }
  })

  test('publish --help includes --dry-run and --all', async () => {
    const { stdout, code } = await runCli(['publish', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--dry-run')
    expect(stdout).toContain('--all')
  })

  test('dev --help includes --port', async () => {
    const { stdout, code } = await runCli(['dev', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--port')
  })

  test('no command shows help and exits 1', async () => {
    const { code, stdout } = await runCli([])
    expect(code).toBe(1)
    expect(stdout).toContain('Usage:')
  })

  test('unknown command shows help and exits 1', async () => {
    const { code, stdout } = await runCli(['nonexistent'])
    expect(code).toBe(1)
    expect(stdout).toContain('Usage:')
  })

  test('unknown flag exits with error', async () => {
    const { code, stderr } = await runCli(['publish', '--bogus'])
    expect(code).toBe(1)
    expect(stderr).toContain('Error')
  })
})

describe('publish --dry-run', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cli-test-'))
    const collectionDir = join(tmpDir, 'landscapes')
    await mkdir(collectionDir, { recursive: true })

    // Approved photo with sidecar
    await writeFile(join(collectionDir, 'sunset.jpg'), Buffer.from('fake'))
    await writeFile(
      join(collectionDir, 'sunset.json'),
      JSON.stringify({
        schemaVersion: 1,
        status: 'approved',
        source: 'sunset.jpg',
        collection: 'landscapes',
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
          title: 'Golden Sunset',
          caption: 'Sunset over the hills',
          tags: ['landscape', 'sunset'],
          model: 'test',
          generatedAt: '2025-01-01T00:00:00Z',
        },
        contentful: { assetId: null, entryId: null, publishedAt: null },
      }),
    )

    // Pending photo (should not appear in dry-run output)
    await writeFile(join(collectionDir, 'pending.jpg'), Buffer.from('fake'))
    await writeFile(
      join(collectionDir, 'pending.json'),
      JSON.stringify({
        schemaVersion: 1,
        status: 'pending',
        source: 'pending.jpg',
        collection: 'landscapes',
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
          title: 'Pending Photo',
          caption: '',
          tags: [],
          model: 'test',
          generatedAt: '2025-01-01T00:00:00Z',
        },
        contentful: { assetId: null, entryId: null, publishedAt: null },
      }),
    )
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('lists approved photos with title and tags', async () => {
    const { stdout, code } = await runCli(['publish', '--dry-run', '--dir', tmpDir], CONFIG_ENV)
    expect(code).toBe(0)
    expect(stdout).toContain('1 approved photo')
    expect(stdout).toContain('landscapes/sunset.jpg')
    expect(stdout).toContain('Golden Sunset')
    expect(stdout).toContain('landscape, sunset')
  })

  test('excludes pending photos', async () => {
    const { stdout } = await runCli(['publish', '--dry-run', '--dir', tmpDir], CONFIG_ENV)
    expect(stdout).not.toContain('pending.jpg')
    expect(stdout).not.toContain('Pending Photo')
  })

  test('shows no-photos message for empty directory', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'cli-empty-'))
    const { stdout, code } = await runCli(['publish', '--dry-run', '--dir', emptyDir], CONFIG_ENV)
    expect(code).toBe(0)
    expect(stdout).toContain('No approved photos')
    await rm(emptyDir, { recursive: true, force: true })
  })

  test('respects user edits over AI metadata', async () => {
    const editDir = await mkdtemp(join(tmpdir(), 'cli-edit-'))
    const collectionDir = join(editDir, 'portraits')
    await mkdir(collectionDir, { recursive: true })

    await writeFile(join(collectionDir, 'photo.jpg'), Buffer.from('fake'))
    await writeFile(
      join(collectionDir, 'photo.json'),
      JSON.stringify({
        schemaVersion: 1,
        status: 'approved',
        source: 'photo.jpg',
        collection: 'portraits',
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
          title: 'AI Title',
          caption: '',
          tags: ['ai-tag'],
          model: 'test',
          generatedAt: '2025-01-01T00:00:00Z',
        },
        userEdits: {
          title: 'Human Title',
          tags: ['human-tag'],
        },
        contentful: { assetId: null, entryId: null, publishedAt: null },
      }),
    )

    const { stdout } = await runCli(['publish', '--dry-run', '--dir', editDir], CONFIG_ENV)
    expect(stdout).toContain('Human Title')
    expect(stdout).not.toContain('AI Title')
    expect(stdout).toContain('human-tag')
    expect(stdout).not.toContain('ai-tag')

    await rm(editDir, { recursive: true, force: true })
  })
})
