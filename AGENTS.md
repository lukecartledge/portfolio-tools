# portfolio-tools — Agent Instructions

## Stack

- Node.js 20+, TypeScript, ESM (`"type": "module"`)
- Hono (local web server)
- Vanilla HTML/CSS/JS for review UI (no frameworks, no build step)
- chokidar@3 (folder watching)
- exifr (EXIF extraction)
- sharp (image resize for AI vision)
- @anthropic-ai/sdk (Claude Vision)
- contentful-management (CMS publishing)

## Conventions

- No `as any`, no `@ts-ignore`, no `@ts-expect-error`
- Strict TypeScript — all flags enabled
- ESM imports only (`import`, not `require`)
- Async/await over callbacks
- Early returns over deep nesting
- Named constants over magic numbers
- Error handling on all async operations
- No unused imports or variables

## Project Structure

```
src/
  cli.ts          — CLI entry point (parseArgs, help, dispatch)
  commands/
    analyze.ts    — Scan + AI analyze photos
    publish.ts    — Publish approved photos to Contentful
    dev.ts        — Watcher + server together
    watch.ts      — Continuous folder watcher
  types.ts        — Shared type definitions
  config.ts       — Environment config loader
  watcher.ts      — chokidar folder watcher
  analyzer.ts     — EXIF extraction + Claude Vision
  publisher.ts    — Contentful Management API
  sidecar.ts      — JSON sidecar read/write
  server/
    index.ts      — Hono server entry
    api.ts        — REST API routes
    public/
      index.html  — Single-page review UI
```

## Key Patterns

- Sidecar `.json` files live alongside each photo (same name, `.json` extension)
- Status flow: `pending` → `approved` → `published`
- Collections derived from subfolder name in watched directory
- All Contentful operations use Management API (not Delivery)

## Testing

- Vitest for unit tests (`npm test` or `npm run test:watch`)
- `tsc --noEmit` for type checking
- Co-located test files: `src/foo.test.ts` next to `src/foo.ts`
- Mock external SDKs (Anthropic, Contentful, sharp, exifr) — no real API calls in tests
- Use temp directories for filesystem I/O tests (sidecar read/write)
- CI runs both `tsc --noEmit` and `vitest run` on every PR

## Do Not

- Add client-side JS frameworks (React, Vue, etc.)
- Add CSS frameworks (Tailwind, etc.)
- Add build tools for the frontend (Vite, webpack, etc.)
- Commit `.env` files
- Suppress type errors
