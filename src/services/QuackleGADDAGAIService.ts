import type { GameState, Player, Tile, PlacedTile, BoardCell } from '../types/game';
import { dictionaryService } from './dictionaryService';
import { calculateTurnScore } from './scoreCalculator';
import { validateMove } from './wordValidator';
import { BOARD_SIZE } from '../constants/board';
import { Gaddag, buildGaddagFromFile } from './gaddag/gaddag';
import { Board } from './gaddag/board';
import { Move } from './gaddag/generator';
import path from 'path';

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

export class QuackleGADDAGAIService {
  private usedDemonNames: Set<string> = new Set();
  private gaddag: Gaddag | null = null;
  private dictionary: Set<string> | null = null;
  private initPromise: Promise<void> | null = null;
  private isInitializing: boolean = false;

  constructor() {
    // Don't initialize in constructor - do it lazily when needed
  }

  public async initialize(): Promise<void> {
    if (this.isInitializing || (this.gaddag && this.dictionary)) {
      return;
    }

    this.isInitializing = true;
    
    try {
      console.log('🔥 Initializing Quackle GADDAG AI Service...');
      
      // Wait for dictionary service to be ready
      await dictionaryService.loadDictionary();
      
      // Build GADDAG from dictionary service's internal word set with timeout
      console.time('GADDAG Build');
      this.gaddag = await Promise.race([
        this.buildGaddagFromDictionaryService(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('GADDAG build timeout')), 30000)
        )
      ]);
      console.timeEnd('GADDAG Build');
      console.log(`✅ GADDAG built with ${this.gaddag.size} nodes`);

      // Create dictionary set for Board class with timeout
      this.dictionary = await Promise.race([
        this.getDictionarySet(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Dictionary load timeout')), 10000)
        )
      ]);
      console.log(`✅ Dictionary loaded with ${this.dictionary.size} words`);
    } catch (error) {
      console.error('💀 Failed to initialize GADDAG AI:', error);
      this.isInitializing = false;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  private async buildGaddagFromDictionaryService(): Promise<Gaddag> {
    const gaddag = new Gaddag();
    
    try {
      // Load from local file only
      const fs = await import('fs');
      const path = await import('path');
      
      // Try multiple possible local paths
      const possiblePaths = [
        path.join(process.cwd(), 'public', 'sowpods.txt'),
        path.join(process.cwd(), 'src', 'services', 'gaddag', 'sowpods.txt'),
        path.join(__dirname, 'gaddag', 'sowpods.txt')
      ];
      
      for (const localPath of possiblePaths) {
        if (fs.existsSync(localPath)) {
          console.log(`Loading dictionary from: ${localPath}`);
          const content = fs.readFileSync(localPath, 'utf8');
          const words = content.trim().split('\n').map(word => word.trim().toUpperCase());
          
          console.log(`Building GADDAG from ${words.length} words...`);
          
          // Process words in chunks to avoid blocking the event loop
          const CHUNK_SIZE = 1000;
          for (let i = 0; i < words.length; i += CHUNK_SIZE) {
            const chunk = words.slice(i, i + CHUNK_SIZE);
            
            // Process chunk synchronously
            for (const word of chunk) {
              if (word && word.length > 0) {
                gaddag.addWord(word);
              }
            }
            
            // Yield control back to event loop every chunk
            if (i % (CHUNK_SIZE * 10) === 0) {
              console.log(`GADDAG progress: ${i}/${words.length} words processed`);
              await new Promise(resolve => setImmediate(resolve));
            }
          }
          
          console.log(`GADDAG build complete: ${words.length} words processed`);
          return gaddag;
        }
      }
      
      throw new Error('No local dictionary file found. Checked paths: ' + possiblePaths.join(', '));
    } catch (error) {
      console.error('Failed to build GADDAG from local files:', error);
      throw error;
    }
  }

  private async getDictionarySet(): Promise<Set<string>> {
    try {
      // Load from local file only
      const fs = await import('fs');
      const path = await import('path');
      
      // Try multiple possible local paths
      const possiblePaths = [
        path.join(process.cwd(), 'public', 'sowpods.txt'),
        path.join(process.cwd(), 'src', 'services', 'gaddag', 'sowpods.txt'),
        path.join(__dirname, 'gaddag', 'sowpods.txt')
      ];
      
      for (const localPath of possiblePaths) {
        if (fs.existsSync(localPath)) {
          console.log(`Loading dictionary set from: ${localPath}`);
          const content = fs.readFileSync(localPath, 'utf8');
          return new Set(content.trim().split('\n').map(word => word.trim().toUpperCase()));
        }
      }
      
      throw new Error('No local dictionary file found for dictionary set. Checked paths: ' + possiblePaths.join(', '));
    } catch (error) {
      console.error('Failed to load dictionary set from local files:', error);
      throw error;
    }
  }

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
      console.warn(`AI player ${playerId} not found`);
      return { type: 'PASS' };
    }

    // Try to ensure initialization, but don't fail if it doesn't work
    try {
      await Promise.race([
        this.ensureInitialized(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('AI initialization timeout')), 3000)
        )
      ]);
    } catch (error) {
      console.warn(`AI initialization failed for ${player.name}:`, error);
      // Fall back to simple strategic exchange instead of failing completely
      console.log(`🔄 ${player.name} falls back to strategic exchange due to initialization failure`);
      return this.generateStrategicExchange(player.tiles);
    }

    // Check if GADDAG is available
    if (!this.gaddag || !this.dictionary) {
      console.warn(`GADDAG not available for ${player.name}, using fallback strategy`);
      return this.generateStrategicExchange(player.tiles);
    }

    console.log(`🎯 ${player.name} analyzing board with GADDAG...`);
    const startTime = Date.now();
    
    try {
      // Convert game board to GADDAG board format
      const gaddagBoard = this.convertToGaddagBoard(gameState.board);
      
      // Convert player tiles to rack string
      const rack = this.convertTilesToRack(player.tiles);
      
      // Generate moves using GADDAG with timeout
      const moves = await Promise.race([
        Promise.resolve(gaddagBoard.generateMoves(rack, this.gaddag)),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Move generation timeout')), 2000)
        )
      ]);
      
      if (moves.length === 0) {
        console.log(`🔄 ${player.name} exchanges tiles strategically - no moves found`);
        return this.generateStrategicExchange(player.tiles);
      }

      // Try moves in order until we find one that passes validation
      for (const move of moves.slice(0, 15)) { // Try top 15 moves
        try {
          const placedTiles = await this.convertGaddagMoveToPlacedTiles(move, player.tiles, gameState.board);
          
          // Validate the move using the game's validation system
          const validation = await validateMove(placedTiles, gameState.board);
          
          if (validation.isValid) {
            const elapsedTime = Date.now() - startTime;
            console.log(`⚡ ${player.name} plays "${move.word}" for ${move.score} points (${elapsedTime}ms)`);
            
            return {
              type: 'WORD',
              tiles: placedTiles
            };
          } else {
            console.log(`❌ ${player.name} rejected "${move.word}": ${validation.errors.join(', ')}`);
          }
        } catch (moveError) {
          console.warn(`Error processing move "${move.word}" for ${player.name}:`, moveError);
          continue; // Try next move
        }
      }
      
      // If no valid moves found, exchange tiles
      console.log(`🔄 ${player.name} exchanges tiles - no valid moves found`);
      return this.generateStrategicExchange(player.tiles);
    } catch (error) {
      console.warn(`GADDAG AI error for ${player.name}:`, error);
      // Fall back to strategic exchange
      console.log(`🔄 ${player.name} falls back to strategic exchange due to error`);
      return this.generateStrategicExchange(player.tiles);
    }
  }

  private convertToGaddagBoard(gameBoard: BoardCell[][]): Board {
    if (!this.dictionary) {
      throw new Error('Dictionary not initialized');
    }

    const board = new Board(this.dictionary);
    
    // Collect all existing tiles
    const existingTiles: { row: number; col: number; code: number }[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = gameBoard[row][col];
        if (cell.tile) {
          const letter = cell.tile.letter.toUpperCase();
          const code = letter.charCodeAt(0);
          existingTiles.push({ row, col, code });
        }
      }
    }
    
    // Place tiles using the proper place method to ensure cross-checks are computed correctly
    // Group tiles by words to place them as complete words rather than individual tiles
    const wordGroups = this.groupTilesIntoWords(existingTiles, gameBoard);
    
    for (const wordGroup of wordGroups) {
      if (wordGroup.tiles.length > 0) {
        const codes = wordGroup.tiles.map(t => t.code);
        board.place(wordGroup.startRow, wordGroup.startCol, wordGroup.direction, codes);
      }
    }
    
    return board;
  }

  private groupTilesIntoWords(
    tiles: { row: number; col: number; code: number }[], 
    gameBoard: BoardCell[][]
  ): { startRow: number; startCol: number; direction: 'H' | 'V'; tiles: { row: number; col: number; code: number }[] }[] {
    const wordGroups: { startRow: number; startCol: number; direction: 'H' | 'V'; tiles: { row: number; col: number; code: number }[] }[] = [];
    const processedTiles = new Set<string>();
    
    for (const tile of tiles) {
      const key = `${tile.row}-${tile.col}`;
      if (processedTiles.has(key)) continue;
      
      // Try horizontal word first
      const horizontalWord = this.findWordFromTile(tile, 'H', gameBoard);
      if (horizontalWord.length > 1) {
        const wordTiles = horizontalWord.map(pos => ({
          row: pos.row,
          col: pos.col,
          code: pos.code
        }));
        
        wordGroups.push({
          startRow: horizontalWord[0].row,
          startCol: horizontalWord[0].col,
          direction: 'H',
          tiles: wordTiles
        });
        
        // Mark all tiles in this word as processed
        horizontalWord.forEach(pos => {
          processedTiles.add(`${pos.row}-${pos.col}`);
        });
        continue;
      }
      
      // Try vertical word
      const verticalWord = this.findWordFromTile(tile, 'V', gameBoard);
      if (verticalWord.length > 1) {
        const wordTiles = verticalWord.map(pos => ({
          row: pos.row,
          col: pos.col,
          code: pos.code
        }));
        
        wordGroups.push({
          startRow: verticalWord[0].row,
          startCol: verticalWord[0].col,
          direction: 'V',
          tiles: wordTiles
        });
        
        // Mark all tiles in this word as processed
        verticalWord.forEach(pos => {
          processedTiles.add(`${pos.row}-${pos.col}`);
        });
        continue;
      }
      
      // Single tile (shouldn't happen in a valid game, but handle it)
      wordGroups.push({
        startRow: tile.row,
        startCol: tile.col,
        direction: 'H',
        tiles: [tile]
      });
      processedTiles.add(key);
    }
    
    return wordGroups;
  }

  private findWordFromTile(
    startTile: { row: number; col: number; code: number },
    direction: 'H' | 'V',
    gameBoard: BoardCell[][]
  ): { row: number; col: number; code: number }[] {
    const [dr, dc] = direction === 'H' ? [0, 1] : [1, 0];
    const word: { row: number; col: number; code: number }[] = [];
    
    // Find the start of the word by going backwards
    let currentRow = startTile.row;
    let currentCol = startTile.col;
    
    while (currentRow >= 0 && currentCol >= 0 && 
           currentRow < BOARD_SIZE && currentCol < BOARD_SIZE) {
      const prevRow = currentRow - dr;
      const prevCol = currentCol - dc;
      
      if (prevRow >= 0 && prevCol >= 0 && 
          prevRow < BOARD_SIZE && prevCol < BOARD_SIZE && 
          gameBoard[prevRow][prevCol].tile) {
        currentRow = prevRow;
        currentCol = prevCol;
      } else {
        break;
      }
    }
    
    // Now collect the word going forward
    while (currentRow >= 0 && currentCol >= 0 && 
           currentRow < BOARD_SIZE && currentCol < BOARD_SIZE && 
           gameBoard[currentRow][currentCol].tile) {
      const cell = gameBoard[currentRow][currentCol];
      const letter = cell.tile!.letter.toUpperCase();
      const code = letter.charCodeAt(0);
      
      word.push({ row: currentRow, col: currentCol, code });
      
      currentRow += dr;
      currentCol += dc;
    }
    
    return word;
  }

  private findWordFromPosition(
    startRow: number, 
    startCol: number, 
    direction: 'H' | 'V', 
    allTiles: { row: number; col: number; letter: string }[]
  ): { row: number; col: number; letter: string }[] {
    const word: { row: number; col: number; letter: string }[] = [];
    const tileMap = new Map<string, { row: number; col: number; letter: string }>();
    
    // Create position map for quick lookup
    allTiles.forEach(tile => {
      tileMap.set(`${tile.row}-${tile.col}`, tile);
    });
    
    const [dr, dc] = direction === 'H' ? [0, 1] : [1, 0];
    
    // Find the actual start of the word (go backwards first)
    let currentRow = startRow;
    let currentCol = startCol;
    
    while (currentRow >= 0 && currentCol >= 0 && 
           currentRow < BOARD_SIZE && currentCol < BOARD_SIZE) {
      const prevRow = currentRow - dr;
      const prevCol = currentCol - dc;
      const prevKey = `${prevRow}-${prevCol}`;
      
      if (prevRow >= 0 && prevCol >= 0 && 
          prevRow < BOARD_SIZE && prevCol < BOARD_SIZE && 
          tileMap.has(prevKey)) {
        currentRow = prevRow;
        currentCol = prevCol;
      } else {
        break;
      }
    }
    
    // Now collect the word going forward
    while (currentRow >= 0 && currentCol >= 0 && 
           currentRow < BOARD_SIZE && currentCol < BOARD_SIZE) {
      const key = `${currentRow}-${currentCol}`;
      const tile = tileMap.get(key);
      
      if (tile) {
        word.push(tile);
        currentRow += dr;
        currentCol += dc;
      } else {
        break;
      }
    }
    
    return word;
  }

  private convertTilesToRack(tiles: Tile[]): string {
    return tiles.map(tile => {
      if (tile.isBlank) {
        return '?'; // GADDAG uses ? for blank tiles
      }
      return tile.letter.toUpperCase();
    }).join('');
  }

  private async convertGaddagMoveToPlacedTiles(move: Move, playerTiles: Tile[], gameBoard: BoardCell[][]): Promise<PlacedTile[]> {
    const placedTiles: PlacedTile[] = [];
    const usedTileIds: string[] = [];
    
    // Parse the word and determine which tiles to place
    const word = move.word;
    const startRow = move.row;
    const startCol = move.col;
    const isHorizontal = move.dir === 'H';
    
    for (let i = 0; i < word.length; i++) {
      const row = isHorizontal ? startRow : startRow + i;
      const col = isHorizontal ? startCol + i : startCol;
      const letter = word[i].toUpperCase();
      
      // Skip if there's already a tile at this position
      if (gameBoard[row] && gameBoard[row][col] && gameBoard[row][col].tile) {
        continue;
      }
      
      // Find available tile for this letter
      let availableTile = playerTiles.find(t => 
        t.letter.toUpperCase() === letter && !usedTileIds.includes(t.id)
      );
      
      // Try using a blank tile if no regular tile available
      if (!availableTile) {
        const blankTile = playerTiles.find(t => 
          t.isBlank && !usedTileIds.includes(t.id)
        );
        
        if (blankTile) {
          // For blank tiles, we need to preserve the original tile for validation
          // but indicate what letter it should represent when placed
          availableTile = {
            ...blankTile,
            // Keep original letter (?) for validation, but add chosen letter as metadata
            chosenLetter: letter,
            value: 0, // Blank tiles are always worth 0 points
            isBlank: true // Keep the isBlank flag for proper validation
          };
        }
      }
      
      if (availableTile) {
        placedTiles.push({
          tile: availableTile,
          row,
          col
        });
        usedTileIds.push(availableTile.id);
      } else {
        console.warn(`Could not find tile for letter ${letter} in word ${word}`);
        return []; // Return empty array if we can't place the word
      }
    }
    
    return placedTiles;
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

export const quackleGaddagAIService = new QuackleGADDAGAIService();
