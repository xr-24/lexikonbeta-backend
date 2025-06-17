import { Socket, Server } from 'socket.io';
import { roomManager } from '../services/RoomManager';
import { gameService } from '../services/GameService';
import { ValidationUtils, RateLimiter } from '../services/validation';
import type { Tile } from '../types/game';

export function registerGameEvents(socket: Socket, io: Server) {
  // Helper function to get player's room and validate game state
  function getPlayerGameContext(socketId: string) {
    const playerInRoom = roomManager.getPlayerInRoom(socketId);
    if (!playerInRoom || !playerInRoom.room.isStarted) {
      return null;
    }
    
    const gameState = gameService.getGameState(playerInRoom.room.id);
    if (!gameState) {
      return null;
    }
    
    return {
      room: playerInRoom.room,
      player: playerInRoom.player,
      gameState,
      roomId: playerInRoom.room.id
    };
  }

  // Helper function to broadcast game state to all players in room
  function broadcastGameState(roomId: string) {
    const gameState = gameService.getGameState(roomId);
    const pendingTiles = gameService.getPendingTiles(roomId);
    
    if (gameState) {
      io.to(roomId).emit('game-state-updated', {
        gameState,
        pendingTiles
      });
    }
  }

  // Validate tile ownership
  function validateTileOwnership(tile: Tile, playerId: string, gameState: any): boolean {
    const player = gameState.players.find((p: any) => p.id === playerId);
    if (!player) return false;
    
    // For power-up tiles, just check if player has any power-up tiles
    if (tile.isPowerUp) {
      return player.tiles.some((t: any) => t.isPowerUp && t.powerUpType === tile.powerUpType);
    }
    
    // For blank tiles, check by ID and blank status (letter might have been changed to chosen letter)
    if (tile.isBlank) {
      return player.tiles.some((t: any) => 
        t.id === tile.id && 
        t.isBlank === true
      );
    }
    
    // For regular tiles, check exact match
    return player.tiles.some((t: any) => 
      t.id === tile.id && 
      t.letter === tile.letter && 
      t.value === tile.value &&
      t.isBlank === tile.isBlank
    );
  }

  // Validate tile data structure
  function validateTileData(tile: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!tile || typeof tile !== 'object') {
      errors.push('Invalid tile data');
      return { isValid: false, errors };
    }
    
    if (typeof tile.id !== 'string' || tile.id.length === 0) {
      errors.push('Invalid tile ID');
    }
    
    if (typeof tile.letter !== 'string' || tile.letter.length !== 1) {
      errors.push('Invalid tile letter');
    }
    
    if (!Number.isInteger(tile.value) || tile.value < 0 || tile.value > 10) {
      errors.push('Invalid tile value');
    }
    
    return { isValid: errors.length === 0, errors };
  }

  // Place a tile on the board
  socket.on('place-tile', (data: { tile: Tile; row: number; col: number }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'place-tile', 10, 1000)) { // 10 per second
        socket.emit('place-tile-response', {
          success: false,
          error: 'Please slow down tile placement'
        });
        return;
      }

      console.log('Place tile request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        console.log('No game context for place-tile');
        socket.emit('place-tile-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data !== 'object') {
        socket.emit('place-tile-response', {
          success: false,
          error: 'Invalid request data'
        });
        return;
      }

      // Validate tile data
      const tileValidation = validateTileData(data.tile);
      if (!tileValidation.isValid) {
        socket.emit('place-tile-response', {
          success: false,
          error: tileValidation.errors[0] || 'Invalid tile'
        });
        return;
      }

      // Validate board position
      const positionValidation = ValidationUtils.validateBoardPosition(data.row, data.col);
      if (!positionValidation.isValid) {
        socket.emit('place-tile-response', {
          success: false,
          error: positionValidation.errors[0] || 'Invalid board position'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      console.log('Place tile - Current player:', currentPlayer?.id, 'Requesting player:', context.player.id);
      
      if (currentPlayer.id !== context.player.id) {
        console.log('Place tile - Not player turn');
        socket.emit('place-tile-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      // Validate tile ownership (critical security check)
      if (!validateTileOwnership(data.tile, context.player.id, context.gameState)) {
        console.warn(`Player ${context.player.id} attempted to place tile they don't own:`, data.tile);
        socket.emit('place-tile-response', {
          success: false,
          error: 'You do not own this tile'
        });
        return;
      }

      const success = gameService.addPendingTile(context.roomId, data.tile, positionValidation.row, positionValidation.col);
      console.log('Add pending tile result:', success);
      
      if (success) {
        socket.emit('place-tile-response', {
          success: true
        });
        
        // Broadcast updated pending tiles to all players
        broadcastGameState(context.roomId);
      } else {
        socket.emit('place-tile-response', {
          success: false,
          error: 'Cannot place tile at that position'
        });
      }
    } catch (error) {
      console.error('Error in place-tile:', error);
      socket.emit('place-tile-response', {
        success: false,
        error: 'An error occurred while placing the tile'
      });
    }
  });

  // Remove a tile from the board
  socket.on('remove-tile', (data: { row: number; col: number }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'remove-tile', 10, 1000)) { // 10 per second
        socket.emit('remove-tile-response', {
          success: false,
          error: 'Please slow down tile removal'
        });
        return;
      }

      console.log('Remove tile request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('remove-tile-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data !== 'object') {
        socket.emit('remove-tile-response', {
          success: false,
          error: 'Invalid request data'
        });
        return;
      }

      // Validate board position
      const positionValidation = ValidationUtils.validateBoardPosition(data.row, data.col);
      if (!positionValidation.isValid) {
        socket.emit('remove-tile-response', {
          success: false,
          error: positionValidation.errors[0] || 'Invalid board position'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('remove-tile-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      const removedTile = gameService.removePendingTile(context.roomId, positionValidation.row, positionValidation.col);
      
      socket.emit('remove-tile-response', {
        success: true,
        removedTile
      });
      
      // Broadcast updated pending tiles to all players
      broadcastGameState(context.roomId);
    } catch (error) {
      console.error('Error in remove-tile:', error);
      socket.emit('remove-tile-response', {
        success: false,
        error: 'An error occurred while removing the tile'
      });
    }
  });

  // Commit the current move
  socket.on('commit-move', async () => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'commit-move', 1, 2000)) { // 1 per 2 seconds
        socket.emit('commit-move-response', {
          success: false,
          error: 'Please wait before committing another move'
        });
        return;
      }

      console.log('Commit move request from:', socket.id);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('commit-move-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('commit-move-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      const result = await gameService.commitMove(context.roomId, context.player.id, io);
      
      socket.emit('commit-move-response', {
        success: result.success,
        errors: result.errors,
        moveResult: result.moveResult
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players about the successful move
        io.to(context.roomId).emit('move-committed', {
          playerId: context.player.id,
          playerName: context.player.name,
          moveResult: result.moveResult
        });
        
        // Check if next player is AI and execute their move (increased delay to prevent sound overlap)
        setTimeout(() => {
          gameService.checkAndExecuteAITurn(context.roomId, io);
        }, 2500);
      }
    } catch (error) {
      console.error('Error committing move:', error);
      socket.emit('commit-move-response', {
        success: false,
        errors: ['An error occurred while processing the move']
      });
    }
  });

  // Exchange tiles
  socket.on('exchange-tiles', (data: { tileIds: string[] }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'exchange-tiles', 1, 5000)) { // 1 per 5 seconds
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Please wait before exchanging tiles again'
        });
        return;
      }

      console.log('Exchange tiles request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || !Array.isArray(data.tileIds)) {
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Invalid tile IDs'
        });
        return;
      }

      // Validate tile IDs
      if (data.tileIds.length === 0 || data.tileIds.length > 7) {
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Invalid number of tiles to exchange'
        });
        return;
      }

      // Validate that all tile IDs are strings
      if (!data.tileIds.every(id => typeof id === 'string' && id.length > 0)) {
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Invalid tile ID format'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      // Validate tile ownership
      const player = context.gameState.players.find((p: any) => p.id === context.player.id);
      if (!player) {
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'Player not found'
        });
        return;
      }

      const playerTileIds = player.tiles.map((t: any) => t.id);
      const invalidTileIds = data.tileIds.filter(id => !playerTileIds.includes(id));
      
      if (invalidTileIds.length > 0) {
        console.warn(`Player ${context.player.id} attempted to exchange tiles they don't own:`, invalidTileIds);
        socket.emit('exchange-tiles-response', {
          success: false,
          error: 'You do not own some of the tiles you are trying to exchange'
        });
        return;
      }

      const result = gameService.exchangeTiles(context.roomId, context.player.id, data.tileIds);
      
      socket.emit('exchange-tiles-response', {
        success: result.success,
        errors: result.errors
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players about the exchange
        io.to(context.roomId).emit('tiles-exchanged', {
          playerId: context.player.id,
          playerName: context.player.name,
          tilesCount: data.tileIds.length
        });
      }
    } catch (error) {
      console.error('Error in exchange-tiles:', error);
      socket.emit('exchange-tiles-response', {
        success: false,
        errors: ['An error occurred while exchanging tiles']
      });
    }
  });

  // Pass turn
  socket.on('pass-turn', () => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'pass-turn', 1, 1000)) { // 1 per second
        socket.emit('pass-turn-response', {
          success: false,
          error: 'Please wait before passing turn again'
        });
        return;
      }

      console.log('Pass turn request from:', socket.id);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('pass-turn-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('pass-turn-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      const result = gameService.passTurn(context.roomId, context.player.id);
      
      socket.emit('pass-turn-response', {
        success: result.success,
        errors: result.errors
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players about the pass
        io.to(context.roomId).emit('turn-passed', {
          playerId: context.player.id,
          playerName: context.player.name
        });
        
        // Check if next player is AI and execute their move
        setTimeout(() => {
          gameService.checkAndExecuteAITurn(context.roomId, io);
        }, 500);
      }
    } catch (error) {
      console.error('Error in pass-turn:', error);
      socket.emit('pass-turn-response', {
        success: false,
        errors: ['An error occurred while passing turn']
      });
    }
  });

  // End game
  socket.on('end-game', () => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'end-game', 1, 5000)) { // 1 per 5 seconds
        socket.emit('end-game-response', {
          success: false,
          error: 'Please wait before ending game again'
        });
        return;
      }

      console.log('End game request from:', socket.id);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('end-game-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      const result = gameService.endGame(context.roomId, context.player.id);
      
      socket.emit('end-game-response', {
        success: result.success,
        errors: result.errors
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players that someone ended their game
        io.to(context.roomId).emit('player-ended-game', {
          playerId: context.player.id,
          playerName: context.player.name
        });
      }
    } catch (error) {
      console.error('Error in end-game:', error);
      socket.emit('end-game-response', {
        success: false,
        errors: ['An error occurred while ending the game']
      });
    }
  });

  // Activate power-up
  socket.on('activate-powerup', (data: { powerUpId: string }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'activate-powerup', 3, 5000)) { // 3 per 5 seconds
        socket.emit('activate-powerup-response', {
          success: false,
          error: 'Please wait before activating another power-up'
        });
        return;
      }

      console.log('Activate power-up request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('activate-powerup-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data.powerUpId !== 'string' || data.powerUpId.length === 0) {
        socket.emit('activate-powerup-response', {
          success: false,
          error: 'Invalid power-up ID'
        });
        return;
      }

      const result = gameService.activatePowerUp(context.roomId, context.player.id, data.powerUpId);
      
      socket.emit('activate-powerup-response', {
        success: result.success,
        errors: result.errors
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players about the power-up activation
        io.to(context.roomId).emit('powerup-activated', {
          playerId: context.player.id,
          playerName: context.player.name,
          powerUpId: data.powerUpId
        });
      }
    } catch (error) {
      console.error('Error in activate-powerup:', error);
      socket.emit('activate-powerup-response', {
        success: false,
        errors: ['An error occurred while activating the power-up']
      });
    }
  });

  // Activate power-up tile
  socket.on('activate-powerup-tile', (data: { tileId: string }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'activate-powerup-tile', 3, 5000)) { // 3 per 5 seconds
        socket.emit('activate-powerup-tile-response', {
          success: false,
          error: 'Please wait before activating another power-up tile'
        });
        return;
      }

      console.log('Activate power-up tile request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('activate-powerup-tile-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data.tileId !== 'string' || data.tileId.length === 0) {
        socket.emit('activate-powerup-tile-response', {
          success: false,
          error: 'Invalid tile ID'
        });
        return;
      }

      // Validate tile ownership
      const player = context.gameState.players.find((p: any) => p.id === context.player.id);
      if (!player) {
        socket.emit('activate-powerup-tile-response', {
          success: false,
          error: 'Player not found'
        });
        return;
      }

      const hasTile = player.tiles.some((t: any) => t.id === data.tileId && t.isPowerUp);
      if (!hasTile) {
        console.warn(`Player ${context.player.id} attempted to activate power-up tile they don't own:`, data.tileId);
        socket.emit('activate-powerup-tile-response', {
          success: false,
          error: 'You do not own this power-up tile'
        });
        return;
      }

      const result = gameService.activatePowerUpTile(context.roomId, context.player.id, data.tileId);
      
      socket.emit('activate-powerup-tile-response', {
        success: result.success,
        errors: result.errors
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players about the power-up tile activation
        io.to(context.roomId).emit('powerup-tile-activated', {
          playerId: context.player.id,
          playerName: context.player.name,
          tileId: data.tileId
        });
      }
    } catch (error) {
      console.error('Error in activate-powerup-tile:', error);
      socket.emit('activate-powerup-tile-response', {
        success: false,
        errors: ['An error occurred while activating the power-up tile']
      });
    }
  });

  // Get current game state
  socket.on('get-game-state', () => {
    try {
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('game-state-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      const pendingTiles = gameService.getPendingTiles(context.roomId);
      
      socket.emit('game-state-response', {
        success: true,
        gameState: context.gameState,
        pendingTiles
      });
    } catch (error) {
      console.error('Error in get-game-state:', error);
      socket.emit('game-state-response', {
        success: false,
        error: 'An error occurred while getting game state'
      });
    }
  });

  // Clear pending move
  socket.on('clear-pending-move', () => {
    try {
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('clear-pending-move-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('clear-pending-move-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      gameService.clearPendingMove(context.roomId);
      
      socket.emit('clear-pending-move-response', {
        success: true
      });
      
      // Broadcast updated pending tiles to all players
      broadcastGameState(context.roomId);
    } catch (error) {
      console.error('Error in clear-pending-move:', error);
      socket.emit('clear-pending-move-response', {
        success: false,
        error: 'An error occurred while clearing the move'
      });
    }
  });

  // Activate evocation
  socket.on('activate-evocation', async (data: { evocationId: string }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'activate-evocation', 2, 5000)) { // 2 per 5 seconds
        socket.emit('activate-evocation-response', {
          success: false,
          error: 'Please wait before activating another evocation'
        });
        return;
      }

      console.log('Activate evocation request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('activate-evocation-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data.evocationId !== 'string' || data.evocationId.length === 0) {
        socket.emit('activate-evocation-response', {
          success: false,
          error: 'Invalid evocation ID'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('activate-evocation-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      // Validate evocation ownership
      const player = context.gameState.players.find((p: any) => p.id === context.player.id);
      if (!player) {
        socket.emit('activate-evocation-response', {
          success: false,
          error: 'Player not found'
        });
        return;
      }

      const hasEvocation = player.evocations.some((e: any) => e.id === data.evocationId);
      if (!hasEvocation) {
        console.warn(`Player ${context.player.id} attempted to activate evocation they don't own:`, data.evocationId);
        socket.emit('activate-evocation-response', {
          success: false,
          error: 'You do not own this evocation'
        });
        return;
      }

      // Execute the evocation through EvocationManager
      const { EvocationManager } = await import('../services/EvocationManager');
      const result = EvocationManager.activateEvocation(player, data.evocationId);
      
      if (result.success) {
        // Update the player in game state through GameService method
        const updateResult = gameService.updatePlayerInGame(context.roomId, context.player.id, result.updatedPlayer);
        
        if (updateResult.success) {
          // Get evocation type from the activated evocation
          const activatedEvocation = result.activatedEvocation;
          const evocationType = activatedEvocation?.type || 'UNKNOWN';
          
          // Execute evocation-specific effects that require game state access
          const effectsResult = await gameService.executeEvocationEffects(context.roomId, context.player.id, evocationType);
          
          if (effectsResult.success) {
            socket.emit('activate-evocation-response', {
              success: true,
              message: 'Evocation activated successfully'
            });
            
            // Broadcast updated game state to all players
            broadcastGameState(context.roomId);
            
            // Broadcast evocation activation to all players
            io.to(context.roomId).emit('evocation-activated', {
              playerId: context.player.id,
              playerName: context.player.name,
              evocationId: data.evocationId,
              evocationType: evocationType
            });
            
            console.log(`Player ${context.player.name} activated evocation ${evocationType}`);
          } else {
            socket.emit('activate-evocation-response', {
              success: false,
              error: effectsResult.errors.join(', ') || 'Failed to execute evocation effects'
            });
          }
        } else {
          socket.emit('activate-evocation-response', {
            success: false,
            error: 'Failed to update game state'
          });
        }
      } else {
        socket.emit('activate-evocation-response', {
          success: false,
          error: result.error || 'Failed to activate evocation'
        });
      }
    } catch (error) {
      console.error('Error in activate-evocation:', error);
      socket.emit('activate-evocation-response', {
        success: false,
        error: 'An error occurred while activating the evocation'
      });
    }
  });

  // Activate intercession
  socket.on('activate-intercession', async (data: { intercessionId: string }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'activate-intercession', 2, 5000)) { // 2 per 5 seconds
        socket.emit('activate-intercession-response', {
          success: false,
          error: 'Please wait before activating another intercession'
        });
        return;
      }

      console.log('Activate intercession request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('activate-intercession-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data.intercessionId !== 'string' || data.intercessionId.length === 0) {
        socket.emit('activate-intercession-response', {
          success: false,
          error: 'Invalid intercession ID'
        });
        return;
      }

      // Execute the intercession through GameService (now async)
      const result = await gameService.executeIntercession(context.roomId, context.player.id, data.intercessionId, io);
      
      socket.emit('activate-intercession-response', {
        success: result.success,
        errors: result.errors,
        message: result.success ? 'Intercession activated successfully' : undefined
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Broadcast intercession activation to all players
        io.to(context.roomId).emit('intercession-activated', {
          playerId: context.player.id,
          playerName: context.player.name,
          intercessionId: data.intercessionId,
          intercessionType: result.intercessionType,
          intercessionName: getIntercessionName(result.intercessionType || '')
        });
        
        console.log(`Player ${context.player.name} activated intercession ${result.intercessionType}`);
        
        // Check if next player is AI and execute their move (especially important for Gabriel)
        setTimeout(() => {
          gameService.checkAndExecuteAITurn(context.roomId, io);
        }, 500);
      }
    } catch (error) {
      console.error('Error in activate-intercession:', error);
      socket.emit('activate-intercession-response', {
        success: false,
        error: 'An error occurred while activating the intercession'
      });
    }
  });

  // Helper function to get intercession name
  function getIntercessionName(type: string): string {
    const nameMap: Record<string, string> = {
      'MICHAEL': 'Judgement of Michael',
      'SAMAEL': 'Wrath of Samael',
      'RAPHAEL': 'Benediction of Raphael',
      'URIEL': 'Protection of Uriel',
      'GABRIEL': 'Insight of Gabriel',
      'METATRON': 'Intercession of Metatron'
    };
    return nameMap[type] || type;
  }

  // Execute power-up with parameters
  socket.on('execute-powerup', (data: { powerUpType: string; params: any }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'execute-powerup', 3, 5000)) { // 3 per 5 seconds
        socket.emit('execute-powerup-response', {
          success: false,
          error: 'Please wait before executing another power-up'
        });
        return;
      }

      console.log('Execute power-up request:', data);
      
      const context = getPlayerGameContext(socket.id);
      if (!context) {
        socket.emit('execute-powerup-response', {
          success: false,
          error: 'Not in an active game'
        });
        return;
      }

      // Validate input data
      if (!data || typeof data.powerUpType !== 'string' || data.powerUpType.length === 0) {
        socket.emit('execute-powerup-response', {
          success: false,
          error: 'Invalid power-up type'
        });
        return;
      }

      if (!data.params || typeof data.params !== 'object') {
        socket.emit('execute-powerup-response', {
          success: false,
          error: 'Invalid power-up parameters'
        });
        return;
      }

      // Check if it's the player's turn
      const currentPlayer = context.gameState.players[context.gameState.currentPlayerIndex];
      if (currentPlayer.id !== context.player.id) {
        socket.emit('execute-powerup-response', {
          success: false,
          error: 'Not your turn'
        });
        return;
      }

      const result = gameService.executePowerUp(context.roomId, context.player.id, data.powerUpType, data.params);
      
      socket.emit('execute-powerup-response', {
        success: result.success,
        errors: result.errors
      });
      
      if (result.success) {
        // Broadcast updated game state to all players
        broadcastGameState(context.roomId);
        
        // Notify all players about the power-up execution
        io.to(context.roomId).emit('powerup-executed', {
          playerId: context.player.id,
          playerName: context.player.name,
          powerUpType: data.powerUpType
        });
      }
    } catch (error) {
      console.error('Error in execute-powerup:', error);
      socket.emit('execute-powerup-response', {
        success: false,
        errors: ['An error occurred while executing the power-up']
      });
    }
  });
}
