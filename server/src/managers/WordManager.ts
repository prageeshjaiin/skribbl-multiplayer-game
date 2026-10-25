import wordsData from '../data/words.json';

export class WordManager {
  private allWords: string[];

  constructor() {
    const list: string[] = [];
    for (const category of Object.values(wordsData)) {
      if (Array.isArray(category)) {
        for (const word of category) {
          if (typeof word === 'string' && word.trim().length > 0) {
            list.push(word.trim().toUpperCase());
          }
        }
      }
    }
    // Remove duplicates
    this.allWords = Array.from(new Set(list));
  }

  /**
   * Returns `count` unique random words from the dictionary.
   */
  public getRandomWords(count: number): string[] {
    const clampedCount = Math.max(1, Math.min(count, 5));
    const shuffled = [...this.allWords].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, clampedCount);
  }

  /**
   * Generates a masked representation of the word for guessers.
   * Reveals spaces, hyphens, and any explicitly unmasked letter indices.
   * e.g. "APPLE" with indices {0, 3} -> "A _ _ L _"
   * e.g. "ICE CREAM" with index {4} -> "_ _ _   C _ _ _ _"
   */
  public maskWord(word: string, revealedIndices?: Set<number>): string {
    return word
      .split('')
      .map((char, index) => {
        if (char === ' ') return ' ';
        if (char === '-') return '-';
        if (revealedIndices && revealedIndices.has(index)) return char;
        return '_';
      })
      .join(' ');
  }

  public getTotalWordCount(): number {
    return this.allWords.length;
  }
}

export const wordManager = new WordManager();
