<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    progress = null,
    closeLabel = 'End',
    onclose,
    children,
  }: { title: string; progress?: number | null; closeLabel?: string; onclose: () => void; children: Snippet } = $props()
</script>

<div class="overlay" role="dialog" aria-label={title}>
  <header>
    {#if progress !== null}
      <div class="bar" aria-hidden="true"><span style:width="{Math.max(0, Math.min(1, progress)) * 100}%"></span></div>
    {/if}
    <div class="top">
      <span class="mono">{title}</span>
      <button class="btn quiet" onclick={onclose}>{closeLabel}</button>
    </div>
  </header>
  <main>{@render children()}</main>
</div>

<style>
  .overlay {
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
  .top .mono { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .top .btn { padding: 0.4rem 0.9rem; min-height: 2.4rem; }
  main { max-width: 62rem; margin: 0 auto; padding: 2.4rem 1rem 6rem; }
</style>
