/**
 * Development only: lets the dev server offer the local /content/*.md files as seed data.
 * The production build gets an empty object, so private content is never bundled; on a
 * real device the same files come in through the file picker in Library.
 */
const files: Record<string, () => Promise<string>> = import.meta.env.DEV
  ? (import.meta.glob(['/content/*.md', '/Content/*.md'], { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>)
  : {}

export const devSeedAvailable = Object.keys(files).length > 0

export async function devSeedTexts(): Promise<string[]> {
  return Promise.all(Object.values(files).map((load) => load()))
}
