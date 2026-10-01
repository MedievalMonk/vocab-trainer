<script lang="ts">
  import type { EntryContent } from '../core/types'
  import { headword } from '../lib/exercises'
  import Speaker from './Speaker.svelte'

  let { content }: { content: EntryContent } = $props()
  const qualifier = $derived(/\(([^)]*)\)/.exec(content.word)?.[1])
</script>

<div class="face">
  <div class="head">
    <h2 class="headword">{headword(content.word)}</h2>
    <Speaker text={content.word} />
  </div>
  <div class="pos">{content.pos}{#if qualifier}{' · '}{qualifier}{/if}</div>

  <p class="definition">{content.definition}</p>
  <p class="example">{content.example}</p>
  <p class="polish"><span class="tag">PL</span>{content.polish}</p>

  {#if content.register || content.similarExpressions}
    <dl class="phrase-notes">
      {#if content.register}<div><dt>Register</dt><dd>{content.register}</dd></div>{/if}
      {#if content.similarExpressions}<div><dt>Similar</dt><dd>{content.similarExpressions}</dd></div>{/if}
    </dl>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }
  .pos { margin: 0.35rem 0 1.4rem; }
  .definition {
    font-size: 1.1rem;
    line-height: 1.6;
    margin-bottom: 1.2rem;
  }
  .example {
    font-family: var(--serif);
    font-style: italic;
    font-size: 1.05rem;
    color: var(--ink-2);
    border-left: 2px solid var(--stamp);
    padding-left: 0.9rem;
    margin-bottom: 1.2rem;
  }
  .polish {
    display: flex;
    gap: 0.7rem;
    align-items: baseline;
    font-size: 1.1rem;
    padding-top: 0.9rem;
    border-top: 1px dashed var(--ink-3);
    margin: 0;
  }
  .tag {
    font-family: var(--mono);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    border: 1px solid var(--ink-3);
    color: var(--ink-3);
    padding: 0.05rem 0.35rem;
    border-radius: 2px;
  }
  .phrase-notes {
    margin: 1.1rem 0 0;
    padding-top: 0.9rem;
    border-top: 1px dashed var(--ink-3);
    font-size: 0.95rem;
    color: var(--ink-2);
  }
  .phrase-notes div { display: flex; gap: 0.8rem; margin-bottom: 0.3rem; }
  dt {
    font-family: var(--mono);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    min-width: 4.5rem;
    padding-top: 0.2rem;
  }
  dd { margin: 0; }
</style>
