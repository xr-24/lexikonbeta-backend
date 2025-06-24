import { Pool } from 'pg';
import type { Room, RoomPlayer } from '../types/room';

interface DbRoom {
  id: string;
  code: string;
  host_player_id: string;
  max_players: number;
  is_started: boolean;
  intercession_selection_started: boolean;
  game_state?: any;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

interface DbPlayer {
  id: string;
  room_id: string;
  socket_id?: string;
  name: string;
  is_host: boolean;
  is_ai: boolean;
  ai_personality?: string;
  color?: string;
  selected_intercessions?: string[];
  is_connected: boolean;
  joined_at: Date;
  last_seen: Date;
}

interface PlayerSession {
  id: string;
  player_id: string;
  room_id: string;
  room_code: string;
  player_name: string;
  ip_address: string;
  browser_fingerprint?: string;
  session_token: string;
  created_at: Date;
  expires_at: Date;
}

export class DatabaseService {
  private pg: Pool;

  constructor() {
    this.pg = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Test connection but don't block startup
    this.testConnection().catch(error => {
      console.error('⚠️  Database connection failed - server will start but features may be limited:', error);
    });
  }

  private async testConnection(): Promise<void> {
    try {
      const pgResult = await this.pg.query('SELECT NOW()');
      console.log('✅ DatabaseService: PostgreSQL connected');
    } catch (error) {
      console.error('❌ DatabaseService connection failed:', error);
      throw error;
    }
  }

  // Room Operations
  async createRoom(room: Omit<Room, 'id'>): Promise<Room> {
    const client = await this.pg.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create room
      const roomResult = await client.query(
        `INSERT INTO rooms (code, host_player_id, max_players, is_started, intercession_selection_started)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [room.code, room.hostId, room.maxPlayers, room.isStarted, room.intercessionSelectionStarted]
      );
      
      const dbRoom = roomResult.rows[0];
      
      // Create host player
      const hostPlayer = room.players.find(p => p.isHost);
      if (hostPlayer) {
        await client.query(
          `INSERT INTO players (id, room_id, socket_id, name, is_host, is_ai, color, joined_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            hostPlayer.id,
            dbRoom.id,
            hostPlayer.socketId,
            hostPlayer.name,
            true,
            hostPlayer.isAI || false,
            hostPlayer.color || null,
            hostPlayer.joinedAt
          ]
        );
      }
      
      await client.query('COMMIT');
      
      const fullRoom = await this.getRoomById(dbRoom.id);
      
      return fullRoom!;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    // Fallback to PostgreSQL
    const result = await this.pg.query(
      `SELECT r.*, 
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'name', p.name,
                    'socketId', p.socket_id,
                    'isHost', p.is_host,
                    'isAI', p.is_ai,
                    'aiPersonality', p.ai_personality,
                    'color', p.color,
                    'selectedIntercessions', p.selected_intercessions,
                    'isConnected', p.is_connected,
                    'joinedAt', p.joined_at
                  )
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::json
              ) as players
       FROM rooms r
       LEFT JOIN players p ON r.id = p.room_id
       WHERE r.id = $1 AND r.expires_at > NOW()
       GROUP BY r.id`,
      [roomId]
    );

    if (result.rows.length === 0) return null;

    const room = this.mapDbRoomToRoom(result.rows[0]);
    
    return room;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    // Fallback to PostgreSQL
    const result = await this.pg.query(
      `SELECT r.*, 
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'name', p.name,
                    'socketId', p.socket_id,
                    'isHost', p.is_host,
                    'isAI', p.is_ai,
                    'aiPersonality', p.ai_personality,
                    'color', p.color,
                    'selectedIntercessions', p.selected_intercessions,
                    'isConnected', p.is_connected,
                    'joinedAt', p.joined_at
                  )
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::json
              ) as players
       FROM rooms r
       LEFT JOIN players p ON r.id = p.room_id
       WHERE r.code = $1 AND r.expires_at > NOW()
       GROUP BY r.id`,
      [code]
    );

    if (result.rows.length === 0) return null;

    const room = this.mapDbRoomToRoom(result.rows[0]);
    
    return room;
  }

  async addPlayerToRoom(roomId: string, player: RoomPlayer): Promise<void> {
    await this.pg.query(
      `INSERT INTO players (id, room_id, socket_id, name, is_host, is_ai, ai_personality, color, selected_intercessions, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        player.id,
        roomId,
        player.socketId,
        player.name,
        player.isHost || false,
        player.isAI || false,
        player.aiPersonality || null,
        player.color || null,
        player.selectedIntercessions || null,
        player.joinedAt
      ]
    );
  }

  async updatePlayerConnection(playerId: string, socketId: string | null, isConnected: boolean): Promise<void> {
    const result = await this.pg.query(
      `UPDATE players 
       SET socket_id = $2, is_connected = $3, last_seen = NOW()
       WHERE id = $1
       RETURNING room_id`,
      [playerId, socketId, isConnected]
    );
  }

  async updatePlayerColor(playerId: string, color: string): Promise<void> {
    const result = await this.pg.query(
      `UPDATE players 
       SET color = $2
       WHERE id = $1
       RETURNING room_id`,
      [playerId, color]
    );
  }

  async updatePlayerIntercessions(playerId: string, intercessions: string[]): Promise<void> {
    const result = await this.pg.query(
      `UPDATE players 
       SET selected_intercessions = $2
       WHERE id = $1
       RETURNING room_id`,
      [playerId, JSON.stringify(intercessions)]
    );
  }

  async removePlayerFromRoom(playerId: string): Promise<string | null> {
    const result = await this.pg.query(
      'DELETE FROM players WHERE id = $1 RETURNING room_id',
      [playerId]
    );
    
    if (result.rows.length > 0) {
      const roomId = result.rows[0].room_id;
      return roomId;
    }
    
    return null;
  }

  async updateRoom(roomId: string, updates: Partial<Room>): Promise<Room | null> {
    const client = await this.pg.connect();
    
    try {
      await client.query('BEGIN');
      
      const setClause = [];
      const values = [];
      let paramIndex = 1;
      
      if (updates.isStarted !== undefined) {
        setClause.push(`is_started = $${paramIndex++}`);
        values.push(updates.isStarted);
      }
      
      if (updates.intercessionSelectionStarted !== undefined) {
        setClause.push(`intercession_selection_started = $${paramIndex++}`);
        values.push(updates.intercessionSelectionStarted);
      }
      
      if (updates.gameState !== undefined) {
        setClause.push(`game_state = $${paramIndex++}`);
        values.push(JSON.stringify(updates.gameState));
      }
      
      setClause.push(`updated_at = NOW()`);
      values.push(roomId);
      
      await client.query(
        `UPDATE rooms SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
      
      await client.query('COMMIT');
      
      return this.getRoomById(roomId);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Session Management
  async createPlayerSession(playerId: string, roomId: string, ipAddress: string, browserFingerprint?: string): Promise<string> {
    const sessionToken = this.generateSessionToken();
    
    await this.pg.query(
      `INSERT INTO player_sessions (player_id, room_id, ip_address, browser_fingerprint, session_token)
       VALUES ($1, $2, $3, $4, $5)`,
      [playerId, roomId, ipAddress, browserFingerprint, sessionToken]
    );
    
    return sessionToken;
  }

  async getPlayerSession(sessionToken: string): Promise<PlayerSession | null> {
    const result = await this.pg.query(
      `SELECT ps.*, p.name as player_name, r.code as room_code
       FROM player_sessions ps
       JOIN players p ON ps.player_id = p.id
       JOIN rooms r ON ps.room_id = r.id
       WHERE ps.session_token = $1 AND ps.expires_at > NOW()`,
      [sessionToken]
    );
    
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async findSessionByIP(ipAddress: string): Promise<PlayerSession | null> {
    const result = await this.pg.query(
      `SELECT ps.*, p.name as player_name, r.code as room_code
       FROM player_sessions ps
       JOIN players p ON ps.player_id = p.id
       JOIN rooms r ON ps.room_id = r.id
       WHERE ps.ip_address = $1 AND ps.expires_at > NOW()
       ORDER BY ps.created_at DESC
       LIMIT 1`,
      [ipAddress]
    );
    
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  // Utility Methods
  private mapDbRoomToRoom(dbRow: any): Room {
    // Process players to properly parse selectedIntercessions from JSON
    const players = Array.isArray(dbRow.players) ? dbRow.players.map((player: any) => {
      let selectedIntercessions = null;
      
      // Parse selectedIntercessions if it exists and is a string
      if (player.selectedIntercessions) {
        try {
          if (typeof player.selectedIntercessions === 'string') {
            selectedIntercessions = JSON.parse(player.selectedIntercessions);
          } else if (Array.isArray(player.selectedIntercessions)) {
            selectedIntercessions = player.selectedIntercessions;
          }
        } catch (error) {
          console.warn('Failed to parse selectedIntercessions for player:', player.id, error);
          selectedIntercessions = null;
        }
      }
      
      return {
        ...player,
        selectedIntercessions,
        // Add compatibility fields for intercession checking
        intercessionsSelected: selectedIntercessions && selectedIntercessions.length > 0,
        hasSelectedIntercessions: selectedIntercessions && selectedIntercessions.length > 0
      };
    }) : [];

    return {
      id: dbRow.id,
      code: dbRow.code,
      hostId: dbRow.host_player_id,
      players,
      isStarted: dbRow.is_started,
      intercessionSelectionStarted: dbRow.intercession_selection_started,
      createdAt: dbRow.created_at,
      maxPlayers: dbRow.max_players,
      gameState: dbRow.game_state || undefined,
    };
  }

  private generateSessionToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  // Cleanup Operations
  async cleanupExpiredRooms(): Promise<void> {
    const result = await this.pg.query(
      'DELETE FROM rooms WHERE expires_at < NOW() RETURNING id, code'
    );
    
    console.log(`🧹 Cleaned up ${result.rows.length} expired rooms`);
  }

  async close(): Promise<void> {
    await this.pg.end();
  }
} 