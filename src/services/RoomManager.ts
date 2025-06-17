import type { Room, RoomPlayer, CreateRoomRequest, JoinRoomRequest, RoomInfo, SelectIntercessionsRequest } from '../types/room';
import { INTERCESSION_TYPES } from '../constants/intercessions';
import { gameService } from './GameService';
import { aiService } from './AIService';

interface DisconnectedPlayer {
  player: RoomPlayer;
  disconnectedAt: Date;
  roomId: string;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private roomsByCode: Map<string, string> = new Map(); // code -> roomId
  private playerRooms: Map<string, string> = new Map(); // socketId -> roomId
  private disconnectedPlayers: Map<string, DisconnectedPlayer> = new Map(); // playerId -> DisconnectedPlayer
  
  private readonly DISCONNECT_GRACE_PERIOD = 20 * 60 * 1000; // 20 minutes
  private readonly ROOM_CLEANUP_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  generateRoomCode(): string {
    // Generate a 6-digit room code
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  createRoom(hostSocketId: string, request: CreateRoomRequest): { success: boolean; room?: RoomInfo; error?: string } {
    // Check if player is already in a room
    if (this.playerRooms.has(hostSocketId)) {
      return { success: false, error: 'Player is already in a room' };
    }

    const roomId = `room-${Date.now()}-${Math.random()}`;
    let roomCode = this.generateRoomCode();
    
    // Ensure unique room code
    while (this.roomsByCode.has(roomCode)) {
      roomCode = this.generateRoomCode();
    }

    const hostPlayer: RoomPlayer = {
      id: `player-0`,
      name: request.playerName,
      socketId: hostSocketId,
      isHost: true,
      joinedAt: new Date(),
    };

    const room: Room = {
      id: roomId,
      code: roomCode,
      hostId: hostPlayer.id,
      players: [hostPlayer],
      isStarted: false,
      createdAt: new Date(),
      maxPlayers: 2, // HP mode only supports 2 players
    };

    this.rooms.set(roomId, room);
    this.roomsByCode.set(roomCode, roomId);
    this.playerRooms.set(hostSocketId, roomId);

    console.log(`Room created: ${roomCode} by ${request.playerName}`);

    return {
      success: true,
      room: this.getRoomInfo(roomId)!
    };
  }

  joinRoom(playerSocketId: string, request: JoinRoomRequest): { success: boolean; room?: RoomInfo; error?: string } {
    // Check if player is already in a room
    if (this.playerRooms.has(playerSocketId)) {
      return { success: false, error: 'Player is already in a room' };
    }

    const roomId = this.roomsByCode.get(request.roomCode);
    if (!roomId) {
      return { success: false, error: 'Room not found' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // Check if this is a reconnection attempt
    const disconnectedPlayer = Array.from(this.disconnectedPlayers.values())
      .find(dp => dp.roomId === roomId && dp.player.name === request.playerName);

    if (disconnectedPlayer) {
      // Reconnect existing player
      const player = disconnectedPlayer.player;
      player.socketId = playerSocketId;
      
      // Remove from disconnected list
      this.disconnectedPlayers.delete(player.id);
      
      // Add back to room if not already there
      if (!room.players.find(p => p.id === player.id)) {
        room.players.push(player);
      } else {
        // Update existing player's socket ID
        const existingPlayer = room.players.find(p => p.id === player.id);
        if (existingPlayer) {
          existingPlayer.socketId = playerSocketId;
        }
      }
      
      this.playerRooms.set(playerSocketId, roomId);
      
      console.log(`Player ${request.playerName} reconnected to room ${request.roomCode}`);
      
      return {
        success: true,
        room: this.getRoomInfo(roomId)!
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
      id: `player-${room.players.length}`,
      name: request.playerName,
      socketId: playerSocketId,
      isHost: false,
      joinedAt: new Date(),
    };

    room.players.push(newPlayer);
    this.playerRooms.set(playerSocketId, roomId);

    console.log(`Player ${request.playerName} joined room ${request.roomCode}`);

    return {
      success: true,
      room: this.getRoomInfo(roomId)!
    };
  }

  leaveRoom(playerSocketId: string): { success: boolean; roomId?: string; wasHost?: boolean; error?: string } {
    const roomId = this.playerRooms.get(playerSocketId);
    if (!roomId) {
      return { success: false, error: 'Player is not in a room' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const playerIndex = room.players.findIndex(p => p.socketId === playerSocketId);
    if (playerIndex === -1) {
      return { success: false, error: 'Player not found in room' };
    }

    const player = room.players[playerIndex];
    const wasHost = player.isHost;

    // Remove player from room
    room.players.splice(playerIndex, 1);
    this.playerRooms.delete(playerSocketId);

    console.log(`Player ${player.name} left room ${room.code}`);

    // If room is empty, start cleanup timer instead of immediate deletion
    if (room.players.length === 0) {
      this.scheduleRoomCleanup(roomId);
    } else if (wasHost && !room.isStarted) {
      // Transfer host to next player if game hasn't started
      room.players[0].isHost = true;
      room.hostId = room.players[0].id;
      console.log(`Host transferred to ${room.players[0].name} in room ${room.code}`);
    }

    return { success: true, roomId, wasHost };
  }

  // Handle disconnect with grace period
  handlePlayerDisconnect(socketId: string): { roomId?: string; wasHost?: boolean; playerId?: string } {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) {
      return {};
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return {};
    }

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) {
      return {};
    }

    // If game hasn't started, remove immediately
    if (!room.isStarted) {
      return this.leaveRoom(socketId);
    }

    // If game is active, add to disconnected players with grace period
    this.disconnectedPlayers.set(player.id, {
      player: { ...player },
      disconnectedAt: new Date(),
      roomId
    });

    // Don't remove from room immediately, just update socket tracking
    this.playerRooms.delete(socketId);
    
    // Schedule cleanup of disconnected player
    setTimeout(() => {
      this.cleanupDisconnectedPlayer(player.id);
    }, this.DISCONNECT_GRACE_PERIOD);

    console.log(`Player ${player.name} disconnected from room ${room.code} (grace period active)`);

    return { 
      roomId, 
      wasHost: player.isHost,
      playerId: player.id
    };
  }

  private cleanupDisconnectedPlayer(playerId: string): void {
    const disconnectedPlayer = this.disconnectedPlayers.get(playerId);
    if (!disconnectedPlayer) {
      return; // Already reconnected
    }

    const room = this.rooms.get(disconnectedPlayer.roomId);
    if (!room) {
      this.disconnectedPlayers.delete(playerId);
      return;
    }

    // Remove player from room
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      const player = room.players[playerIndex];
      room.players.splice(playerIndex, 1);
      
      console.log(`Player ${player.name} permanently removed from room ${room.code} (grace period expired)`);
      
      // If was host, transfer to next player
      if (player.isHost && room.players.length > 0 && !room.isStarted) {
        room.players[0].isHost = true;
        room.hostId = room.players[0].id;
      }
    }

    this.disconnectedPlayers.delete(playerId);

    // If room is now empty, schedule cleanup
    if (room.players.length === 0) {
      this.scheduleRoomCleanup(disconnectedPlayer.roomId);
    }
  }

  private scheduleRoomCleanup(roomId: string): void {
    setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (room && room.players.length === 0) {
        this.rooms.delete(roomId);
        this.roomsByCode.delete(room.code);
        
        // Clean up game if it exists
        if (room.gameState) {
          gameService.removeGame(roomId);
        }
        
        console.log(`Room ${room.code} deleted after cleanup timeout`);
      }
    }, this.ROOM_CLEANUP_TIMEOUT);
  }

  startGame(hostSocketId: string): { success: boolean; gameState?: any; error?: string } {
    const roomId = this.playerRooms.get(hostSocketId);
    if (!roomId) {
      return { success: false, error: 'Player is not in a room' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const hostPlayer = room.players.find(p => p.socketId === hostSocketId);
    if (!hostPlayer || !hostPlayer.isHost) {
      return { success: false, error: 'Only the host can start the game' };
    }

    if (room.isStarted) {
      return { success: false, error: 'Game has already started' };
    }

    // Use the new validation method
    const canStartResult = this.canStartGame(roomId);
    if (!canStartResult.canStart) {
      return { success: false, error: canStartResult.reason };
    }

    // Start the game
    room.isStarted = true;
    const roomPlayers = room.players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      color: p.color,
      isAI: p.isAI,
      aiPersonality: p.aiPersonality,
      selectedIntercessions: p.selectedIntercessions || []
    }));
    const gameState = gameService.initializeGame(roomId, roomPlayers);
    room.gameState = gameState;

    console.log(`Game started in room ${room.code} with ${room.players.length} players`);

    return { success: true, gameState };
  }

  getRoomInfo(roomId: string): RoomInfo | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      players: room.players,
      isStarted: room.isStarted,
      maxPlayers: room.maxPlayers,
    };
  }

  getRoomBySocketId(socketId: string): Room | null {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) {
      return null;
    }
    return this.rooms.get(roomId) || null;
  }

  getRoomByCode(code: string): Room | null {
    const roomId = this.roomsByCode.get(code);
    if (!roomId) {
      return null;
    }
    return this.rooms.get(roomId) || null;
  }

  getPlayerInRoom(socketId: string): { room: Room; player: RoomPlayer } | null {
    const room = this.getRoomBySocketId(socketId);
    if (!room) {
      return null;
    }

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) {
      return null;
    }

    return { room, player };
  }

  updatePlayerColor(socketId: string, color: string): { success: boolean; room?: RoomInfo; error?: string } {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) {
      return { success: false, error: 'Player is not in a room' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) {
      return { success: false, error: 'Player not found in room' };
    }

    // Update player color
    player.color = color;

    console.log(`Player ${player.name} updated color to ${color} in room ${room.code}`);

    return {
      success: true,
      room: this.getRoomInfo(roomId)!
    };
  }

  addAIPlayer(hostSocketId: string): { success: boolean; room?: RoomInfo; error?: string } {
    const roomId = this.playerRooms.get(hostSocketId);
    if (!roomId) {
      return { success: false, error: 'Player is not in a room' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const hostPlayer = room.players.find(p => p.socketId === hostSocketId);
    if (!hostPlayer || !hostPlayer.isHost) {
      return { success: false, error: 'Only the host can add AI players' };
    }

    if (room.isStarted) {
      return { success: false, error: 'Cannot add AI players after game has started' };
    }

    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: 'Room is full' };
    }

    // Generate AI player
    const aiName = aiService.generateDemonName();
    const aiPlayer: RoomPlayer = {
      id: `ai-player-${room.players.length}`,
      name: aiName,
      socketId: `ai-${Date.now()}-${Math.random()}`, // Fake socket ID for AI
      isHost: false,
      joinedAt: new Date(),
      isAI: true,
      aiPersonality: aiName
    };

    room.players.push(aiPlayer);

    console.log(`AI player ${aiName} added to room ${room.code}`);

    return {
      success: true,
      room: this.getRoomInfo(roomId)!
    };
  }

  removeAIPlayer(hostSocketId: string, aiPlayerId: string): { success: boolean; room?: RoomInfo; error?: string } {
    const roomId = this.playerRooms.get(hostSocketId);
    if (!roomId) {
      return { success: false, error: 'Player is not in a room' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const hostPlayer = room.players.find(p => p.socketId === hostSocketId);
    if (!hostPlayer || !hostPlayer.isHost) {
      return { success: false, error: 'Only the host can remove AI players' };
    }

    if (room.isStarted) {
      return { success: false, error: 'Cannot remove AI players after game has started' };
    }

    const aiPlayerIndex = room.players.findIndex(p => p.id === aiPlayerId && p.isAI);
    if (aiPlayerIndex === -1) {
      return { success: false, error: 'AI player not found' };
    }

    const aiPlayer = room.players[aiPlayerIndex];
    room.players.splice(aiPlayerIndex, 1);

    console.log(`AI player ${aiPlayer.name} removed from room ${room.code}`);

    return {
      success: true,
      room: this.getRoomInfo(roomId)!
    };
  }

  selectIntercessions(playerSocketId: string, request: SelectIntercessionsRequest): { success: boolean; room?: RoomInfo; error?: string } {
    const roomId = this.playerRooms.get(playerSocketId);
    if (!roomId) {
      return { success: false, error: 'Player is not in a room' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    const player = room.players.find(p => p.socketId === playerSocketId);
    if (!player) {
      return { success: false, error: 'Player not found in room' };
    }

    if (room.isStarted) {
      return { success: false, error: 'Cannot select intercessions after game has started' };
    }

    // Validate intercession selection
    if (request.intercessionTypes.length !== 2) {
      return { success: false, error: 'Must select exactly 2 intercessions' };
    }

    // Validate all selected intercessions are valid
    const invalidIntercessions = request.intercessionTypes.filter(type => !INTERCESSION_TYPES.includes(type));
    if (invalidIntercessions.length > 0) {
      return { success: false, error: `Invalid intercession types: ${invalidIntercessions.join(', ')}` };
    }

    // Validate no duplicates
    const uniqueIntercessions = new Set(request.intercessionTypes);
    if (uniqueIntercessions.size !== request.intercessionTypes.length) {
      return { success: false, error: 'Cannot select duplicate intercessions' };
    }

    // Update player's intercession selection
    player.selectedIntercessions = request.intercessionTypes;
    player.intercessionsSelected = true;

    console.log(`Player ${player.name} selected intercessions: ${request.intercessionTypes.join(', ')} in room ${room.code}`);

    return {
      success: true,
      room: this.getRoomInfo(roomId)!
    };
  }

  canStartGame(roomId: string): { canStart: boolean; reason?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { canStart: false, reason: 'Room not found' };
    }

    if (room.players.length < 2) {
      return { canStart: false, reason: 'Need at least 2 players' };
    }

    // Check if all human players have selected intercessions
    // AI players don't need intercessions, so they're automatically ready
    const humanPlayers = room.players.filter(p => !p.isAI);
    const playersWithoutIntercessions = humanPlayers.filter(p => !p.intercessionsSelected);
    
    if (playersWithoutIntercessions.length > 0) {
      return { canStart: false, reason: 'All human players must select intercessions before starting' };
    }

    return { canStart: true };
  }

  // Clean up rooms older than 1 hour with no activity
  cleanupOldRooms(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [roomId, room] of this.rooms) {
      if (room.createdAt < oneHourAgo && !room.isStarted) {
        // Clean up room
        this.roomsByCode.delete(room.code);
        this.rooms.delete(roomId);
        
        // Clean up player mappings
        room.players.forEach(player => {
          this.playerRooms.delete(player.socketId);
        });
        
        console.log(`Cleaned up old room: ${room.code}`);
      }
    }

    // Clean up old disconnected players
    const gracePeriodAgo = new Date(Date.now() - this.DISCONNECT_GRACE_PERIOD);
    for (const [playerId, disconnectedPlayer] of this.disconnectedPlayers) {
      if (disconnectedPlayer.disconnectedAt < gracePeriodAgo) {
        this.disconnectedPlayers.delete(playerId);
      }
    }
  }

  // Get all rooms (for debugging)
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}

export const roomManager = new RoomManager();

// Clean up old rooms every 30 minutes
setInterval(() => {
  roomManager.cleanupOldRooms();
}, 30 * 60 * 1000);
