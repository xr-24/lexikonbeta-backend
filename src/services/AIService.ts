import type { GameState, Player, Tile, PlacedTile, BoardCell } from '../types/game';
import { dictionaryService } from './dictionaryService';
import { calculateTurnScore } from './scoreCalculator';
import { validateMove } from './wordValidator';
import { BOARD_SIZE } from '../constants/board';

// Professional AI demon names
const DEMON_NAMES = [
  'Baal', 'Agares', 'Vassago', 'Samigina', 'Marbas', 'Valefor', 'Amon', 'Barbatos',
  'Paimon', 'Buer', 'Gusion', 'Sitri', 'Beleth', 'Leraje', 'Eligos', 'Zepar',
  'Botis', 'Bathin', 'Sallos', 'Purson', 'Marax', 'Ipos', 'Aim', 'Naberius'
];

interface AIMove {
  type: 'WORD' | 'EXCHANGE' | 'PASS';
  tiles?: PlacedTile[];
  exchangeTileIds?: string[];
}

interface WordCandidate {
  word: string;
  tiles: PlacedTile[];
  score: number;
  estimatedScore: number;
  row: number;
  col: number;
  direction: 'HORIZONTAL' | 'VERTICAL';
}

interface AnchorPoint {
  row: number;
  col: number;
  direction: 'HORIZONTAL' | 'VERTICAL';
  crossWordConstraints: string[];
  availableSpace: number;
  premiumMultiplier: number;
}

interface TilePattern {
  pattern: string;
  words: string[];
  minLength: number;
  maxLength: number;
}

export class AIService {
  private usedDemonNames: Set<string> = new Set();
  private wordCache: Map<string, boolean> = new Map();
  private patternCache: Map<string, string[]> = new Map();
  
  // High-value letter patterns for strategic word generation
  private readonly HIGH_VALUE_PATTERNS: TilePattern[] = [
    { pattern: 'QU', words: ['QUEEN', 'QUICK', 'QUIET', 'QUILT', 'QUOTE'], minLength: 4, maxLength: 7 },
    { pattern: 'X', words: ['AX', 'EX', 'OX', 'WAX', 'TAX', 'BOX', 'FOX', 'MIX', 'SIX', 'FIX'], minLength: 2, maxLength: 5 },
    { pattern: 'Z', words: ['ZOO', 'ZIP', 'ZAP', 'ZONE', 'ZERO', 'ZEST'], minLength: 3, maxLength: 6 },
    { pattern: 'J', words: ['JAM', 'JOB', 'JOY', 'JUMP', 'JUST', 'JAZZ'], minLength: 3, maxLength: 6 },
    { pattern: 'ING', words: ['RING', 'SING', 'KING', 'WING', 'THING', 'BRING'], minLength: 4, maxLength: 7 },
    { pattern: 'ED', words: ['RED', 'BED', 'LED', 'USED', 'MOVED', 'PLAYED'], minLength: 3, maxLength: 7 },
    { pattern: 'ER', words: ['HER', 'PER', 'OVER', 'UNDER', 'WATER', 'BETTER'], minLength: 3, maxLength: 7 },
    { pattern: 'LY', words: ['FLY', 'TRY', 'ONLY', 'EARLY', 'REALLY'], minLength: 3, maxLength: 7 },
    { pattern: 'ION', words: ['LION', 'UNION', 'NATION', 'ACTION'], minLength: 4, maxLength: 7 }
  ];

  // Common high-scoring words by length
  private readonly STRATEGIC_WORDS: Record<number, string[]> = {
    2: ['QI', 'XI', 'XU', 'ZA', 'JO', 'KA', 'QAT'],
    3: ['QUA', 'ZAX', 'ZEX', 'JEW', 'JAW', 'WAX', 'BOX', 'FOX', 'MIX'],
    4: ['QUIZ', 'JAZZ', 'JINX', 'WAXY', 'FOXY', 'COZY', 'HAZY'],
    5: ['JAZZY', 'FIZZY', 'FUZZY', 'DIZZY', 'QUAKE', 'QUEEN'],
    6: ['QUARTZ', 'ZEPHYR', 'JOCKEY', 'OXYGEN'],
    7: ['QUICKLY', 'QUALIFY', 'SQUEEZE', 'BUZZARD']
  };

  generateDemonName(): string {
    const availableNames = DEMON_NAMES.filter(name => !this.usedDemonNames.has(name));
    
    if (availableNames.length === 0) {
      this.usedDemonNames.clear();
      const name = DEMON_NAMES[Math.floor(Math.random() * DEMON_NAMES.length)];
      this.usedDemonNames.add(name);
      return name;
    }
    
    const name = availableNames[Math.floor(Math.random() * availableNames.length)];
    this.usedDemonNames.add(name);
    return name;
  }

  async generateMove(gameState: GameState, playerId: string): Promise<AIMove> {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      console.error(`AI player ${playerId} not found`);
      return { type: 'PASS' };
    }

    console.log(`🎯 ${player.name} analyzing board position...`);
    const startTime = Date.now();
    
    try {
      // Professional AI move generation pipeline
      const candidates = await this.generateWordCandidates(gameState.board, player.tiles);
      
      if (candidates.length === 0) {
        console.log(`🔄 ${player.name} exchanges tiles strategically`);
        return this.generateStrategicExchange(player.tiles);
      }

      // Select highest scoring move
      const bestMove = candidates[0]; // Already sorted by score
      const elapsedTime = Date.now() - startTime;
      
      console.log(`⚡ ${player.name} plays "${bestMove.word}" for ${bestMove.score} points (${elapsedTime}ms)`);
      
      return {
        type: 'WORD',
        tiles: bestMove.tiles
      };
    } catch (error) {
      console.error(`💀 ${player.name} AI error:`, error);
      return { type: 'PASS' };
    }
  }

  private async generateWordCandidates(board: BoardCell[][], tiles: Tile[]): Promise<WordCandidate[]> {
    const candidates: WordCandidate[] = [];
    
    // Step 1: Find strategic anchor points (adjacent to existing tiles)
    const anchors = this.findStrategicAnchors(board);
    
    // Step 2: Generate words using pattern-based approach
    const wordPool = this.generateWordPool(tiles);
    
    // Step 3: Try each word at each viable anchor point
    for (const word of wordPool) {
      for (const anchor of anchors) {
        const candidate = await this.tryWordAtAnchor(word, anchor, board, tiles);
        if (candidate) {
          candidates.push(candidate);
          
          // Limit candidates for performance (beam search)
          if (candidates.length >= 50) break;
        }
      }
      if (candidates.length >= 50) break;
    }

    // Step 4: Sort by score (highest first) and return top candidates
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // Keep only top 10 moves
  }

  private findStrategicAnchors(board: BoardCell[][]): AnchorPoint[] {
    const anchors: AnchorPoint[] = [];
    const hasExistingTiles = board.some(row => row.some(cell => cell.tile));
    
    if (!hasExistingTiles) {
      // First move - center position only
      return [{
        row: 7, col: 7, direction: 'HORIZONTAL',
        crossWordConstraints: [], availableSpace: 7, premiumMultiplier: 2
      }];
    }

    // Find positions adjacent to existing tiles
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col].tile) continue; // Skip occupied cells
        
        // Check if adjacent to existing tile
        const isAdjacent = this.isAdjacentToTile(row, col, board);
        if (!isAdjacent) continue;

        // Add horizontal anchor
        const hSpace = this.calculateAvailableSpace(row, col, 'HORIZONTAL', board);
        if (hSpace >= 2) {
          anchors.push({
            row, col, direction: 'HORIZONTAL',
            crossWordConstraints: this.getCrossWordConstraints(row, col, 'HORIZONTAL', board),
            availableSpace: hSpace,
            premiumMultiplier: this.calculatePremiumValue(row, col, board)
          });
        }

        // Add vertical anchor
        const vSpace = this.calculateAvailableSpace(row, col, 'VERTICAL', board);
        if (vSpace >= 2) {
          anchors.push({
            row, col, direction: 'VERTICAL',
            crossWordConstraints: this.getCrossWordConstraints(row, col, 'VERTICAL', board),
            availableSpace: vSpace,
            premiumMultiplier: this.calculatePremiumValue(row, col, board)
          });
        }
      }
    }

    // Sort anchors by strategic value (premium squares first)
    return anchors.sort((a, b) => b.premiumMultiplier - a.premiumMultiplier);
  }

  private generateWordPool(tiles: Tile[]): string[] {
    const words: Set<string> = new Set();
    const letters = tiles.map(t => t.letter.toUpperCase()).filter(l => l !== '?');
    const blanks = tiles.filter(t => t.isBlank).length;
    
    // Add strategic high-scoring words first
    for (const [length, wordList] of Object.entries(this.STRATEGIC_WORDS)) {
      for (const word of wordList) {
        if (this.canMakeWordWithBlanks(word, letters, blanks)) {
          words.add(word);
        }
      }
    }

    // Add pattern-based words
    for (const pattern of this.HIGH_VALUE_PATTERNS) {
      if (this.hasPattern(pattern.pattern, letters)) {
        for (const word of pattern.words) {
          if (this.canMakeWordWithBlanks(word, letters, blanks)) {
            words.add(word);
          }
        }
      }
    }

    // Add common 2-3 letter words for quick plays
    const shortWords = ['AT', 'TO', 'OF', 'IN', 'IT', 'IS', 'BE', 'AS', 'OR', 'AN', 'ON', 'NO', 'SO', 'BY', 'MY', 'WE', 'UP', 'IF', 'GO', 'DO', 'ME', 'HE', 'AM', 'US', 'OX', 'AX', 'EX', 'HI', 'LO', 'OH', 'YE', 'YO'];
    for (const word of shortWords) {
      if (this.canMakeWordWithBlanks(word, letters, blanks)) {
        words.add(word);
      }
    }

    // Convert to array and sort by length (longer words first for higher scores)
    return Array.from(words).sort((a, b) => b.length - a.length);
  }

  private async tryWordAtAnchor(
    word: string,
    anchor: AnchorPoint,
    board: BoardCell[][],
    tiles: Tile[]
  ): Promise<WordCandidate | null> {
    const { row, col, direction, availableSpace } = anchor;
    
    if (word.length > availableSpace) return null;

    // Try different starting positions for the word
    const maxOffset = Math.min(word.length - 1, direction === 'HORIZONTAL' ? col : row);
    
    for (let offset = 0; offset <= maxOffset; offset++) {
      const startRow = direction === 'HORIZONTAL' ? row : row - offset;
      const startCol = direction === 'HORIZONTAL' ? col - offset : col;
      
      const placement = await this.tryWordPlacement(
        word, startRow, startCol, direction, board, tiles
      );
      
      if (placement) {
        return placement;
      }
    }
    
    return null;
  }

  private async tryWordPlacement(
    word: string,
    startRow: number,
    startCol: number,
    direction: 'HORIZONTAL' | 'VERTICAL',
    board: BoardCell[][],
    tiles: Tile[]
  ): Promise<WordCandidate | null> {
    // Check bounds
    const endRow = direction === 'HORIZONTAL' ? startRow : startRow + word.length - 1;
    const endCol = direction === 'HORIZONTAL' ? startCol + word.length - 1 : startCol;
    
    if (startRow < 0 || startCol < 0 || endRow >= BOARD_SIZE || endCol >= BOARD_SIZE) {
      return null;
    }

    const placedTiles: PlacedTile[] = [];
    const usedTileIds: string[] = [];
    let connectsToExisting = false;
    let usedBlanks = 0;
    
    // Check if we can place this word
    for (let i = 0; i < word.length; i++) {
      const row = direction === 'HORIZONTAL' ? startRow : startRow + i;
      const col = direction === 'HORIZONTAL' ? startCol + i : startCol;
      const letter = word[i].toUpperCase();
      
      const existingTile = board[row][col].tile;
      
      if (existingTile) {
        // Must match existing tile
        if (existingTile.letter.toUpperCase() !== letter) {
          return null;
        }
        connectsToExisting = true;
      } else {
        // Need to place a new tile
        let availableTile = tiles.find(t => 
          t.letter.toUpperCase() === letter && !usedTileIds.includes(t.id)
        );
        
        // Try using a blank tile if no regular tile available
        if (!availableTile) {
          availableTile = tiles.find(t => 
            t.isBlank && !usedTileIds.includes(t.id)
          );
          if (availableTile) {
            usedBlanks++;
          }
        }
        
        if (!availableTile) {
          return null;
        }
        
        placedTiles.push({
          tile: availableTile,
          row,
          col
        });
        usedTileIds.push(availableTile.id);
      }
    }
    
    // Must place at least one new tile
    if (placedTiles.length === 0) return null;
    
    // First move must cover center
    const isFirstMove = !board.some(row => row.some(cell => cell.tile));
    if (isFirstMove) {
      const coversCenter = placedTiles.some(t => t.row === 7 && t.col === 7);
      if (!coversCenter) return null;
      connectsToExisting = true;
    }
    
    // Must connect to existing tiles
    if (!connectsToExisting && !isFirstMove) return null;
    
    // Quick word validation
    if (!(await this.isValidWordCached(word))) return null;
    
    // Estimate score quickly (without full validation)
    const estimatedScore = this.estimateScore(word, placedTiles, board, usedBlanks);
    
    // Only do expensive validation for high-scoring moves
    if (estimatedScore < 15 && !isFirstMove) return null;
    
    try {
      // Full validation
      const validation = await validateMove(placedTiles, board);
      if (!validation.isValid) return null;
      
      // Calculate exact score
      const scoreResult = calculateTurnScore(validation.words, placedTiles, board);
      
      return {
        word,
        tiles: placedTiles,
        score: scoreResult.totalScore,
        estimatedScore,
        row: startRow,
        col: startCol,
        direction
      };
    } catch (error) {
      return null;
    }
  }

  private estimateScore(word: string, tiles: PlacedTile[], board: BoardCell[][], blanksUsed: number): number {
    let score = 0;
    let wordMultiplier = 1;
    
    for (const placedTile of tiles) {
      const { row, col, tile } = placedTile;
      let letterScore = tile.isBlank ? 0 : tile.value;
      
      // Apply letter multipliers
      const multiplier = board[row][col].multiplier;
      if (multiplier === 'DOUBLE_LETTER') letterScore *= 2;
      if (multiplier === 'TRIPLE_LETTER') letterScore *= 3;
      if (multiplier === 'DOUBLE_WORD') wordMultiplier *= 2;
      if (multiplier === 'TRIPLE_WORD') wordMultiplier *= 3;
      
      score += letterScore;
    }
    
    score *= wordMultiplier;
    
    // Bonus for using all 7 tiles
    if (tiles.length === 7) score += 50;
    
    // Bonus for longer words
    if (word.length >= 6) score += word.length * 2;
    
    // Penalty for using blanks
    score -= blanksUsed * 5;
    
    return score;
  }

  // Helper methods
  private isAdjacentToTile(row: number, col: number, board: BoardCell[][]): boolean {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    return directions.some(([dr, dc]) => {
      const newRow = row + dr;
      const newCol = col + dc;
      return newRow >= 0 && newRow < BOARD_SIZE && 
             newCol >= 0 && newCol < BOARD_SIZE && 
             board[newRow][newCol].tile !== null;
    });
  }

  private calculateAvailableSpace(row: number, col: number, direction: 'HORIZONTAL' | 'VERTICAL', board: BoardCell[][]): number {
    let space = 1; // Current position
    
    if (direction === 'HORIZONTAL') {
      // Check left
      for (let c = col - 1; c >= 0 && !board[row][c].tile; c--) space++;
      // Check right
      for (let c = col + 1; c < BOARD_SIZE && !board[row][c].tile; c++) space++;
    } else {
      // Check up
      for (let r = row - 1; r >= 0 && !board[r][col].tile; r--) space++;
      // Check down
      for (let r = row + 1; r < BOARD_SIZE && !board[r][col].tile; r++) space++;
    }
    
    return space;
  }

  private getCrossWordConstraints(row: number, col: number, direction: 'HORIZONTAL' | 'VERTICAL', board: BoardCell[][]): string[] {
    // For now, return empty constraints - could be enhanced for more sophisticated play
    return [];
  }

  private calculatePremiumValue(row: number, col: number, board: BoardCell[][]): number {
    const multiplier = board[row][col].multiplier;
    switch (multiplier) {
      case 'TRIPLE_WORD': return 10;
      case 'DOUBLE_WORD': return 5;
      case 'TRIPLE_LETTER': return 3;
      case 'DOUBLE_LETTER': return 2;
      case 'CENTER': return 4;
      default: return 1;
    }
  }

  private canMakeWordWithBlanks(word: string, letters: string[], blanks: number): boolean {
    const letterCounts = new Map<string, number>();
    letters.forEach(letter => {
      letterCounts.set(letter, (letterCounts.get(letter) || 0) + 1);
    });
    
    let blanksNeeded = 0;
    for (const letter of word) {
      const available = letterCounts.get(letter) || 0;
      if (available > 0) {
        letterCounts.set(letter, available - 1);
      } else {
        blanksNeeded++;
      }
    }
    
    return blanksNeeded <= blanks;
  }

  private hasPattern(pattern: string, letters: string[]): boolean {
    return pattern.split('').every(letter => letters.includes(letter));
  }

  private async isValidWordCached(word: string): Promise<boolean> {
    if (this.wordCache.has(word)) {
      return this.wordCache.get(word)!;
    }
    
    try {
      const isValid = await dictionaryService.isValidWord(word);
      this.wordCache.set(word, isValid);
      return isValid;
    } catch (error) {
      this.wordCache.set(word, false);
      return false;
    }
  }

  private generateStrategicExchange(tiles: Tile[]): AIMove {
    // Keep high-value tiles and vowels, exchange low-value consonants
    const tileValues = tiles.map(t => ({ 
      tile: t, 
      value: t.value,
      isVowel: 'AEIOU'.includes(t.letter.toUpperCase())
    }));
    
    // Sort by strategic value (keep high-value tiles and vowels)
    tileValues.sort((a, b) => {
      if (a.isVowel !== b.isVowel) return a.isVowel ? 1 : -1; // Keep vowels
      return a.value - b.value; // Exchange low-value tiles first
    });
    
    // Exchange 3-5 lowest value tiles
    const exchangeCount = Math.min(Math.max(3, Math.floor(Math.random() * 3) + 3), tiles.length);
    const tilesToExchange = tileValues.slice(0, exchangeCount).map(tv => tv.tile);
    
    return {
      type: 'EXCHANGE',
      exchangeTileIds: tilesToExchange.map(t => t.id)
    };
  }
}

export const aiService = new AIService();
