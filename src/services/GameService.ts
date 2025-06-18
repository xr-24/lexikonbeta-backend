import type { GameState, Player, Tile, PlacedTile, MoveHistoryEntry, PowerUp, IntercessionsType } from '../types/game';
import { createEmptyBoard } from '../constants/board';
import { createTileBag, drawTiles, TILES_PER_PLAYER } from '../constants/tiles';
import { createPlayerIntercessions } from '../constants/intercessions';
import { moveManager, type MoveResult } from './moveManager';
import { PowerUpManager } from './PowerUpManager';
import { EvocationManager } from './EvocationManager';
import { quackleGaddagAIService } from './QuackleGADDAGAIService';

export class GameService {
  private games: Map<string, GameState> = new Map();
  private pendingTiles: Map<string, PlacedTile[]> = new Map();

  // Perform tile pull to determine starting player
  private performTilePull(roomPlayers: Array<{id: string, name: string, color?: string, isAI?: boolean, aiPersonality?: string, selectedIntercessions?: string[]}>, tileBag: Tile[]): { startingPlayerIndex: number; remainingBag: Tile[]; tilePullResults: Array<{ playerId: string; playerName: string; tile: Tile }> } {
    console.log('Performing tile pull to determine starting player');
    
    const tilePullResults: Array<{ playerId: string; playerName: string; tile: Tile }> = [];
    let currentBag = [...tileBag];
    
    // Each player draws a tile
    for (let i = 0; i < roomPlayers.length; i++) {
      const player = roomPlayers[i];
      if (currentBag.length === 0) {
        // Fallback if no tiles left - shouldn't happen in normal game
        console.warn('No tiles left in bag during tile pull');
        break;
      }
      
      // Draw a random tile
      const randomIndex = Math.floor(Math.random() * currentBag.length);
      const drawnTile = currentBag[randomIndex];
      currentBag.splice(randomIndex, 1);
      
      tilePullResults.push({
        playerId: player.id,
        playerName: player.name,
        tile: drawnTile
      });
      
      console.log(`${player.name} drew tile: ${drawnTile.letter} (value: ${drawnTile.value})`);
    }
    
    // Put the drawn tiles back into the bag and shuffle
    const drawnTiles = tilePullResults.map(result => result.tile);
    currentBag.push(...drawnTiles);
    
    // Shuffle the bag
    for (let i = currentBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [currentBag[i], currentBag[j]] = [currentBag[j], currentBag[i]];
    }
    
    // Determine starting player - closest to 'A' wins (lowest letter value)
    // In case of tie, use the order they joined (first player wins)
    let startingPlayerIndex = 0;
    let bestTile = tilePullResults[0].tile;
    
    for (let i = 1; i < tilePullResults.length; i++) {
      const currentTile = tilePullResults[i].tile;
      
      // Compare by letter (A comes before Z)
      if (currentTile.letter < bestTile.letter) {
        startingPlayerIndex = i;
        bestTile = currentTile;
      }
      // If same letter, first player wins (no change needed)
    }
    
    console.log(`Starting player determined: ${roomPlayers[startingPlayerIndex].name} (drew ${bestTile.letter})`);
    
    return {
      startingPlayerIndex,
      remainingBag: currentBag,
      tilePullResults
    };
  }

  initializeGame(gameId: string, roomPlayers: Array<{id: string, name: string, color?: string, isAI?: boolean, aiPersonality?: string, selectedIntercessions?: string[]}>): GameState {
    console.log('Initializing game with players:', roomPlayers);
    let tileBag = createTileBag();
    
    // Perform tile pull to determine starting player
    const tilePullResult = this.performTilePull(roomPlayers, tileBag);
    tileBag = tilePullResult.remainingBag;
    
    const players: Player[] = roomPlayers.map((roomPlayer) => {
      const { drawnTiles, remainingBag } = drawTiles(tileBag, TILES_PER_PLAYER);
      tileBag = remainingBag;
      // Create intercessions from selected types
      const intercessions = roomPlayer.selectedIntercessions 
        ? createPlayerIntercessions(roomPlayer.selectedIntercessions as IntercessionsType[])
        : [];

      return {
        id: roomPlayer.id,
        name: roomPlayer.name,
        tiles: drawnTiles,
        score: 0,
        hp: 300, // All players start with 300 HP
        hasEndedGame: false,
        activePowerUps: [],
        activePowerUpForTurn: null,
        evocations: [], // Start with no evocations
        intercessions, // Populated from selectedIntercessions
        tileColor: roomPlayer.color || '#404040',
        isAI: roomPlayer.isAI || false,
        aiPersonality: roomPlayer.aiPersonality,
        silencedTiles: [],
      };
    });

    const gameState: GameState = {
      board: createEmptyBoard(),
      players,
      currentPlayerIndex: tilePullResult.startingPlayerIndex,
      tileBag,
      gamePhase: 'PLAYING',
      turnNumber: 1,
      playersEndedGame: [],
      moveHistory: [],
      tilePullResult: tilePullResult, // Store the tile pull result for frontend display
    };

    this.games.set(gameId, gameState);
    this.pendingTiles.set(gameId, []);
    
    // Check if first player is AI and execute their move
    this.checkAndExecuteAITurn(gameId);
    
    console.log('Game initialized successfully');
    return gameState;
  }

  getGameState(gameId: string): GameState | null {
    return this.games.get(gameId) || null;
  }

  getPendingTiles(gameId: string): PlacedTile[] {
    return this.pendingTiles.get(gameId) || [];
  }

  // Server-side validation for tile ownership
  private validateTileOwnership(playerId: string, tile: Tile, gameState: GameState): boolean {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      console.warn(`Player ${playerId} not found in game state`);
      return false;
    }
    
    // For power-up tiles, check if player has the specific power-up tile
    if (tile.isPowerUp) {
      const hasPowerUpTile = player.tiles.some(t => 
        t.id === tile.id && 
        t.isPowerUp && 
        t.powerUpType === tile.powerUpType
      );
      if (!hasPowerUpTile) {
        console.warn(`Player ${playerId} doesn't own power-up tile:`, tile);
        return false;
      }
      return true;
    }
    
    // For blank tiles, check by ID and blank status (letter might have been changed to chosen letter)
    if (tile.isBlank) {
      const hasBlankTile = player.tiles.some(t => 
        t.id === tile.id && 
        t.isBlank === true
      );
      if (!hasBlankTile) {
        console.warn(`Player ${playerId} doesn't own blank tile:`, tile);
        console.warn(`Player tiles:`, player.tiles.map(t => ({ id: t.id, letter: t.letter, value: t.value, isBlank: t.isBlank })));
      }
      return hasBlankTile;
    }
    
    // Special case: if tile has chosenLetter property, it's a blank tile being used as a specific letter
    if (tile.chosenLetter) {
      const hasBlankTile = player.tiles.some(t => 
        t.id === tile.id && 
        t.isBlank === true
      );
      if (!hasBlankTile) {
        console.warn(`Player ${playerId} doesn't own blank tile for chosen letter:`, tile);
        console.warn(`Player tiles:`, player.tiles.map(t => ({ id: t.id, letter: t.letter, value: t.value, isBlank: t.isBlank })));
      }
      return hasBlankTile;
    }
    
    // For regular tiles, check exact match
    const ownsTile = player.tiles.some(t => 
      t.id === tile.id && 
      t.letter === tile.letter && 
      t.value === tile.value &&
      t.isBlank === tile.isBlank
    );
    
    if (!ownsTile) {
      console.warn(`Player ${playerId} doesn't own tile:`, tile);
      console.warn(`Player tiles:`, player.tiles.map(t => ({ id: t.id, letter: t.letter, value: t.value, isBlank: t.isBlank })));
    }
    
    return ownsTile;
  }

  // Validate that all pending tiles are owned by the player
  private validateAllPendingTilesOwnership(playerId: string, gameState: GameState, pendingTiles: PlacedTile[]): boolean {
    for (const placedTile of pendingTiles) {
      if (!this.validateTileOwnership(playerId, placedTile.tile, gameState)) {
        return false;
      }
    }
    return true;
  }

  addPendingTile(gameId: string, tile: Tile, row: number, col: number): boolean {
    const gameState = this.games.get(gameId);
    const pendingTiles = this.pendingTiles.get(gameId);
    
    if (!gameState || !pendingTiles) {
      return false;
    }

    // Get current player
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer) {
      console.warn('No current player found');
      return false;
    }

    // Validate tile ownership before adding to pending
    if (!this.validateTileOwnership(currentPlayer.id, tile, gameState)) {
      console.warn('Tile ownership validation failed for addPendingTile');
      return false;
    }

    if (currentPlayer.silencedTiles && currentPlayer.silencedTiles.includes(tile.id)) {
      console.warn(`Player ${currentPlayer.id} attempted to use silenced tile ${tile.id}`);
      return false;
    }

    const { success, newPendingTiles } = moveManager.addTile(tile, row, col, gameState.board, pendingTiles);
    if (success) {
      this.pendingTiles.set(gameId, newPendingTiles);
      return true;
    }
    return false;
  }

  removePendingTile(gameId: string, row: number, col: number): Tile | null {
    const pendingTiles = this.pendingTiles.get(gameId);
    
    if (!pendingTiles) {
      return null;
    }

    const { removedTile, newPendingTiles } = moveManager.removeTile(row, col, pendingTiles);
    this.pendingTiles.set(gameId, newPendingTiles);
    return removedTile;
  }

  clearPendingMove(gameId: string): void {
    this.pendingTiles.set(gameId, []);
  }

  async commitMove(gameId: string, playerId: string, io?: any): Promise<{ success: boolean; errors: string[]; moveResult?: MoveResult }> {
    console.log('CommitMove called:', { gameId, playerId });
    const gameState = this.games.get(gameId);
    const pendingTiles = this.pendingTiles.get(gameId);
    
    console.log('Game state exists:', !!gameState);
    console.log('Pending tiles:', pendingTiles);
    
    if (!gameState || !pendingTiles) {
      console.log('Game or pending tiles not found');
      return { success: false, errors: ['Game not found'] };
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    console.log('Current player:', currentPlayer?.id, 'Requested player:', playerId);
    console.log('Current player index:', gameState.currentPlayerIndex);
    console.log('Pending tiles length:', pendingTiles.length);
    
    if (!currentPlayer) {
      return { success: false, errors: ['No current player found'] };
    }
    
    if (currentPlayer.id !== playerId) {
      return { success: false, errors: ['Not your turn'] };
    }
    
    if (pendingTiles.length === 0) {
      return { success: false, errors: ['No tiles placed'] };
    }

    // Critical security check: validate all pending tiles are owned by the player
    if (!this.validateAllPendingTilesOwnership(playerId, gameState, pendingTiles)) {
      console.error(`SECURITY ALERT: Player ${playerId} attempted to commit move with tiles they don't own`);
      return { success: false, errors: ['Invalid tile ownership'] };
    }

    const moveResult = await moveManager.executeMove(gameState.board, currentPlayer, pendingTiles);

    if (moveResult.isValid && moveResult.score) {
      // Stamp tiles with player ID before committing to board
      const tilesWithOwnership = pendingTiles.map(placedTile => ({
        ...placedTile,
        tile: {
          ...placedTile.tile,
          placedByPlayerId: currentPlayer.id
        }
      }));
      
      const newBoard = moveManager.commitMove(gameState.board, tilesWithOwnership);
      const remainingTiles = moveManager.removeTilesFromPlayer(currentPlayer, pendingTiles);
      
      const tilesNeeded = TILES_PER_PLAYER - remainingTiles.length;
      const { drawnTiles, remainingBag } = drawTiles(gameState.tileBag, Math.min(tilesNeeded, gameState.tileBag.length));

      // HP-based scoring: damage opponent instead of adding to own score
      const opponent = gameState.players.find(p => p.id !== currentPlayer.id);
      let baseDamage = moveResult.score?.totalScore ?? 0;
      
      // Check for Samael double damage effect
      let damageDealt = baseDamage;
      if (currentPlayer.samaelDoubleDamage) {
        damageDealt = baseDamage * 2;
        console.log(`Samael double damage: ${baseDamage} -> ${damageDealt}`);
      }
      
      // Check for Uriel protection on opponent
      if (opponent?.urielProtection) {
        damageDealt = Math.floor(damageDealt * 0.5);
        console.log(`Uriel protection: damage reduced to ${damageDealt}`);
      }
      
      let updatedPlayer: Player = {
        ...currentPlayer,
        tiles: [...remainingTiles, ...drawnTiles],
        score: currentPlayer.score + damageDealt, // Keep traditional score for history
        activePowerUpForTurn: null, // Clear active power-up after move
        samaelDoubleDamage: false, // Clear Samael effect after use
      };

      // Add collected evocations to player's inventory (or heal AI)
      if (moveResult.collectedPowerUps && moveResult.collectedPowerUps.length > 0) {
        moveResult.collectedPowerUps.forEach(powerUp => {
          if (updatedPlayer.isAI) {
            // AI gets 20 HP healing per evocation (max 300 HP)
            updatedPlayer.hp = Math.min(300, updatedPlayer.hp + 20);
            console.log(`AI ${updatedPlayer.name} collected evocation and healed 20 HP (${updatedPlayer.hp - 20} -> ${updatedPlayer.hp})`);
          } else {
            // Human gets evocation ability - convert PowerUp to Evocation
            // Since board now spawns evocations stored as powerUps, treat them as evocations
            const evocation = powerUp as any; // The board stores evocations in powerUp field
            updatedPlayer = EvocationManager.collectEvocationFromBoard(updatedPlayer, evocation);
          }
        });
      }

      // Apply HP damage to opponent
      let updatedOpponent = opponent;
      if (opponent && damageDealt > 0) {
        updatedOpponent = {
          ...opponent,
          hp: Math.max(0, opponent.hp - damageDealt),
          urielProtection: false  // Clear Uriel protection after taking damage
        };
        
        // Emit damage event for visual feedback
        this.emitDamageEvent(gameId, opponent.id, damageDealt, opponent.isAI || false, io);
      }

      const updatedPlayers = gameState.players.map(p => {
        if (p.id === currentPlayer.id) return updatedPlayer;
        if (p.id === opponent?.id && updatedOpponent) return updatedOpponent;
        return p;
      });

      // Check for HP victory condition
      if (updatedOpponent && updatedOpponent.hp <= 0) {
        const finalGameState: GameState = {
          ...gameState,
          board: newBoard,
          players: updatedPlayers,
          tileBag: remainingBag,
          gamePhase: 'FINISHED'
        };

        this.games.set(gameId, finalGameState);
        this.pendingTiles.set(gameId, []);

        // Add move to history
        const words = moveResult.validation.words.map(w => w.word);
        this.addMoveToHistory(
          gameId,
          currentPlayer.id,
          currentPlayer.name,
          'WORD',
          words,
          moveResult.score.totalScore
        );

        console.log(`Game ${gameId} ended: ${currentPlayer.name} defeated ${updatedOpponent.name} (HP: ${updatedOpponent.hp})`);
        return { success: true, errors: [], moveResult };
      }

      // Update game state first
      const updatedGameState: GameState = {
        ...gameState,
        board: newBoard,
        players: updatedPlayers,
        tileBag: remainingBag,
      };

      this.games.set(gameId, updatedGameState);
      this.pendingTiles.set(gameId, []);

      // Add move to history after updating game state
      const words = moveResult.validation.words.map(w => w.word);
      this.addMoveToHistory(
        gameId,
        currentPlayer.id,
        currentPlayer.name,
        'WORD',
        words,
        moveResult.score.totalScore
      );

      // Check if we should skip turn advancement (EXTRA_TURN power-up only)
      if (moveResult.modifiers?.skipTurnAdvancement) {
        console.log(`Extra turn granted due to EXTRA_TURN power-up`);
      } else {
        this.nextTurn(gameId);
      }

      return { success: true, errors: [], moveResult };
    } else {
      return { success: false, errors: moveResult.errors, moveResult };
    }
  }

  // Special version of commitMove that doesn't advance the turn - used by Gabriel intercession
  async commitMoveWithoutTurnAdvancement(gameId: string, playerId: string): Promise<{ success: boolean; errors: string[]; moveResult?: MoveResult }> {
    console.log('CommitMoveWithoutTurnAdvancement called:', { gameId, playerId });
    const gameState = this.games.get(gameId);
    const pendingTiles = this.pendingTiles.get(gameId);
    
    if (!gameState || !pendingTiles) {
      return { success: false, errors: ['Game not found'] };
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    
    if (!currentPlayer) {
      return { success: false, errors: ['No current player found'] };
    }
    
    if (currentPlayer.id !== playerId) {
      return { success: false, errors: ['Not your turn'] };
    }
    
    if (pendingTiles.length === 0) {
      return { success: false, errors: ['No tiles placed'] };
    }

    // Critical security check: validate all pending tiles are owned by the player
    if (!this.validateAllPendingTilesOwnership(playerId, gameState, pendingTiles)) {
      console.error(`SECURITY ALERT: Player ${playerId} attempted to commit move with tiles they don't own`);
      return { success: false, errors: ['Invalid tile ownership'] };
    }

    const moveResult = await moveManager.executeMove(gameState.board, currentPlayer, pendingTiles);

    if (moveResult.isValid && moveResult.score) {
      // Stamp tiles with player ID before committing to board
      const tilesWithOwnership = pendingTiles.map(placedTile => ({
        ...placedTile,
        tile: {
          ...placedTile.tile,
          placedByPlayerId: currentPlayer.id
        }
      }));
      
      const newBoard = moveManager.commitMove(gameState.board, tilesWithOwnership);
      const remainingTiles = moveManager.removeTilesFromPlayer(currentPlayer, pendingTiles);
      
      const tilesNeeded = TILES_PER_PLAYER - remainingTiles.length;
      const { drawnTiles, remainingBag } = drawTiles(gameState.tileBag, Math.min(tilesNeeded, gameState.tileBag.length));

      // HP-based scoring: damage opponent instead of adding to own score
      const opponent = gameState.players.find(p => p.id !== currentPlayer.id);
      let baseDamage = moveResult.score?.totalScore ?? 0;
      
      // Check for Samael double damage effect
      let damageDealt = baseDamage;
      if (currentPlayer.samaelDoubleDamage) {
        damageDealt = baseDamage * 2;
        console.log(`Samael double damage: ${baseDamage} -> ${damageDealt}`);
      }
      
      // Check for Uriel protection on opponent
      if (opponent?.urielProtection) {
        damageDealt = Math.floor(damageDealt * 0.5);
        console.log(`Uriel protection: damage reduced to ${damageDealt}`);
      }
      
      let updatedPlayer: Player = {
        ...currentPlayer,
        tiles: [...remainingTiles, ...drawnTiles],
        score: currentPlayer.score + damageDealt, // Keep traditional score for history
        activePowerUpForTurn: null, // Clear active power-up after move
        samaelDoubleDamage: false, // Clear Samael effect after use
      };

      // Add collected evocations to player's inventory (or heal AI)
      if (moveResult.collectedPowerUps && moveResult.collectedPowerUps.length > 0) {
        moveResult.collectedPowerUps.forEach(powerUp => {
          if (updatedPlayer.isAI) {
            // AI gets 20 HP healing per evocation
            updatedPlayer.hp = Math.min(200, updatedPlayer.hp + 20);
          } else {
            // Human gets evocation ability (convert PowerUp to Evocation)
            // For now, keep existing powerup logic - will be updated in Phase 3
            updatedPlayer = PowerUpManager.collectPowerUpFromBoard(updatedPlayer, powerUp);
          }
        });
      }

      // Apply HP damage to opponent
      let updatedOpponent = opponent;
      if (opponent && damageDealt > 0) {
        updatedOpponent = {
          ...opponent,
          hp: Math.max(0, opponent.hp - damageDealt),
          urielProtection: false  // Clear Uriel protection after taking damage
        };
      }

      const updatedPlayers = gameState.players.map(p => {
        if (p.id === currentPlayer.id) return updatedPlayer;
        if (p.id === opponent?.id && updatedOpponent) return updatedOpponent;
        return p;
      });

      // Check for HP victory condition
      if (updatedOpponent && updatedOpponent.hp <= 0) {
        const finalGameState: GameState = {
          ...gameState,
          board: newBoard,
          players: updatedPlayers,
          tileBag: remainingBag,
          gamePhase: 'FINISHED'
        };

        this.games.set(gameId, finalGameState);
        this.pendingTiles.set(gameId, []);

        // Add move to history
        const words = moveResult.validation.words.map(w => w.word);
        this.addMoveToHistory(
          gameId,
          currentPlayer.id,
          currentPlayer.name,
          'WORD',
          words,
          moveResult.score.totalScore
        );

        console.log(`Game ${gameId} ended: ${currentPlayer.name} defeated ${updatedOpponent.name} (HP: ${updatedOpponent.hp})`);
        return { success: true, errors: [], moveResult };
      }

      // Update game state but DON'T advance turn
      const updatedGameState: GameState = {
        ...gameState,
        board: newBoard,
        players: updatedPlayers,
        tileBag: remainingBag,
      };

      this.games.set(gameId, updatedGameState);
      this.pendingTiles.set(gameId, []);

      // Add move to history after updating game state
      const words = moveResult.validation.words.map(w => w.word);
      this.addMoveToHistory(
        gameId,
        currentPlayer.id,
        currentPlayer.name,
        'WORD',
        words,
        moveResult.score.totalScore
      );

      // NOTE: We deliberately do NOT call nextTurn() here - that's handled by the caller

      return { success: true, errors: [], moveResult };
    } else {
      return { success: false, errors: moveResult.errors, moveResult };
    }
  }

  previewBoard(gameId: string): any[][] | null {
    const gameState = this.games.get(gameId);
    const pendingTiles = this.pendingTiles.get(gameId);
    
    if (!gameState || !pendingTiles) {
      return null;
    }

    return moveManager.previewMove(gameState.board, pendingTiles);
  }

  nextTurn(gameId: string, io?: any): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    
    // Check if current player has extra turn from FURFUR evocation
    if (currentPlayer?.hasExtraTurn) {
      console.log(`${currentPlayer.name} has extra turn from FURFUR evocation - skipping turn advancement`);
      
      // Clear the extra turn flag and silenced tiles
      const updatedPlayers = gameState.players.map((p, index) =>
        index === gameState.currentPlayerIndex 
          ? { ...p, silencedTiles: [], hasExtraTurn: false } 
          : p
      );
      
      const updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers
      };
      
      this.games.set(gameId, updatedGameState);
      
      // Don't advance turn, but still reduce cooldowns
      this.reduceIntercessionCooldowns(gameId);
      return;
    }

    // Clear silenced tiles for the player whose turn just ended
    const clearedPlayers = gameState.players.map((p, index) =>
      index === gameState.currentPlayerIndex ? { ...p, silencedTiles: [] } : p
    );
    const clearedState: GameState = { ...gameState, players: clearedPlayers };
    this.games.set(gameId, clearedState);

    // Reduce intercession cooldowns for all players at the end of each turn
    this.reduceIntercessionCooldowns(gameId);

    let nextPlayerIndex = (clearedState.currentPlayerIndex + 1) % clearedState.players.length;
    
    // Skip players who have ended their game
    let attempts = 0;
    while (clearedState.players[nextPlayerIndex]?.hasEndedGame && attempts < clearedState.players.length) {
      nextPlayerIndex = (nextPlayerIndex + 1) % clearedState.players.length;
      attempts++;
    }
    
    // If all players have ended the game, don't change turn
    if (attempts >= clearedState.players.length) {
      this.checkGameEnd(gameId);
      return;
    }

    const nextTurnNumber = nextPlayerIndex < clearedState.currentPlayerIndex ?
      clearedState.turnNumber + 1 : clearedState.turnNumber;

    // Get updated game state after cooldown reduction
    const updatedGameState = this.games.get(gameId);
    if (!updatedGameState) return;

    const finalGameState: GameState = {
      ...updatedGameState,
      currentPlayerIndex: nextPlayerIndex,
      turnNumber: nextTurnNumber,
    };

    this.games.set(gameId, finalGameState);

    // Check if the next player is AI and execute their move
    this.checkAndExecuteAITurn(gameId, io);
  }

  exchangeTiles(gameId: string, playerId: string, tileIds: string[], io?: any): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId || currentPlayer.hasEndedGame || tileIds.length === 0) {
      return { success: false, errors: ['Invalid exchange attempt'] };
    }

    // Validate player has all the tiles they want to exchange
    const playerTileIds = currentPlayer.tiles.map(t => t.id);
    const invalidTiles = tileIds.filter(id => !playerTileIds.includes(id));
    if (invalidTiles.length > 0) {
      console.warn(`Player ${playerId} attempted to exchange tiles they don't own:`, invalidTiles);
      return { success: false, errors: ['Cannot exchange tiles you do not have'] };
    }

    // Additional validation: ensure no duplicate tile IDs
    const uniqueTileIds = new Set(tileIds);
    if (uniqueTileIds.size !== tileIds.length) {
      return { success: false, errors: ['Duplicate tiles in exchange request'] };
    }

    // Remove tiles from player and add them back to bag
    const tilesToExchange = currentPlayer.tiles.filter(t => tileIds.includes(t.id));
    const remainingTiles = currentPlayer.tiles.filter(t => !tileIds.includes(t.id));
    
    // Validate that we found all tiles to exchange
    if (tilesToExchange.length !== tileIds.length) {
      console.warn(`Player ${playerId} exchange validation failed: found ${tilesToExchange.length} tiles, expected ${tileIds.length}`);
      return { success: false, errors: ['Some tiles could not be found for exchange'] };
    }
    
    // Add exchanged tiles back to bag and shuffle
    const newBag = [...gameState.tileBag, ...tilesToExchange];
    for (let i = newBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newBag[i], newBag[j]] = [newBag[j], newBag[i]];
    }

    // Draw new tiles
    const { drawnTiles, remainingBag } = drawTiles(newBag, Math.min(tileIds.length, newBag.length));

    const updatedPlayers = gameState.players.map(p =>
      p.id === currentPlayer.id
        ? { ...p, tiles: [...remainingTiles, ...drawnTiles] }
        : p
    );

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
      tileBag: remainingBag,
    };

    this.games.set(gameId, updatedGameState);
    this.pendingTiles.set(gameId, []);

    // Add exchange to history after updating game state
    this.addMoveToHistory(
      gameId,
      currentPlayer.id,
      currentPlayer.name,
      'EXCHANGE',
      [],
      0
    );

    // Move to next turn
    this.nextTurn(gameId, io);

    return { success: true, errors: [] };
  }

  passTurn(gameId: string, playerId: string, io?: any): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId || currentPlayer.hasEndedGame) {
      return { success: false, errors: ['Invalid pass attempt'] };
    }

    this.pendingTiles.set(gameId, []);

    // Add pass to history after clearing pending tiles
    this.addMoveToHistory(
      gameId,
      currentPlayer.id,
      currentPlayer.name,
      'PASS',
      [],
      0
    );

    // Move to next turn
    this.nextTurn(gameId);

    return { success: true, errors: [] };
  }

  // AI Move Handling
  async executeAIMove(gameId: string): Promise<{ success: boolean; errors: string[] }> {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || !currentPlayer.isAI) {
      return { success: false, errors: ['Current player is not an AI'] };
    }

    if (currentPlayer.hasEndedGame) {
      return { success: false, errors: ['AI player has ended the game'] };
    }

    try {
      console.log(`Executing AI move for ${currentPlayer.name}`);
      
      // Generate AI move using GADDAG
      const aiMove = await quackleGaddagAIService.generateMove(gameState, currentPlayer.id);
      
      switch (aiMove.type) {
        case 'WORD':
          if (aiMove.tiles && aiMove.tiles.length > 0) {
            return await this.executeAIWordMove(gameId, currentPlayer.id, aiMove.tiles);
          } else {
            console.warn(`AI ${currentPlayer.name} generated invalid word move`);
            return this.passTurn(gameId, currentPlayer.id);
          }
          
        case 'EXCHANGE':
          if (aiMove.exchangeTileIds && aiMove.exchangeTileIds.length > 0) {
            return this.exchangeTiles(gameId, currentPlayer.id, aiMove.exchangeTileIds);
          } else {
            console.warn(`AI ${currentPlayer.name} generated invalid exchange move`);
            return this.passTurn(gameId, currentPlayer.id);
          }
          
        case 'PASS':
        default:
          return this.passTurn(gameId, currentPlayer.id);
      }
    } catch (error) {
      console.error(`Error executing AI move for ${currentPlayer.name}:`, error);
      // Fallback to pass turn if AI move fails
      return this.passTurn(gameId, currentPlayer.id);
    }
  }

  private async executeAIWordMove(gameId: string, playerId: string, tiles: PlacedTile[]): Promise<{ success: boolean; errors: string[] }> {
    // Set the pending tiles for the AI
    this.pendingTiles.set(gameId, tiles);
    
    // Commit the move
    const result = await this.commitMove(gameId, playerId);
    
    if (!result.success) {
      // Clear pending tiles if move failed
      this.pendingTiles.set(gameId, []);
      console.warn(`AI move failed for player ${playerId}:`, result.errors);
    }
    
    return result;
  }

  // Check if current player is AI and execute move if needed
  async checkAndExecuteAITurn(gameId: string, io?: any): Promise<void> {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      console.log(`checkAndExecuteAITurn: Game ${gameId} not found`);
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    console.log(`checkAndExecuteAITurn: Current player is ${currentPlayer?.name} (AI: ${currentPlayer?.isAI}, hasEnded: ${currentPlayer?.hasEndedGame})`);
    
    if (currentPlayer && currentPlayer.isAI && !currentPlayer.hasEndedGame) {
      console.log(`Scheduling AI move for ${currentPlayer.name} in ${gameId}`);
      // Add a small delay to make AI moves feel more natural
      setTimeout(async () => {
        try {
          console.log(`Executing AI move for ${currentPlayer.name}`);
          const result = await this.executeAIMove(gameId);
          console.log(`AI move result for ${currentPlayer.name}:`, result);
          
          // Always broadcast game state update after AI move - CRITICAL for frontend sync
          if (io) {
            console.log(`Broadcasting game state after AI move for ${currentPlayer.name}`);
            this.broadcastGameState(gameId, io);
          }
          
          if (!result.success) {
            console.warn(`AI move failed for ${currentPlayer.name}:`, result.errors);
            // If AI move fails, try to pass turn to prevent getting stuck
            console.log(`Attempting to pass turn for ${currentPlayer.name} after failed move`);
            const passResult = this.passTurn(gameId, currentPlayer.id);
            console.log(`Pass turn result for ${currentPlayer.name}:`, passResult);
            
            // Broadcast after pass turn too
            if (io) {
              console.log(`Broadcasting game state after AI pass turn for ${currentPlayer.name}`);
              this.broadcastGameState(gameId, io);
            }
          }
          
          // Check if the next player is also AI and needs to move
          setTimeout(() => {
            this.checkAndExecuteAITurn(gameId, io);
          }, 500);
          
        } catch (error) {
          console.warn(`Error in AI move execution for ${currentPlayer.name}:`, error);
          // Fallback: pass turn if AI completely fails
          try {
            console.log(`Emergency pass turn for ${currentPlayer.name} after error`);
            const passResult = this.passTurn(gameId, currentPlayer.id);
            console.log(`Emergency pass result for ${currentPlayer.name}:`, passResult);
            
            // Broadcast after emergency pass
            if (io) {
              console.log(`Broadcasting game state after AI emergency pass for ${currentPlayer.name}`);
              this.broadcastGameState(gameId, io);
            }
            
            // Check if the next player is also AI and needs to move
            setTimeout(() => {
              this.checkAndExecuteAITurn(gameId, io);
            }, 500);
            
          } catch (passError) {
            console.warn(`Emergency pass also failed for ${currentPlayer.name}:`, passError);
            // At this point, just broadcast the current state and hope for the best
            if (io) {
              this.broadcastGameState(gameId, io);
            }
          }
        }
      }, 1000 + Math.random() * 2000); // 1-3 second delay
    } else {
      // If current player is not AI, make sure we broadcast the current state
      if (io) {
        console.log(`Current player ${currentPlayer?.name} is not AI, broadcasting current game state`);
        this.broadcastGameState(gameId, io);
      }
    }
  }

  // Rest of the methods remain the same...
  endGame(gameId: string, playerId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }
    
    if (gameState.playersEndedGame.includes(playerId)) {
      return { success: false, errors: ['Player already ended game'] };
    }

    // Validate that the player actually exists in the game
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found in game'] };
    }

    const updatedPlayers = gameState.players.map(p =>
      p.id === playerId ? { ...p, hasEndedGame: true } : p
    );

    const newPlayersEndedGame = [...gameState.playersEndedGame, playerId];

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
      playersEndedGame: newPlayersEndedGame,
    };

    this.games.set(gameId, updatedGameState);
    this.pendingTiles.set(gameId, []);

    // Check if all players have ended the game
    this.checkGameEnd(gameId);
    
    // If the current player ended their game, move to next turn
    if (gameState.players[gameState.currentPlayerIndex]?.id === playerId) {
      this.nextTurn(gameId);
    }

    return { success: true, errors: [] };
  }

  hasPlayerEndedGame(gameId: string, playerId: string): boolean {
    const gameState = this.games.get(gameId);
    if (!gameState) return false;
    return gameState.playersEndedGame.includes(playerId);
  }

  getActivePlayers(gameId: string): Player[] {
    const gameState = this.games.get(gameId);
    if (!gameState) return [];
    return gameState.players.filter(p => !p.hasEndedGame);
  }

  checkGameEnd(gameId: string): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;
    
    if (gameState.playersEndedGame.length === gameState.players.length) {
      // All players have ended the game - calculate final scores
      const finalPlayers = gameState.players.map(player => {
        const remainingTileValue = player.tiles.reduce((sum, tile) => sum + tile.value, 0);
        return {
          ...player,
          score: player.score - remainingTileValue
        };
      });

      const updatedGameState: GameState = {
        ...gameState,
        players: finalPlayers,
        gamePhase: 'FINISHED'
      };

      this.games.set(gameId, updatedGameState);
    }
  }

  addMoveToHistory(gameId: string, playerId: string, playerName: string, moveType: 'WORD' | 'EXCHANGE' | 'PASS' | 'EVOCATION' | 'INTERCESSION', words?: string[], score?: number, spellInfo?: { spellType: 'EVOCATION' | 'INTERCESSION'; spellName: string; spellEffect: string; damageDealt?: number; damageTarget?: string }): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;
    
    const newEntry: MoveHistoryEntry = {
      playerId,
      playerName,
      turnNumber: gameState.turnNumber,
      moveType,
      words: words || [],
      score: score || 0,
      timestamp: new Date(),
      // Add spell information if provided
      ...(spellInfo && {
        spellType: spellInfo.spellType,
        spellName: spellInfo.spellName,
        spellEffect: spellInfo.spellEffect,
        damageDealt: spellInfo.damageDealt,
        damageTarget: spellInfo.damageTarget
      })
    };

    const updatedGameState: GameState = {
      ...gameState,
      moveHistory: [...gameState.moveHistory, newEntry],
    };

    console.log('Adding move to history:', newEntry);
    console.log('Updated move history length:', updatedGameState.moveHistory.length);

    this.games.set(gameId, updatedGameState);
  }

  activatePowerUp(gameId: string, playerId: string, powerUpId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    // Validate that the player actually owns the power-up
    const powerUpExists = player.activePowerUps.some(pu => pu.id === powerUpId);
    if (!powerUpExists) {
      console.warn(`Player ${playerId} attempted to activate power-up they don't own: ${powerUpId}`);
      return { success: false, errors: ['Power-up not found in player inventory'] };
    }

    const result = PowerUpManager.activatePowerUp(player, powerUpId);
    
    if (result.success) {
      const updatedPlayers = gameState.players.map(p =>
        p.id === playerId ? result.updatedPlayer : p
      );
      
      const updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers,
      };

      this.games.set(gameId, updatedGameState);
      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to activate power-up'] };
    }
  }

  activatePowerUpTile(gameId: string, playerId: string, tileId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    const powerUpTile = player.tiles.find(t => t.id === tileId && t.isPowerUp);
    if (!powerUpTile || !powerUpTile.powerUpType) {
      console.warn(`Player ${playerId} attempted to activate power-up tile they don't own: ${tileId}`);
      return { success: false, errors: ['Power-up tile not found'] };
    }

    const result = PowerUpManager.activatePowerUpTile(player, tileId);
    
    if (result.success) {
      const updatedPlayers = gameState.players.map(p =>
        p.id === playerId ? result.updatedPlayer : p
      );
      
      let updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers,
      };

      this.games.set(gameId, updatedGameState);

      // Handle immediate effects for certain powerups
      switch (powerUpTile.powerUpType) {
        case 'HEADSTONE':
          this.executeHeadstoneSwap(gameId, playerId);
          break;
        case 'WILTED_ROSE':
          this.executeWiltedRoseSwap(gameId, playerId);
          break;
        case 'CRESCENT_MOON':
          this.executeCrescentMoon(gameId, playerId);
          break;
        case 'SCROLL':
          // SCROLL is handled as a turn modifier, no immediate effect needed
          break;
      }

      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to activate power-up tile'] };
    }
  }

  clearActivePowerUp(gameId: string, playerId: string): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const updatedPlayers = gameState.players.map(p =>
      p.id === playerId ? PowerUpManager.clearActivePowerUp(p) : p
    );
    
    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
    };

    this.games.set(gameId, updatedGameState);
  }

  executeHeadstoneSwap(gameId: string, playerId: string): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const { updatedPlayer, updatedBag } = PowerUpManager.swapPlayerTiles(player, gameState.tileBag);
    const { finalTiles, updatedBag: finalBag } = PowerUpManager.guaranteeVowelsInDraw(updatedPlayer.tiles, updatedBag);
    
    const finalPlayer = {
      ...updatedPlayer,
      tiles: finalTiles
    };

    const updatedPlayers = gameState.players.map(p =>
      p.id === playerId ? finalPlayer : p
    );
    
    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
      tileBag: finalBag,
    };

    this.games.set(gameId, updatedGameState);
  }

  executeWiltedRoseSwap(gameId: string, playerId: string): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const currentPlayer = gameState.players.find(p => p.id === playerId);
    if (!currentPlayer) return;

    // Find other players who haven't ended their game
    const otherPlayers = gameState.players.filter(p => p.id !== playerId && !p.hasEndedGame);
    
    if (otherPlayers.length === 0) return;

    // Pick a random other player
    const randomPlayer = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
    
    // Swap tiles between current player and random player
    const { updatedPlayer1, updatedPlayer2 } = PowerUpManager.swapTilesWithOpponent(currentPlayer, randomPlayer);
    
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === playerId) return updatedPlayer1;
      if (p.id === randomPlayer.id) return updatedPlayer2;
      return p;
    });
    
    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
    };

    this.games.set(gameId, updatedGameState);
  }

  executeCrescentMoon(gameId: string, playerId: string): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    // Add a blank tile to the player's rack
    const updatedPlayer = PowerUpManager.addBlankTileToRack(player);

    const updatedPlayers = gameState.players.map(p =>
      p.id === playerId ? updatedPlayer : p
    );
    
    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
    };

    this.games.set(gameId, updatedGameState);
  }

  executeBurn(gameId: string, playerId: string, targetTileIds: string[]): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    // Find target player (opponent)
    const targetPlayer = gameState.players.find(p => p.id !== playerId && !p.hasEndedGame);
    if (!targetPlayer) {
      return { success: false, errors: ['No valid target player found'] };
    }

    const result = PowerUpManager.executeBurn(targetPlayer, targetTileIds);
    
    if (result.success) {
      const updatedPlayers = gameState.players.map(p =>
        p.id === targetPlayer.id ? result.updatedPlayer : p
      );
      
      const updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers,
      };

      this.games.set(gameId, updatedGameState);
      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to execute burn'] };
    }
  }

  executeTileThief(gameId: string, playerId: string, targetPlayerId: string, targetTileId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const currentPlayer = gameState.players.find(p => p.id === playerId);
    const targetPlayer = gameState.players.find(p => p.id === targetPlayerId);
    
    if (!currentPlayer || !targetPlayer) {
      return { success: false, errors: ['Player not found'] };
    }

    const result = PowerUpManager.executeTileThief(currentPlayer, targetPlayer, targetTileId);
    
    if (result.success) {
      const updatedPlayers = gameState.players.map(p => {
        if (p.id === playerId) return result.updatedCurrentPlayer;
        if (p.id === targetPlayerId) return result.updatedTargetPlayer;
        return p;
      });
      
      const updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers,
      };

      this.games.set(gameId, updatedGameState);
      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to execute tile thief'] };
    }
  }

  executeDuplicate(gameId: string, playerId: string, sourceTileId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    const result = PowerUpManager.executeDuplicate(player, sourceTileId);
    
    if (result.success) {
      const updatedPlayers = gameState.players.map(p =>
        p.id === playerId ? result.updatedPlayer : p
      );
      
      const updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers,
      };

      this.games.set(gameId, updatedGameState);
      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to execute duplicate'] };
    }
  }

  executeExtraTiles(gameId: string, playerId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    const result = PowerUpManager.executeExtraTiles(player, gameState.tileBag);
    
    if (result.success) {
      const updatedPlayers = gameState.players.map(p =>
        p.id === playerId ? result.updatedPlayer : p
      );
      
      const updatedGameState: GameState = {
        ...gameState,
        players: updatedPlayers,
        tileBag: result.updatedBag,
      };

      this.games.set(gameId, updatedGameState);
      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to execute extra tiles'] };
    }
  }

  executeSilence(gameId: string, playerId: string, targetPlayerId: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const targetPlayer = gameState.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) {
      return { success: false, errors: ['Target player not found'] };
    }

    const result = PowerUpManager.executeSilence(targetPlayer);
    
    if (result.success) {
      // Store silenced tile IDs in game state (you might need to add this to GameState type)
      // For now, we'll just return success - the silencing effect would need to be tracked
      // in the game state and checked during tile placement validation
      
      console.log(`Silence powerup executed: silenced tiles ${result.silencedTileIds.join(', ')} for player ${targetPlayerId}`);
      return { success: true, errors: [] };
    } else {
      return { success: false, errors: [result.error || 'Failed to execute silence'] };
    }
  }

  executeTileFreeze(gameId: string, playerId: string, targetRow: number, targetCol: number): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    // Validate target position has a tile
    if (!gameState.board[targetRow] || !gameState.board[targetRow][targetCol] || !gameState.board[targetRow][targetCol].tile) {
      return { success: false, errors: ['No tile at target position'] };
    }

    // For now, just log the freeze effect - you'd need to track frozen tiles in game state
    console.log(`Tile freeze powerup executed: froze tile at position (${targetRow}, ${targetCol})`);
    return { success: true, errors: [] };
  }

  executeMultiplierThief(gameId: string, playerId: string, targetRow: number, targetCol: number): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    // Validate target position has a multiplier
    const targetCell = gameState.board[targetRow]?.[targetCol];
    if (!targetCell || (!targetCell.multiplier || targetCell.tile)) {
      return { success: false, errors: ['No available multiplier at target position'] };
    }

    // For now, just log the theft - you'd need to track stolen multipliers in game state
    console.log(`Multiplier thief powerup executed: stole ${targetCell.multiplier} multiplier from position (${targetRow}, ${targetCol})`);
    return { success: true, errors: [] };
  }

  executePowerUp(gameId: string, playerId: string, powerUpType: string, params: any): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    try {
      // Handle different power-up types
      switch (powerUpType) {
        case 'HEADSTONE':
          this.executeHeadstoneSwap(gameId, playerId);
          return { success: true, errors: [] };
          
        case 'WILTED_ROSE':
          this.executeWiltedRoseSwap(gameId, playerId);
          return { success: true, errors: [] };
          
        case 'CRESCENT_MOON':
          this.executeCrescentMoon(gameId, playerId);
          return { success: true, errors: [] };
          
        case 'BURN':
          return this.executeBurn(gameId, playerId, params.targetTileIds);
          
        case 'TILE_THIEF':
          return this.executeTileThief(gameId, playerId, params.targetPlayerId, params.targetTileId);
          
        case 'DUPLICATE':
          return this.executeDuplicate(gameId, playerId, params.sourceTileId);
          
        case 'EXTRA_TILES':
          return this.executeExtraTiles(gameId, playerId);
          
        case 'SILENCE':
          return this.executeSilence(gameId, playerId, params.targetPlayerId);
          
        case 'TILE_FREEZE':
          return this.executeTileFreeze(gameId, playerId, params.targetRow, params.targetCol);
          
        case 'MULTIPLIER_THIEF':
          return this.executeMultiplierThief(gameId, playerId, params.targetRow, params.targetCol);
          
        default:
          return { success: false, errors: [`Unknown power-up type: ${powerUpType}`] };
      }
    } catch (error) {
      console.error(`Error executing power-up ${powerUpType}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, errors: [`Failed to execute power-up: ${errorMessage}`] };
    }
  }

  // Emit damage event for visual feedback
  emitDamageEvent(gameId: string, playerId: string, damage: number, isAI: boolean, io?: any): void {
    if (io) {
      console.log(`Emitting damage event: ${playerId} took ${damage} damage (AI: ${isAI})`);
      io.to(gameId).emit('damage-event', {
        playerId,
        damage,
        isAI
      });
    }
  }

  // Broadcast game state to all players in room
  broadcastGameState(gameId: string, io: any): void {
    const gameState = this.getGameState(gameId);
    const pendingTiles = this.getPendingTiles(gameId);
    
    if (gameState && io) {
      console.log(`Broadcasting game state update for game ${gameId}`);
      io.to(gameId).emit('game-state-updated', {
        gameState,
        pendingTiles
      });
    }
  }

  // Intercession execution methods
  async executeIntercession(gameId: string, playerId: string, intercessionId: string, io?: any): Promise<{ success: boolean; errors: string[]; intercessionType?: string }> {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    const intercession = player.intercessions.find(i => i.id === intercessionId);
    if (!intercession) {
      return { success: false, errors: ['Intercession not found'] };
    }

    if (intercession.currentCooldown > 0) {
      return { success: false, errors: [`Intercession is on cooldown for ${intercession.currentCooldown} more turns`] };
    }

    try {
      // Execute the intercession effect
      switch (intercession.type) {
        case 'MICHAEL':
          return this.executeMichael(gameId, playerId, intercessionId);
        case 'SAMAEL':
          return this.executeSamael(gameId, playerId, intercessionId);
        case 'RAPHAEL':
          return this.executeRaphael(gameId, playerId, intercessionId);
        case 'URIEL':
          return this.executeUriel(gameId, playerId, intercessionId);
        case 'GABRIEL':
          return await this.executeGabriel(gameId, playerId, intercessionId, io);
        case 'METATRON':
          return this.executeMetatron(gameId, playerId, intercessionId);
        default:
          return { success: false, errors: [`Unknown intercession type: ${intercession.type}`] };
      }
    } catch (error) {
      console.error(`Error executing intercession ${intercession.type}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, errors: [`Failed to execute intercession: ${errorMessage}`] };
    }
  }

  private executeMichael(gameId: string, playerId: string, intercessionId: string): { success: boolean; errors: string[]; intercessionType: string } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'], intercessionType: 'MICHAEL' };
    }

    // Find opponent
    const opponent = gameState.players.find(p => p.id !== playerId && !p.hasEndedGame);
    if (!opponent) {
      return { success: false, errors: ['No valid opponent found'], intercessionType: 'MICHAEL' };
    }

    // Deal 30 direct damage
    const damage = 30;
    const newHP = Math.max(0, opponent.hp - damage);

    // Update opponent's HP
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === opponent.id) {
        return { ...p, hp: newHP };
      }
      if (p.id === playerId) {
        // Set intercession on cooldown
        const updatedIntercessions = p.intercessions.map(i => 
          i.id === intercessionId ? { ...i, currentCooldown: i.cooldown } : i
        );
        return { ...p, intercessions: updatedIntercessions };
      }
      return p;
    });

    // Check for victory condition
    let gamePhase = gameState.gamePhase;
    if (newHP <= 0) {
      gamePhase = 'FINISHED';
    }

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
      gamePhase
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Michael intercession: ${opponent.name} took 30 damage (HP: ${opponent.hp} -> ${newHP})`);
    
    return { success: true, errors: [], intercessionType: 'MICHAEL' };
  }

  private executeSamael(gameId: string, playerId: string, intercessionId: string): { success: boolean; errors: string[]; intercessionType: string } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'], intercessionType: 'SAMAEL' };
    }

    // Set double damage flag for next word
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === playerId) {
        // Set intercession on cooldown and add double damage effect
        const updatedIntercessions = p.intercessions.map(i => 
          i.id === intercessionId ? { ...i, currentCooldown: i.cooldown } : i
        );
        return { 
          ...p, 
          intercessions: updatedIntercessions,
          samaelDoubleDamage: true
        };
      }
      return p;
    });

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Samael intercession: ${playerId} will deal double damage on next word`);
    
    return { success: true, errors: [], intercessionType: 'SAMAEL' };
  }

  private executeRaphael(gameId: string, playerId: string, intercessionId: string): { success: boolean; errors: string[]; intercessionType: string } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'], intercessionType: 'RAPHAEL' };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'], intercessionType: 'RAPHAEL' };
    }

    // Heal 50 HP (max 300)
    const healing = 50;
    const newHP = Math.min(300, player.hp + healing);

    const updatedPlayers = gameState.players.map(p => {
      if (p.id === playerId) {
        // Set intercession on cooldown and heal
        const updatedIntercessions = p.intercessions.map(i => 
          i.id === intercessionId ? { ...i, currentCooldown: i.cooldown } : i
        );
        return { ...p, hp: newHP, intercessions: updatedIntercessions };
      }
      return p;
    });

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Raphael intercession: ${player.name} healed for 50 HP (${player.hp} -> ${newHP})`);
    
    return { success: true, errors: [], intercessionType: 'RAPHAEL' };
  }

  private executeUriel(gameId: string, playerId: string, intercessionId: string): { success: boolean; errors: string[]; intercessionType: string } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'], intercessionType: 'URIEL' };
    }

    // Set damage reduction flag for this player
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === playerId) {
        // Set intercession on cooldown and add protection effect
        const updatedIntercessions = p.intercessions.map(i => 
          i.id === intercessionId ? { ...i, currentCooldown: i.cooldown } : i
        );
        return { 
          ...p, 
          intercessions: updatedIntercessions,
          urielProtection: true
        };
      }
      return p;
    });

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Uriel intercession: ${playerId} has 50% damage reduction for opponent's next turn`);
    
    return { success: true, errors: [], intercessionType: 'URIEL' };
  }

  private async executeGabriel(gameId: string, playerId: string, intercessionId: string, io?: any): Promise<{ success: boolean; errors: string[]; intercessionType: string }> {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'], intercessionType: 'GABRIEL' };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'], intercessionType: 'GABRIEL' };
    }

    // Set intercession on cooldown first
    const updatedPlayers = gameState.players.map(p => {
      if (p.id === playerId) {
        const updatedIntercessions = p.intercessions.map(i => 
          i.id === intercessionId ? { ...i, currentCooldown: i.cooldown } : i
        );
        return { ...p, intercessions: updatedIntercessions };
      }
      return p;
    });

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers
    };

    this.games.set(gameId, updatedGameState);

    try {
      console.log(`Gabriel intercession: Auto-playing highest scoring word for ${player.name}`);
      
      // Use the AI service to find the best move
      const aiMove = await quackleGaddagAIService.generateMove(updatedGameState, playerId);
      
      if (aiMove.type === 'WORD' && aiMove.tiles && aiMove.tiles.length > 0) {
        // Set the pending tiles for Gabriel's auto-play
        this.pendingTiles.set(gameId, aiMove.tiles);
        
        // Commit the move automatically - but don't let it call nextTurn yet
        const moveResult = await this.commitMoveWithoutTurnAdvancement(gameId, playerId);
        
        if (moveResult.success) {
          console.log(`Gabriel intercession: Successfully auto-played word for ${moveResult.moveResult?.score?.totalScore || 0} points`);
          
          // Now manually advance the turn to ensure proper state management
          this.nextTurn(gameId);
          
          return { success: true, errors: [], intercessionType: 'GABRIEL' };
        } else {
          // Clear pending tiles if move failed
          this.pendingTiles.set(gameId, []);
          console.log(`Gabriel intercession: Auto-play failed - ${moveResult.errors.join(', ')}`);
          return { success: true, errors: [`Auto-play failed: ${moveResult.errors.join(', ')}`], intercessionType: 'GABRIEL' };
        }
      } else {
        console.log(`Gabriel intercession: No valid word moves available, applying fallback damage`);

        // Find opponent similar to Michael intercession
        const opponent = updatedGameState.players.find(p => p.id !== playerId && !p.hasEndedGame);
        if (opponent) {
          const damage = 30;
          const newHP = Math.max(0, opponent.hp - damage);

          const finalPlayers = updatedGameState.players.map(p => {
            if (p.id === opponent.id) return { ...p, hp: newHP };
            return p;
          });

          let gamePhase = updatedGameState.gamePhase;
          if (newHP <= 0) {
            gamePhase = 'FINISHED';
          }

          const finalGameState: GameState = {
            ...updatedGameState,
            players: finalPlayers,
            gamePhase
          };

          this.games.set(gameId, finalGameState);

          // Emit damage event for visual feedback
          this.emitDamageEvent(gameId, opponent.id, damage, opponent.isAI || false, io);

          console.log(`Gabriel intercession fallback: ${opponent.name} took ${damage} damage (HP: ${opponent.hp} -> ${newHP})`);

          return { success: true, errors: [], intercessionType: 'GABRIEL' };
        } else {
          console.log(`Gabriel intercession fallback failed: no valid opponent found`);
          return { success: true, errors: ['No valid opponent for fallback damage'], intercessionType: 'GABRIEL' };
        }
      }
    } catch (error) {
      console.error(`Gabriel intercession error:`, error);
      return { success: true, errors: [`Auto-play error: ${error instanceof Error ? error.message : 'Unknown error'}`], intercessionType: 'GABRIEL' };
    }
  }

  private executeMetatron(gameId: string, playerId: string, intercessionId: string): { success: boolean; errors: string[]; intercessionType: string } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'], intercessionType: 'METATRON' };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'], intercessionType: 'METATRON' };
    }

    // Heal 100 HP (max 300)
    const healing = 100;
    const newHP = Math.min(300, player.hp + healing);

    const updatedPlayers = gameState.players.map(p => {
      if (p.id === playerId) {
        // Set intercession on cooldown and heal
        const updatedIntercessions = p.intercessions.map(i => 
          i.id === intercessionId ? { ...i, currentCooldown: i.cooldown } : i
        );
        return { ...p, hp: newHP, intercessions: updatedIntercessions };
      }
      return p;
    });

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Metatron intercession: ${player.name} healed for 100 HP (${player.hp} -> ${newHP})`);
    
    return { success: true, errors: [], intercessionType: 'METATRON' };
  }

  // Method to reduce cooldowns at turn end
  reduceIntercessionCooldowns(gameId: string): void {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const updatedPlayers = gameState.players.map(player => ({
      ...player,
      intercessions: player.intercessions.map(intercession => ({
        ...intercession,
        currentCooldown: Math.max(0, intercession.currentCooldown - 1)
      }))
    }));

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers
    };

    this.games.set(gameId, updatedGameState);
  }

  // Remove a game from memory
  removeGame(gameId: string): void {
    this.games.delete(gameId);
    this.pendingTiles.delete(gameId);
    console.log(`Game ${gameId} removed from memory`);
  }

  // Update player color in game state
  updatePlayerColor(gameId: string, playerId: string, color: string): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found in game'] };
    }

    // Update player's tile color
    const updatedPlayers = gameState.players.map(p =>
      p.id === playerId ? { ...p, tileColor: color } : p
    );

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Player ${playerId} color updated to ${color} in game ${gameId}`);
    
    return { success: true, errors: [] };
  }

  // Update player in game state
  updatePlayerInGame(gameId: string, playerId: string, updatedPlayer: Player): { success: boolean; errors: string[] } {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const playerExists = gameState.players.find(p => p.id === playerId);
    if (!playerExists) {
      return { success: false, errors: ['Player not found in game'] };
    }

    // Update the specific player in the game state
    const updatedPlayers = gameState.players.map(p =>
      p.id === playerId ? updatedPlayer : p
    );

    const updatedGameState: GameState = {
      ...gameState,
      players: updatedPlayers,
    };

    this.games.set(gameId, updatedGameState);
    console.log(`Player ${playerId} updated in game ${gameId}`);
    
    return { success: true, errors: [] };
  }

  // Execute evocation effects that require game state access
  async executeEvocationEffects(gameId: string, playerId: string, evocationType: string, params?: any): Promise<{ success: boolean; errors: string[] }> {
    const gameState = this.games.get(gameId);
    if (!gameState) {
      return { success: false, errors: ['Game not found'] };
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      return { success: false, errors: ['Player not found'] };
    }

    const opponent = gameState.players.find(p => p.id !== playerId && !p.hasEndedGame);

    try {
      switch (evocationType) {
        case 'MURMUR':
          if (!opponent) {
            return { success: false, errors: ['No valid opponent found'] };
          }
          const murmurResult = EvocationManager.executeMurmur(opponent);
          if (murmurResult.success) {
            const updatedOpponent = { ...opponent, silencedTiles: murmurResult.silencedTileIds };
            this.updatePlayerInGame(gameId, opponent.id, updatedOpponent);
            console.log(`MURMUR evocation: Silenced tiles ${murmurResult.silencedTileIds.join(', ')} for player ${opponent.name}`);
          }
          return { success: murmurResult.success, errors: murmurResult.error ? [murmurResult.error] : [] };

        case 'AIM':
          if (!opponent) {
            return { success: false, errors: ['No valid opponent found'] };
          }
          // For AIM, we need to randomly select 2 tiles from opponent
          const opponentTileIds = opponent.tiles.slice(0, 2).map(t => t.id);
          if (opponentTileIds.length < 2) {
            return { success: false, errors: ['Opponent does not have enough tiles'] };
          }
          const aimResult = EvocationManager.executeAim(opponent, opponentTileIds);
          if (aimResult.success) {
            this.updatePlayerInGame(gameId, opponent.id, aimResult.updatedPlayer);
            console.log(`AIM evocation: Removed 2 tiles from ${opponent.name}`);
          }
          return { success: aimResult.success, errors: aimResult.error ? [aimResult.error] : [] };

        case 'BUNE':
          // Swap player tiles with guaranteed vowels
          const buneResult = EvocationManager.swapPlayerTiles(player, gameState.tileBag);
          const { finalTiles, updatedBag } = EvocationManager.guaranteeVowelsInDraw(buneResult.updatedPlayer.tiles, buneResult.updatedBag);
          
          // Update game state with new bag FIRST
          const updatedGameState: GameState = { ...gameState, tileBag: updatedBag };
          this.games.set(gameId, updatedGameState);
          
          // THEN update the player
          const updatedPlayer = { ...buneResult.updatedPlayer, tiles: finalTiles };
          this.updatePlayerInGame(gameId, playerId, updatedPlayer);
          
          console.log(`BUNE evocation: Swapped tiles for ${player.name} with guaranteed vowels`);
          return { success: true, errors: [] };

        case 'GREMORY':
          if (!opponent) {
            return { success: false, errors: ['No valid opponent found'] };
          }
          const gremoryResult = EvocationManager.swapTilesWithOpponent(player, opponent);
          this.updatePlayerInGame(gameId, playerId, gremoryResult.updatedPlayer1);
          this.updatePlayerInGame(gameId, opponent.id, gremoryResult.updatedPlayer2);
          console.log(`GREMORY evocation: Swapped tiles between ${player.name} and ${opponent.name}`);
          return { success: true, errors: [] };

        case 'HAAGENTI':
          const haagenResult = EvocationManager.executeHaagenti(player, gameState.tileBag);
          if (haagenResult.success) {
            // Set rack expansion flags for UI display
            const expandedPlayer = {
              ...haagenResult.updatedPlayer,
              allowRackExpansion: true,
              maxRackSize: 10
            };
            this.updatePlayerInGame(gameId, playerId, expandedPlayer);
            const updatedGameStateHaag: GameState = { ...gameState, tileBag: haagenResult.updatedBag };
            this.games.set(gameId, updatedGameStateHaag);
            console.log(`HAAGENTI evocation: Added 3 tiles to ${player.name}'s rack and expanded to 10 slots`);
          }
          return { success: haagenResult.success, errors: haagenResult.error ? [haagenResult.error] : [] };

        case 'DANTALION':
          if (!params || typeof params.sourceTileId !== 'string') {
            return { success: false, errors: ['No source tile specified'] };
          }
          const dupResult = PowerUpManager.executeDuplicate(player, params.sourceTileId);
          if (dupResult.success) {
            this.updatePlayerInGame(gameId, playerId, dupResult.updatedPlayer);
            console.log(`DANTALION evocation: Duplicated tile ${params.sourceTileId} for ${player.name}`);
          }
          return { success: dupResult.success, errors: dupResult.error ? [dupResult.error] : [] };

        case 'OROBAS':
          // OROBAS allows unlimited tile reuse - this is handled during move validation
          console.log(`OROBAS evocation: ${player.name} can reuse tiles unlimited times this turn`);
          return { success: true, errors: [] };

        case 'FURFUR':
          // FURFUR grants extra turn - set flag on player
          const updatedPlayerFurfur = { ...player, hasExtraTurn: true };
          this.updatePlayerInGame(gameId, playerId, updatedPlayerFurfur);
          console.log(`FURFUR evocation: ${player.name} will get an extra turn`);
          return { success: true, errors: [] };

        case 'ANDROMALIUS':
          if (!opponent) {
            return { success: false, errors: ['No valid opponent found'] };
          }
          // For ANDROMALIUS, we need to randomly select 1 tile from opponent to steal
          if (opponent.tiles.length === 0) {
            return { success: false, errors: ['Opponent has no tiles to steal'] };
          }
          const randomTileIndex = Math.floor(Math.random() * opponent.tiles.length);
          const targetTileId = opponent.tiles[randomTileIndex].id;
          
          const androResult = EvocationManager.executeAndromalius(player, opponent, targetTileId);
          if (androResult.success) {
            this.updatePlayerInGame(gameId, playerId, androResult.updatedCurrentPlayer);
            this.updatePlayerInGame(gameId, opponent.id, androResult.updatedTargetPlayer);
            console.log(`ANDROMALIUS evocation: ${player.name} stole tile from ${opponent.name}`);
          }
          return { success: androResult.success, errors: androResult.error ? [androResult.error] : [] };

        case 'FORNEUS':
          if (!params || !params.targetPositions || !Array.isArray(params.targetPositions)) {
            return { success: false, errors: ['No target positions specified for Forneus'] };
          }
          
          const forneusResult = EvocationManager.executeForneus(gameState.board, params.targetPositions);
          if (forneusResult.success) {
            const updatedGameState: GameState = {
              ...gameState,
              board: forneusResult.updatedBoard
            };
            this.games.set(gameId, updatedGameState);
            console.log(`FORNEUS evocation: ${player.name} froze ${params.targetPositions.length} tiles`);
          }
          return { success: forneusResult.success, errors: forneusResult.error ? [forneusResult.error] : [] };

        // ASTAROTH is handled immediately in EvocationManager.activateEvocation
        // DANTALION, VALEFOR would need additional UI for target selection

        default:
          console.log(`Evocation ${evocationType} activated but no special effects implemented yet`);
          return { success: true, errors: [] };
      }
    } catch (error) {
      console.error(`Error executing evocation ${evocationType}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, errors: [`Failed to execute evocation: ${errorMessage}`] };
    }
  }
}

// Export singleton instance
export const gameService = new GameService();
