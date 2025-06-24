import { GameState, IntercessionsType } from './game';

export interface Room {
  id: string;
  code: string;          // 6-digit room code
  hostId: string;
  players: RoomPlayer[];
  gameState?: GameState;
  isStarted: boolean;
  intercessionSelectionStarted: boolean;
  createdAt: Date;
  maxPlayers: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  socketId?: string;
  isHost: boolean;
  joinedAt: Date;
  color?: string;
  isAI?: boolean;
  aiPersonality?: string;
  selectedIntercessions?: string[];
  intercessionsSelected?: boolean;
  hasSelectedIntercessions?: boolean;
}

export interface CreateRoomRequest {
  playerName: string;
}

export interface JoinRoomRequest {
  roomCode: string;
  playerName: string;
}

export interface SelectIntercessionsRequest {
  intercessionTypes: IntercessionsType[];
}

export interface RoomInfo {
  id: string;
  code: string;
  hostId: string;
  players: RoomPlayer[];
  isStarted: boolean;
  intercessionSelectionStarted: boolean;
  maxPlayers: number;
}
