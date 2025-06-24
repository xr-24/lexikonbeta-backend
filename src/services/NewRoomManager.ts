import type { Room, RoomPlayer, CreateRoomRequest, JoinRoomRequest, RoomInfo, SelectIntercessionsRequest } from '../types/room';
import { INTERCESSION_TYPES } from '../constants/intercessions';
import { gameService } from './GameService';
import { aiService } from './AIService';
import { DatabaseService } from './DatabaseService';

interface DisconnectedPlayer {
  player: RoomPlayer;
  disconnectedAt: Date;
  roomId: string;
}

export class NewRoomManager {
  private db: DatabaseService;
  private socketToPlayer: Map<string, { playerId: string; roomId: string }> = new Map(); // socketId -> player info
  private disconnectedPlayers: Map<string, DisconnectedPlayer> = new Map(); // playerId -> DisconnectedPlayer
  
  private readonly DISCONNECT_GRACE_PERIOD = 20 * 60 * 1000; // 20 minutes
  private readonly ROOM_CLEANUP_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.db = new DatabaseService();
    this.startCleanupTimer();
  }

  generateRoomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async createRoom(hostSocketId: string, request: CreateRoomRequest, ip?: string): Promise<{ success: boolean; room?: RoomInfo; error?: string }> {
    try {
      // Check if player is already in a room
      if (this.socketToPlayer.has(hostSocketId)) {
        return { success: false, error: 'Player is already in a room' };
      }

      let roomCode = this.generateRoomCode();
      
      // Ensure unique room code
      while (await this.db.getRoomByCode(roomCode)) {
        roomCode = this.generateRoomCode();
      }

      const hostPlayer: RoomPlayer = {
        id: `player-${Date.now()}-0`,
        name: request.playerName,
        socketId: hostSocketId,
        isHost: true,
        joinedAt: new Date(),
      };

      const roomData: Omit<Room, 'id'> = {
        code: roomCode,
        hostId: hostPlayer.id,
        players: [hostPlayer],
        isStarted: false,
        intercessionSelectionStarted: false,
        createdAt: new Date(),
        maxPlayers: 2, // HP mode only supports 2 players
      };

      const room = await this.db.createRoom(roomData);
      
      // Track socket to player mapping
      this.socketToPlayer.set(hostSocketId, { playerId: hostPlayer.id, roomId: room.id });

      // Create session if IP is provided
      if (ip) {
        await this.db.createPlayerSession(hostPlayer.id, room.id, ip);
      }

      console.log(`Room created: ${roomCode} by ${request.playerName}`);

      return {
        success: true,
        room: this.getRoomInfoFromRoom(room)
      };

    } catch (error) {
      console.error('Error creating room:', error);
      return { success: false, error: 'Failed to create room' };
    }
  }

  async joinRoom(playerSocketId: string, request: JoinRoomRequest, ip?: string): Promise<{ success: boolean; room?: RoomInfo; error?: string }> {
    try {
      console.log('🔍 NewRoomManager.joinRoom called with:', { playerSocketId, request });
      
      // Check if player is already in a room
      if (this.socketToPlayer.has(playerSocketId)) {
        console.log('❌ Player already in a room:', playerSocketId);
        return { success: false, error: 'Player is already in a room' };
      }

      const room = await this.db.getRoomByCode(request.roomCode);
      if (!room) {
        console.log('❌ Room not found for code:', request.roomCode);
        return { success: false, error: 'Room not found' };
      }

      console.log('🔍 Room found:', { id: room.id, code: room.code, playerCount: room.players.length });

      // Check if this is a reconnection attempt
      const disconnectedPlayer = Array.from(this.disconnectedPlayers.values())
        .find(dp => dp.roomId === room.id && dp.player.name === request.playerName);

      if (disconnectedPlayer) {
        // Reconnect existing player
        const player = disconnectedPlayer.player;
        
        // Update player's socket ID in the room data
        player.socketId = playerSocketId;
        
        // Remove from disconnected list
        this.disconnectedPlayers.delete(player.id);
        
        // Update socket mapping
        this.socketToPlayer.set(playerSocketId, { playerId: player.id, roomId: room.id });
        
        console.log(`Player ${request.playerName} reconnected to room ${request.roomCode}`);
        
        const updatedRoom = await this.db.getRoomById(room.id);
        return {
          success: true,
          room: this.getRoomInfoFromRoom(updatedRoom!)
        };
      }

      if (room.isStarted) {
        return { success: false, error: 'Game has already started' };
      }

      if (room.players.length >= room.maxPlayers) {
        return { success: false, error: 'Room is full' };
      }

      // Check if player name is already taken
      if (room.players.some(p => p.name === request.playerName)) {
        return { success: false, error: 'Player name is already taken' };
      }

      const newPlayer: RoomPlayer = {
        id: `player-${Date.now()}-${room.players.length}`,
        name: request.playerName,
        socketId: playerSocketId,
        isHost: false,
        joinedAt: new Date(),
      };

      await this.db.addPlayerToRoom(room.id, newPlayer);
      
      // Track socket to player mapping
      this.socketToPlayer.set(playerSocketId, { playerId: newPlayer.id, roomId: room.id });

      // Create session if IP is provided
      if (ip) {
        await this.db.createPlayerSession(newPlayer.id, room.id, ip);
      }

      console.log(`Player ${request.playerName} joined room ${request.roomCode}`);

      const updatedRoom = await this.db.getRoomById(room.id);
      return {
        success: true,
        room: this.getRoomInfoFromRoom(updatedRoom!)
      };

    } catch (error) {
      console.error('Error joining room:', error);
      return { success: false, error: 'Failed to join room' };
    }
  }

  async leaveRoom(playerSocketId: string): Promise<{ success: boolean; roomId?: string; wasHost?: boolean; error?: string }> {
    try {
      const playerInfo = this.socketToPlayer.get(playerSocketId);
      if (!playerInfo) {
        return { success: false, error: 'Player is not in a room' };
      }

      const room = await this.db.getRoomById(playerInfo.roomId);
      if (!room) {
        return { success: false, error: 'Room not found' };
      }

      const player = room.players.find(p => p.id === playerInfo.playerId);
      if (!player) {
        return { success: false, error: 'Player not found in room' };
      }

      const wasHost = player.isHost;

      // Remove player from database
      await this.db.removePlayerFromRoom(playerInfo.playerId);
      
      // Remove socket mapping
      this.socketToPlayer.delete(playerSocketId);

      console.log(`Player ${player.name} left room ${room.code}`);

      return {
        success: true,
        roomId: room.id,
        wasHost: wasHost
      };

    } catch (error) {
      console.error('Error leaving room:', error);
      return { success: false, error: 'Failed to leave room' };
    }
  }

  async handlePlayerDisconnect(socketId: string): Promise<{ roomId?: string; wasHost?: boolean; playerId?: string }> {
    try {
      const playerInfo = this.socketToPlayer.get(socketId);
      if (!playerInfo) return {};

      const room = await this.db.getRoomById(playerInfo.roomId);
      if (!room) return {};

      const player = room.players.find(p => p.id === playerInfo.playerId);
      if (!player) return {};

      // Player will be tracked in disconnectedPlayers Map

      // Track disconnected player for grace period
      this.disconnectedPlayers.set(playerInfo.playerId, {
        player: player,
        disconnectedAt: new Date(),
        roomId: room.id
      });

      // Remove socket mapping
      this.socketToPlayer.delete(socketId);

      console.log(`Player ${player.name} disconnected from room ${room.code}`);

      // Schedule cleanup after grace period
      setTimeout(async () => {
        await this.cleanupDisconnectedPlayer(playerInfo.playerId);
      }, this.DISCONNECT_GRACE_PERIOD);

      return {
        roomId: room.id,
        wasHost: player.isHost,
        playerId: player.id
      };

    } catch (error) {
      console.error('Error handling player disconnect:', error);
      return {};
    }
  }

  async startGame(hostSocketId: string): Promise<{ success: boolean; gameState?: any; error?: string; waitingForIntercessions?: boolean }> {
    try {
      const playerInfo = this.socketToPlayer.get(hostSocketId);
      if (!playerInfo) {
        return { success: false, error: 'Player not found' };
      }

      const room = await this.db.getRoomById(playerInfo.roomId);
      if (!room) {
        return { success: false, error: 'Room not found' };
      }

      const hostPlayer = room.players.find(p => p.id === playerInfo.playerId);
      if (!hostPlayer?.isHost) {
        return { success: false, error: 'Only the host can start the game' };
      }

      if (room.isStarted) {
        return { success: false, error: 'Game has already started' };
      }

      // Check if game can start (intercessions validation)
      const canStartResult = await this.canStartGame(playerInfo.roomId);
      console.log('🎯 Can start game result:', canStartResult);
      if (!canStartResult.canStart) {
        if (canStartResult.reason === 'Not all players have selected intercessions') {
          console.log('🎯 Setting intercession selection started flag');
          // Set intercession selection started flag
          await this.db.updateRoom(playerInfo.roomId, {
            intercessionSelectionStarted: true
          });
          return { success: false, waitingForIntercessions: true };
        }
        return { success: false, error: canStartResult.reason };
      }

      // Start the game
      const roomPlayers = room.players.map(p => ({ 
        id: p.id, 
        name: p.name, 
        color: p.color,
        isAI: p.isAI,
        aiPersonality: p.aiPersonality,
        selectedIntercessions: p.selectedIntercessions || []
      }));
      
      const gameState = gameService.initializeGame(playerInfo.roomId, roomPlayers);
      
      // Update room with game state
      await this.db.updateRoom(playerInfo.roomId, {
        isStarted: true,
        intercessionSelectionStarted: false,
        gameState: gameState
      });

      console.log(`Game started in room ${room.code} with ${room.players.length} players`);

      return {
        success: true,
        gameState: gameState
      };

    } catch (error) {
      console.error('Error starting game:', error);
      return { success: false, error: 'Failed to start game' };
    }
  }

  // Utility methods
  async getRoomBySocketId(socketId: string): Promise<Room | null> {
    const playerInfo = this.socketToPlayer.get(socketId);
    if (!playerInfo) return null;
    
    return await this.db.getRoomById(playerInfo.roomId);
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    return await this.db.getRoomByCode(code);
  }

  async getPlayerInRoom(socketId: string): Promise<{ room: Room; player: RoomPlayer } | null> {
    const room = await this.getRoomBySocketId(socketId);
    if (!room) return null;

    const playerInfo = this.socketToPlayer.get(socketId);
    if (!playerInfo) return null;

    const player = room.players.find(p => p.id === playerInfo.playerId);
    if (!player) return null;

    return { room, player };
  }

  // Session management methods
  async checkSessionByIP(ip: string): Promise<any> {
    return await this.db.findSessionByIP(ip);
  }

  async clearSession(ip: string): Promise<void> {
    // This would need to be implemented in DatabaseService
    // For now, we'll just log it
    console.log(`Clearing session for IP: ${ip}`);
  }

  private async cleanupDisconnectedPlayer(playerId: string): Promise<void> {
    try {
      const disconnectedPlayer = this.disconnectedPlayers.get(playerId);
      if (!disconnectedPlayer) return;

      const room = await this.db.getRoomById(disconnectedPlayer.roomId);
      if (!room) return;

      const player = room.players.find(p => p.id === playerId);
      if (!player) return; // Player not found or already removed

      // Remove player permanently
      await this.db.removePlayerFromRoom(playerId);
      this.disconnectedPlayers.delete(playerId);
      
      console.log(`Cleaned up disconnected player: ${player.name}`);

    } catch (error) {
      console.error('Error cleaning up disconnected player:', error);
    }
  }

  // Public method to get room info by room ID
  async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    const room = await this.db.getRoomById(roomId);
    if (!room) return null;
    return this.getRoomInfoFromRoom(room);
  }

  // Update player color
  async updatePlayerColor(socketId: string, color: string): Promise<{ success: boolean; room?: RoomInfo; error?: string }> {
    try {
      const playerInRoom = await this.getPlayerInRoom(socketId);
      if (!playerInRoom) {
        return { success: false, error: 'Player not found in any room' };
      }

      // Update player color in database
      await this.db.updatePlayerColor(playerInRoom.player.id, color);
      
      // Get updated room
      const updatedRoom = await this.db.getRoomById(playerInRoom.room.id);
      if (!updatedRoom) {
        return { success: false, error: 'Room not found after update' };
      }

      return {
        success: true,
        room: this.getRoomInfoFromRoom(updatedRoom)
      };

    } catch (error) {
      console.error('Error updating player color:', error);
      return { success: false, error: 'Failed to update player color' };
    }
  }

  // Add AI player (host only)
  async addAIPlayer(hostSocketId: string): Promise<{ success: boolean; room?: RoomInfo; error?: string }> {
    try {
      const playerInRoom = await this.getPlayerInRoom(hostSocketId);
      if (!playerInRoom) {
        return { success: false, error: 'Player not found in any room' };
      }

      if (!playerInRoom.player.isHost) {
        return { success: false, error: 'Only the host can add AI players' };
      }

      if (playerInRoom.room.players.length >= playerInRoom.room.maxPlayers) {
        return { success: false, error: 'Room is full' };
      }

      if (playerInRoom.room.isStarted) {
        return { success: false, error: 'Cannot add AI player after game has started' };
      }

      const aiPlayer: RoomPlayer = {
        id: `ai-${Date.now()}-${playerInRoom.room.players.length}`,
        name: `AI Player ${playerInRoom.room.players.length}`,
        socketId: undefined,
        isHost: false,
        isAI: true,
        aiPersonality: 'balanced',
        joinedAt: new Date(),
      };

      await this.db.addPlayerToRoom(playerInRoom.room.id, aiPlayer);
      
      const updatedRoom = await this.db.getRoomById(playerInRoom.room.id);
      if (!updatedRoom) {
        return { success: false, error: 'Room not found after update' };
      }

      return {
        success: true,
        room: this.getRoomInfoFromRoom(updatedRoom)
      };

    } catch (error) {
      console.error('Error adding AI player:', error);
      return { success: false, error: 'Failed to add AI player' };
    }
  }

  // Remove AI player (host only)
  async removeAIPlayer(hostSocketId: string, aiPlayerId: string): Promise<{ success: boolean; room?: RoomInfo; error?: string }> {
    try {
      const playerInRoom = await this.getPlayerInRoom(hostSocketId);
      if (!playerInRoom) {
        return { success: false, error: 'Player not found in any room' };
      }

      if (!playerInRoom.player.isHost) {
        return { success: false, error: 'Only the host can remove AI players' };
      }

      if (playerInRoom.room.isStarted) {
        return { success: false, error: 'Cannot remove AI player after game has started' };
      }

      const aiPlayer = playerInRoom.room.players.find(p => p.id === aiPlayerId && p.isAI);
      if (!aiPlayer) {
        return { success: false, error: 'AI player not found' };
      }

      await this.db.removePlayerFromRoom(aiPlayerId);
      
      const updatedRoom = await this.db.getRoomById(playerInRoom.room.id);
      if (!updatedRoom) {
        return { success: false, error: 'Room not found after update' };
      }

      return {
        success: true,
        room: this.getRoomInfoFromRoom(updatedRoom)
      };

    } catch (error) {
      console.error('Error removing AI player:', error);
      return { success: false, error: 'Failed to remove AI player' };
    }
  }

  // Select intercessions
  async selectIntercessions(playerSocketId: string, request: SelectIntercessionsRequest): Promise<{ success: boolean; room?: RoomInfo; error?: string; gameState?: any }> {
    try {
      const playerInRoom = await this.getPlayerInRoom(playerSocketId);
      if (!playerInRoom) {
        return { success: false, error: 'Player not found in any room' };
      }

      // Update player's selected intercessions
      await this.db.updatePlayerIntercessions(playerInRoom.player.id, request.intercessionTypes);
      
      const updatedRoom = await this.db.getRoomById(playerInRoom.room.id);
      if (!updatedRoom) {
        return { success: false, error: 'Room not found after update' };
      }

      // Check if all players have selected intercessions
      const allPlayersSelected = updatedRoom.players.every(p => 
        p.isAI || (p.selectedIntercessions && p.selectedIntercessions.length > 0)
      );

      if (allPlayersSelected && updatedRoom.players.length >= 2) {
        // Start the game
        const gameState = gameService.initializeGame(updatedRoom.id, updatedRoom.players);
        
        await this.db.updateRoom(updatedRoom.id, {
          isStarted: true,
          gameState: gameState
        });

        return {
          success: true,
          room: this.getRoomInfoFromRoom(updatedRoom),
          gameState: gameState
        };
      }

      return {
        success: true,
        room: this.getRoomInfoFromRoom(updatedRoom)
      };

    } catch (error) {
      console.error('Error selecting intercessions:', error);
      return { success: false, error: 'Failed to select intercessions' };
    }
  }

  // Check if game can start
  async canStartGame(roomId: string): Promise<{ canStart: boolean; reason?: string }> {
    try {
      const room = await this.db.getRoomById(roomId);
      if (!room) {
        return { canStart: false, reason: 'Room not found' };
      }

      if (room.isStarted) {
        return { canStart: false, reason: 'Game already started' };
      }

      if (room.players.length < 2) {
        return { canStart: false, reason: 'Need at least 2 players' };
      }

      console.log('🎯 Checking player intercessions:', room.players.map(p => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        selectedIntercessions: p.selectedIntercessions,
        hasSelected: p.selectedIntercessions && p.selectedIntercessions.length > 0
      })));

      const allPlayersSelected = room.players.every(p => 
        p.isAI || (p.selectedIntercessions && p.selectedIntercessions.length > 0)
      );

      console.log('🎯 All players selected intercessions:', allPlayersSelected);

      if (!allPlayersSelected) {
        return { canStart: false, reason: 'Not all players have selected intercessions' };
      }

      return { canStart: true };

    } catch (error) {
      console.error('Error checking if game can start:', error);
      return { canStart: false, reason: 'Error checking game state' };
    }
  }

  private getRoomInfoFromRoom(room: Room): RoomInfo {
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      players: room.players.map(p => ({
        ...p,
        hasSelectedIntercessions: (p.selectedIntercessions?.length || 0) > 0
      })),
      isStarted: room.isStarted,
      intercessionSelectionStarted: room.intercessionSelectionStarted,
      maxPlayers: room.maxPlayers
    };
  }

  private startCleanupTimer(): void {
    // Clean up expired rooms every 10 minutes
    setInterval(async () => {
      try {
        await this.db.cleanupExpiredRooms();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }, 10 * 60 * 1000);
  }

  async getAllRooms(): Promise<Room[]> {
    // This would require a new method in DatabaseService
    // For now, return empty array
    return [];
  }

  async shutdown(): Promise<void> {
    await this.db.close();
  }
} 