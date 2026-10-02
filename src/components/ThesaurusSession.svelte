<script lang="ts">
  import type { ThesaurusSpec } from '../lib/app.svelte'
  import ClusterPractice from './ClusterPractice.svelte'
  import DuelGame from './DuelGame.svelte'
  import LadderGame from './LadderGame.svelte'

  let { spec }: { spec: ThesaurusSpec } = $props()
</script>

{#if spec.kind === 'practice'}
  <ClusterPractice {spec} />
{:else if spec.kind === 'duel'}
  <DuelGame />
{:else}
  <LadderGame />
{/if}
