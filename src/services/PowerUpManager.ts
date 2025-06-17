import type { PowerUp, PowerUpType, Player, PlacedTile, Tile } from '../types/game';

export interface GameModifiers {
  allowUnlimitedTiles: boolean;
  scoreMultiplier: number;
  skipTurnAdvancement: boolean;
  allowWildCards: boolean;
  addBlankTile: boolean;               // For CRESCENT_MOON
  swapWithOpponent: boolean;           // For WILTED_ROSE
  guaranteedVowelSwap: boolean;        // For HEADSTONE
  allowRackExpansion: boolean;         // For TILE_THIEF, EXTRA_TILES
  maxRackSize: number;                 // 8 for TILE_THIEF, 10 for EXTRA_TILES
  frozenTiles: Array<{row: number, col: number}>; // For TILE_FREEZE
  silencedTiles: string[];             // tile IDs for SILENCE
  stolenMultiplier: {type: 'DOUBLE_WORD' | 'TRIPLE_WORD', position: {row: number, col: number}} | null; // For MULTIPLIER_THIEF
}

export class PowerUpManager {
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
      silencedTiles: [],
      stolenMultiplier: null
    };
  }

  static applyPowerUpEffects(powerUp: PowerUpType | null): GameModifiers {
    const modifiers = this.getDefaultModifiers();

    if (!powerUp) {
      return modifiers;
    }

    switch (powerUp) {
      case 'SCROLL':
        modifiers.allowUnlimitedTiles = true;
        break;
      case 'HEADSTONE':
        modifiers.guaranteedVowelSwap = true;
        break;
      case 'WILTED_ROSE':
        modifiers.swapWithOpponent = true;
        break;
      case 'CRESCENT_MOON':
        modifiers.addBlankTile = true;
        break;
      case 'TILE_THIEF':
        modifiers.allowRackExpansion = true;
        modifiers.maxRackSize = 8;
        break;
      case 'EXTRA_TILES':
        modifiers.allowRackExpansion = true;
        modifiers.maxRackSize = 10;
        break;
      case 'EXTRA_TURN':
        modifiers.skipTurnAdvancement = true;
        break;
      // BURN, MULTIPLIER_THIEF, DUPLICATE, TILE_FREEZE, SILENCE require special handling
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
      // With unlimited tiles power-up, any tile usage is valid
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

  static collectPowerUpFromBoard(
    player: Player,
    powerUp: PowerUp
  ): Player {
    // Create a power-up tile
    const powerUpTile: Tile = {
      id: `powerup-tile-${powerUp.id}`,
      letter: powerUp.emoji,
      value: 0,
      isPowerUp: true,
      powerUpType: powerUp.type,
      emoji: powerUp.emoji
    };

    return {
      ...player,
      tiles: [...player.tiles, powerUpTile]
    };
  }

  static activatePowerUp(
    player: Player,
    powerUpId: string
  ): { success: boolean; updatedPlayer: Player; error?: string } {
    const powerUpIndex = player.activePowerUps.findIndex(pu => pu.id === powerUpId);
    
    if (powerUpIndex === -1) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'Power-up not found in player inventory'
      };
    }

    if (player.activePowerUpForTurn !== null) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'A power-up is already active for this turn'
      };
    }

    const powerUp = player.activePowerUps[powerUpIndex];
    const updatedActivePowerUps = player.activePowerUps.filter((_, index) => index !== powerUpIndex);

    return {
      success: true,
      updatedPlayer: {
        ...player,
        activePowerUps: updatedActivePowerUps,
        activePowerUpForTurn: powerUp
      }
    };
  }

  static activatePowerUpTile(
    player: Player,
    tileId: string
  ): { success: boolean; updatedPlayer: Player; error?: string } {
    const tileIndex = player.tiles.findIndex(t => t.id === tileId && t.isPowerUp);
    
    if (tileIndex === -1) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'Power-up tile not found in player tiles'
      };
    }

    if (player.activePowerUpForTurn !== null) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'A power-up is already active for this turn'
      };
    }

    const powerUpTile = player.tiles[tileIndex];
    const updatedTiles = player.tiles.filter((_, index) => index !== tileIndex);

    // Create a PowerUp object from the tile for the activePowerUpForTurn
    const powerUp: PowerUp = {
      id: powerUpTile.id,
      type: powerUpTile.powerUpType!,
      emoji: powerUpTile.emoji!,
      name: this.getPowerUpName(powerUpTile.powerUpType!),
      description: this.getPowerUpDescription(powerUpTile.powerUpType!)
    };

    return {
      success: true,
      updatedPlayer: {
        ...player,
        tiles: updatedTiles,
        activePowerUpForTurn: powerUp
      }
    };
  }

  static getPowerUpName(type: PowerUpType): string {
    switch (type) {
      case 'SCROLL':
        return 'Scroll';
      case 'HEADSTONE':
        return 'Headstone';
      case 'WILTED_ROSE':
        return 'Wilted Rose';
      case 'CRESCENT_MOON':
        return 'Crescent Moon';
      case 'BURN':
        return 'Burn';
      case 'TILE_THIEF':
        return 'Tile Thief';
      case 'MULTIPLIER_THIEF':
        return 'Multiplier Thief';
      case 'DUPLICATE':
        return 'Duplicate';
      case 'EXTRA_TURN':
        return 'Extra Turn';
      case 'TILE_FREEZE':
        return 'Tile Freeze';
      case 'SILENCE':
        return 'Silence';
      case 'EXTRA_TILES':
        return 'Extra Tiles';
      default:
        return 'Unknown';
    }
  }

  static getPowerUpDescription(type: PowerUpType): string {
    switch (type) {
      case 'SCROLL':
        return 'Place a letter tile any number of times on the board, all letters in your possession can be used multiple times for that turn regardless of how many of that letter you actually have';
      case 'HEADSTONE':
        return 'Swap all 7 of your tiles for a new set, guaranteed to contain at least two vowels. (consumed on use)';
      case 'WILTED_ROSE':
        return 'Swaps you and your opponents\' tiles.';
      case 'CRESCENT_MOON':
        return 'Adds an extra blank tile to your rack.';
      case 'BURN':
        return 'Choose 2 tiles to force your opponent to discard from their rack.';
      case 'TILE_THIEF':
        return 'Steal 1 tile from opponent\'s rack. Your rack expands to 8/7 for this turn.';
      case 'MULTIPLIER_THIEF':
        return 'Steal a Double Word or Triple Word multiplier from the board to use on your next word.';
      case 'DUPLICATE':
        return 'Copy one of your own tiles to create an exact duplicate.';
      case 'EXTRA_TURN':
        return 'Play again immediately after your current turn ends.';
      case 'TILE_FREEZE':
        return 'Freeze a tile on the board - opponents cannot connect new tiles to it on their next turn.';
      case 'SILENCE':
        return 'Lock 3 random tiles on your opponent\'s rack, preventing them from being used on their next turn.';
      case 'EXTRA_TILES':
        return 'Get 3 bonus tiles for this turn only. Your rack expands to 10/7 temporarily.';
      default:
        return 'Unknown power-up';
    }
  }

  static clearActivePowerUp(player: Player): Player {
    return {
      ...player,
      activePowerUpForTurn: null
    };
  }

  static applyScoreModifier(baseScore: number, scoreMultiplier: number): number {
    return Math.floor(baseScore * scoreMultiplier);
  }

  // New methods for complex powerup effects
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

  // New powerup execution methods
  static executeBurn(
    targetPlayer: Player,
    targetTileIds: string[]
  ): { success: boolean; updatedPlayer: Player; error?: string } {
    if (targetTileIds.length !== 2) {
      return {
        success: false,
        updatedPlayer: targetPlayer,
        error: 'Must select exactly 2 tiles to burn'
      };
    }

    // Remove the selected tiles from target player's rack
    const updatedTiles = targetPlayer.tiles.filter(tile => !targetTileIds.includes(tile.id));
    
    if (updatedTiles.length !== targetPlayer.tiles.length - 2) {
      return {
        success: false,
        updatedPlayer: targetPlayer,
        error: 'One or more selected tiles not found in player rack'
      };
    }

    return {
      success: true,
      updatedPlayer: {
        ...targetPlayer,
        tiles: updatedTiles
      }
    };
  }

  static executeTileThief(
    currentPlayer: Player,
    targetPlayer: Player,
    targetTileId: string
  ): { success: boolean; updatedCurrentPlayer: Player; updatedTargetPlayer: Player; error?: string } {
    const targetTileIndex = targetPlayer.tiles.findIndex(tile => tile.id === targetTileId);
    
    if (targetTileIndex === -1) {
      return {
        success: false,
        updatedCurrentPlayer: currentPlayer,
        updatedTargetPlayer: targetPlayer,
        error: 'Target tile not found in opponent rack'
      };
    }

    const stolenTile = targetPlayer.tiles[targetTileIndex];
    const updatedTargetTiles = targetPlayer.tiles.filter((_, index) => index !== targetTileIndex);
    const updatedCurrentTiles = [...currentPlayer.tiles, stolenTile];

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

  static executeDuplicate(
    player: Player,
    sourceTileId: string
  ): { success: boolean; updatedPlayer: Player; error?: string } {
    const sourceTile = player.tiles.find(tile => tile.id === sourceTileId);
    
    if (!sourceTile) {
      return {
        success: false,
        updatedPlayer: player,
        error: 'Source tile not found in player rack'
      };
    }

    // Create a duplicate tile with a new ID
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

  static executeExtraTiles(
    player: Player,
    tileBag: Tile[]
  ): { success: boolean; updatedPlayer: Player; updatedBag: Tile[]; error?: string } {
    if (tileBag.length < 3) {
      return {
        success: false,
        updatedPlayer: player,
        updatedBag: tileBag,
        error: 'Not enough tiles in bag for extra tiles powerup'
      };
    }

    // Draw 3 extra tiles
    const extraTiles = tileBag.slice(0, 3);
    const remainingBag = tileBag.slice(3);

    return {
      success: true,
      updatedPlayer: {
        ...player,
        tiles: [...player.tiles, ...extraTiles]
      },
      updatedBag: remainingBag
    };
  }

  static executeSilence(
    targetPlayer: Player
  ): { success: boolean; updatedPlayer: Player; silencedTileIds: string[]; error?: string } {
    const availableTiles = targetPlayer.tiles.filter(tile => !tile.isPowerUp);
    
    if (availableTiles.length === 0) {
      return {
        success: false,
        updatedPlayer: targetPlayer,
        silencedTileIds: [],
        error: 'No tiles available to silence'
      };
    }

    // Randomly select up to 3 tiles to silence
    const tilesToSilence = Math.min(3, availableTiles.length);
    const shuffled = [...availableTiles].sort(() => Math.random() - 0.5);
    const silencedTileIds = shuffled.slice(0, tilesToSilence).map(tile => tile.id);

    return {
      success: true,
      updatedPlayer: targetPlayer, // Player object doesn't change, but we track silenced tiles separately
      silencedTileIds
    };
  }
}

export const powerUpManager = new PowerUpManager();
