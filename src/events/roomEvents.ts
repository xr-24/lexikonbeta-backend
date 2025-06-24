import { Socket, Server } from 'socket.io';
import { roomManager } from '../services/roomManagerInstance';
import { gameService } from '../services/GameService';
import { ValidationUtils, RateLimiter } from '../services/validation';
import type { CreateRoomRequest, JoinRoomRequest, SelectIntercessionsRequest } from '../types/room';

export function registerRoomEvents(socket: Socket, io: Server) {
  // Check for existing session
  socket.on('check-session', async () => {
    try {
      const clientIP = socket.handshake.address;
      console.log('Session check request from IP:', clientIP);
      
      const session = await roomManager.checkSessionByIP(clientIP);
      
      if (session) {
        console.log('🔍 Session data retrieved:', session);
        socket.emit('session-found', {
          success: true,
          session: {
            roomCode: session.room_code || session.roomCode,
            playerName: session.player_name || session.playerName,
            playerId: session.player_id || session.playerId
          }
        });
        console.log(`Session found for IP ${clientIP}: ${session.player_name || session.playerName} in room ${session.room_code || session.roomCode}`);
      } else {
        socket.emit('session-found', {
          success: false,
          message: 'No active session found'
        });
      }
    } catch (error) {
      console.error('Error in check-session:', error);
      socket.emit('session-found', {
        success: false,
        error: 'An error occurred while checking session'
      });
    }
  });

  // Clear session (when player chooses to leave permanently)
  socket.on('clear-session', async () => {
    try {
      const clientIP = socket.handshake.address;
      await roomManager.clearSession(clientIP);
      
      socket.emit('session-cleared', {
        success: true
      });
      
      console.log(`Session cleared for IP ${clientIP}`);
    } catch (error) {
      console.error('Error in clear-session:', error);
      socket.emit('session-cleared', {
        success: false,
        error: 'An error occurred while clearing session'
      });
    }
  });

  // Create a new room
  socket.on('create-room', async (data: CreateRoomRequest) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'create-room', 1, 10000)) { // 1 per 10 seconds
        socket.emit('room-created', {
          success: false,
          error: 'Please wait before creating another room'
        });
        return;
      }

      console.log('Create room request:', data);
      
      // Validate input
      if (!data || typeof data !== 'object') {
        socket.emit('room-created', {
          success: false,
          error: 'Invalid request data'
        });
        return;
      }

      const nameValidation = ValidationUtils.validatePlayerName(data.playerName);
      if (!nameValidation.isValid) {
        socket.emit('room-created', {
          success: false,
          error: nameValidation.errors[0] || 'Invalid player name'
        });
        return;
      }

      // Use sanitized name
      const sanitizedData: CreateRoomRequest = {
        playerName: nameValidation.sanitized
      };
      
      const clientIP = socket.handshake.address;
      const result = await roomManager.createRoom(socket.id, sanitizedData, clientIP);
      
      if (result.success && result.room) {
        // Join the socket to the room
        socket.join(result.room.id);
        
        // Send success response to the creator
        socket.emit('room-created', {
          success: true,
          room: result.room
        });
        
        // Broadcast room update to all players in the room
        io.to(result.room.id).emit('room-updated', result.room);
        
        console.log(`Room ${result.room.code} created successfully`);
      } else {
        socket.emit('room-created', {
          success: false,
          error: result.error || 'Failed to create room'
        });
      }
    } catch (error) {
      console.error('Error in create-room:', error);
      socket.emit('room-created', {
        success: false,
        error: 'An error occurred while creating the room'
      });
    }
  });

  // Join an existing room
  socket.on('join-room', async (data: JoinRoomRequest) => {
    try {
      console.log('🔍 Join room request received:', { socketId: socket.id, data });
      
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'join-room', 3, 10000)) { // 3 per 10 seconds
        console.log('❌ Rate limit exceeded for join-room:', socket.id);
        socket.emit('room-joined', {
          success: false,
          error: 'Please wait before trying to join again'
        });
        return;
      }

      // Validate input
      if (!data || typeof data !== 'object') {
        console.log('❌ Invalid request data for join-room:', data);
        socket.emit('room-joined', {
          success: false,
          error: 'Invalid request data'
        });
        return;
      }

      console.log('🔍 Validating player name and room code...');
      const nameValidation = ValidationUtils.validatePlayerName(data.playerName);
      const codeValidation = ValidationUtils.validateRoomCode(data.roomCode);

      if (!nameValidation.isValid) {
        console.log('❌ Invalid player name:', nameValidation.errors);
        socket.emit('room-joined', {
          success: false,
          error: nameValidation.errors[0] || 'Invalid player name'
        });
        return;
      }

      if (!codeValidation.isValid) {
        console.log('❌ Invalid room code:', codeValidation.errors);
        socket.emit('room-joined', {
          success: false,
          error: codeValidation.errors[0] || 'Invalid room code'
        });
        return;
      }

      // Use sanitized data
      const sanitizedData: JoinRoomRequest = {
        roomCode: codeValidation.sanitized,
        playerName: nameValidation.sanitized
      };
      
      console.log('🔍 Attempting to join room with sanitized data:', sanitizedData);
      const clientIP = socket.handshake.address;
      const result = await roomManager.joinRoom(socket.id, sanitizedData, clientIP);
      console.log('🔍 Room join result:', { success: result.success, error: result.error });
      
      if (result.success && result.room) {
        console.log('✅ Room join successful, joining socket to room:', result.room.id);
        console.log('🔄 Room join result details:', { 
          roomCode: result.room.code, 
          playerCount: result.room.players.length,
          isStarted: result.room.isStarted,
          intercessionSelectionStarted: result.room.intercessionSelectionStarted
        });
        
        // Join the socket to the room
        socket.join(result.room.id);
        
        // Send success response to the joiner
        socket.emit('room-joined', {
          success: true,
          room: result.room
        });
        
        // Broadcast room update to all players in the room
        io.to(result.room.id).emit('room-updated', result.room);
        
        // Notify other players that someone joined
        socket.to(result.room.id).emit('player-joined', {
          playerName: sanitizedData.playerName,
          room: result.room
        });
        
        console.log(`✅ Player ${sanitizedData.playerName} successfully joined room ${sanitizedData.roomCode}`);
      } else {
        console.log('❌ Room join failed:', result.error);
        socket.emit('room-joined', {
          success: false,
          error: result.error || 'Failed to join room'
        });
      }
    } catch (error) {
      console.error('💥 Critical error in join-room:', error);
      socket.emit('room-joined', {
        success: false,
        error: 'An error occurred while joining the room'
      });
    }
  });

  // Leave room
  socket.on('leave-room', async () => {
    try {
      console.log('Leave room request from:', socket.id);
      
      const result = await roomManager.leaveRoom(socket.id);
      
      if (result.success && result.roomId) {
        // Leave the socket room
        socket.leave(result.roomId);
        
        // Send confirmation to the leaving player
        socket.emit('room-left', {
          success: true
        });
        
        // Get updated room info and broadcast to remaining players
        const roomInfo = await roomManager.getRoomInfo(result.roomId);
        if (roomInfo) {
          io.to(result.roomId).emit('room-updated', roomInfo);
          
          // Notify remaining players that someone left
          socket.to(result.roomId).emit('player-left', {
            wasHost: result.wasHost,
            room: roomInfo
          });
        }
        
        console.log(`Player left room ${result.roomId}`);
      } else {
        socket.emit('room-left', {
          success: false,
          error: result.error || 'Failed to leave room'
        });
      }
    } catch (error) {
      console.error('Error in leave-room:', error);
      socket.emit('room-left', {
        success: false,
        error: 'An error occurred while leaving the room'
      });
    }
  });

  // Start game (host only)
  socket.on('start-game', async () => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'start-game', 1, 5000)) { // 1 per 5 seconds
        socket.emit('game-started', {
          success: false,
          error: 'Please wait before starting the game'
        });
        return;
      }

      console.log('Start game request from:', socket.id);
      
      const result = await roomManager.startGame(socket.id);

      if (result.success && result.gameState) {
        const playerInRoom = await roomManager.getPlayerInRoom(socket.id);

        if (playerInRoom) {
          // Broadcast game start to all players in the room
          io.to(playerInRoom.room.id).emit('game-started', {
            success: true,
            gameState: result.gameState,
            tilePullResult: result.gameState.tilePullResult
          });

          // Check if first player is AI and execute their move with io instance
          gameService.checkAndExecuteAITurn(playerInRoom.room.id, io);

          console.log(`Game started in room ${playerInRoom.room.code}`);
        }
      } else if (result.waitingForIntercessions) {
        const playerInRoom = await roomManager.getPlayerInRoom(socket.id);
        if (playerInRoom) {
          io.to(playerInRoom.room.id).emit('intercession-selection-start');
        }
        socket.emit('game-started', {
          success: false,
          waitingForIntercessions: true
        });
      } else {
        socket.emit('game-started', {
          success: false,
          error: result.error || 'Failed to start game'
        });
      }
    } catch (error) {
      console.error('Error in start-game:', error);
      socket.emit('game-started', {
        success: false,
        error: 'An error occurred while starting the game'
      });
    }
  });

  // Get current room info
  socket.on('get-room-info', async () => {
    try {
      const playerInRoom = await roomManager.getPlayerInRoom(socket.id);
      
      if (playerInRoom) {
        const roomInfo = await roomManager.getRoomInfo(playerInRoom.room.id);
        socket.emit('room-info', {
          success: true,
          room: roomInfo
        });
      } else {
        socket.emit('room-info', {
          success: false,
          error: 'Not in a room'
        });
      }
    } catch (error) {
      console.error('Error in get-room-info:', error);
      socket.emit('room-info', {
        success: false,
        error: 'An error occurred while getting room info'
      });
    }
  });

  // Update player color
  socket.on('update-player-color', async (data: { color: string }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'update-color', 3, 5000)) { // 3 per 5 seconds
        socket.emit('room-error', {
          message: 'Please wait before changing color again'
        });
        return;
      }

      console.log('Update player color from:', socket.id, data);
      
      // Validate input
      if (!data || typeof data !== 'object') {
        socket.emit('room-error', {
          message: 'Invalid color data'
        });
        return;
      }

      // Basic color validation
      const playerColor = typeof data.color === 'string' && 
                         /^#[0-9A-Fa-f]{6}$/.test(data.color) 
                         ? data.color 
                         : '#DC143C';
      
      const result = await roomManager.updatePlayerColor(socket.id, playerColor);
      
      if (result.success && result.room) {
        // If game is started, also update the game state
        if (result.room.isStarted) {
          const playerInRoom = await roomManager.getPlayerInRoom(socket.id);
          if (playerInRoom) {
            const gameResult = gameService.updatePlayerColor(
              result.room.id, 
              playerInRoom.player.id, 
              playerColor
            );
            
            if (gameResult.success) {
              // Broadcast updated game state to all players
              const gameState = gameService.getGameState(result.room.id);
              if (gameState) {
                io.to(result.room.id).emit('game-state-update', gameState);
              }
            }
          }
        }
        
        // Broadcast room update to all players in the room
        io.to(result.room.id).emit('room-updated', result.room);
        
        console.log(`Player color updated in room ${result.room.code}`);
      } else {
        socket.emit('room-error', {
          message: result.error || 'Failed to update color'
        });
      }
    } catch (error) {
      console.error('Error in update-player-color:', error);
      socket.emit('room-error', {
        message: 'An error occurred while updating color'
      });
    }
  });

  // Add AI player (host only)
  socket.on('add-ai-player', async () => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'add-ai', 2, 5000)) { // 2 per 5 seconds
        socket.emit('ai-player-added', {
          success: false,
          error: 'Please wait before adding another AI player'
        });
        return;
      }

      console.log('Add AI player request from:', socket.id);
      
      const result = await roomManager.addAIPlayer(socket.id);
      
      if (result.success && result.room) {
        // Broadcast room update to all players in the room
        io.to(result.room.id).emit('room-updated', result.room);
        
        // Send success response to the host
        socket.emit('ai-player-added', {
          success: true,
          room: result.room
        });
        
        console.log(`AI player added to room ${result.room.code}`);
      } else {
        socket.emit('ai-player-added', {
          success: false,
          error: result.error || 'Failed to add AI player'
        });
      }
    } catch (error) {
      console.error('Error in add-ai-player:', error);
      socket.emit('ai-player-added', {
        success: false,
        error: 'An error occurred while adding AI player'
      });
    }
  });

  // Remove AI player (host only)
  socket.on('remove-ai-player', async (data: { aiPlayerId: string }) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'remove-ai', 3, 5000)) { // 3 per 5 seconds
        socket.emit('ai-player-removed', {
          success: false,
          error: 'Please wait before removing another AI player'
        });
        return;
      }

      console.log('Remove AI player request from:', socket.id, data);
      
      // Validate input
      if (!data || typeof data !== 'object' || typeof data.aiPlayerId !== 'string') {
        socket.emit('ai-player-removed', {
          success: false,
          error: 'Invalid AI player ID'
        });
        return;
      }
      
      const result = await roomManager.removeAIPlayer(socket.id, data.aiPlayerId);
      
      if (result.success && result.room) {
        // Broadcast room update to all players in the room
        io.to(result.room.id).emit('room-updated', result.room);
        
        // Send success response to the host
        socket.emit('ai-player-removed', {
          success: true,
          room: result.room
        });
        
        console.log(`AI player removed from room ${result.room.code}`);
      } else {
        socket.emit('ai-player-removed', {
          success: false,
          error: result.error || 'Failed to remove AI player'
        });
      }
    } catch (error) {
      console.error('Error in remove-ai-player:', error);
      socket.emit('ai-player-removed', {
        success: false,
        error: 'An error occurred while removing AI player'
      });
    }
  });

  // Select intercessions
  socket.on('select-intercessions', async (data: SelectIntercessionsRequest) => {
    try {
      // Rate limiting
      if (!RateLimiter.checkLimit(socket.id, 'select-intercessions', 2, 5000)) { // 2 per 5 seconds
        socket.emit('intercessions-selected', {
          success: false,
          error: 'Please wait before changing intercessions again'
        });
        return;
      }

      console.log('Select intercessions request from:', socket.id, data);
      
      // Validate input
      if (!data || typeof data !== 'object') {
        socket.emit('intercessions-selected', {
          success: false,
          error: 'Invalid intercession data'
        });
        return;
      }

      if (!Array.isArray(data.intercessionTypes)) {
        socket.emit('intercessions-selected', {
          success: false,
          error: 'Intercession types must be an array'
        });
        return;
      }

      // Validate each intercession type is a string
      if (!data.intercessionTypes.every(type => typeof type === 'string')) {
        socket.emit('intercessions-selected', {
          success: false,
          error: 'All intercession types must be strings'
        });
        return;
      }
      
      const result = await roomManager.selectIntercessions(socket.id, data);

      if (result.success && result.room) {
        // Send success response to the player
        socket.emit('intercessions-selected', {
          success: true,
          room: result.room
        });
        
        // Broadcast room update to all players in the room
        io.to(result.room.id).emit('room-updated', result.room);
        
        if (result.gameState) {
          io.to(result.room.id).emit('game-started', {
            success: true,
            gameState: result.gameState,
            tilePullResult: result.gameState.tilePullResult
          });
          gameService.checkAndExecuteAITurn(result.room.id, io);
        } else {
          // Check if all players have selected intercessions and notify
          const canStartResult = await roomManager.canStartGame(result.room.id);
          if (canStartResult.canStart) {
            io.to(result.room.id).emit('ready-to-start', {
              message: 'All players have selected intercessions. Ready to start!'
            });
          }

          console.log(`Player selected intercessions in room ${result.room.code}`);
        }
      } else {
        socket.emit('intercessions-selected', {
          success: false,
          error: result.error || 'Failed to select intercessions'
        });
      }
    } catch (error) {
      console.error('Error in select-intercessions:', error);
      socket.emit('intercessions-selected', {
        success: false,
        error: 'An error occurred while selecting intercessions'
      });
    }
  });

  // Send chat message
  socket.on('send-chat-message', async (data: { message: string; playerColor?: string }) => {
    try {
      // Rate limiting for chat
      if (!RateLimiter.checkLimit(socket.id, 'chat', 5, 5000)) { // 5 messages per 5 seconds
        socket.emit('room-error', {
          message: 'Please slow down your messages'
        });
        return;
      }

      console.log('Chat message from:', socket.id, data);
      
      // Validate input
      if (!data || typeof data !== 'object') {
        socket.emit('room-error', {
          message: 'Invalid message data'
        });
        return;
      }

      const messageValidation = ValidationUtils.validateChatMessage(data.message);
      if (!messageValidation.isValid) {
        socket.emit('room-error', {
          message: messageValidation.errors[0] || 'Invalid message'
        });
        return;
      }
      
      const playerInRoom = await roomManager.getPlayerInRoom(socket.id);
      
      if (playerInRoom) {
        // Use stored player color or provided color as fallback
        const playerColor = playerInRoom.player.color || 
                           (typeof data.playerColor === 'string' && 
                            /^#[0-9A-Fa-f]{6}$/.test(data.playerColor) 
                            ? data.playerColor 
                            : '#DC143C');

        // Update player color if provided and different from stored
        if (data.playerColor && data.playerColor !== playerInRoom.player.color) {
          await roomManager.updatePlayerColor(socket.id, data.playerColor);
        }
        
        const chatMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          playerId: playerInRoom.player.id,
          playerName: playerInRoom.player.name,
          playerColor: playerColor,
          message: messageValidation.sanitized,
          timestamp: new Date().toISOString(),
        };
        
        // Broadcast chat message to all players in the room
        io.to(playerInRoom.room.id).emit('chat-message', chatMessage);
        
        console.log(`Chat message sent in room ${playerInRoom.room.code}: ${messageValidation.sanitized}`);
      } else {
        socket.emit('room-error', {
          message: 'Not in a room'
        });
      }
    } catch (error) {
      console.error('Error in send-chat-message:', error);
      socket.emit('room-error', {
        message: 'An error occurred while sending the message'
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    try {
      console.log('Player disconnected:', socket.id);
      
      const result = await roomManager.handlePlayerDisconnect(socket.id);
      
      if (result.roomId) {
        // Get updated room info and broadcast to remaining players
        const roomInfo = await roomManager.getRoomInfo(result.roomId);
        if (roomInfo) {
          io.to(result.roomId).emit('room-updated', roomInfo);
          
          // Notify remaining players that someone disconnected
          socket.to(result.roomId).emit('player-disconnected', {
            wasHost: result.wasHost,
            room: roomInfo
          });
        }
        
        console.log(`Player disconnected from room ${result.roomId}`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
}
