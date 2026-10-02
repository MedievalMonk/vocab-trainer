<script lang="ts">
  /** Where a member sits on a gradient: `index` of `count`, as a row of filled blocks, mildest to strongest. */
  let { index, count }: { index: number; count: number } = $props()
</script>

<span class="meter" role="img" aria-label="Step {index + 1} of {count}, mildest to strongest">
  {#each Array(count) as _, i (i)}<i class:on={i <= index}></i>{/each}
</span>

<style>
  .meter { display: inline-flex; gap: 3px; align-items: flex-end; }
  i { width: 0.5rem; background: rgb(20 34 58 / 0.18); border-radius: 1px; height: 0.7rem; }
  i:nth-child(2) { height: 0.85rem; }
  i:nth-child(3) { height: 1rem; }
  i:nth-child(4) { height: 1.15rem; }
  i:nth-child(5) { height: 1.3rem; }
  i:nth-child(6) { height: 1.45rem; }
  i.on { background: var(--stamp); }
</style>
