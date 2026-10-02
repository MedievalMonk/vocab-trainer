<script lang="ts">
  import { untrack } from 'svelte'
  import { app, type ThesaurusSpec } from '../lib/app.svelte'
  import { makeRound, ratingForRound, type ClozeQuestion } from '../lib/thesaurus'
  import Card from './Card.svelte'
  import Meter from './Meter.svelte'
  import Overlay from './Overlay.svelte'
  import Speaker from './Speaker.svelte'

  let { spec }: { spec: Extract<ThesaurusSpec, { kind: 'practice' }> } = $props()

  const svc = app.svc!
  const ids = untrack(() => [...spec.clusterIds])

  let ci = $state(0)
  let round = $state<ClozeQuestion[]>([])
  let qi = $state(0)
  let picked = $state<number | null>(null)
  let results = $state<boolean[]>([])
  let summary = $state<{ correct: number; total: number; rating: 1 | 2 | 3; due?: Date } | null>(null)
  let finished = $state(false)
  let busy = $state(false)

  const cluster = $derived(svc.cluster(ids[ci])?.content)
  const q = $derived(round[qi])
  const answered = $derived(picked !== null)
  const right = $derived(picked !== null && q ? picked === q.answer : false)

  function start() {
    const c = svc.cluster(ids[ci])
    round = c ? makeRound(c.content) : []
    qi = 0
    picked = null
    results = []
    summary = null
    if (round.length === 0) advance()
  }
  function advance() {
    if (ci < ids.length - 1) {
      ci++
      start()
    } else finished = true
  }
  start()

  function choose(member: number) {
    if (picked !== null || !q) return
    picked = member
    results = [...results, member === q.answer]
  }

  async function next() {
    if (qi < round.length - 1) {
      qi++
      picked = null
      return
    }
    busy = true
    const correct = results.filter(Boolean).length
    const rating = ratingForRound(correct, results.length)
    const id = ids[ci]
    await app.run((s) => s.reviewCluster(id, rating, correct, results.length))
    summary = { correct, total: results.length, rating, due: svc.clusterList().find((c) => c.id === id)?.due }
    busy = false
  }

  function onKey(e: KeyboardEvent) {
    if (finished || busy) return
    if (summary) {
      if (e.key === 'Enter') advance()
    } else if (!answered && ['1', '2', '3', '4'].includes(e.key)) {
      const opt = q?.options[Number(e.key) - 1]
      if (opt !== undefined) choose(opt)
    } else if (answered && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      next()
    }
  }

  const when = (d: Date | undefined) => {
    if (!d) return ''
    const days = Math.max(1, Math.round((d.getTime() - Date.now()) / 86_400_000))
    return days === 1 ? 'tomorrow' : `in ${days} days`
  }
  const verdict = $derived(
    summary
      ? summary.rating === 3
        ? 'Every one right.'
        : summary.rating === 2
          ? 'One slip.'
          : 'A few slips.'
      : '',
  )
  const progress = $derived((ci + (summary ? 1 : round.length ? qi / round.length : 0)) / Math.max(ids.length, 1))
  const parts = $derived(q ? q.sentence.split('_____') : [])
</script>

<svelte:window onkeydown={onKey} />

<Overlay title={spec.title} {progress} closeLabel={finished ? 'Close' : 'End'} onclose={() => app.endThesaurus()}>
  {#if finished}
    <div class="center">
      <h2>Practice complete</h2>
      <p class="muted">{ids.length} {ids.length === 1 ? 'cluster' : 'clusters'} practised. Each one is scheduled for when you are about to lose the distinctions.</p>
      <button class="btn primary" onclick={() => app.endThesaurus()}>Back to the Thesaurus</button>
    </div>
  {:else if summary && cluster}
    <div class="recap">
      <h2>{verdict}</h2>
      <p class="muted">
        {summary.correct} of {summary.total} right in “{cluster.title}”.
        {#if summary.due}Next practice {when(summary.due)}.{/if}
      </p>
      <ol class="members">
        {#each cluster.members as m, i (m.word)}
          <li>
            <div class="mhead">
              <b>{m.word}</b>
              {#if cluster.ordered}<Meter index={i} count={cluster.members.length} />{/if}
            </div>
            <p>{m.nuance}</p>
          </li>
        {/each}
      </ol>
      <button class="btn primary" onclick={advance}>{ci < ids.length - 1 ? 'Next cluster' : 'Finish'}</button>
    </div>
  {:else if cluster && q}
    <Card collection={`${cluster.collection} > ${cluster.coreMeaning}`}>
      <div class="mono label">Which word fits best?</div>
      <p class="sentence">
        {parts[0]}<span class="blank" class:ok={answered}>{answered ? cluster.members[q.answer].word : '   '}</span>{parts[1] ?? ''}
      </p>

      <ol class="options">
        {#each q.options as opt, idx (opt)}
          <li>
            <button
              class="opt"
              class:right={answered && opt === q.answer}
              class:wrong={picked === opt && opt !== q.answer}
              disabled={answered}
              onclick={() => choose(opt)}
            >
              <span class="n">{idx + 1}</span>{cluster.members[opt].word}
            </button>
          </li>
        {/each}
      </ol>

      {#if answered && picked !== null}
        <div class="feedback" class:ok={right}>
          <p class="line">
            <b>{cluster.members[q.answer].word}</b>
            <Speaker text={cluster.members[q.answer].word} />
          </p>
          <p>{cluster.members[q.answer].nuance}</p>
          {#if !right}
            <p class="chosen">You chose <b>{cluster.members[picked].word}</b>: {cluster.members[picked].nuance}</p>
          {/if}
        </div>
      {/if}
    </Card>

    {#if answered}
      <nav class="actions"><button class="btn primary" onclick={next} disabled={busy}>{qi < round.length - 1 ? 'Next' : 'Finish round'}</button></nav>
    {/if}
  {/if}
</Overlay>

<style>
  .label { color: var(--ink-3); margin-bottom: 0.8rem; }
  .sentence { font-family: var(--serif); font-size: 1.55rem; line-height: 1.5; margin-bottom: 1.6rem; }
  .blank { display: inline-block; min-width: 4.5rem; border-bottom: 2px solid var(--ink); text-align: center; font-weight: 600; }
  .blank.ok { color: var(--good); border-color: var(--good); }
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
    font-family: var(--serif);
    font-size: 1.2rem;
  }
  .opt:hover:not(:disabled) { background: rgb(255 255 255 / 0.8); }
  .opt .n { font-family: var(--mono); color: var(--ink-3); font-size: 0.8rem; align-self: center; }
  .opt.right { background: #cfe3d3; border-color: var(--good); }
  .opt.wrong { background: #ecc9c9; border-color: var(--stamp); }
  .opt:disabled { cursor: default; }
  .feedback { margin-top: 1.3rem; padding: 0.8rem 1rem; border-left: 3px solid var(--stamp); background: rgb(140 44 49 / 0.08); }
  .feedback.ok { border-color: var(--good); background: rgb(47 107 82 / 0.1); }
  .feedback p { margin: 0 0 0.5rem; line-height: 1.5; }
  .line { display: flex; align-items: center; gap: 0.6rem; font-size: 1.2rem; font-family: var(--serif); }
  .chosen { color: var(--ink-2); font-size: 0.95rem; }
  .actions { display: flex; justify-content: center; margin-top: 2rem; }
  .center { max-width: 32rem; margin: 3rem auto; display: grid; gap: 1rem; justify-items: center; text-align: center; }
  .recap { max-width: 40rem; margin: 0 auto; }
  .recap h2 { font-size: 1.8rem; margin-bottom: 0.4rem; }
  .members { list-style: none; margin: 1.6rem 0 2rem; padding: 0; display: grid; gap: 1rem; }
  .members li { border-left: 3px solid var(--brass); padding-left: 1rem; }
  .mhead { display: flex; align-items: center; gap: 0.8rem; }
  .mhead b { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; flex: 1; }
  .members p { margin: 0.2rem 0 0; color: var(--text-2); font-size: 0.95rem; }
  .members :global(.meter i) { background: rgb(221 224 211 / 0.2); }
  .members :global(.meter i.on) { background: var(--brass); }
</style>
