import { describe, test, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const TSX = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx')
const CLI = join(__dirname, 'cli.ts')

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
    expect(stdout).toContain('--force')
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
