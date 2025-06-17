import type { BoardCell, PlacedTile, WordPlacement } from '../types/game';

export interface WordScore {
  word: string;
  baseScore: number;
  multipliedScore: number;
  letterMultipliers: number;
  wordMultipliers: number;
}

export interface TurnScore {
  words: WordScore[];
  totalScore: number;
  bonusPoints: number;
  allTilesUsed: boolean;
}

export function calculateWordScore(
  word: string,
  placedTiles: PlacedTile[],
  board: BoardCell[][]
): WordScore {
  let baseScore = 0;
  let wordMultiplier = 1;
  let letterMultipliers = 0;

  // Calculate score for each letter in the word
  placedTiles.forEach(({ tile, row, col }) => {
    // For blank tiles, use the value of the chosen letter instead of 0
    let letterScore = tile.isBlank && tile.chosenLetter 
      ? getLetterScore(tile.chosenLetter) 
      : tile.value;
    
    const multiplier = board[row][col].multiplier;

    // Apply letter multipliers only to newly placed tiles
    if (multiplier === 'DOUBLE_LETTER') {
      letterScore *= 2;
      letterMultipliers++;
    } else if (multiplier === 'TRIPLE_LETTER') {
      letterScore *= 3;
      letterMultipliers++;
    }

    baseScore += letterScore;

    // Apply word multipliers only to newly placed tiles
    if (multiplier === 'DOUBLE_WORD' || multiplier === 'CENTER') {
      wordMultiplier *= 2;
    } else if (multiplier === 'TRIPLE_WORD') {
      wordMultiplier *= 3;
    }
  });

  // Add scores for existing tiles that are part of the word
  // (These don't get multipliers applied)
  // This would be calculated by the word formation logic

  const multipliedScore = baseScore * wordMultiplier;

  return {
    word,
    baseScore,
    multipliedScore,
    letterMultipliers,
    wordMultipliers: wordMultiplier
  };
}

export function calculateTurnScore(
  words: WordPlacement[],
  placedTiles: PlacedTile[],
  board: BoardCell[][]
): TurnScore {
  const wordScores: WordScore[] = [];
  let totalScore = 0;

  // Calculate score for each word formed
  words.forEach(wordPlacement => {
    const wordScore = calculateWordScore(
      wordPlacement.word,
      wordPlacement.tiles,
      board
    );
    wordScores.push(wordScore);
    totalScore += wordScore.multipliedScore;
  });

  // Bonus for using all 7 tiles (50 points)
  const allTilesUsed = placedTiles.length === 7;
  const bonusPoints = allTilesUsed ? 50 : 0;
  totalScore += bonusPoints;

  return {
    words: wordScores,
    totalScore,
    bonusPoints,
    allTilesUsed
  };
}

export function getLetterScore(letter: string): number {
  const letterValues: Record<string, number> = {
    'A': 1, 'E': 1, 'I': 1, 'L': 1, 'N': 1, 'O': 1, 'R': 1, 'S': 1, 'T': 1, 'U': 1,
    'D': 2, 'G': 2,
    'B': 3, 'C': 3, 'M': 3, 'P': 3,
    'F': 4, 'H': 4, 'V': 4, 'W': 4, 'Y': 4,
    'K': 5,
    'J': 8, 'X': 8,
    'Q': 10, 'Z': 10,
    '?': 0 // Blank tile
  };
  
  return letterValues[letter.toUpperCase()] || 0;
}
