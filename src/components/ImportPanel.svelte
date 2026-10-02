<script lang="ts">
  import type { ImportReport } from '../core/merge'
  import { app } from '../lib/app.svelte'
  import { devSeedAvailable, devSeedTexts } from '../lib/devseed'
  import { downloadText } from '../lib/format'

  let pasted = $state('')
  let defaultCollection = $state('Personal')
  let updateExisting = $state(false)
  let busy = $state(false)
  let reports = $state<{ name: string; r: ImportReport }[]>([])
  let fileInput: HTMLInputElement

  async function importTexts(items: { name: string; text: string }[], opts: { defaultCollection?: string } = {}) {
    busy = true
    reports = []
    for (const it of items) {
      const r = await app.run((s) => s.importMarkdown(it.text, { ...opts, updateExisting }))
      reports.push({ name: it.name, r })
    }
    busy = false
  }

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const files = [...(input.files ?? [])]
    const items = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))
    input.value = ''
    await importTexts(items)
  }

  async function onPaste() {
    if (!pasted.trim()) return
    await importTexts([{ name: 'Pasted text', text: pasted }], { defaultCollection })
    pasted = ''
  }

  async function seed() {
    const texts = await devSeedTexts()
    await importTexts(texts.map((text, i) => ({ name: `content file ${i + 1}`, text })))
  }

  function exportAll() {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`vocab-export-${stamp}.md`, app.svc!.exportMarkdown())
  }

  const problemLines = (r: ImportReport) => r.warnings.filter((w) => w.level === 'error' || w.level === 'warn').slice(0, 6)
</script>

<section class="panel">
  <div class="cols">
    <div>
      <h2>Import files</h2>
      <p class="muted">
        Markdown batch files (.md). Each file's <code>Collection:</code> line decides where its words go. Importing the same file twice changes nothing,
        and your progress is never reset.
      </p>
      <input bind:this={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onchange={onFiles} />
      <div class="row">
        <button class="btn primary" onclick={() => fileInput.click()} disabled={busy}>Choose files…</button>
        {#if devSeedAvailable}<button class="btn" onclick={seed} disabled={busy}>Load content/ (dev)</button>{/if}
      </div>
      <label class="check"><input type="checkbox" bind:checked={updateExisting} /> Also overwrite words that already exist (replaces edits made here)</label>
    </div>

    <div>
      <h2>Paste words</h2>
      <p class="muted">Same block format. Without a <code>Collection:</code> line, words go to the collection below.</p>
      <textarea class="input" bind:value={pasted} placeholder={'## word\n- **POS:** noun\n- **Definition:** …\n- **Example:** …\n- **Polish:** …\n- **Tags:** …'} spellcheck="false"></textarea>
      <div class="row">
        <input class="input coll" bind:value={defaultCollection} aria-label="Default collection" />
        <button class="btn" onclick={onPaste} disabled={busy || !pasted.trim()}>Import pasted text</button>
      </div>
    </div>
  </div>

  {#if reports.length}
    <div class="reports" aria-live="polite">
      {#each reports as { name, r } (name)}
        <div class="report">
          <b>{name}</b>:
          {#if r.clusters}
            <span class="clu">{r.clusters.added} synonym clusters added, {r.clusters.unchanged} already there{#if r.clusters.updated}, {r.clusters.updated} updated{/if}{#if r.clusters.differing.length}, {r.clusters.differing.length} differ from your copy (kept){/if}{#if r.clusters.skippedDeleted}, {r.clusters.skippedDeleted} previously deleted (skipped){/if}{#if r.clusters.skippedInvalid}, <span class="bad">{r.clusters.skippedInvalid} skipped as incomplete</span>{/if}{#if r.clusters.reviewsRestored}, {r.clusters.reviewsRestored} practice rounds restored{/if}.</span>
            {#if r.added || r.unchanged || r.skippedInvalid} Words: {/if}
          {/if}
          {#if !r.clusters || r.added || r.unchanged || r.skippedInvalid}
            {r.added} added, {r.unchanged} already there{#if r.updated}, {r.updated} updated{/if}{#if r.differing.length}, {r.differing.length} differ from your edited copy (kept){/if}{#if r.skippedDeleted}, {r.skippedDeleted} previously deleted (skipped){/if}{#if r.skippedInvalid}, <span class="bad">{r.skippedInvalid} skipped as incomplete</span>{/if}.
          {/if}
          {#each problemLines(r) as w, i (i)}<div class="warn">line {w.line}: {w.message}</div>{/each}
        </div>
      {/each}
    </div>
  {/if}

  <div class="export">
    <h2>Backup</h2>
    <p class="muted">
      A plain Markdown file with every word, its status and your full review history. Openable in any text editor, and importable back here. Make one now and then.
    </p>
    <button class="btn" onclick={exportAll}>Download Markdown backup</button>
  </div>
</section>

<style>
  .panel { border: 1px solid var(--desk-line); background: var(--desk-2); border-radius: 3px; padding: 1.4rem; margin-bottom: 2rem; }
  .cols { display: grid; gap: 2rem; }
  @media (min-width: 52rem) { .cols { grid-template-columns: 1fr 1fr; } }
  h2 { font-size: 1.2rem; margin-bottom: 0.5rem; }
  code { font-family: var(--mono); font-size: 0.85em; background: #0a1422; padding: 0.05rem 0.3rem; border-radius: 2px; }
  .row { display: flex; gap: 0.6rem; flex-wrap: wrap; margin: 0.8rem 0; }
  .coll { max-width: 14rem; }
  .check { display: flex; gap: 0.5rem; font-size: 0.85rem; color: var(--text-2); align-items: flex-start; }
  .reports { margin-top: 1.4rem; padding-top: 1rem; border-top: 1px solid var(--desk-line); font-size: 0.92rem; }
  .report { margin-bottom: 0.6rem; }
  .warn { color: var(--text-3); font-size: 0.82rem; margin-left: 1rem; }
  .bad { color: #e4a3a6; }
  .export { margin-top: 1.6rem; padding-top: 1.2rem; border-top: 1px solid var(--desk-line); }
</style>
