<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { devSeedAvailable, devSeedTexts } from '../lib/devseed'
  import { addDays } from '../core/history'
  import { crumb } from '../lib/format'
  import Calendar from './Calendar.svelte'
  import DataPanel from './DataPanel.svelte'

  const dash = $derived.by(() => {
    app.rev
    return app.svc!.dashboard()
  })
  const empty = $derived.by(() => {
    app.rev
    return app.svc!.state.entries.size === 0
  })
  const settings = $derived.by(() => {
    app.rev
    return app.svc!.settings
  })

  const cal = $derived.by(() => {
    app.rev
    return app.svc!.calendar()
  })
  const dayLabels = $derived(
    dash.forecast.map((_, i) => {
      const key = addDays(cal.today, i)
      const d = new Date(key + 'T00:00:00Z')
      const wd = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
      return `${wd} ${d.getUTCDate()}`
    }),
  )
  const sinceLabel = $derived(
    cal.since
      ? new Date(cal.since + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      : null,
  )
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '–')
  const maxBar = $derived(Math.max(1, ...dash.forecast))
  const weekTotal = $derived(dash.forecast.reduce((a, b) => a + b, 0))

  function startRepetitions() {
    app.startSession({ kind: 'quiz', ids: app.svc!.repetitions(), lock: 'mixed', mode: 'repetition', title: 'Repetitions' })
  }

  let seeding = $state(false)
  async function seed() {
    seeding = true
    for (const text of await devSeedTexts()) await app.run((s) => s.importMarkdown(text))
    seeding = false
  }

  async function setCap(e: Event) {
    const n = Math.round(Number((e.currentTarget as HTMLInputElement).value))
    if (n >= 1 && n <= 1000) await app.run((s) => s.updateSettings({ dailyCap: n }))
  }
</script>

<div class="page">
  {#if empty}
    <section class="welcome">
      <p class="mono">Nothing filed yet</p>
      <h1>Your dictionary is empty</h1>
      <p class="muted">
        Import your vocabulary files (.md) in the Library. Everything stays on this device; the Markdown export is your permanent, readable backup.
      </p>
      <div class="row">
        <button class="btn primary" onclick={() => app.go('library')}>Go to Library</button>
        {#if devSeedAvailable}
          <button class="btn" onclick={seed} disabled={seeding}>{seeding ? 'Importing…' : 'Load content/ (dev)'}</button>
        {/if}
      </div>
    </section>
  {:else}
    <div class="grid">
      <section class="due">
        <div class="slip">
          <span class="mono">Due today</span>
          <div class="number" aria-live="polite">{dash.dueToday}</div>
          <p class="sub">
            {#if dash.dueNow > 0}
              {dash.dueNow} waiting now{#if dash.dueToday > dash.dueNow}, {dash.dueToday - dash.dueNow} later today{/if}
            {:else if dash.dueToday > 0}
              Nothing waiting yet: {dash.dueToday} fall due later today
            {:else}
              Nothing waiting right now
            {/if}
            · {dash.doneToday} of {dash.dailyCap} done today
          </p>
        </div>
        <div class="row">
          <button class="btn primary big" onclick={startRepetitions} disabled={dash.dueNow === 0 || dash.remainingToday === 0}>
            Start repetitions
          </button>
          <button class="btn quiet" onclick={() => app.go('study')}>New words</button>
        </div>
        {#if dash.remainingToday === 0 && dash.dueNow > 0}
          <p class="note">Today's limit of {dash.dailyCap} is reached. The rest keeps until tomorrow, and nothing is lost.</p>
        {:else if dash.active}
          <p class="note">A backlog is waiting, so new words are paused. They resume once you catch up; no streaks, nothing to make up.</p>
        {/if}
      </section>

      <section class="forecast">
        <h2>Next seven days</h2>
        <div class="bars" role="img" aria-label="Reviews due per day: {dash.forecast.join(', ')}">
          {#each dash.forecast as n, i (i)}
            <div class="col">
              <span class="count">{n}</span>
              <div class="bar" style:height="{Math.max(n ? 6 : 2, (n / maxBar) * 100)}%"></div>
              <span class="mono day">{dayLabels[i]}</span>
            </div>
          {/each}
        </div>
        <p class="muted small">{weekTotal} reviews in the coming week, counting today's.</p>
      </section>

      <section class="collections">
        <h2>Due by collection</h2>
        {#if dash.perCollection.length}
          <ul class="index">
            {#each dash.perCollection as c (c.collection)}
              <li><span class="name">{crumb(c.collection)}</span><i></i><span class="n">{c.dueToday}</span></li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Nothing due today.</p>
        {/if}
      </section>
    </div>

    <section class="history">
      <div class="h-head">
        <h2>Calendar and history</h2>
        {#if sinceLabel}
          <span class="mono since">Since {sinceLabel}{cal.sinceReset ? ' · last reset' : ''}</span>
        {/if}
      </div>
      <dl class="tiles">
        <div><dt>Answers</dt><dd>{cal.totals.reviews}</dd></div>
        <div><dt>Correct</dt><dd>{pct(cal.totals.correct, cal.totals.reviews)}</dd></div>
        <div><dt>Words taught</dt><dd>{cal.totals.taught}</dd></div>
        <div><dt>Filed as known</dt><dd>{cal.totals.known}</dd></div>
        <div><dt>Days studied</dt><dd>{cal.totals.activeDays}</dd></div>
      </dl>
      <Calendar data={cal} />
    </section>

    <details class="settings">
      <summary class="mono">Settings</summary>
      <label class="field">
        <span>Daily review limit (the queue never goes past this)</span>
        <input class="input narrow" type="number" min="1" max="1000" value={settings.dailyCap} onchange={setCap} />
      </label>
      {#if app.persisted === false}
        <p class="note">
          Your browser has not granted permanent storage. Install the app to the home screen, and keep exporting Markdown backups.
        </p>
      {/if}
      <DataPanel />
    </details>
  {/if}
</div>

<style>
  .grid {
    display: grid;
    gap: 2.5rem;
  }
  @media (min-width: 52rem) {
    .grid {
      grid-template-columns: 1.1fr 1fr;
      align-items: start;
    }
    .due { grid-row: span 2; }
  }
  .slip {
    position: relative;
    background: var(--paper);
    color: var(--ink);
    border-radius: 3px;
    padding: 2.6rem 1.6rem 1.4rem;
    box-shadow: 0 2px 0 var(--paper-edge), 0 14px 34px rgb(0 0 0 / 0.5);
    border-top: 5px solid var(--stamp);
    margin-bottom: 1.5rem;
  }
  .slip .mono { position: absolute; top: 0.9rem; left: 1.6rem; color: var(--ink-3); }
  .number {
    font-family: var(--serif);
    font-size: clamp(5rem, 22vw, 9rem);
    line-height: 0.95;
    letter-spacing: -0.03em;
  }
  .sub { margin: 0.8rem 0 0; color: var(--ink-2); }
  .row { display: flex; gap: 0.8rem; flex-wrap: wrap; align-items: center; }
  .big { padding: 0.9rem 1.6rem; font-size: 1.1rem; }
  .note {
    margin-top: 1.2rem;
    padding: 0.7rem 0.9rem;
    border-left: 3px solid var(--brass);
    color: var(--text-2);
    font-size: 0.92rem;
  }
  h2 { font-size: 1.25rem; margin-bottom: 1rem; }
  .small { font-size: 0.85rem; margin-top: 0.8rem; }

  .bars {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.5rem;
    height: 11rem;
    align-items: end;
    padding: 0 0 0.2rem;
    border-bottom: 1px solid var(--desk-line);
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    height: 100%;
    gap: 0.3rem;
    min-width: 0;
  }
  .col .bar { width: 100%; background: var(--paper-2); border-radius: 2px 2px 0 0; min-height: 2px; }
  .col:first-child .bar { background: var(--brass); }
  .count { font-family: var(--mono); font-size: 0.8rem; color: var(--text-2); }
  .day { color: var(--text-3); font-size: 0.6rem; margin-top: 0.2rem; }
  .forecast { padding-bottom: 1.4rem; }

  .index { list-style: none; margin: 0; padding: 0; }
  .index li { display: flex; align-items: baseline; gap: 0.6rem; padding: 0.3rem 0; }
  .index .name { font-family: var(--serif); }
  .index i { flex: 1; border-bottom: 1px dotted var(--text-3); transform: translateY(-0.25em); }
  .index .n { font-family: var(--mono); color: var(--brass); }

  .history { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--desk-line); }
  .h-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.2rem; }
  .since { color: var(--text-3); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.2rem, 1fr)); gap: 0.8rem; margin: 0 0 2rem; }
  .tiles div { background: var(--desk-2); border: 1px solid var(--desk-line); border-radius: 3px; padding: 0.8rem 1rem; }
  .tiles dt { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3); }
  .tiles dd { margin: 0.2rem 0 0; font-family: var(--serif); font-size: 1.9rem; line-height: 1.1; }
  .welcome { max-width: 36rem; margin: 3rem auto; display: grid; gap: 1rem; }
  .welcome h1 { font-size: 2.2rem; }
  .settings { margin-top: 3rem; color: var(--text-2); }
  .settings summary { cursor: pointer; margin-bottom: 1rem; }
  .narrow { max-width: 9rem; }
</style>
