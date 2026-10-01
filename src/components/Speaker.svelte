<script lang="ts">
  import { speak, ttsAvailable } from '../lib/tts'

  let { text, label = 'Pronounce' }: { text: string; label?: string } = $props()
</script>

{#if ttsAvailable}
  <button
    class="speaker"
    type="button"
    aria-label={label}
    onclick={(e) => {
      e.stopPropagation()
      speak(text)
    }}
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  </button>
{/if}

<style>
  .speaker {
    appearance: none;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--ink-2);
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    flex: none;
  }
  .speaker:hover {
    background: rgb(20 34 58 / 0.08);
    color: var(--ink);
  }
</style>
