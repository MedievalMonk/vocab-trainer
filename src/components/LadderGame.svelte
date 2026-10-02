<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { ladderScore, makeLadder } from '../lib/thesaurus'
  import Overlay from './Overlay.svelte'

  const pool = app.svc!.clusterList().map((c) => c.content).filter((c) => c.ordered && c.members.length >= 3)

  const first = pickCluster(-1)
  let current = $state(first)
  let shuffled = $state<number[]>(first >= 0 ? makeLadder(pool[first]) : [])
  let placed = $state<number[]>([])
  let checked = $state(false)

  function pickCluster(avoid: number): number {
    if (!pool.length) return -1
    if (pool.length === 1) return 0
    let n = avoid
    while (n === avoid) n = Math.floor(Math.random() * pool.length)
    return n
  }

  const cluster = $derived(current >= 0 ? pool[current] : null)
  const remaining = $derived(shuffled.filter((i) => !placed.includes(i)))
  const full = $derived(cluster ? placed.length === cluster.members.length : false)
  const score = $derived(checked ? ladderScore(placed) : 0)

  function place(i: number) {
    if (checked) return
    placed = [...placed, i]
  }
  function unplace(slot: number) {
    if (checked) return
    placed = placed.filter((_, s) => s !== slot)
  }
  function again() {
    current = pickCluster(current)
    shuffled = makeLadder(pool[current])
    placed = []
    checked = false
  }
</script>

<Overlay title="Intensity Ladder" closeLabel="Close" onclose={() => app.endThesaurus()}>
  {#if !cluster}
    <div class="center">
      <h2>Intensity Ladder</h2>
      <p class="muted">This needs a cluster that runs from mildest to strongest. Import one in the Library first.</p>
    </div>
  {:else}
    <div class="wrap">
      <h2>Put them in order</h2>
      <p class="muted">“{cluster.coreMeaning}”: tap the words from the <b>mildest</b> to the <b>strongest</b>. Tap a placed word to take it back.</p>

      <ol class="rungs">
        {#each cluster.members as _, slot (slot)}
          {@const idx = placed[slot]}
          <li class:empty={idx === undefined} class:right={checked && idx === slot} class:wrong={checked && idx !== undefined && idx !== slot}>
            <span class="rn mono">{slot + 1}{slot === 0 ? ' · mildest' : slot === cluster.members.length - 1 ? ' · strongest' : ''}</span>
            {#if idx !== undefined}
              <button class="word" onclick={() => unplace(slot)} disabled={checked}>{cluster.members[idx].word}</button>
            {:else}
              <span class="blank">—</span>
            {/if}
          </li>
        {/each}
      </ol>

      {#if !checked}
        <div class="chips" aria-label="Words left to place">
          {#each remaining as i (i)}
            <button class="chip" onclick={() => place(i)}>{cluster.members[i].word}</button>
          {/each}
        </div>
        <div class="row">
          <button class="btn primary" onclick={() => (checked = true)} disabled={!full}>Check</button>
          {#if placed.length}<button class="btn quiet" onclick={() => (placed = [])}>Start over</button>{/if}
        </div>
      {:else}
        <p class="result">
          {score === cluster.members.length ? 'Perfect.' : `${score} of ${cluster.members.length} on the right rung.`}
        </p>
        <h3>The scale, with what separates each step</h3>
        <ol class="answer">
          {#each cluster.members as m, i (m.word)}
            <li><b>{m.word}</b><span>{m.nuance}</span></li>
          {/each}
        </ol>
        <div class="row">
          <button class="btn primary" onclick={again}>Another ladder</button>
          <button class="btn" onclick={() => app.endThesaurus()}>Back</button>
        </div>
      {/if}
    </div>
  {/if}
</Overlay>

<style>
  .center, .wrap { max-width: 36rem; margin: 1rem auto; display: grid; gap: 1rem; }
  h2 { font-size: 1.7rem; }
  h3 { font-size: 1.1rem; margin-top: 0.6rem; }
  .rungs { list-style: none; margin: 0.4rem 0; padding: 0; display: grid; gap: 0.5rem; }
  .rungs li {
    display: flex;
    align-items: center;
    gap: 1rem;
    border: 1px dashed var(--desk-line);
    border-radius: 3px;
    padding: 0.5rem 0.8rem;
    min-height: 3.2rem;
  }
  .rungs li:not(.empty) { border-style: solid; background: var(--desk-2); }
  .rungs li.right { border-color: #6fb08f; background: rgb(111 176 143 / 0.15); }
  .rungs li.wrong { border-color: var(--stamp); background: rgb(140 44 49 / 0.15); }
  .rn { color: var(--text-3); font-size: 0.6rem; min-width: 5.5rem; }
  .word, .chip {
    appearance: none;
    background: var(--paper);
    color: var(--ink);
    border: 0;
    border-radius: 3px;
    padding: 0.5rem 1rem;
    font-family: var(--serif);
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow: 0 2px 0 var(--paper-edge);
  }
  .word:disabled { cursor: default; }
  .blank { color: var(--text-3); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 0.6rem; min-height: 3rem; }
  .row { display: flex; gap: 0.8rem; margin-top: 0.4rem; }
  .result { font-family: var(--serif); font-size: 1.4rem; margin: 0.6rem 0 0; }
  .answer { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.8rem; }
  .answer li { display: grid; gap: 0.1rem; border-left: 3px solid var(--brass); padding-left: 0.9rem; }
  .answer b { font-family: var(--serif); font-size: 1.15rem; font-weight: 600; }
  .answer span { color: var(--text-2); font-size: 0.92rem; }
</style>
