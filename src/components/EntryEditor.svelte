<script lang="ts">
  import { untrack } from 'svelte'
  import { STATUSES, type EntryContent, type Status } from '../core/types'
  import { app } from '../lib/app.svelte'
  import { collectionList } from '../lib/format'

  let { entryId, onclose }: { entryId: string | null; onclose: () => void } = $props()

  const svc = app.svc!
  const existing = untrack(() => (entryId ? svc.state.entries.get(entryId) : undefined))
  const c = existing?.content

  let word = $state(c?.word ?? '')
  let pos = $state(c?.pos ?? 'noun')
  let definition = $state(c?.definition ?? '')
  let example = $state(c?.example ?? '')
  let polish = $state(c?.polish ?? '')
  let collection = $state(c?.collection ?? 'Personal')
  let tags = $state((c?.tags ?? []).join(', '))
  let register = $state(c?.register ?? '')
  let similar = $state(c?.similarExpressions ?? '')
  let status = $state<Status>(existing?.status ?? 'new')
  let message = $state('')
  let confirmDelete = $state(false)

  const collections = $derived(collectionList(svc.state).map((x) => x.name))
  const valid = $derived([word, pos, definition, example, polish, collection].every((s) => s.trim()))

  async function save() {
    message = ''
    const fields = {
      word: word.trim(), pos: pos.trim(), definition: definition.trim(), example: example.trim(), polish: polish.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      register: register.trim() || undefined,
      similarExpressions: similar.trim() || undefined,
    }
    if (existing) {
      const patch: Partial<EntryContent> = { ...fields, collection: collection.trim() }
      await app.run(async (s) => {
        await s.editEntry(existing.id, patch)
        if (status !== existing.status) await s.setStatus(existing.id, status)
      })
      onclose()
    } else {
      const r = await app.run((s) => s.addEntry({ ...fields, collection }))
      if (r.added) onclose()
      else message = r.unchanged || r.differing.length ? 'That word already exists in this collection.' : 'Could not add: check the required fields.'
    }
  }

  async function remove() {
    if (!existing) return
    await app.run((s) => s.deleteEntry(existing.id))
    onclose()
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={existing ? 'Edit entry' : 'Add a word'}>
  <form onsubmit={(e) => { e.preventDefault(); if (valid) save() }}>
    <h2>{existing ? 'Edit entry' : 'Add a word'}</h2>

    <label class="field"><span>Word or phrase</span><input class="input" bind:value={word} required /></label>
    <div class="two">
      <label class="field"><span>Part of speech</span><input class="input" bind:value={pos} required /></label>
      <label class="field">
        <span>Collection</span>
        <input class="input" bind:value={collection} list="collections" required />
        <datalist id="collections">{#each collections as name (name)}<option value={name}></option>{/each}</datalist>
      </label>
    </div>
    <label class="field"><span>Definition (English)</span><textarea class="input short" bind:value={definition} required></textarea></label>
    <label class="field"><span>Example sentence (your own)</span><textarea class="input short" bind:value={example} required></textarea></label>
    <label class="field"><span>Polish</span><input class="input" bind:value={polish} required /></label>
    <label class="field"><span>Tags (comma separated)</span><input class="input" bind:value={tags} /></label>
    <div class="two">
      <label class="field"><span>Register (idioms, optional)</span><input class="input" bind:value={register} /></label>
      <label class="field"><span>Similar expressions (optional)</span><input class="input" bind:value={similar} /></label>
    </div>
    {#if existing}
      <label class="field">
        <span>Status</span>
        <select class="input" bind:value={status}>{#each STATUSES as s (s)}<option value={s}>{s}</option>{/each}</select>
      </label>
    {/if}

    {#if message}<p class="msg">{message}</p>{/if}
    <div class="actions">
      {#if existing}
        {#if confirmDelete}
          <button type="button" class="btn danger" onclick={remove}>Delete for good?</button>
        {:else}
          <button type="button" class="btn danger" onclick={() => (confirmDelete = true)}>Delete</button>
        {/if}
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn quiet" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn primary" disabled={!valid}>{existing ? 'Save' : 'Add'}</button>
    </div>
  </form>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(5 10 18 / 0.7);
    display: grid;
    place-items: start center;
    overflow-y: auto;
    padding: 1rem;
  }
  .dialog {
    width: 100%;
    max-width: 38rem;
    background: var(--desk-2);
    border: 1px solid var(--desk-line);
    border-radius: 4px;
    padding: 1.5rem;
    margin: 2rem 0;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.6);
  }
  h2 { font-size: 1.5rem; margin-bottom: 1.2rem; }
  .two { display: grid; gap: 0 1rem; }
  @media (min-width: 36rem) { .two { grid-template-columns: 1fr 1fr; } }
  .short { min-height: 4.5rem; }
  .actions { display: flex; gap: 0.6rem; align-items: center; margin-top: 0.6rem; }
  .spacer { flex: 1; }
  .msg { color: #e4a3a6; }
</style>
