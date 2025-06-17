import type { BoardCell, PlacedTile, WordPlacement } from '../types/game';
import { BOARD_SIZE } from '../constants/board';
import { dictionaryService } from './dictionaryService';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  words: WordPlacement[];
}

export async function validateMove(
  placedTiles: PlacedTile[],
  board: BoardCell[][]
): Promise<ValidationResult> {
  const errors: string[] = [];
  
  if (placedTiles.length === 0) {
    return { isValid: false, errors: ['No tiles placed'], words: [] };
  }

  // Check if tiles are placed in a single line
  const lineValidation = validateSingleLine(placedTiles, board);
  if (!lineValidation.isValid) {
    errors.push(...lineValidation.errors);
  }

  // Check if tiles are connected to existing tiles (except first move)
  const connectionValidation = validateConnection(placedTiles, board);
  if (!connectionValidation.isValid) {
    errors.push(...connectionValidation.errors);
  }

  // Find all words formed by this move
  const words = findFormedWords(placedTiles, board);
  
  // Validate each word against dictionary
  const wordValidation = await validateWords(words);
  if (!wordValidation.isValid) {
    errors.push(...wordValidation.errors);
  }

  return {
    isValid: errors.length === 0,
    errors,
    words
  };
}

function validateSingleLine(placedTiles: PlacedTile[], board: BoardCell[][]): ValidationResult {
  if (placedTiles.length <= 1) {
    return { isValid: true, errors: [], words: [] };
  }

  const rows = placedTiles.map(t => t.row);
  const cols = placedTiles.map(t => t.col);
  
  const sameRow = rows.every(row => row === rows[0]);
  const sameCol = cols.every(col => col === cols[0]);

  if (!sameRow && !sameCol) {
    return {
      isValid: false,
      errors: ['Tiles must be placed in a single row or column'],
      words: []
    };
  }

  // Check for gaps in placement, considering existing tiles
  if (sameRow) {
    const row = rows[0];
    const allCols = cols.sort((a, b) => a - b);
    const minCol = allCols[0];
    const maxCol = allCols[allCols.length - 1];
    for (let c = minCol; c <= maxCol; c++) {
      const isPlaced = placedTiles.some(t => t.col === c);
      const hasExistingTile = board[row][c].tile !== null;
      if (!isPlaced && !hasExistingTile) {
        return {
          isValid: false,
          errors: ['Tiles must form a continuous line with existing tiles'],
          words: []
        };
      }
    }
  } else { // sameCol
    const col = cols[0];
    const allRows = rows.sort((a, b) => a - b);
    const minRow = allRows[0];
    const maxRow = allRows[allRows.length - 1];
    for (let r = minRow; r <= maxRow; r++) {
      const isPlaced = placedTiles.some(t => t.row === r);
      const hasExistingTile = board[r][col].tile !== null;
      if (!isPlaced && !hasExistingTile) {
        return {
          isValid: false,
          errors: ['Tiles must form a continuous line with existing tiles'],
          words: []
        };
      }
    }
  }

  return { isValid: true, errors: [], words: [] };
}

function validateConnection(placedTiles: PlacedTile[], board: BoardCell[][]): ValidationResult {
  // Check if this is the first move (center tile must be covered)
  const centerRow = Math.floor(BOARD_SIZE / 2);
  const centerCol = Math.floor(BOARD_SIZE / 2);
  
  const hasExistingTiles = board.some(row => 
    row.some(cell => cell.tile !== null)
  );

  if (!hasExistingTiles) {
    // First move must cover center
    const coversCenter = placedTiles.some(t => 
      t.row === centerRow && t.col === centerCol
    );
    
    if (!coversCenter) {
      return {
        isValid: false,
        errors: ['First move must cover the center star'],
        words: []
      };
    }
  } else {
    // Subsequent moves must connect to existing tiles
    const tempBoard = board.map(row => [...row]);
    placedTiles.forEach(({ tile, row, col }) => {
      tempBoard[row][col] = { ...tempBoard[row][col], tile };
    });

    const isConnected = placedTiles.some(tile => {
      const { row, col } = tile;
      // Check adjacent cells for existing tiles
      const adjacentPositions = [
        [row - 1, col], [row + 1, col],
        [row, col - 1], [row, col + 1]
      ];
      
      return adjacentPositions.some(([r, c]) => {
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
          return false;
        }
        // Check against the original board state
        return board[r][c].tile !== null;
      });
    });

    if (!isConnected) {
      return {
        isValid: false,
        errors: ['New tiles must connect to existing tiles'],
        words: []
      };
    }
  }

  return { isValid: true, errors: [], words: [] };
}

function findFormedWords(placedTiles: PlacedTile[], board: BoardCell[][]): WordPlacement[] {
  const words: WordPlacement[] = [];
  
  // Create a temporary board with the new tiles placed
  const tempBoard = board.map(row => [...row]);
  placedTiles.forEach(({ tile, row, col }) => {
    tempBoard[row][col] = { ...tempBoard[row][col], tile };
  });

  // Find horizontal words
  for (let row = 0; row < BOARD_SIZE; row++) {
    let currentWord = '';
    let wordTiles: PlacedTile[] = [];
    let startCol = 0;

    for (let col = 0; col <= BOARD_SIZE; col++) {
      const hasLetter = col < BOARD_SIZE && tempBoard[row][col].tile;
      
      if (hasLetter) {
        const tile = tempBoard[row][col].tile!;
        const letterToUse = tile.isBlank ? (tile.chosenLetter || tile.letter) : tile.letter;
        currentWord += letterToUse;
        wordTiles.push({ tile, row, col });
      } else {
        if (currentWord.length > 1) {
          // Check if this word contains any newly placed tiles
          const containsNewTile = wordTiles.some(wt => 
            placedTiles.some(pt => pt.row === wt.row && pt.col === wt.col)
          );
          
          if (containsNewTile) {
            words.push({
              word: currentWord,
              tiles: wordTiles,
              direction: 'HORIZONTAL',
              startRow: row,
              startCol
            });
          }
        }
        currentWord = '';
        wordTiles = [];
        startCol = col + 1;
      }
    }
  }

  // Find vertical words
  for (let col = 0; col < BOARD_SIZE; col++) {
    let currentWord = '';
    let wordTiles: PlacedTile[] = [];
    let startRow = 0;

    for (let row = 0; row <= BOARD_SIZE; row++) {
      const hasLetter = row < BOARD_SIZE && tempBoard[row][col].tile;
      
      if (hasLetter) {
        const tile = tempBoard[row][col].tile!;
        const letterToUse = tile.isBlank ? (tile.chosenLetter || tile.letter) : tile.letter;
        currentWord += letterToUse;
        wordTiles.push({ tile, row, col });
      } else {
        if (currentWord.length > 1) {
          // Check if this word contains any newly placed tiles
          const containsNewTile = wordTiles.some(wt => 
            placedTiles.some(pt => pt.row === wt.row && pt.col === wt.col)
          );
          
          if (containsNewTile) {
            words.push({
              word: currentWord,
              tiles: wordTiles,
              direction: 'VERTICAL',
              startRow,
              startCol: col
            });
          }
        }
        currentWord = '';
        wordTiles = [];
        startRow = row + 1;
      }
    }
  }

  return words;
}

async function validateWords(words: WordPlacement[]): Promise<ValidationResult> {
  const errors: string[] = [];
  
  for (const wordPlacement of words) {
    if (!(await isValidWord(wordPlacement.word))) {
      errors.push(`"${wordPlacement.word}" is not a valid word`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    words
  };
}

export async function isValidWord(word: string): Promise<boolean> {
  if (!word) {
    return false;
  }

  try {
    return await dictionaryService.isValidWord(word);
  } catch (error) {
    console.error('Error validating word:', error);
    return false;
  }
}
