<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { downloadText } from '../lib/format'
  import ConfirmDialog from './ConfirmDialog.svelte'

  let asking = $state<'progress' | 'everything' | null>(null)
  let busy = $state(false)
  let done = $state('')

  const counts = $derived.by(() => {
    app.rev
    return app.svc!.counts()
  })

  function backup() {
    downloadText(`vocab-export-${new Date().toISOString().slice(0, 10)}.md`, app.svc!.exportMarkdown())
  }

  async function confirm() {
    busy = true
    if (asking === 'progress') {
      await app.run((s) => s.resetProgress())
      done = 'Learning progress was reset. Your words are untouched.'
    } else {
      await app.run((s) => s.clearEverything())
      done = 'Everything was cleared.'
    }
    busy = false
    asking = null
  }
</script>

<section class="data">
  <h3 class="mono">Data</h3>
  <div class="row">
    <div>
      <b>Reset learning progress</b>
      <p class="muted">Every word becomes new again and the history starts over. Your {counts.total} words stay.</p>
      <button class="btn" onclick={() => (asking = 'progress')} disabled={counts.total === 0}>Reset progress…</button>
    </div>
    <div>
      <b>Clear everything</b>
      <p class="muted">Deletes all words, progress, history and settings from this device.</p>
      <button class="btn danger" onclick={() => (asking = 'everything')}>Clear everything…</button>
    </div>
  </div>
  {#if done}<p class="done" role="status">{done}</p>{/if}
</section>

{#if asking === 'progress'}
  <ConfirmDialog
    title="Are you sure you want to proceed?"
    message="All {counts.studied} studied words will go back to new and your review history will start again from today. The {counts.total} words themselves, and anything you have edited, are kept. This cannot be undone."
    confirmLabel="Yes, reset progress"
    extraLabel="Download a backup first"
    onextra={backup}
    {busy}
    onconfirm={confirm}
    oncancel={() => (asking = null)}
  />
{:else if asking === 'everything'}
  <ConfirmDialog
    title="Are you sure you want to proceed?"
    message="This permanently deletes all {counts.total} words, every review and your settings from this device. Markdown backups you have already downloaded are not affected. This cannot be undone."
    confirmLabel="Yes, clear everything"
    extraLabel="Download a backup first"
    onextra={backup}
    {busy}
    onconfirm={confirm}
    oncancel={() => (asking = null)}
  />
{/if}

<style>
  .data { margin-top: 2rem; padding-top: 1.4rem; border-top: 1px solid var(--desk-line); }
  h3 { color: var(--text-3); margin-bottom: 1rem; }
  .row { display: grid; gap: 1.6rem; }
  @media (min-width: 40rem) { .row { grid-template-columns: 1fr 1fr; } }
  p { margin: 0.2rem 0 0.8rem; font-size: 0.9rem; }
  .done { color: var(--brass); margin-top: 1rem; }
</style>
