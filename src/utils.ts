/** Extract a human-readable message from an unknown thrown value */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Derive a display title from a folder name (e.g. "new-zealand" → "New Zealand") */
export function toCollectionTitle(folderName: string): string {
  return folderName.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
