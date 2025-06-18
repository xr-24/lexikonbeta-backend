import type { Evocation, EvocationType, Player, PlacedTile, Tile } from '../types/game';

export interface GameModifiers {
  allowUnlimitedTiles: boolean;
  scoreMultiplier: number;
  skipTurnAdvancement: boolean;
  allowWildCards: boolean;
  addBlankTile: boolean;               // For ASTAROTH
  swapWithOpponent: boolean;           // For GREMORY
  guaranteedVowelSwap: boolean;        // For BUNE
  allowRackExpansion: boolean;         // For ANDROMALIUS, HAAGENTI
  maxRackSize: number;                 // 8 for ANDROMALIUS, 10 for HAAGENTI
  frozenTiles: Array<{row: number, col: number}>; // For FORNEUS
  silencedTiles: string[];             // tile IDs for MURMUR
}

export class EvocationManager {
  static getDefaultModifiers(): GameModifiers {
    return {
      allowUnlimitedTiles: false,
      scoreMultiplier: 1,
      skipTurnAdvancement: false,
      allowWildCards: false,
      addBlankTile: false,
      swapWithOpponent: false,
      guaranteedVowelSwap: false,
      allowRackExpansion: false,
      maxRackSize: 7,
      frozenTiles: [],
      silencedTiles: []
    };
  }

  static applyEvocationEffects(evocationType: EvocationType | null): GameModifiers {
    const modifiers = this.getDefaultModifiers();

    if (!evocationType) {
      return modifiers;
    }

    switch (evocationType) {
      case 'OROBAS':
        modifiers.allowUnlimitedTiles = true;
        break;
      case 'BUNE':
        modifiers.guaranteedVowelSwap = true;
        break;
      case 'GREMORY':
        modifiers.swapWithOpponent = true;
        break;
      case 'ASTAROTH':
        modifiers.addBlankTile = true;
        break;
      case 'ANDROMALIUS':
        modifiers.allowRackExpansion = true;
        modifiers.maxRackSize = 8;
        break;
      case 'HAAGENTI':
        modifiers.allowRackExpansion = true;
        modifiers.maxRackSize = 10;
        break;
      case 'FURFUR':
        modifiers.skipTurnAdvancement = true;
        break;
      // AIM, VALEFOR, DANTALION, FORNEUS, MURMUR require special handling
      // and don't modify the basic game modifiers
    }

    return modifiers;
  }

  static validateTileUsage(
    player: Player,
    pendingTiles: PlacedTile[],
    allowUnlimitedTiles: boolean = false
  ): { isValid: boolean; errors: string[] } {
    if (allowUnlimitedTiles) {
      // With unlimited tiles evocation, any tile usage is valid
      return { isValid: true, errors: [] };
    }

    // Count how many times each tile ID is used
    const tileUsageCount = new Map<string, number>();
    pendingTiles.forEach(pt => {
      const currentCount = tileUsageCount.get(pt.tile.id) || 0;
      tileUsageCount.set(pt.tile.id, currentCount + 1);
    });

    // Check if player has enough of each tile
    const errors: string[] = [];
    for (const [tileId, usageCount] of tileUsageCount) {
      const playerTileCount = player.tiles.filter(t => t.id === tileId).length;
      if (usageCount > playerTileCount) {
        const tile = player.tiles.find(t => t.id === tileId);
        const letter = tile?.letter || 'Unknown';
        errors.push(`Cannot use tile '${letter}' ${usageCount} times - you only have ${playerTileCount}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static collectEvocationFromBoard(
    player: Player,
    evocation: Evocation
  ): Player {
    return {
      ...player,
      evocations: [...player.evocations, evocation]
    };
  }

  static activateEvocation(
    player: Player,
    evocationId: string
  ): { success: boolean; updatedPlayer: Player; activatedEvocation?: Evocation; error?: string; requiresGameStateUpdate?: boolean; gameStateUpdates?: any } {
    const evocationIndex = player.evocations.findIndex(e => e.id === evocationId);
    
    if (evocationIndex === -1) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'Evocation not found in player inventory'
      };
    }

    const evocation = player.evocations[evocationIndex];
    const updatedEvocations = player.evocations.filter((_, index) => index !== evocationIndex);

    // Remove evocation from inventory first
    let updatedPlayer = {
      ...player,
      evocations: updatedEvocations
    };

    // Execute evocation-specific effects that can be handled immediately
    // Note: Some evocations like MURMUR, AIM, ANDROMALIUS, VALEFOR require game state access
    // and will be handled by the GameService after this method returns
    switch (evocation.type) {
      case 'ASTAROTH':
        // Add blank tile to rack
        updatedPlayer = this.addBlankTileToRack(updatedPlayer);
        break;
      case 'DANTALION':
        // For now, we'll need the GameService to handle this since it needs tile selection
        // This will be handled in the GameService after activation
        break;
      case 'FURFUR':
        // Extra turn - this will be handled by game flow logic
        break;
      // Other evocations that need special handling will be processed by GameService
      default:
        // Most evocations require game state access and will be handled by GameService
        break;
    }

    return {
      success: true,
      updatedPlayer,
      activatedEvocation: evocation,
      requiresGameStateUpdate: true
    };
  }

  static getEvocationName(type: EvocationType): string {
    switch (type) {
      case 'OROBAS':
        return 'Invocation of Orobas';
      case 'BUNE':
        return 'Invocation of Bune';
      case 'GREMORY':
        return 'Invocation of Gremory';
      case 'ASTAROTH':
        return 'Invocation of Astaroth';
      case 'AIM':
        return 'Invocation of Aim';
      case 'ANDROMALIUS':
        return 'Invocation of Andromalius';
      case 'VALEFOR':
        return 'Invocation of Valefor';
      case 'DANTALION':
        return 'Invocation of Dantalion';
      case 'FURFUR':
        return 'Invocation of Furfur';
      case 'FORNEUS':
        return 'Invocation of Forneus';
      case 'MURMUR':
        return 'Invocation of Murmur';
      case 'HAAGENTI':
        return 'Invocation of Haagenti';
      default:
        return 'Unknown';
    }
  }

  static getEvocationDescription(type: EvocationType): string {
    switch (type) {
      case 'OROBAS':
        return 'Allows unlimited reuse of letters from your rack for one turn.';
      case 'BUNE':
        return 'Discard your current rack and draw a fresh one, guaranteed vowels.';
      case 'GREMORY':
        return 'Swap racks entirely with your opponent.';
      case 'ASTAROTH':
        return 'Adds one temporary wildcard tile (blank) to your rack.';
      case 'AIM':
        return 'Force your opponent to discard two tiles from their rack.';
      case 'ANDROMALIUS':
        return 'Steal one tile from your opponent\'s rack to use on your turn.';
      case 'VALEFOR':
        return 'Steal a double or triple word multiplier from the board for your own use.';
      case 'DANTALION':
        return 'Duplicate one tile in your rack.';
      case 'FURFUR':
        return 'Immediately take an additional turn after your current one.';
      case 'FORNEUS':
        return 'Freeze a tile on the board, preventing opponents from building on it next turn.';
      case 'MURMUR':
        return 'Lock three random opponent tiles, preventing their use next turn.';
      case 'HAAGENTI':
        return 'Temporarily expand your rack to 10 tiles for your current turn.';
      default:
        return 'Unknown evocation';
    }
  }

  static applyScoreModifier(baseScore: number, scoreMultiplier: number): number {
    return Math.floor(baseScore * scoreMultiplier);
  }

  // Evocation effect methods (same logic as PowerUpManager but for evocations)
  static swapPlayerTiles(currentPlayer: Player, tileBag: Tile[]): {
    updatedPlayer: Player;
    updatedBag: Tile[];
  } {
    // Add current player's tiles back to bag
    const newBag = [...tileBag, ...currentPlayer.tiles];
    
    // Shuffle the bag
    for (let i = newBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newBag[i], newBag[j]] = [newBag[j], newBag[i]];
    }

    // Draw 7 new tiles
    const newTiles = newBag.slice(0, 7);
    const remainingBag = newBag.slice(7);

    return {
      updatedPlayer: {
        ...currentPlayer,
        tiles: newTiles
      },
      updatedBag: remainingBag
    };
  }

  static swapTilesWithOpponent(player1: Player, player2: Player): {
    updatedPlayer1: Player;
    updatedPlayer2: Player;
  } {
    return {
      updatedPlayer1: {
        ...player1,
        tiles: player2.tiles
      },
      updatedPlayer2: {
        ...player2,
        tiles: player1.tiles
      }
    };
  }

  static addBlankTileToRack(player: Player): Player {
    // Create a new blank tile
    const blankTile: Tile = {
      id: `blank-tile-${Date.now()}-${Math.random()}`,
      letter: '?',
      value: 0,
      isBlank: true
    };

    return {
      ...player,
      tiles: [...player.tiles, blankTile]
    };
  }

  static guaranteeVowelsInDraw(tiles: Tile[], tileBag: Tile[]): {
    finalTiles: Tile[];
    updatedBag: Tile[];
  } {
    const vowels = ['A', 'E', 'I', 'O', 'U'];
    const vowelTiles = tileBag.filter(tile => vowels.includes(tile.letter));
    const nonVowelTiles = tileBag.filter(tile => !vowels.includes(tile.letter));
    
    // Count vowels in current tiles
    const currentVowelCount = tiles.filter(tile => vowels.includes(tile.letter)).length;
    const vowelsNeeded = Math.max(0, 2 - currentVowelCount);
    
    if (vowelsNeeded === 0 || vowelTiles.length === 0) {
      // Already have enough vowels or no vowels available
      return {
        finalTiles: tiles,
        updatedBag: tileBag
      };
    }

    // Take required vowels from bag
    const guaranteedVowels = vowelTiles.slice(0, Math.min(vowelsNeeded, vowelTiles.length));
    const remainingVowels = vowelTiles.slice(guaranteedVowels.length);
    
    // Remove non-vowels from tiles to make room for guaranteed vowels
    const nonVowelsInTiles = tiles.filter(tile => !vowels.includes(tile.letter));
    
    const tilesToRemove = nonVowelsInTiles.slice(0, guaranteedVowels.length);
    const tilesToKeep = tiles.filter(tile => !tilesToRemove.includes(tile));
    
    // Create final tile set
    const finalTiles = [...tilesToKeep, ...guaranteedVowels];
    
    // Update bag
    const updatedBag = [...remainingVowels, ...nonVowelTiles, ...tilesToRemove];
    
    // Shuffle the updated bag
    for (let i = updatedBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [updatedBag[i], updatedBag[j]] = [updatedBag[j], updatedBag[i]];
    }

    return {
      finalTiles,
      updatedBag
    };
  }

  // Specific evocation execution methods
  static executeAim(targetPlayer: Player, targetTileIds: string[]): {
    success: boolean;
    updatedPlayer: Player;
    error?: string;
  } {
    if (targetTileIds.length !== 2) {
      return {
        success: false,
        updatedPlayer: targetPlayer,
        error: 'Must select exactly 2 tiles to discard'
      };
    }

    // Validate target player has the tiles
    const tilesToRemove = targetTileIds.map(id => 
      targetPlayer.tiles.find(t => t.id === id)
    );

    if (tilesToRemove.some(tile => !tile)) {
      return {
        success: false,
        updatedPlayer: targetPlayer,
        error: 'Target player does not have one or more of the specified tiles'
      };
    }

    // Remove the specified tiles
    const updatedTiles = targetPlayer.tiles.filter(t => !targetTileIds.includes(t.id));

    return {
      success: true,
      updatedPlayer: {
        ...targetPlayer,
        tiles: updatedTiles
      }
    };
  }

  static executeAndromalius(currentPlayer: Player, targetPlayer: Player, targetTileId: string): {
    success: boolean;
    updatedCurrentPlayer: Player;
    updatedTargetPlayer: Player;
    error?: string;
  } {
    // Validate target tile exists
    const targetTile = targetPlayer.tiles.find(t => t.id === targetTileId);
    if (!targetTile) {
      return {
        success: false,
        updatedCurrentPlayer: currentPlayer,
        updatedTargetPlayer: targetPlayer,
        error: 'Target tile not found'
      };
    }

    // Remove tile from target player
    const updatedTargetTiles = targetPlayer.tiles.filter(t => t.id !== targetTileId);
    
    // Add tile to current player
    const updatedCurrentTiles = [...currentPlayer.tiles, targetTile];

    return {
      success: true,
      updatedCurrentPlayer: {
        ...currentPlayer,
        tiles: updatedCurrentTiles
      },
      updatedTargetPlayer: {
        ...targetPlayer,
        tiles: updatedTargetTiles
      }
    };
  }

  static executeDantalion(player: Player, sourceTileId: string): {
    success: boolean;
    updatedPlayer: Player;
    error?: string;
  } {
    const sourceTile = player.tiles.find(t => t.id === sourceTileId);
    if (!sourceTile) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'Source tile not found'
      };
    }

    // Create duplicate tile with new ID
    const duplicateTile: Tile = {
      ...sourceTile,
      id: `duplicate-${sourceTile.id}-${Date.now()}-${Math.random()}`
    };

    return {
      success: true,
      updatedPlayer: {
        ...player,
        tiles: [...player.tiles, duplicateTile]
      }
    };
  }

  static executeHaagenti(player: Player, tileBag: Tile[]): {
    success: boolean;
    updatedPlayer: Player;
    updatedBag: Tile[];
    error?: string;
  } {
    const tilesToDraw = Math.min(3, tileBag.length);
    if (tilesToDraw === 0) {
      return {
        success: false,
        updatedPlayer: player,
        updatedBag: tileBag,
        error: 'No tiles available in bag'
      };
    }

    // Draw tiles from bag
    const drawnTiles = tileBag.slice(0, tilesToDraw);
    const remainingBag = tileBag.slice(tilesToDraw);

    return {
      success: true,
      updatedPlayer: {
        ...player,
        tiles: [...player.tiles, ...drawnTiles]
      },
      updatedBag: remainingBag
    };
  }

  static executeMurmur(targetPlayer: Player): {
    success: boolean;
    silencedTileIds: string[];
    error?: string;
  } {
    if (targetPlayer.tiles.length === 0) {
      return {
        success: false,
        silencedTileIds: [],
        error: 'Target player has no tiles to silence'
      };
    }

    // Randomly select up to 3 tiles to silence
    const tilesToSilence = Math.min(3, targetPlayer.tiles.length);
    const shuffledTiles = [...targetPlayer.tiles].sort(() => Math.random() - 0.5);
    const silencedTileIds = shuffledTiles.slice(0, tilesToSilence).map(t => t.id);

    return {
      success: true,
      silencedTileIds
    };
  }

  static executeForneus(board: any[][], targetPositions: Array<{row: number, col: number}>): {
    success: boolean;
    updatedBoard: any[][];
    error?: string;
  } {
    // Validate all target positions have tiles
    for (const pos of targetPositions) {
      if (!board[pos.row] || !board[pos.row][pos.col] || !board[pos.row][pos.col].tile) {
        return {
          success: false,
          updatedBoard: board,
          error: `No tile found at position (${pos.row}, ${pos.col})`
        };
      }
    }

    // Create updated board with frozen tiles
    const updatedBoard = board.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const shouldFreeze = targetPositions.some(pos => pos.row === rowIndex && pos.col === colIndex);
        if (shouldFreeze) {
          return {
            ...cell,
            isFrozen: true
          };
        }
        return cell;
      })
    );

    return {
      success: true,
      updatedBoard
    };
  }
}

export const evocationManager = new EvocationManager();
