<script lang="ts">
  import { onMount } from 'svelte'
  import { app, type Route } from './lib/app.svelte'
  import Dashboard from './components/Dashboard.svelte'
  import Games from './components/Games.svelte'
  import Library from './components/Library.svelte'
  import Session from './components/Session.svelte'
  import Study from './components/Study.svelte'

  onMount(() => app.init())

  const TABS: { route: Route; label: string }[] = [
    { route: 'review', label: 'Review' },
    { route: 'study', label: 'Study' },
    { route: 'library', label: 'Library' },
    { route: 'games', label: 'Games' },
  ]
</script>

{#if app.error}
  <div class="page">
    <h1>Storage unavailable</h1>
    <p class="muted">This browser would not open its local database: {app.error}</p>
    <p class="muted">Try a normal (non-private) window. Nothing has been lost.</p>
  </div>
{:else if !app.svc}
  <div class="page"><p class="muted">Opening the card index…</p></div>
{:else}
  {#if app.applyUpdate && !app.session}
    <div class="update" role="status">
      <span>A new version is ready.</span>
      <button class="btn" onclick={() => app.applyUpdate?.()}>Reload to update</button>
    </div>
  {/if}
  <nav class="tabs" aria-label="Sections">
    <span class="brand mono">Vocab · Index</span>
    {#each TABS as t (t.route)}
      <button class:on={app.route === t.route} aria-current={app.route === t.route ? 'page' : undefined} onclick={() => app.go(t.route)}>
        {t.label}
      </button>
    {/each}
  </nav>

  {#if app.route === 'review'}<Dashboard />
  {:else if app.route === 'study'}<Study />
  {:else if app.route === 'library'}<Library />
  {:else}<Games />{/if}

  {#if app.session}
    {#key app.session}<Session spec={app.session} />{/key}
  {/if}
{/if}

<style>
  .update {
    position: fixed;
    z-index: 30;
    left: 0.8rem;
    right: 0.8rem;
    bottom: calc(4.2rem + env(safe-area-inset-bottom));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    background: var(--paper);
    color: var(--ink);
    border-radius: 3px;
    border-top: 3px solid var(--stamp);
    padding: 0.6rem 0.9rem;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
  }
  .update .btn { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  @media (min-width: 52rem) {
    .update { left: auto; right: 1.5rem; bottom: 1.5rem; max-width: 28rem; }
  }
  .tabs {
    position: fixed;
    z-index: 20;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--desk-2);
    border-top: 1px solid var(--desk-line);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .brand { display: none; }
  button {
    appearance: none;
    background: transparent;
    border: 0;
    border-top: 3px solid transparent;
    color: var(--text-2);
    padding: 0.85rem 0.2rem 0.9rem;
    font-family: var(--serif);
    font-size: 1.02rem;
    cursor: pointer;
  }
  button.on { color: var(--text); border-top-color: var(--brass); background: var(--desk-3); }
  @media (min-width: 52rem) {
    .tabs {
      position: sticky;
      top: 0;
      bottom: auto;
      display: flex;
      align-items: stretch;
      gap: 0.3rem;
      padding: 0 2rem;
      border-top: 0;
      border-bottom: 1px solid var(--desk-line);
      background: rgb(12 23 38 / 0.92);
      backdrop-filter: blur(6px);
    }
    .brand { display: flex; align-items: center; margin-right: auto; color: var(--brass); }
    button { border-top: 0; border-bottom: 3px solid transparent; padding: 1rem 1.3rem; margin-bottom: -1px; }
    button.on { border-bottom-color: var(--brass); }
  }
</style>
