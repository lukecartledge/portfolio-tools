# portfolio-tools

Photo metadata automation for my portfolio site. Watches a folder for new photos, extracts EXIF data, generates titles/captions/tags via Claude Vision, and publishes to Contentful — with a local web UI for human review before anything goes live.

## Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/) (Claude Vision)
- A [Contentful Management API token](https://app.contentful.com/account/profile/cma_tokens)

## Setup

```bash
git clone git@github.com:lukecartledge/portfolio-tools.git
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

Continuously watch the directory for new exports from Lightroom (or any image editor). Each new photo is automatically analyzed:

```bash
npm run watch
```

The watcher waits for files to stabilize (3s) before processing, so partially-written exports from Lightroom won't cause issues.

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

## Lightroom note

By default, Lightroom strips GPS data on export. To preserve location coordinates in your photos, enable **Include GPS Location Data** in the export dialog under the Metadata section.

## Development

```bash
npm test             # run tests (vitest)
npm run test:watch   # run tests in watch mode
npm run build        # type-check (tsc --noEmit)
npm run lint         # prettier + eslint + type-check
```
