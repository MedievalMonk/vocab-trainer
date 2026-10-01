import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * After the build, writes dist/sw.js: the template plus the exact list of built files and a
 * version derived from their contents. Any change to the app changes the version, which is
 * what makes browsers install the update.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'vocab-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name)
          if (statSync(p).isDirectory()) walk(p)
          else files.push(relative(outDir, p).replace(/\\/g, '/'))
        }
      }
      walk(outDir)
      const urls = files.filter((f) => f !== 'sw.js').sort()
      const template = readFileSync(resolve(import.meta.dirname, 'scripts/sw.template.js'), 'utf8')
      const hash = createHash('sha256').update(template)
      for (const f of urls) hash.update(f).update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const precache = ['./', ...urls.map((f) => './' + f)]
      const sw = template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 2))
      if (sw.includes('__VERSION__') || sw.includes('__PRECACHE__') || !sw.includes(`const VERSION = '${version}'`)) {
        throw new Error('Service worker template was not filled in correctly')
      }
      writeFileSync(join(outDir, 'sw.js'), sw)
    },
  }
}

// base './' keeps every URL relative, so the same build works at
// https://<user>.github.io/vocab-trainer/, on a local server, or in any folder.
export default defineConfig({
  base: './',
  plugins: [svelte(), serviceWorker()],
  test: { include: ['src/**/*.test.ts'] },
})
