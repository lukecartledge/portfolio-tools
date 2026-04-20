# portfolio-tools

Photo metadata automation for portfolio sites. Watches a folder for new photos, extracts EXIF data, generates titles/captions/tags via Claude Vision, and publishes to Contentful — with a local web UI for human review before anything goes live.

MIT licensed. See [LICENSE](LICENSE).

## Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/) (Claude Vision)
- A [Contentful Management API token](https://app.contentful.com/account/profile/cma_tokens)

## Setup

```bash
git clone https://github.com/lukecartledge/portfolio-tools.git
cd portfolio-tools
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```
CONTENTFUL_SPACE_ID=your-space-id
CONTENTFUL_ENVIRONMENT=master
CONTENTFUL_MANAGEMENT_TOKEN=your-management-token
ANTHROPIC_API_KEY=sk-ant-...
WATCH_DIR=~/Pictures/Portfolio
PORT=3000
```

Then create the Contentful content model:

```bash
npm run setup
```

This creates the `photo` and `collection` content types in your Contentful space. It's idempotent — running it again skips types that already exist.

## Usage

All commands accept `--dir <path>` to override the watch directory and `--verbose` for extra output.

```bash
portfolio-tools <command> [options]
```

Or via npm scripts (which use `tsx` under the hood):

```bash
npm run <command>
```

### Analyze photos

Scan the watch directory and generate metadata for any photos that don't have a sidecar JSON yet. Each photo gets an animated spinner while Claude Vision processes it.

```bash
npm run analyze

# Override the watch directory:
npm run analyze -- --dir ~/Desktop/test-photos
```

### Watch for new photos

Continuously watch the directory for new photo exports. Each new photo is automatically analyzed:

```bash
npm run watch
```

The watcher waits for files to stabilize (configurable via `WRITE_STABILITY_THRESHOLD`) before processing, so partially-written exports won't cause issues.

### Review in the browser

Start the watcher and local review server together:

```bash
npm run dev

# Use a different port:
npm run dev -- --port 8080
```

Open http://localhost:3000. The UI shows all photos with their AI-generated metadata. You can:

- Edit titles, captions, and tags inline
- Approve photos for publishing
- Publish approved photos to Contentful one by one

### Publish approved photos

Publish approved photos to Contentful from the command line (alternative to the UI):

```bash
# Interactive mode — select photos, confirm before publishing:
npm run publish

# Preview what would be published without actually publishing:
npm run publish -- --dry-run

# Publish all approved photos without prompts (good for CI):
npm run publish -- --all
```

In interactive mode (TTY), you get a multi-select prompt to pick which photos to publish, then a confirmation step. In non-TTY environments (pipes, CI), `--all` behavior is used automatically.

### CLI reference

```
Global options:
  -h, --help       Show help
  -v, --version    Show version
  --dir <path>     Override watch directory (default: WATCH_DIR env var)
  --verbose        Enable verbose output

Commands:
  analyze          Scan watch directory and analyze new photos
  watch            Watch directory for new photos (continuous)
  publish          Publish approved photos to Contentful
  dev              Start watcher and review server together

publish options:
  --dry-run        Show what would be published without publishing
  --all            Publish all approved photos without prompts

dev options:
  --port <port>    Server port (default: 3000)
```

## Folder structure

The watch directory uses subfolders as **collection names**:

```
~/Pictures/Portfolio/
  iceland/
    DSC_0001.jpg
    DSC_0001.json    ← sidecar (auto-generated)
    DSC_0002.jpg
    DSC_0002.json
  japan/
    IMG_1234.jpg
    IMG_1234.json
```

The subfolder name (e.g. `iceland`) maps to a Contentful collection entry. If the collection doesn't exist in Contentful, the publish step will skip the collection link (you can create collections via the API or the Contentful web app).

## Sidecar files

Each photo gets a `.json` sidecar alongside it with the same name. This is where all metadata lives:

```json
{
  "status": "pending",
  "source": "DSC_0001.jpg",
  "collection": "iceland",
  "exif": {
    "camera": "FUJIFILM X-T5",
    "lens": "XF16-55mmF2.8 R LM WR",
    "aperture": "f/8",
    "shutterSpeed": "1/250",
    "iso": 200,
    "focalLength": "23mm",
    "dateTaken": "2025-06-15T14:30:00.000Z",
    "gps": { "lat": 64.1466, "lng": -21.9426 }
  },
  "ai": {
    "title": "Midnight Sun Over Reynisfjara",
    "caption": "Black sand beach stretching toward basalt sea stacks under a low golden sun.",
    "tags": ["landscape", "iceland", "beach", "golden-hour", "basalt", "ocean"]
  },
  "contentful": {
    "assetId": null,
    "entryId": null,
    "publishedAt": null
  }
}
```

Status flow: `pending` → `approved` → `published`

## GPS data note

Some photo editors (including Lightroom) strip GPS data on export. To preserve location coordinates, check your editor's export settings for a GPS/location data option.

## Development

```bash
npm test             # run tests (vitest)
npm run test:watch   # run tests in watch mode
npm run build        # type-check (tsc --noEmit)
npm run lint         # prettier + eslint + type-check
```

## Architecture

```
photo dropped in watch dir
  → chokidar detects new file
  → exifr extracts EXIF metadata
  → sharp resizes for AI input
  → Claude Vision generates title, caption, tags
  → sidecar JSON written alongside photo

user reviews in browser UI (localhost:3000)
  → edits title/caption/tags inline
  → approves photo

publish command (CLI or UI)
  → uploads image asset to Contentful
  → creates photo entry with all metadata
  → links to collection entry (from subfolder name)
  → marks sidecar as published
```

### Key dependencies

| Dependency                   | Purpose                                  |
| ---------------------------- | ---------------------------------------- |
| `@anthropic-ai/sdk`          | Claude Vision for AI-generated metadata  |
| `exifr`                      | Pure-JS EXIF extraction (~1ms/file)      |
| `sharp`                      | Image resize for AI vision input         |
| `chokidar`                   | Filesystem watching                      |
| `contentful-management`      | Contentful Management API (plain client) |
| `hono` + `@hono/node-server` | Local review server                      |
| `@clack/prompts`             | Interactive CLI prompts                  |

## Environment variables

Required:

| Variable                      | Description                         |
| ----------------------------- | ----------------------------------- |
| `CONTENTFUL_SPACE_ID`         | Your Contentful space ID            |
| `CONTENTFUL_MANAGEMENT_TOKEN` | Contentful Management API token     |
| `ANTHROPIC_API_KEY`           | Anthropic API key for Claude Vision |

Optional:

| Variable                    | Default                | Description                                     |
| --------------------------- | ---------------------- | ----------------------------------------------- |
| `CONTENTFUL_ENVIRONMENT`    | `master`               | Contentful environment                          |
| `WATCH_DIR`                 | `~/Pictures/Portfolio` | Directory to watch for photos                   |
| `PORT`                      | `3000`                 | Review server port                              |
| `CONTENTFUL_LOCALE`         | `en-US`                | Locale for Contentful field values              |
| `PHOTO_CONTENT_TYPE`        | `photo`                | Contentful photo content type ID                |
| `COLLECTION_CONTENT_TYPE`   | `collection`           | Contentful collection content type ID           |
| `VISION_MODEL`              | `claude-sonnet-4-6`    | Claude model for vision analysis                |
| `WRITE_STABILITY_THRESHOLD` | `3000`                 | File write stability threshold (ms)             |
| `LOG_LEVEL`                 | `info`                 | Log verbosity: debug, info, warn, error, silent |
