<script lang="ts">
  let {
    title,
    message,
    confirmLabel,
    busy = false,
    extraLabel = '',
    onextra,
    onconfirm,
    oncancel,
  }: {
    title: string
    message: string
    confirmLabel: string
    busy?: boolean
    /** Optional secondary action, e.g. "Download a backup first". */
    extraLabel?: string
    onextra?: () => void
    onconfirm: () => void
    oncancel: () => void
  } = $props()

  let cancelBtn: HTMLButtonElement
  $effect(() => cancelBtn?.focus()) // the safe choice has focus, so a stray Enter cancels
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !busy && oncancel()} />

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && oncancel()}>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" aria-describedby="cd-msg">
    <h2 id="cd-title">{title}</h2>
    <p id="cd-msg">{message}</p>
    {#if extraLabel && onextra}
      <div class="extra"><button class="btn quiet" onclick={onextra} disabled={busy}>{extraLabel}</button></div>
    {/if}
    <div class="actions">
      <span class="spacer"></span>
      <button class="btn" bind:this={cancelBtn} onclick={oncancel} disabled={busy}>Cancel</button>
      <button class="btn danger" onclick={onconfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgb(5 10 18 / 0.75);
    display: grid;
    place-items: center;
    padding: 1rem;
  }
  .dialog {
    width: 100%;
    max-width: 30rem;
    background: var(--desk-2);
    border: 1px solid var(--desk-line);
    border-top: 3px solid var(--stamp);
    border-radius: 4px;
    padding: 1.5rem;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.6);
  }
  h2 { font-size: 1.4rem; margin-bottom: 0.8rem; }
  p { color: var(--text-2); line-height: 1.55; margin-bottom: 1.4rem; }
  .extra { margin: -0.4rem 0 1.2rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
  .spacer { flex: 1; }
</style>
