<script lang="ts">
  import { untrack } from 'svelte'
  import type { Rating } from '../core/types'
  import { app, type SessionSpec } from '../lib/app.svelte'
  import { EXERCISE_KINDS, gradeTyped, headword, isPhrase, makeExercise, type Exercise, type ExerciseKind, type Verdict } from '../lib/exercises'
  import Card from './Card.svelte'
  import EntryFace from './EntryFace.svelte'
  import FlipCard from './FlipCard.svelte'
  import Speaker from './Speaker.svelte'

  let { spec }: { spec: SessionSpec } = $props()

  const svc = app.svc!
  const initial = untrack(() => spec)
  const entryOf = (id: string) => svc.state.entries.get(id)!
  const pool = [...svc.state.entries.values()].filter((e) => !e.deleted)

  // ---- shared state --------------------------------------------------------------------
  let queue = $state<string[]>([...initial.ids])
  let i = $state(0)
  let finished = $state(false)
  let busy = $state(false)
  let filedWord = $state<string | null>(null)
  const filedList = $state<string[]>([])
  const tally = $state({ right: 0, wrong: 0 })
  const retried = new Set<string>()

  // ---- quiz state ----------------------------------------------------------------------
  let exercise = $state<Exercise | null>(null)
  let flipped = $state(false)
  let picked = $state<number | null>(null)
  let typed = $state('')
  let verdict = $state<Verdict | null>(null)
  let lastKind: ExerciseKind | null = null

  const total = $derived(queue.length)
  const currentId = $derived(queue[i])
  const current = $derived(currentId ? entryOf(currentId) : null)
  const answered = $derived(picked !== null || verdict !== null)

  function present() {
    flipped = false
    picked = null
    typed = ''
    verdict = null
    if (initial.kind === 'teach') return
    const id = queue[i]
    if (id === undefined) {
      finished = true
      return
    }
    let kind: ExerciseKind
    if (initial.lock === 'mixed') {
      const options = EXERCISE_KINDS.filter((k) => k !== lastKind)
      kind = options[Math.floor(Math.random() * options.length)]
    } else kind = initial.lock
    exercise = makeExercise(entryOf(id), kind, pool)
    lastKind = exercise.kind
  }
  present()

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function grade(rating: Rating) {
    if (busy || !exercise) return
    busy = true
    const id = exercise.entryId
    const before = entryOf(id).status
    const after = await app.run((s) => s.review(id, rating, initial.mode))
    if (rating > 1) tally.right++
    else {
      tally.wrong++
      // A word you missed comes round once more before the session ends.
      if (!retried.has(id)) {
        retried.add(id)
        queue.push(id)
      }
    }
    if (after === 'known' && before !== 'known') {
      filedWord = headword(entryOf(id).content.word)
      filedList.push(filedWord)
      await sleep(1500)
      filedWord = null
    }
    i++
    busy = false
    present()
  }

  // ---- teach-first pass ----------------------------------------------------------------
  async function nextTaught() {
    if (i < total - 1) {
      i++
      present()
      return
    }
    busy = true
    await app.run((s) => s.markExposed(initial.ids))
    busy = false
    finished = true
  }
  function prevTaught() {
    if (i > 0) {
      i--
      present()
    }
  }

  // ---- quiz interactions ---------------------------------------------------------------
  function choose(idx: number) {
    if (picked === null) picked = idx
  }
  function check() {
    if (verdict || !exercise || !typed.trim()) return
    verdict = gradeTyped(typed, exercise.answer)
  }
  const choiceRight = $derived(exercise?.kind === 'choice' && picked !== null && picked === exercise.correct)
  const typedRating = $derived<Rating>(verdict === 'exact' ? 3 : verdict === 'close' ? 2 : 1)

  function onKey(e: KeyboardEvent) {
    if (finished || busy || (e.target instanceof HTMLInputElement)) return
    if (initial.kind === 'teach') {
      if (e.key === 'ArrowRight' || e.key === 'Enter') nextTaught()
      else if (e.key === 'ArrowLeft') prevTaught()
      return
    }
    if (!exercise) return
    if (exercise.kind === 'flashcard') {
      if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        flipped = true
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) as Rating)
    } else if (exercise.kind === 'choice') {
      if (picked === null && ['1', '2', '3', '4'].includes(e.key)) choose(Number(e.key) - 1)
      else if (picked !== null && e.key === 'Enter') grade(choiceRight ? 3 : 1)
    } else if (verdict && e.key === 'Enter') grade(typedRating)
  }

  const title = $derived(initial.title)
</script>

<svelte:window onkeydown={onKey} />

<div class="session" role="dialog" aria-label={title}>
  <header>
    <div class="bar" aria-hidden="true"><span style:width="{finished ? 100 : (i / Math.max(total, 1)) * 100}%"></span></div>
    <div class="top">
      <span class="mono">{title}</span>
      {#if !finished}<span class="mono">{Math.min(i + 1, total)} / {total}</span>{/if}
      <button class="btn quiet" onclick={() => app.endSession()}>{finished ? 'Close' : 'End session'}</button>
    </div>
  </header>

  <main>
    {#if finished}
      <div class="summary">
        <h2>{initial.kind === 'teach' ? 'Filed for revision' : 'Session complete'}</h2>
        {#if initial.kind === 'teach'}
          <p class="muted">
            {initial.ids.length} words taught. Your first quiz on them opens in about {svc.settings.firstReviewDelayMin} minutes and they will appear
            in Repetitions. Nothing was scored.
          </p>
        {:else}
          <p class="muted">{tally.right} of {tally.right + tally.wrong} answers correct.</p>
          {#if filedList.length}
            <p class="muted">Filed as known: {filedList.join(', ')}.</p>
          {/if}
        {/if}
        <button class="btn primary" onclick={() => app.endSession()}>Back to the desk</button>
      </div>
    {:else if initial.kind === 'teach' && current}
      <Card collection={current.content.collection} phrase={isPhrase(current.content)}>
        <EntryFace content={current.content} />
      </Card>
      <nav class="actions">
        <button class="btn" onclick={prevTaught} disabled={i === 0}>Back</button>
        <button class="btn primary" onclick={nextTaught} disabled={busy}>{i < total - 1 ? 'Next' : 'Done: file these words'}</button>
      </nav>
      <p class="hint muted">Take your time: this pass is not scored.</p>
    {:else if exercise && current}
      {@const phrase = isPhrase(current.content)}
      {#if exercise.kind === 'flashcard'}
        <FlipCard {flipped} {phrase} collection={current.content.collection}>
          {#snippet front()}
            <div class="prompt">
              <div class="mono label">{exercise!.label}</div>
              <div class="headword">{exercise!.prompt}</div>
              {#if exercise!.direction === 'en2pl'}<Speaker text={exercise!.prompt} />{/if}
            </div>
          {/snippet}
          {#snippet back()}
            <EntryFace content={current.content} />
          {/snippet}
        </FlipCard>
        <nav class="actions">
          {#if !flipped}
            <button class="btn primary" onclick={() => (flipped = true)}>Show the card</button>
          {:else}
            <div class="ratings">
              <button class="btn" onclick={() => grade(1)} disabled={busy}><b>Again</b><small>1</small></button>
              <button class="btn" onclick={() => grade(2)} disabled={busy}><b>Hard</b><small>2</small></button>
              <button class="btn" onclick={() => grade(3)} disabled={busy}><b>Good</b><small>3</small></button>
              <button class="btn" onclick={() => grade(4)} disabled={busy}><b>Easy</b><small>4</small></button>
            </div>
          {/if}
        </nav>
      {:else}
        <Card collection={current.content.collection} {phrase}>
          <div class="prompt">
            <div class="mono label">{exercise.label}</div>
            <div class={exercise.kind === 'blank' || exercise.prompt.length > 40 ? 'long' : 'headword'}>{exercise.prompt}</div>
          </div>

          {#if exercise.kind === 'choice'}
            <ol class="options">
              {#each exercise.options ?? [] as opt, idx (idx)}
                <li>
                  <button
                    class="opt"
                    class:right={picked !== null && idx === exercise.correct}
                    class:wrong={picked === idx && idx !== exercise.correct}
                    disabled={picked !== null}
                    onclick={() => choose(idx)}
                  >
                    <span class="n">{idx + 1}</span>{opt}
                  </button>
                </li>
              {/each}
            </ol>
          {:else}
            <form
              class="typed"
              onsubmit={(e) => {
                e.preventDefault()
                check()
              }}
            >
              <input
                class="paper-input"
                bind:value={typed}
                disabled={verdict !== null}
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder="Type the word"
                aria-label="Your answer"
              />
              {#if !verdict}<button class="btn primary" type="submit" disabled={!typed.trim()}>Check</button>{/if}
            </form>
          {/if}

          {#if answered}
            <div class="result" class:ok={exercise.kind === 'choice' ? choiceRight : verdict !== 'wrong'}>
              {#if exercise.kind === 'choice'}
                {choiceRight ? 'Correct.' : 'Not this time.'}
              {:else if verdict === 'exact'}
                Correct.
              {:else if verdict === 'close'}
                Almost: check the spelling.
              {:else}
                Not this time.
              {/if}
              {#if exercise.kind !== 'choice' || !choiceRight}
                <span class="answer">{exercise.answer}</span>
                <Speaker text={exercise.answer} />
              {/if}
            </div>
            <details class="more">
              <summary>Show the full card</summary>
              <EntryFace content={current.content} />
            </details>
          {/if}
        </Card>

        {#if answered}
          <nav class="actions">
            {#if (exercise.kind === 'choice' && choiceRight) || verdict === 'exact'}
              <button class="btn" onclick={() => grade(4)} disabled={busy}>Too easy</button>
            {/if}
            <button class="btn primary" onclick={() => grade(exercise!.kind === 'choice' ? (choiceRight ? 3 : 1) : typedRating)} disabled={busy}>Continue</button>
          </nav>
        {/if}
      {/if}
    {/if}
  </main>

  {#if filedWord}
    <div class="filed" aria-live="polite">
      <div class="stamp"><span>Filed</span><b>{filedWord}</b></div>
    </div>
  {/if}
</div>

<style>
  .session {
    position: fixed;
    inset: 0;
    z-index: 50;
    overflow-y: auto;
    background: radial-gradient(ellipse at 50% -10%, #17304f 0%, transparent 60%), var(--desk);
  }
  header {
    position: sticky;
    top: 0;
    background: var(--desk);
    border-bottom: 1px solid var(--desk-line);
    z-index: 2;
  }
  .bar { height: 3px; background: var(--desk-2); }
  .bar span { display: block; height: 100%; background: var(--brass); transition: width 0.3s; }
  .top {
    max-width: 62rem;
    margin: 0 auto;
    padding: 0.35rem 1rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    color: var(--text-2);
    white-space: nowrap;
  }
  .top .mono:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .top .btn { padding: 0.4rem 0.9rem; min-height: 2.4rem; }
  main {
    max-width: 62rem;
    margin: 0 auto;
    padding: 3rem 1rem 6rem;
  }
  .prompt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
    margin-bottom: 1.4rem;
  }
  .label { color: var(--ink-3); }
  .long {
    font-family: var(--serif);
    font-size: 1.45rem;
    line-height: 1.45;
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 0.8rem;
    margin-top: 2rem;
  }
  .ratings {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 7rem));
    gap: 0.6rem;
  }
  .ratings .btn { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; padding: 0.6rem 0.3rem; }
  .ratings small { color: var(--text-3); font-family: var(--mono); }
  .hint { text-align: center; margin-top: 1rem; font-size: 0.9rem; }

  .options { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
  .opt {
    appearance: none;
    width: 100%;
    text-align: left;
    background: rgb(255 255 255 / 0.45);
    border: 1px solid var(--ink-3);
    border-radius: 3px;
    padding: 0.8rem 1rem;
    color: var(--ink);
    cursor: pointer;
    display: flex;
    gap: 0.8rem;
    line-height: 1.4;
  }
  .opt:hover:not(:disabled) { background: rgb(255 255 255 / 0.8); }
  .opt .n { font-family: var(--mono); color: var(--ink-3); }
  .opt.right { background: #cfe3d3; border-color: var(--good); }
  .opt.wrong { background: #ecc9c9; border-color: var(--stamp); }
  .opt:disabled { cursor: default; }

  .typed { display: flex; gap: 0.6rem; }
  .paper-input {
    flex: 1;
    min-width: 0;
    background: rgb(255 255 255 / 0.55);
    border: 1px solid var(--ink-3);
    border-radius: 3px;
    padding: 0.7rem 0.8rem;
    font-family: var(--serif);
    font-size: 1.3rem;
    color: var(--ink);
  }
  .result {
    margin-top: 1.2rem;
    padding: 0.7rem 0.9rem;
    border-left: 3px solid var(--stamp);
    background: rgb(140 44 49 / 0.08);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .result.ok { border-color: var(--good); background: rgb(47 107 82 / 0.1); }
  .answer { font-family: var(--serif); font-size: 1.3rem; font-weight: 600; }
  .more { margin-top: 1rem; }
  .more summary { cursor: pointer; color: var(--ink-2); font-size: 0.9rem; margin-bottom: 1rem; }

  .summary { max-width: 32rem; margin: 3rem auto; text-align: center; display: grid; gap: 1rem; justify-items: center; }

  .filed {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgb(8 14 24 / 0.55);
    pointer-events: none;
    animation: fade 1.5s both;
  }
  .stamp {
    border: 4px double var(--stamp);
    color: #d98a8e;
    background: rgb(12 23 38 / 0.9);
    padding: 1.1rem 2.4rem;
    border-radius: 6px;
    text-align: center;
    transform: rotate(-8deg);
    animation: thud 0.5s cubic-bezier(0.2, 0.9, 0.2, 1) both;
  }
  .stamp span {
    display: block;
    font-family: var(--mono);
    letter-spacing: 0.4em;
    font-size: 1.6rem;
    text-transform: uppercase;
  }
  .stamp b { display: block; font-family: var(--serif); font-size: 1.1rem; color: var(--text); margin-top: 0.3rem; }
  @keyframes thud {
    from { transform: rotate(-8deg) scale(1.7); opacity: 0; }
    to { transform: rotate(-8deg) scale(1); opacity: 1; }
  }
  @keyframes fade {
    0%, 75% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
