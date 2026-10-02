<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { makeDuel, type DuelQuestion } from '../lib/thesaurus'
  import Overlay from './Overlay.svelte'

  const DURATION = 45
  const THRESHOLD = 70

  const clusters = app.svc!.clusterList().map((c) => c.content)

  type Miss = { q: DuelQuestion; picked: number }
  let phase = $state<'ready' | 'play' | 'over'>('ready')
  let q = $state<DuelQuestion | null>(null)
  let left = $state(DURATION)
  let score = $state(0)
  let right = $state(0)
  let wrong = $state(0)
  let misses = $state<Miss[]>([])
  let flash = $state<'ok' | 'no' | null>(null)
  let dx = $state(0)
  let dragging = $state(false)
  let startX = 0
  let best = $state(readBest())
  let endsAt = 0

  function readBest() {
    try {
      return Number(localStorage.getItem('duel-best') ?? 0)
    } catch {
      return 0
    }
  }

  function begin() {
    score = right = wrong = 0
    misses = []
    flash = null
    left = DURATION
    endsAt = Date.now() + DURATION * 1000
    q = makeDuel(clusters)
    phase = q ? 'play' : 'over'
  }

  $effect(() => {
    if (phase !== 'play') return
    const t = setInterval(() => {
      left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      if (left <= 0) finish()
    }, 200)
    return () => clearInterval(t)
  })

  function finish() {
    phase = 'over'
    if (score > best) {
      best = score
      try {
        localStorage.setItem('duel-best', String(score))
      } catch {
        // a remembered best score is a convenience only
      }
    }
  }

  function pick(side: 'left' | 'right') {
    if (phase !== 'play' || !q || flash) return
    const chosen = side === 'left' ? q.left : q.right
    if (chosen === q.answer) {
      score += 10
      right++
      flash = 'ok'
    } else {
      score = Math.max(0, score - 5)
      wrong++
      misses = [...misses, { q, picked: chosen }]
      flash = 'no'
    }
    dx = 0
    setTimeout(() => {
      flash = null
      if (phase === 'play') q = makeDuel(clusters)
    }, 380)
  }

  // Swipe: drag the card sideways and let go past the threshold.
  function down(e: PointerEvent) {
    if (phase !== 'play' || flash) return
    dragging = true
    startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (dragging) dx = e.clientX - startX
  }
  function up() {
    if (!dragging) return
    dragging = false
    if (dx > THRESHOLD) pick('right')
    else if (dx < -THRESHOLD) pick('left')
    else dx = 0
  }

  function onKey(e: KeyboardEvent) {
    if (phase === 'play') {
      if (e.key === 'ArrowLeft') pick('left')
      else if (e.key === 'ArrowRight') pick('right')
    } else if (e.key === 'Enter') begin()
  }

  const parts = $derived(q ? q.sentence.split('_____') : [])
  const word = (i: number, cIndex: number) => clusters[cIndex].members[i]
  const total = $derived(right + wrong)
</script>

<svelte:window onkeydown={onKey} />

<Overlay title="Nuance Duel" progress={phase === 'play' ? left / DURATION : null} closeLabel={phase === 'play' ? 'End' : 'Close'} onclose={() => (phase === 'play' ? finish() : app.endThesaurus())}>
  {#if phase === 'ready'}
    <div class="center">
      <h2>Nuance Duel</h2>
      <p class="muted">
        {DURATION} seconds. A sentence, two words: swipe toward the one that fits better, or tap it. Right is +10, wrong is −5. Close calls between neighbouring words come up often.
      </p>
      {#if best}<p class="mono best">Best score {best}</p>{/if}
      {#if clusters.length === 0}<p class="muted">Import some synonym clusters first.</p>{/if}
      <button class="btn primary big" onclick={begin} disabled={clusters.length === 0}>Start</button>
    </div>
  {:else if phase === 'play' && q}
    <div class="hud mono"><span>{left}s</span><span>Score {score}</span></div>
    <div
      class="duel-card"
      class:ok={flash === 'ok'}
      class:no={flash === 'no'}
      class:snap={!dragging}
      style:transform="translateX({dx}px) rotate({dx / 25}deg)"
      role="group"
      aria-label="Sentence. Swipe or choose a word"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      <p class="sentence">{parts[0]}<span class="blank">{flash ? word(q.answer, q.clusterIndex).word : '   '}</span>{parts[1] ?? ''}</p>
      <div class="edge mono" aria-hidden="true">
        <span class:hot={dx < -THRESHOLD / 2}>← {word(q.left, q.clusterIndex).word}</span>
        <span class:hot={dx > THRESHOLD / 2}>{word(q.right, q.clusterIndex).word} →</span>
      </div>
    </div>
    <div class="choices">
      <button class="btn choice" onclick={() => pick('left')} disabled={!!flash}>{word(q.left, q.clusterIndex).word}</button>
      <button class="btn choice" onclick={() => pick('right')} disabled={!!flash}>{word(q.right, q.clusterIndex).word}</button>
    </div>
  {:else}
    <div class="over">
      <h2>{score} points</h2>
      <p class="muted">
        {right} right, {wrong} wrong{total ? ` · ${Math.round((right / total) * 100)}% accuracy` : ''}.
        {#if score >= best && score > 0}<span class="mono best">Best score</span>{/if}
      </p>
      {#if misses.length}
        <h3>Where you slipped</h3>
        <ul class="misses">
          {#each misses as m, i (i)}
            {@const parts2 = m.q.sentence.split('_____')}
            {@const a = word(m.q.answer, m.q.clusterIndex)}
            {@const p = word(m.picked, m.q.clusterIndex)}
            <li>
              <p class="sentence small">{parts2[0]}<b>{a.word}</b>{parts2[1] ?? ''}</p>
              <p><b>{a.word}</b>: {a.nuance}</p>
              <p class="muted">You picked <b>{p.word}</b>: {p.nuance}</p>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="row">
        <button class="btn primary" onclick={begin}>Play again</button>
        <button class="btn" onclick={() => app.endThesaurus()}>Back</button>
      </div>
    </div>
  {/if}
</Overlay>

<style>
  .center, .over { max-width: 36rem; margin: 2rem auto; display: grid; gap: 1rem; }
  .center { justify-items: center; text-align: center; }
  .big { padding: 0.9rem 2.2rem; font-size: 1.1rem; }
  .best { color: var(--brass); }
  .hud { display: flex; justify-content: space-between; max-width: 30rem; margin: 0 auto 1rem; color: var(--text-2); font-size: 0.9rem; }
  .duel-card {
    max-width: 30rem;
    margin: 0 auto;
    background: var(--paper);
    color: var(--ink);
    border-radius: 4px;
    border-top: 4px solid var(--stamp);
    box-shadow: 0 14px 34px rgb(0 0 0 / 0.5);
    padding: 2rem 1.6rem 1.2rem;
    touch-action: pan-y;
    user-select: none;
    cursor: grab;
  }
  .duel-card.snap { transition: transform 0.2s, background 0.2s; }
  .duel-card.ok { background: #cfe3d3; }
  .duel-card.no { background: #ecc9c9; }
  .sentence { font-family: var(--serif); font-size: 1.5rem; line-height: 1.5; margin: 0 0 1.6rem; }
  .sentence.small { font-size: 1.05rem; margin: 0 0 0.4rem; }
  .blank { display: inline-block; min-width: 4rem; border-bottom: 2px solid var(--ink); text-align: center; font-weight: 600; }
  .edge { display: flex; justify-content: space-between; color: var(--ink-3); font-size: 0.66rem; }
  .edge .hot { color: var(--stamp); font-weight: 700; }
  .choices { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; max-width: 30rem; margin: 1.4rem auto 0; }
  .choice { font-family: var(--serif); font-size: 1.25rem; padding: 0.9rem 0.5rem; }
  .over h2 { font-size: 2.2rem; }
  .misses { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.2rem; }
  .misses li { border-left: 3px solid var(--stamp); padding-left: 1rem; }
  .misses p { margin: 0 0 0.3rem; font-size: 0.95rem; }
  .row { display: flex; gap: 0.8rem; margin-top: 0.6rem; }
</style>
