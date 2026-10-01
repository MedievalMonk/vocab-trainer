<script lang="ts">
  import type { Snippet } from 'svelte'
  import { crumb } from '../lib/format'

  let { collection = '', phrase = false, children }: { collection?: string; phrase?: boolean; children: Snippet } = $props()
</script>

<article class="card" class:wide={phrase}>
  {#if phrase}<span class="tab">Idiom · Phrase</span>{/if}
  {#if collection}<div class="catalog">{crumb(collection)}</div>{/if}
  {@render children()}
</article>
