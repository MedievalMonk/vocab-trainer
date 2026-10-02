<script lang="ts">
  import { untrack } from 'svelte'
  import type { EntryState } from '../core/events'
  import { STATUSES, type Status } from '../core/types'
  import { app } from '../lib/app.svelte'
  import { headword } from '../lib/exercises'
  import { collectionList, crumb, shortDate } from '../lib/format'
  import EntryEditor from './EntryEditor.svelte'
  import ImportPanel from './ImportPanel.svelte'

  let query = $state('')
  let collection = $state('')
  let tag = $state('')
  let status = $state<'' | Status>('')
  let limit = $state(80)
  let editing = $state<{ id: string | null } | null>(null)
  // Open from the start when there is nothing yet, and then stay open, so its report is not lost
  // the moment the first words arrive.
  let showImport = $state(untrack(() => app.svc!.counts().total === 0))

  const counts = $derived.by(() => {
    app.rev
    return app.svc!.counts()
  })
  const all = $derived.by(() => {
    app.rev
    return [...app.svc!.state.entries.values()].filter((e) => !e.deleted)
  })
  const collections = $derived.by(() => {
    app.rev
    return collectionList(app.svc!.state)
  })
  const inScope = $derived(
    collection ? all.filter((e) => e.content.collection === collection || e.content.collection.startsWith(collection + ' > ')) : all,
  )
  const tags = $derived.by(() => {
    const m = new Map<string, number>()
    for (const e of inScope) for (const t of e.content.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40)
  })
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return inScope
      .filter((e) => (!tag || e.content.tags.includes(tag)) && (!status || e.status === status))
      .filter((e) => {
        if (!q) return true
        const c = e.content
        return [c.word, c.definition, c.polish, c.example, c.tags.join(' ')].some((s) => s.toLowerCase().includes(q))
      })
      .sort((a, b) => a.content.word.toLowerCase().localeCompare(b.content.word.toLowerCase()))
  })
  const duplicates = $derived.by(() => {
    app.rev
    return app.svc!.duplicates()
  })

  function pickCollection(name: string) {
    collection = name
    tag = ''
    limit = 80
  }
  const dueLabel = (e: EntryState) => {
    const card = app.svc!.card(e.id)
    if (!card) return 'not studied'
    return card.reps ? `due ${shortDate(card.due)}` : 'taught'
  }
  $effect(() => {
    query; tag; status; collection
    limit = 80
  })
</script>

<div class="page">
  <div class="title">
    <div>
      <h1>Library</h1>
      <p class="totals muted">
        <b>{counts.total}</b> words in the library · <b>{counts.studied}</b> studied · <b>{counts.known}</b> known · <b>{counts.notStarted}</b> not started
      </p>
    </div>
    <div class="row">
      <button class="btn" onclick={() => (editing = { id: null })}>Add a word</button>
      <button class="btn" class:primary={all.length === 0 && !showImport} onclick={() => (showImport = !showImport)}>{showImport ? 'Hide import' : 'Import / Export'}</button>
    </div>
  </div>

  {#if showImport}
    <ImportPanel />
  {/if}

  {#if all.length}
    <div class="filters">
      <input class="input" type="search" placeholder="Search words, definitions, Polish, tags…" bind:value={query} aria-label="Search" />
      <select class="input" value={collection} onchange={(e) => pickCollection(e.currentTarget.value)} aria-label="Collection">
        <option value="">All collections</option>
        {#each collections as c (c.name)}
          <option value={c.name}>{' '.repeat(c.name.split(' > ').length - 1)}{c.name.split(' > ').pop()} ({c.total})</option>
        {/each}
      </select>
      <select class="input" bind:value={status} aria-label="Status">
        <option value="">Any status</option>
        {#each STATUSES as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </div>

    {#if collection && tags.length}
      <div class="tags" aria-label="Tags">
        {#each tags as [t, n] (t)}
          <button class="tag" class:on={tag === t} onclick={() => (tag = tag === t ? '' : t)}>{t} <i>{n}</i></button>
        {/each}
      </div>
    {/if}

    {#if duplicates.length}
      <details class="dups">
        <summary>{duplicates.length} word{duplicates.length > 1 ? 's' : ''} filed twice with the same meaning</summary>
        <ul>
          {#each duplicates as g (g.word)}
            <li><b>{g.word}</b> ({g.polish}): {g.entries.map((x) => crumb(x.collection)).join(' and ')}. Delete one if you only want it once.</li>
          {/each}
        </ul>
      </details>
    {/if}

    <p class="muted count">{filtered.length} shown</p>
    <ul class="list">
      {#each filtered.slice(0, limit) as e (e.id)}
        <li>
          <button class="row-item" onclick={() => (editing = { id: e.id })}>
            <span class="dot {e.status}" title={e.status}></span>
            <span class="main">
              <span class="w">{headword(e.content.word)}{#if e.content.word.includes('(')}<small> {e.content.word.slice(e.content.word.indexOf('('))}</small>{/if}</span>
              <span class="d">{e.content.definition}</span>
            </span>
            <span class="meta">
              <span>{crumb(e.content.collection).split(' › ').pop()}</span>
              <span>{dueLabel(e)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if filtered.length > limit}
      <div class="more"><button class="btn" onclick={() => (limit += 120)}>Show more ({filtered.length - limit} left)</button></div>
    {/if}
  {/if}
</div>

{#if editing}
  <EntryEditor entryId={editing.id} onclose={() => (editing = null)} />
{/if}

<style>
  .title { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.4rem; }
  h1 { font-size: 2.2rem; }
  .totals { margin: 0.4rem 0 0; font-size: 0.92rem; }
  .totals b { color: var(--text); font-weight: 600; }
  .row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .filters { display: grid; gap: 0.6rem; margin-bottom: 1rem; }
  @media (min-width: 52rem) { .filters { grid-template-columns: 2fr 1.2fr 0.8fr; } }
  .tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .tag {
    appearance: none;
    border: 1px solid var(--desk-line);
    background: transparent;
    color: var(--text-2);
    border-radius: 99px;
    padding: 0.25rem 0.8rem;
    cursor: pointer;
    font-size: 0.82rem;
  }
  .tag i { font-style: normal; color: var(--text-3); margin-left: 0.2rem; }
  .tag.on { background: var(--brass); color: #1c1708; border-color: var(--brass); }
  .tag.on i { color: #4a3f1c; }
  .dups { margin: 0.4rem 0 1rem; color: var(--text-2); font-size: 0.9rem; }
  .dups summary { cursor: pointer; }
  .count { font-size: 0.85rem; margin: 0.6rem 0; }
  .list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--desk-line); }
  .list li { border-bottom: 1px solid var(--desk-line); }
  .row-item {
    appearance: none;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.85rem 0.4rem;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.9rem;
    align-items: center;
    cursor: pointer;
  }
  .row-item:hover { background: var(--desk-2); }
  .dot { width: 0.65rem; height: 0.65rem; border-radius: 50%; border: 1.5px solid var(--text-3); }
  .dot.learning { background: var(--brass); border-color: var(--brass); }
  .dot.known { background: #6fb08f; border-color: #6fb08f; }
  .main { display: grid; min-width: 0; }
  .w { font-family: var(--serif); font-size: 1.15rem; }
  .w small { font-family: var(--sans); font-size: 0.8rem; color: var(--text-3); }
  .d { color: var(--text-2); font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: none; text-align: right; color: var(--text-3); font-size: 0.78rem; gap: 0.1rem; }
  @media (min-width: 40rem) { .meta { display: grid; } }
  .more { text-align: center; margin-top: 1.4rem; }
</style>
