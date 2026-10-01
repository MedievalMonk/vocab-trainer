<script lang="ts">
  import type { NewWordsMode } from '../core/queue'
  import { app } from '../lib/app.svelte'
  import { EXERCISE_KINDS, KIND_LABEL, type ExerciseKind } from '../lib/exercises'
  import { collectionList, crumb } from '../lib/format'

  type Tab = 'new' | 'rep'
  let tab = $state<Tab>('new')
  let modeKind = $state<NewWordsMode['kind']>('random')
  let collection = $state('')
  let lock = $state<'mixed' | ExerciseKind>('mixed')
  // Any batch size you like: starts at your saved default and is remembered when you change it.
  let sizeText = $state(String(app.svc!.settings.batchSize))
  const size = $derived.by(() => {
    const n = Math.floor(Number(sizeText))
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : app.svc!.settings.batchSize
  })
  async function rememberSize() {
    sizeText = String(size)
    if (size !== app.svc!.settings.batchSize) await app.run((s) => s.updateSettings({ batchSize: size }))
  }

  const collections = $derived.by(() => {
    app.rev
    return collectionList(app.svc!.state)
  })
  const mode = $derived<NewWordsMode>(
    modeKind === 'collection' ? { kind: 'collection', collection: collection || collections[0]?.name || '' } : { kind: modeKind },
  )
  const batch = $derived.by(() => {
    app.rev
    return app.svc!.newWords(mode, undefined, size)
  })
  const revisit = $derived.by(() => {
    app.rev
    return app.svc!.revisit(size)
  })
  const dash = $derived.by(() => {
    app.rev
    return app.svc!.dashboard()
  })
  const repBatch = $derived.by(() => {
    app.rev
    return app.svc!.repetitions(size)
  })

  function startTeach() {
    app.startSession({ kind: 'teach', ids: app.svc!.newWords(mode, undefined, size).ids, lock, mode: 'new', title: 'New words' })
  }
  function startRevisit() {
    app.startSession({ kind: 'quiz', ids: app.svc!.revisit(size), lock, mode: 'revisit', title: 'Quiz: taught words' })
  }
  function startReps() {
    app.startSession({ kind: 'quiz', ids: app.svc!.repetitions(size), lock, mode: 'repetition', title: 'Repetitions' })
  }

  const MODES: { kind: NewWordsMode['kind']; label: string; hint: string }[] = [
    { kind: 'random', label: 'Random', hint: 'From the whole dictionary' },
    { kind: 'collection', label: 'Collection', hint: 'One subject, book or set' },
    { kind: 'recent', label: 'Recently added', hint: 'Newest words not yet studied' },
  ]
</script>

<div class="page">
  <h1>Study</h1>

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'new'} class:on={tab === 'new'} onclick={() => (tab = 'new')}>New words</button>
    <button role="tab" aria-selected={tab === 'rep'} class:on={tab === 'rep'} onclick={() => (tab = 'rep')}>
      Repetitions{#if dash.dueNow}<span class="badge">{dash.dueNow}</span>{/if}
    </button>
  </div>

  <label class="field size">
    <span>Words per batch</span>
    <input class="input" type="number" inputmode="numeric" min="1" max="500" bind:value={sizeText} onchange={rememberSize} />
  </label>

  {#if tab === 'new'}
    <section>
      <p class="muted lead">
        New words are first <em>taught</em> as plain flashcards, with no scoring, and only then quizzed.
      </p>

      <div class="modes">
        {#each MODES as m (m.kind)}
          <label class="mode" class:on={modeKind === m.kind}>
            <input type="radio" name="mode" value={m.kind} bind:group={modeKind} />
            <b>{m.label}</b>
            <span>{m.hint}</span>
          </label>
        {/each}
      </div>

      {#if modeKind === 'collection'}
        <label class="field">
          <span>Collection</span>
          <select class="input" bind:value={collection}>
            {#each collections as c (c.name)}
              <option value={c.name}>{crumb(c.name)} ({c.unseen} new)</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if batch.paused}
        <p class="note">
          New words are paused while repetitions are waiting. This keeps the pile from growing. Catch up in Repetitions and they resume by themselves.
        </p>
      {:else if batch.ids.length === 0}
        <p class="note">No unstudied words in this selection.</p>
      {/if}
      <div class="row">
        <button class="btn primary big" onclick={startTeach} disabled={batch.ids.length === 0}>
          {batch.ids.length ? `Teach me ${batch.ids.length} ${batch.ids.length === 1 ? 'word' : 'words'}` : 'Nothing to teach'}
        </button>
      </div>

      {#if revisit.length}
        <div class="revisit">
          <h2>Taught, not yet quizzed</h2>
          <p class="muted">{revisit.length} words have had their first pass and are ready for quiz-style exercises.</p>
          <label class="field inline">
            <span>Exercises</span>
            <select class="input" bind:value={lock}>
              <option value="mixed">Mix of all four</option>
              {#each EXERCISE_KINDS as k (k)}<option value={k}>{KIND_LABEL[k]} only</option>{/each}
            </select>
          </label>
          <button class="btn" onclick={startRevisit}>Quiz these {revisit.length}</button>
        </div>
      {/if}
    </section>
  {:else}
    <section>
      <p class="muted lead">
        Words the scheduler says you are about to forget, most at risk first. A batch is never larger than what is left of your daily limit ({dash.dailyCap}).
      </p>
      <div class="facts">
        <div><b>{dash.dueNow}</b><span>due now</span></div>
        <div><b>{dash.doneToday}</b><span>done today</span></div>
        <div><b>{dash.remainingToday}</b><span>left in today's limit</span></div>
      </div>
      <label class="field">
        <span>Exercise types</span>
        <select class="input" bind:value={lock}>
          <option value="mixed">Mix of all four</option>
          {#each EXERCISE_KINDS as k (k)}<option value={k}>{KIND_LABEL[k]} only</option>{/each}
        </select>
      </label>
      <div class="row">
        <button class="btn primary big" onclick={startReps} disabled={repBatch.length === 0}>
          {repBatch.length ? `Start ${repBatch.length} reviews` : 'Nothing to review'}
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  h1 { font-size: 2.2rem; margin-bottom: 1.2rem; }
  .tabs { display: flex; gap: 0.3rem; border-bottom: 1px solid var(--desk-line); margin-bottom: 1.6rem; }
  .tabs button {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-bottom: 0;
    color: var(--text-2);
    padding: 0.7rem 1.3rem;
    cursor: pointer;
    border-radius: 3px 3px 0 0;
    font-family: var(--serif);
    font-size: 1.1rem;
  }
  .tabs button.on { background: var(--desk-2); border-color: var(--desk-line); color: var(--text); margin-bottom: -1px; }
  .badge { margin-left: 0.5rem; font-family: var(--mono); font-size: 0.7rem; background: var(--brass); color: #1c1708; padding: 0.1rem 0.45rem; border-radius: 99px; }
  .lead { max-width: 40rem; }
  .size { max-width: 10rem; margin-bottom: 1.2rem; }
  .modes { display: grid; gap: 0.6rem; margin: 1.4rem 0; }
  @media (min-width: 40rem) { .modes { grid-template-columns: repeat(3, 1fr); } }
  .mode {
    display: grid;
    gap: 0.15rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--desk-line);
    border-radius: 3px;
    background: var(--desk-2);
    cursor: pointer;
  }
  .mode input { position: absolute; opacity: 0; pointer-events: none; }
  .mode b { font-family: var(--serif); font-size: 1.1rem; }
  .mode span { color: var(--text-2); font-size: 0.85rem; }
  .mode.on { border-color: var(--brass); background: var(--desk-3); }
  .mode:has(:focus-visible) { outline: 2px solid var(--brass); outline-offset: 2px; }
  .note { margin: 1rem 0; padding: 0.7rem 0.9rem; border-left: 3px solid var(--brass); color: var(--text-2); font-size: 0.92rem; }
  .row { display: flex; gap: 0.8rem; margin-top: 1.2rem; }
  .big { padding: 0.9rem 1.6rem; font-size: 1.1rem; }
  .revisit { margin-top: 3rem; padding-top: 1.6rem; border-top: 1px solid var(--desk-line); }
  .revisit h2 { font-size: 1.3rem; margin-bottom: 0.4rem; }
  .field.inline { max-width: 20rem; }
  .facts { display: flex; gap: 2rem; margin: 1.4rem 0; flex-wrap: wrap; }
  .facts div { display: grid; }
  .facts b { font-family: var(--serif); font-size: 2.2rem; font-weight: 600; line-height: 1; }
  .facts span { color: var(--text-2); font-size: 0.85rem; }
</style>
