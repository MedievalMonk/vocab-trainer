<script lang="ts">
  import { app } from '../lib/app.svelte'
  import ClusterView from './ClusterView.svelte'

  const dash = $derived.by(() => {
    app.rev
    return app.svc!.clusterDashboard()
  })
  const clusters = $derived.by(() => {
    app.rev
    return app.svc!.clusterList()
  })
  const cap = $derived.by(() => {
    app.rev
    return app.svc!.settings.clusterDailyCap
  })

  let query = $state('')
  let open = $state<string | null>(null)

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clusters
    return clusters.filter(
      (c) => c.content.title.toLowerCase().includes(q) || c.content.coreMeaning.toLowerCase().includes(q) || c.content.members.some((m) => m.word.toLowerCase().includes(q)),
    )
  })
  const hasLadder = $derived(clusters.some((c) => c.content.ordered && c.content.members.length >= 3))

  const when = (d: Date | undefined) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

  function practiceDue() {
    app.startThesaurus({ kind: 'practice', clusterIds: dash.queue, title: 'Practice' })
  }
  function practiceNew() {
    const next = clusters.filter((c) => c.status === 'new').slice(0, 3).map((c) => c.id)
    app.startThesaurus({ kind: 'practice', clusterIds: next, title: 'Practice · new clusters' })
  }
  async function setCap(e: Event) {
    const n = Math.round(Number((e.currentTarget as HTMLInputElement).value))
    if (n >= 1 && n <= 200) await app.run((s) => s.updateSettings({ clusterDailyCap: n }))
  }
</script>

<div class="page">
  <h1>The Thesaurus</h1>
  <p class="lead muted">
    Near-synonyms are rarely interchangeable. This is where you practise telling them apart: which word fits <em>this</em> sentence, and where it sits on the scale.
    Always available; it has its own schedule, separate from word review.
  </p>

  {#if clusters.length === 0}
    <section class="empty">
      <h2>No clusters yet</h2>
      <p class="muted">Import a synonym-cluster file (<code>## Cluster:</code> blocks) in the Library, with Import / Export → Choose files.</p>
      <button class="btn primary" onclick={() => app.go('library')}>Go to Library</button>
    </section>
  {:else}
    <section class="today">
      <div class="slip">
        <span class="mono">Clusters due today</span>
        <div class="number" aria-live="polite">{dash.dueToday}</div>
        <p class="sub">
          {dash.newCount} not practised yet · {dash.practised} of {dash.total} practised · {dash.doneToday} of {cap} rounds today
        </p>
      </div>
      <div class="row">
        <button class="btn primary big" onclick={practiceDue} disabled={dash.queue.length === 0}>
          {dash.queue.length ? `Practise ${dash.queue.length} due` : 'Nothing due'}
        </button>
        <button class="btn" onclick={practiceNew} disabled={dash.newCount === 0}>Try {Math.min(3, dash.newCount)} new</button>
      </div>
      {#if dash.dueToday > dash.queue.length}
        <p class="note">Today's limit of {cap} rounds is reached. The rest keeps until tomorrow.</p>
      {/if}
    </section>

    <section class="games">
      <h2>Games</h2>
      <p class="muted small">Just for practice. They never change the schedule.</p>
      <div class="row">
        <button class="btn" onclick={() => app.startThesaurus({ kind: 'duel' })}>Nuance Duel</button>
        <button class="btn" onclick={() => app.startThesaurus({ kind: 'ladder' })} disabled={!hasLadder}>Intensity Ladder</button>
      </div>
    </section>

    <section>
      <div class="browse-head">
        <h2>All clusters <small class="muted">{clusters.length}</small></h2>
        <input class="input search" type="search" placeholder="Search words or meanings…" bind:value={query} aria-label="Search clusters" />
      </div>
      <ul class="list">
        {#each shown as c (c.id)}
          <li>
            <button class="item" onclick={() => (open = c.id)}>
              <span class="main">
                <span class="title">{c.content.title}</span>
                <span class="core">{c.content.coreMeaning}</span>
              </span>
              <span class="state mono" class:due={c.status === 'due'}>
                {#if c.status === 'new'}new{:else if c.status === 'due'}due{:else}{when(c.due)}{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if shown.length === 0}<p class="muted">Nothing matches.</p>{/if}
    </section>

    <details class="settings">
      <summary class="mono">Settings</summary>
      <label class="field">
        <span>Practice rounds per day (the due queue never goes past this)</span>
        <input class="input narrow" type="number" min="1" max="200" value={cap} onchange={setCap} />
      </label>
    </details>
  {/if}
</div>

{#if open}
  <ClusterView clusterId={open} onclose={() => (open = null)} />
{/if}

<style>
  h1 { font-size: 2.2rem; margin-bottom: 0.6rem; }
  h2 { font-size: 1.3rem; margin-bottom: 0.6rem; }
  h2 small { font-family: var(--sans); font-size: 0.85rem; font-weight: 400; margin-left: 0.4rem; }
  .lead { max-width: 42rem; margin-bottom: 2rem; }
  section { margin-top: 2.4rem; }
  .row { display: flex; gap: 0.8rem; flex-wrap: wrap; align-items: center; }
  .big { padding: 0.9rem 1.6rem; font-size: 1.1rem; }
  .small { font-size: 0.85rem; margin: 0 0 0.8rem; }
  code { font-family: var(--mono); font-size: 0.85em; background: #0a1422; padding: 0.05rem 0.3rem; border-radius: 2px; }
  .empty { max-width: 34rem; display: grid; gap: 0.8rem; justify-items: start; }

  .slip {
    position: relative;
    background: var(--paper);
    color: var(--ink);
    border-radius: 3px;
    border-top: 5px solid var(--stamp);
    padding: 2.6rem 1.6rem 1.3rem;
    box-shadow: 0 2px 0 var(--paper-edge), 0 14px 34px rgb(0 0 0 / 0.5);
    margin-bottom: 1.4rem;
    max-width: 34rem;
  }
  .slip .mono { position: absolute; top: 0.9rem; left: 1.6rem; color: var(--ink-3); }
  .number { font-family: var(--serif); font-size: clamp(4rem, 18vw, 6.5rem); line-height: 0.95; letter-spacing: -0.03em; }
  .sub { margin: 0.7rem 0 0; color: var(--ink-2); font-size: 0.92rem; }
  .note { margin-top: 1rem; padding: 0.7rem 0.9rem; border-left: 3px solid var(--brass); color: var(--text-2); font-size: 0.92rem; max-width: 34rem; }

  .browse-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
  .search { max-width: 20rem; }
  .list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--desk-line); }
  .list li { border-bottom: 1px solid var(--desk-line); }
  .item {
    appearance: none;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.85rem 0.4rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 1rem;
    align-items: center;
    cursor: pointer;
  }
  .item:hover { background: var(--desk-2); }
  .main { display: grid; min-width: 0; }
  .title { font-family: var(--serif); font-size: 1.1rem; }
  .core { color: var(--text-2); font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .state { color: var(--text-3); }
  .state.due { color: var(--brass); }
  .settings { margin-top: 3rem; color: var(--text-2); }
  .settings summary { cursor: pointer; margin-bottom: 1rem; }
  .narrow { max-width: 9rem; }
</style>
