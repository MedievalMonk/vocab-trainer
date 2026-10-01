<script lang="ts">
  import { untrack } from 'svelte'
  import type { CalendarData } from '../core/service'

  let { data }: { data: CalendarData } = $props()

  const today = $derived(data.today)
  let view = $state(untrack(() => data.today).slice(0, 7)) // "YYYY-MM"
  let picked = $state<string | null>(null)
  const selected = $derived(picked ?? today)

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const fmt = (key: string, o: Intl.DateTimeFormatOptions) => new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })

  const monthTitle = $derived(fmt(view + '-01', { month: 'long', year: 'numeric' }))
  const cells = $derived.by(() => {
    const [y, m] = view.split('-').map(Number)
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // weeks start on Monday
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const out: (string | null)[] = Array(lead).fill(null)
    for (let d = 1; d <= days; d++) out.push(`${view}-${String(d).padStart(2, '0')}`)
    return out
  })

  function shift(delta: number) {
    const [y, m] = view.split('-').map(Number)
    view = new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
  }
  function goToday() {
    view = today.slice(0, 7)
    picked = null
  }

  const level = (n: number) => (n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4)
  const stat = (key: string) => data.days[key]
  const sel = $derived(stat(selected))
  const selDue = $derived(data.due[selected] ?? 0)
  const beforeStart = (key: string) => !!data.since && key < data.since
  const label = (key: string) => {
    const s = stat(key)
    const parts = [fmt(key, { day: 'numeric', month: 'long' })]
    if (s?.reviews) parts.push(`${s.reviews} reviews`)
    if (s?.taught) parts.push(`${s.taught} words taught`)
    if (key >= today && data.due[key]) parts.push(`${data.due[key]} due`)
    return parts.join(', ')
  }
</script>

<section class="cal" aria-label="Calendar">
  <header>
    <h2>{monthTitle}</h2>
    <div class="nav">
      <button class="btn" onclick={() => shift(-1)} aria-label="Previous month">‹</button>
      <button class="btn" onclick={goToday} disabled={view === today.slice(0, 7) && selected === today}>Today</button>
      <button class="btn" onclick={() => shift(1)} aria-label="Next month">›</button>
    </div>
  </header>

  <div class="grid" role="grid">
    {#each WEEKDAYS as w (w)}<span class="wd mono">{w}</span>{/each}
    {#each cells as key, i (key ?? 'pad' + i)}
      {#if key}
        {@const s = stat(key)}
        {@const future = key > today}
        <button
          class="day l{level(s?.reviews ?? 0)}"
          class:today={key === today}
          class:future
          class:selected={key === selected}
          class:before={beforeStart(key)}
          aria-label={label(key)}
          aria-pressed={key === selected}
          onclick={() => (picked = key)}
        >
          <span class="n">{Number(key.slice(8))}</span>
          {#if !future && s?.reviews}<span class="c">{s.reviews}</span>{/if}
          {#if key >= today && data.due[key]}<span class="due">{data.due[key]}</span>{/if}
        </button>
      {:else}
        <span class="pad"></span>
      {/if}
    {/each}
  </div>

  <div class="legend mono">
    <span><i class="sw l2"></i> reviews done</span>
    <span><i class="sw due-sw"></i> reviews due</span>
  </div>

  <div class="detail" aria-live="polite">
    <h3>{fmt(selected, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{selected === today ? ' · today' : ''}</h3>
    {#if selected > today}
      <p>{selDue ? `${selDue} reviews due.` : 'Nothing due yet.'}</p>
    {:else}
      {#if sel && (sel.reviews || sel.taught || sel.known)}
        <ul>
          {#if sel.reviews}<li><b>{sel.reviews}</b> answers, <b>{Math.round((sel.correct / sel.reviews) * 100)}%</b> correct</li>{/if}
          {#if sel.taught}<li><b>{sel.taught}</b> new words taught</li>{/if}
          {#if sel.known}<li><b>{sel.known}</b> filed as known</li>{/if}
        </ul>
      {:else}
        <p class="muted">{beforeStart(selected) ? 'Before your current history begins.' : 'No study recorded.'}</p>
      {/if}
      {#if selected === today && selDue}<p class="muted">{selDue} more due today.</p>{/if}
    {/if}
  </div>
</section>

<style>
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
  h2 { font-size: 1.4rem; }
  .nav { display: flex; gap: 0.4rem; }
  .nav .btn { padding: 0.45rem 0.9rem; min-height: 2.4rem; }
  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.3rem; }
  .wd { text-align: center; color: var(--text-3); font-size: 0.62rem; padding-bottom: 0.2rem; }
  .pad { min-height: 3.4rem; }
  .day {
    appearance: none;
    position: relative;
    min-height: 3.4rem;
    border: 1px solid var(--desk-line);
    background: var(--desk-2);
    border-radius: 3px;
    padding: 0.25rem 0.35rem;
    cursor: pointer;
    color: var(--text);
    text-align: left;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .day:hover { border-color: #3a5a82; }
  .n { font-family: var(--mono); font-size: 0.72rem; color: var(--text-2); }
  .c { font-family: var(--serif); font-size: 1.05rem; line-height: 1; text-align: right; }
  .due { font-family: var(--mono); font-size: 0.78rem; text-align: right; color: var(--brass); }
  .l1 { background: rgb(201 178 124 / 0.16); }
  .l2 { background: rgb(201 178 124 / 0.34); }
  .l3 { background: rgb(201 178 124 / 0.56); }
  .l4 { background: rgb(201 178 124 / 0.82); color: #1c1708; }
  .l3 .n, .l4 .n { color: inherit; }
  .future { border-style: dashed; background: transparent; }
  .before { opacity: 0.45; }
  .today { box-shadow: inset 0 0 0 2px var(--paper); }
  .selected { outline: 2px solid var(--brass); outline-offset: 1px; }
  .legend { display: flex; gap: 1.4rem; margin: 0.9rem 0; color: var(--text-3); font-size: 0.62rem; }
  .sw { display: inline-block; width: 0.9rem; height: 0.9rem; vertical-align: -0.15rem; border: 1px solid var(--desk-line); border-radius: 2px; margin-right: 0.3rem; }
  .due-sw { border: 1px dashed var(--brass); background: transparent; }
  .detail { background: var(--desk-2); border: 1px solid var(--desk-line); border-radius: 3px; padding: 1rem 1.2rem; }
  .detail h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }
  .detail ul { margin: 0; padding-left: 1.1rem; }
  .detail p { margin: 0.3rem 0 0; }
  @media (min-width: 40rem) { .day, .pad { min-height: 4.2rem; } }
</style>
