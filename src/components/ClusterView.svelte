<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { lastPart } from '../lib/format'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import Meter from './Meter.svelte'
  import Overlay from './Overlay.svelte'
  import Speaker from './Speaker.svelte'

  let { clusterId, onclose }: { clusterId: string; onclose: () => void } = $props()

  const cluster = $derived.by(() => {
    app.rev
    return app.svc!.cluster(clusterId)
  })
  const info = $derived.by(() => {
    app.rev
    return app.svc!.clusterList().find((c) => c.id === clusterId)
  })
  let confirmDelete = $state(false)

  const linked = (word: string) => app.svc!.linkedEntries(word)
  const when = (d: Date | undefined) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

  function practise() {
    if (!cluster) return
    // Read the id first: closing the view clears the prop it comes from.
    const id = clusterId
    onclose()
    app.startThesaurus({ kind: 'practice', clusterIds: [id], title: 'Practice' })
  }
  async function remove() {
    await app.run((s) => s.deleteCluster(clusterId))
    onclose()
  }
</script>

{#if cluster}
  <Overlay title="Cluster" closeLabel="Close" {onclose}>
    <header class="head">
      <h2>{cluster.content.title}</h2>
      <p class="core">{cluster.content.coreMeaning}</p>
      <p class="meta mono">
        {cluster.content.members.length} words{cluster.content.ordered ? ' · mildest to strongest' : ''} ·
        {#if info?.status === 'new'}not practised yet{:else if info?.status === 'due'}due for practice{:else}next practice {when(info?.due)}{/if}
      </p>
      <div class="actions">
        <button class="btn primary" onclick={practise}>Practise this cluster</button>
        <button class="btn quiet danger" onclick={() => (confirmDelete = true)}>Delete</button>
      </div>
    </header>

    <ol class="stack">
      {#each cluster.content.members as m, i (m.word)}
        {@const links = linked(m.word)}
        <li style:--i={i}>
          <article class="member">
            <div class="top">
              <h3>{m.word}</h3>
              <Speaker text={m.word} />
              {#if cluster.content.ordered}<span class="at"><Meter index={i} count={cluster.content.members.length} /></span>{/if}
            </div>
            <p class="reg mono">{m.register}</p>
            <p class="nuance">{m.nuance}</p>
            <p class="example">{m.example}</p>
            <p class="polish"><span class="tag">PL</span>{m.polish}</p>
            <p class="link mono">
              {#if links.length}In your dictionary · {links.map((e) => lastPart(e.content.collection)).join(', ')}{:else}Not in your dictionary{/if}
            </p>
          </article>
        </li>
      {/each}
    </ol>
  </Overlay>

  {#if confirmDelete}
    <ConfirmDialog
      title="Are you sure you want to proceed?"
      message="This deletes the cluster “{cluster.content.title}” and its practice history from this device. Importing the file again will not bring it back. This cannot be undone."
      confirmLabel="Yes, delete cluster"
      onconfirm={remove}
      oncancel={() => (confirmDelete = false)}
    />
  {/if}
{/if}

<style>
  .head h2 { font-size: 1.9rem; margin-bottom: 0.5rem; }
  .core { color: var(--text-2); font-size: 1.05rem; max-width: 40rem; }
  .meta { color: var(--text-3); margin: 0.2rem 0 1.2rem; }
  .actions { display: flex; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 2.4rem; }

  .stack { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.1rem; max-width: 46rem; }
  /* A fanned staircase on wider screens: each step a little further along, like cards fanned on a desk. */
  @media (min-width: 44rem) { .stack li { margin-left: calc(var(--i) * 1.3rem); } }
  .member {
    background: var(--paper);
    color: var(--ink);
    border-radius: 3px;
    border-left: 5px solid var(--ink);
    box-shadow: 0 2px 0 var(--paper-edge), 0 10px 26px rgb(0 0 0 / 0.45);
    padding: 1.1rem 1.3rem 1rem;
  }
  .top { display: flex; align-items: center; gap: 0.8rem; }
  .top h3 { font-size: 1.7rem; flex: 1; }
  .at { margin-left: auto; }
  .reg { color: var(--ink-3); margin: 0.3rem 0 0.8rem; font-size: 0.66rem; }
  .nuance { font-size: 1.02rem; line-height: 1.55; margin-bottom: 0.9rem; }
  .example {
    font-family: var(--serif);
    font-style: italic;
    color: var(--ink-2);
    border-left: 2px solid var(--stamp);
    padding-left: 0.8rem;
    margin-bottom: 0.9rem;
  }
  .polish { display: flex; gap: 0.7rem; align-items: baseline; margin: 0; padding-top: 0.7rem; border-top: 1px dashed var(--ink-3); }
  .tag { font-family: var(--mono); font-size: 0.62rem; border: 1px solid var(--ink-3); color: var(--ink-3); padding: 0.05rem 0.35rem; border-radius: 2px; }
  .link { margin: 0.7rem 0 0; color: var(--ink-3); font-size: 0.6rem; }
</style>
