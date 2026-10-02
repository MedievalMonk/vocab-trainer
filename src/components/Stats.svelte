<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { headword, KIND_LABEL, type ExerciseKind } from '../lib/exercises'
  import { crumb } from '../lib/format'

  const s = $derived.by(() => {
    app.rev
    return app.svc!.stats()
  })
  const target = $derived(Math.round(app.svc!.settings.requestRetention * 100))

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null)
  const lib = $derived(s.library)
  const learningPct = $derived(pct(lib.learning, lib.total) ?? 0)
  const knownPct = $derived(pct(lib.known, lib.total) ?? 0)
  const accuracy = $derived(pct(s.reviews.correct, s.reviews.total))
  const retention = $derived(pct(s.reviews.matureCorrect, s.reviews.matureTotal))
  const maxDay = $derived(Math.max(1, ...s.last30.map((d) => d.reviews)))
  const last30Total = $derived(s.last30.reduce((a, d) => a + d.reviews, 0))
  const sinceLabel = $derived(
    s.since ? new Date(s.since + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null,
  )
  const dayLabel = (key: string) => {
    const d = new Date(key + 'T00:00:00Z')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
  const kindName = (k: string) => KIND_LABEL[k as ExerciseKind] ?? k
</script>

<div class="page">
  <button class="back mono" onclick={() => app.go('review')}>‹ Review</button>
  <div class="title">
    <h1>Stats</h1>
    {#if sinceLabel}<span class="mono since">Since {sinceLabel}{s.sinceReset ? ' · last reset' : ''}</span>{/if}
  </div>

  <section>
    <h2>Your words</h2>
    <dl class="tiles">
      <div><dt>In the library</dt><dd>{lib.total}</dd></div>
      <div><dt>Studied</dt><dd>{lib.studied}</dd></div>
      <div><dt>Learning</dt><dd>{lib.learning}</dd></div>
      <div><dt>Known</dt><dd>{lib.known}</dd></div>
      <div><dt>Not started</dt><dd>{lib.notStarted}</dd></div>
    </dl>
    {#if lib.total}
      <div class="stack" role="img" aria-label="{lib.known} known, {lib.learning} learning, rest not started">
        <span class="known" style:width="{knownPct}%"></span>
        <span class="learning" style:width="{learningPct}%"></span>
      </div>
      <p class="muted legend"><i class="k"></i> known <i class="l"></i> learning <i class="n"></i> not started</p>
    {/if}
  </section>

  <section>
    <h2>Answers and retention</h2>
    <dl class="tiles">
      <div><dt>Answers</dt><dd>{s.reviews.total}</dd></div>
      <div><dt>Correct</dt><dd>{accuracy === null ? '–' : accuracy + '%'}</dd></div>
      <div><dt>Retention</dt><dd>{retention === null ? '–' : retention + '%'}</dd></div>
      <div><dt>Days studied</dt><dd>{s.reviews.activeDays}</dd></div>
      <div><dt>Per study day</dt><dd>{s.reviews.perActiveDay === null ? '–' : Math.round(s.reviews.perActiveDay)}</dd></div>
    </dl>
    <p class="muted note">
      <b>Retention</b> counts only answers on words you had already learned ({s.reviews.matureTotal} so far). The scheduler aims for {target}%;
      {#if retention === null}it appears once words have come back for review.
      {:else if retention >= target - 3}you are right on target.
      {:else}a little lower than the target, which usually means reviews are bunching up or the words are hard.{/if}
    </p>
  </section>

  <section>
    <h2>Last 30 days</h2>
    <div class="chart" role="img" aria-label="Answers per day over the last 30 days: {last30Total} in total">
      {#each s.last30 as d (d.day)}
        <div class="bar-col" title="{dayLabel(d.day)}: {d.reviews} answers{d.taught ? ', ' + d.taught + ' words taught' : ''}">
          <div class="bar" style:height="{d.reviews ? Math.max(4, (d.reviews / maxDay) * 100) : 0}%"></div>
          {#if d.taught}<span class="taught" aria-hidden="true"></span>{/if}
        </div>
      {/each}
    </div>
    <div class="axis mono"><span>{dayLabel(s.last30[0].day)}</span><span>{dayLabel(s.last30[14].day)}</span><span>Today</span></div>
    <p class="muted note">{last30Total} answers in 30 days. A dot under a bar marks a day you learned new words.</p>
  </section>

  <section>
    <h2>By collection</h2>
    {#if s.collections.length}
      <ul class="rows">
        {#each s.collections as c (c.collection)}
          <li>
            <div class="row-head">
              <span class="name">{crumb(c.collection)}</span>
              <span class="num mono">{c.known} known · {c.studied} / {c.total} studied</span>
            </div>
            <div class="bar-track" aria-hidden="true">
              <span class="known" style:width="{(c.known / c.total) * 100}%"></span>
              <span class="studied" style:width="{((c.studied - c.known) / c.total) * 100}%"></span>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Nothing here yet.</p>
    {/if}
  </section>

  <section>
    <h2>By exercise type</h2>
    {#if s.exercises.length}
      <ul class="rows">
        {#each s.exercises as x (x.kind)}
          <li>
            <div class="row-head">
              <span class="name">{kindName(x.kind)}</span>
              <span class="num mono">{Math.round((x.correct / x.total) * 100)}% of {x.total}</span>
            </div>
            <div class="bar-track" aria-hidden="true"><span class="known" style:width="{(x.correct / x.total) * 100}%"></span></div>
          </li>
        {/each}
      </ul>
      <p class="muted note">Typing exercises are usually harder than choosing: a lower score there is normal, and where the learning happens.</p>
    {:else}
      <p class="muted">Shows up once you have answered some quiz questions.</p>
    {/if}
  </section>

  <section>
    <h2>Words that keep slipping</h2>
    {#if s.hardest.length}
      <ol class="hard">
        {#each s.hardest as h (h.id)}
          <li>
            <span class="name">{headword(h.word)}</span>
            <span class="muted">{crumb(h.collection).split(' › ').pop()}</span>
            <span class="num mono">forgotten {h.lapses}×</span>
          </li>
        {/each}
      </ol>
      <p class="muted note">Words you have forgotten after learning them, most often first. Worth a better example sentence in the Library.</p>
    {:else}
      <p class="muted">No word has been forgotten twice yet.</p>
    {/if}
  </section>

  <section>
    <h2>Pace</h2>
    {#if s.pace.estimatedActiveDays !== null && s.pace.notStarted > 0}
      <p>
        You have learned about <b>{s.pace.newPerActiveDay!.toFixed(1)}</b> new words per study day. The <b>{s.pace.notStarted}</b> not yet started would
        take about <b>{s.pace.estimatedActiveDays}</b> more study days at that rate. An estimate, nothing more.
      </p>
    {:else if s.pace.notStarted === 0 && lib.total > 0}
      <p>Every word in the library has been started.</p>
    {:else}
      <p class="muted">An estimate appears once you have learned some new words.</p>
    {/if}
  </section>
</div>

<style>
  .back { appearance: none; background: none; border: 0; color: var(--brass); cursor: pointer; padding: 0.3rem 0; margin-bottom: 0.6rem; }
  .title { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  h1 { font-size: 2.2rem; }
  .since { color: var(--text-3); }
  section { margin-top: 2.6rem; }
  h2 { font-size: 1.3rem; margin-bottom: 1rem; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.2rem, 1fr)); gap: 0.8rem; margin: 0 0 1rem; }
  .tiles div { background: var(--desk-2); border: 1px solid var(--desk-line); border-radius: 3px; padding: 0.8rem 1rem; }
  .tiles dt { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3); }
  .tiles dd { margin: 0.2rem 0 0; font-family: var(--serif); font-size: 1.9rem; line-height: 1.1; }
  .note { font-size: 0.88rem; max-width: 42rem; margin-top: 0.8rem; }

  .stack { display: flex; height: 0.9rem; background: var(--desk-3); border-radius: 2px; overflow: hidden; }
  .stack .known, .bar-track .known { background: #6fb08f; }
  .stack .learning { background: var(--brass); }
  .legend { font-size: 0.82rem; margin-top: 0.6rem; }
  .legend i { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 2px; margin: 0 0.25rem 0 0.8rem; vertical-align: -0.05rem; }
  .legend i:first-child { margin-left: 0; }
  .legend .k { background: #6fb08f; }
  .legend .l { background: var(--brass); }
  .legend .n { background: var(--desk-3); border: 1px solid var(--desk-line); }

  .chart { display: grid; grid-template-columns: repeat(30, 1fr); gap: 3px; height: 9rem; align-items: end; border-bottom: 1px solid var(--desk-line); }
  .bar-col { position: relative; height: 100%; display: flex; align-items: flex-end; }
  .bar { width: 100%; background: var(--paper-2); border-radius: 2px 2px 0 0; }
  .bar-col:last-child .bar { background: var(--brass); }
  .taught { position: absolute; left: 50%; bottom: -0.65rem; width: 0.38rem; height: 0.38rem; margin-left: -0.19rem; border-radius: 50%; background: #6fb08f; }
  .axis { display: flex; justify-content: space-between; color: var(--text-3); font-size: 0.6rem; margin-top: 0.9rem; }

  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.9rem; }
  .row-head { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; margin-bottom: 0.3rem; }
  .name { font-family: var(--serif); }
  .num { color: var(--text-3); font-size: 0.65rem; white-space: nowrap; }
  .bar-track { display: flex; height: 0.55rem; background: var(--desk-3); border-radius: 2px; overflow: hidden; }
  .bar-track .studied { background: var(--brass); }

  .hard { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--desk-line); }
  .hard li { display: grid; grid-template-columns: 1fr auto auto; gap: 1rem; align-items: baseline; padding: 0.6rem 0; border-bottom: 1px solid var(--desk-line); }
</style>
