import type { BoardCell, PlacedTile, Tile, Player, PowerUp } from '../types/game';
import { validateMove, type ValidationResult } from './wordValidator';
import { calculateTurnScore, type TurnScore } from './scoreCalculator';
import { PowerUpManager } from './PowerUpManager';

export interface MoveResult {
  isValid: boolean;
  validation: ValidationResult;
  score?: TurnScore;
  errors: string[];
  collectedPowerUps: PowerUp[];
  modifiers: any;
}

export interface PendingMove {
  placedTiles: PlacedTile[];
  player: Player;
}

export class MoveManager {
  addTile(
    tile: Tile,
    row: number,
    col: number,
    board: BoardCell[][],
    pendingTiles: PlacedTile[]
  ): { success: boolean; newPendingTiles: PlacedTile[] } {
    if (board[row][col].tile !== null) {
      return { success: false, newPendingTiles: pendingTiles };
    }

    const newPendingTiles = [...pendingTiles];
    const existingIndex = newPendingTiles.findIndex(pt => pt.row === row && pt.col === col);

    if (existingIndex >= 0) {
      newPendingTiles[existingIndex] = { tile, row, col };
    } else {
      newPendingTiles.push({ tile, row, col });
    }

    return { success: true, newPendingTiles };
  }

  removeTile(
    row: number,
    col: number,
    pendingTiles: PlacedTile[]
  ): { removedTile: Tile | null; newPendingTiles: PlacedTile[] } {
    const index = pendingTiles.findIndex(pt => pt.row === row && pt.col === col);

    if (index >= 0) {
      const removedTile = pendingTiles[index].tile;
      const newPendingTiles = pendingTiles.filter((_, i) => i !== index);
      return { removedTile, newPendingTiles };
    }

    return { removedTile: null, newPendingTiles: pendingTiles };
  }

  async executeMove(
    board: BoardCell[][],
    player: Player,
    pendingTiles: PlacedTile[]
  ): Promise<MoveResult> {
    const validation = await validateMove(pendingTiles, board);

    if (!validation.isValid) {
      return {
        isValid: false,
        validation,
        errors: validation.errors,
        collectedPowerUps: [],
        modifiers: PowerUpManager.getDefaultModifiers()
      };
    }

    // Get power-up modifiers
    const modifiers = PowerUpManager.applyPowerUpEffects(player.activePowerUpForTurn?.type || null);

    // Validate tile usage with power-up considerations
    const tileValidation = PowerUpManager.validateTileUsage(player, pendingTiles, modifiers.allowUnlimitedTiles);
    
    if (!tileValidation.isValid) {
      return {
        isValid: false,
        validation,
        errors: tileValidation.errors,
        collectedPowerUps: [],
        modifiers
      };
    }

    // Check for power-ups collected by this move
    const collectedPowerUps: PowerUp[] = [];
    pendingTiles.forEach(({ row, col }) => {
      const powerUp = board[row][col].powerUp;
      if (powerUp) {
        collectedPowerUps.push(powerUp);
      }
    });

    // Calculate base score
    let score = calculateTurnScore(validation.words, pendingTiles, board);

    // Apply score modifiers from power-ups
    if (score && modifiers.scoreMultiplier !== 1) {
      score = {
        ...score,
        totalScore: PowerUpManager.applyScoreModifier(score.totalScore, modifiers.scoreMultiplier)
      };
    }

    return {
      isValid: true,
      validation,
      score,
      errors: [],
      collectedPowerUps,
      modifiers
    };
  }

  commitMove(board: BoardCell[][], pendingTiles: PlacedTile[]): BoardCell[][] {
    const newBoard = board.map(row => [...row]);
    
    pendingTiles.forEach(({ tile, row, col }) => {
      newBoard[row][col] = {
        ...newBoard[row][col],
        tile,
        powerUp: null // Remove power-up when tile is placed on it
      };
    });

    return newBoard;
  }

  removeTilesFromPlayer(player: Player, pendingTiles: PlacedTile[]): Tile[] {
    const tilesToRemove = pendingTiles.map(pt => pt.tile);
    const remainingTiles = player.tiles.filter(
      tile => !tilesToRemove.some(tr => {
        // For blank tiles with chosen letters, match by ID only
        if (tr.chosenLetter && tile.isBlank) {
          return tr.id === tile.id;
        }
        // For regular tiles, match by ID
        return tr.id === tile.id;
      })
    );
    
    return remainingTiles;
  }

  previewMove(board: BoardCell[][], pendingTiles: PlacedTile[]): BoardCell[][] {
    const previewBoard = board.map(row => [...row]);
    
    pendingTiles.forEach(({ tile, row, col }) => {
      previewBoard[row][col] = {
        ...previewBoard[row][col],
        tile
      };
    });

    return previewBoard;
  }

  canPlaceTile(row: number, col: number, board: BoardCell[][], pendingTiles: PlacedTile[]): boolean {
    if (row < 0 || row >= board.length || col < 0 || col >= board[0].length) {
      return false;
    }

    if (board[row][col].tile !== null) {
      return false;
    }

    const hasPendingTile = pendingTiles.some(pt => pt.row === row && pt.col === col);

    return !hasPendingTile;
  }

  getTileAt(row: number, col: number, pendingTiles: PlacedTile[]): Tile | null {
    const pendingTile = pendingTiles.find(pt => pt.row === row && pt.col === col);
    return pendingTile ? pendingTile.tile : null;
  }
}

export const moveManager = new MoveManager();
