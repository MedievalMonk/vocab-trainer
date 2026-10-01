<div class="page">
  <h1>Games</h1>
  <p class="muted lead">
    English-only games for reinforcement, drawn from every word you have entered. They never touch your repetition schedule: a lucky guess here cannot
    change how well the scheduler thinks you know a word.
  </p>
  <ul class="shelf">
    {#each ['Hangman', 'Anagram', 'Word Search', 'Speed Match', 'Typing Sprint'] as g (g)}
      <li><span class="name">{g}</span><span class="mono">coming soon</span></li>
    {/each}
  </ul>
</div>

<style>
  h1 { font-size: 2.2rem; margin-bottom: 1rem; }
  .lead { max-width: 38rem; }
  .shelf { list-style: none; margin: 2rem 0 0; padding: 0; display: grid; gap: 0.7rem; max-width: 30rem; }
  .shelf li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.9rem 1.1rem;
    border: 1px dashed var(--desk-line);
    border-radius: 3px;
    color: var(--text-2);
  }
  .name { font-family: var(--serif); font-size: 1.15rem; color: var(--text); }
</style>
