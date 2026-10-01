<script lang="ts">
  import type { Snippet } from 'svelte'
  import Card from './Card.svelte'

  let {
    flipped = false,
    collection = '',
    phrase = false,
    front,
    back,
  }: { flipped?: boolean; collection?: string; phrase?: boolean; front: Snippet; back: Snippet } = $props()
</script>

<!-- One genuine flip on reveal. Both faces share a grid cell, so the card is as tall as the taller face. -->
<div class="flip" class:flipped class:wide={phrase}>
  <div class="inner">
    <div class="side front" aria-hidden={flipped}>
      <Card {collection} {phrase}>{@render front()}</Card>
    </div>
    <div class="side back" aria-hidden={!flipped}>
      <Card {collection} {phrase}>{@render back()}</Card>
    </div>
  </div>
</div>

<style>
  .flip {
    perspective: 1600px;
    max-width: 34rem;
    margin: 0 auto;
  }
  .flip.wide { max-width: 46rem; }
  .inner {
    display: grid;
    transform-style: preserve-3d;
    transition: transform 0.6s cubic-bezier(0.3, 0.7, 0.2, 1);
  }
  .flipped .inner { transform: rotateY(180deg); }
  .side {
    grid-area: 1 / 1;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }
  .back { transform: rotateY(180deg); }
  .side :global(.card) { height: 100%; }
</style>
