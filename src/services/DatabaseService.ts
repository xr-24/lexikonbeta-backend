import { Pool } from 'pg';
import Redis from 'ioredis';
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
  private redis: Redis;

  constructor() {
    this.pg = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
      enableOfflineQueue: false,
    });

    // Test connections but don't block startup
    this.testConnections().catch(error => {
      console.error('⚠️  Database connections failed - server will start but features may be limited:', error);
    });
  }

  private async testConnections(): Promise<void> {
    try {
      const pgResult = await this.pg.query('SELECT NOW()');
      console.log('✅ DatabaseService: PostgreSQL connected');

      try {
        await this.redis.ping();
        console.log('✅ DatabaseService: Redis connected');
      } catch (redisError) {
        console.warn('⚠️  Redis not available, running without cache:', redisError);
        // Game will work without Redis, just slower
      }
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
      
      // Cache in Redis for fast access (safe)
      try {
        await this.redis.setex(`room:${dbRoom.id}`, 3600, JSON.stringify(fullRoom));
        await this.redis.setex(`room:code:${room.code}`, 3600, dbRoom.id);
      } catch (redisError) {
        console.warn('Redis cache write failed:', redisError);
        // Continue without caching
      }
      
      return fullRoom!;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    // Try Redis cache first (with fallback)
    try {
      const cached = await this.redis.get(`room:${roomId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (redisError) {
      console.warn('Redis cache miss:', redisError);
      // Continue to PostgreSQL fallback
    }

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
    
    // Cache for future requests (safe)
    try {
      await this.redis.setex(`room:${roomId}`, 1800, JSON.stringify(room));
    } catch (redisError) {
      console.warn('Redis cache write failed:', redisError);
      // Continue without caching
    }
    
    return room;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    // Try Redis cache first (with fallback)
    try {
      const cachedRoomId = await this.redis.get(`room:code:${code}`);
      if (cachedRoomId) {
        return this.getRoomById(cachedRoomId);
      }
    } catch (redisError) {
      console.warn('Redis cache miss for room code:', redisError);
      // Continue to PostgreSQL fallback
    }

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
    
    // Cache for future requests (safe)
    try {
      await this.redis.setex(`room:${room.id}`, 1800, JSON.stringify(room));
      await this.redis.setex(`room:code:${code}`, 1800, room.id);
    } catch (redisError) {
      console.warn('Redis cache write failed:', redisError);
      // Continue without caching
    }
    
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
    
    // Invalidate room cache
    await this.redis.del(`room:${roomId}`);
  }

  async updatePlayerConnection(playerId: string, socketId: string | null, isConnected: boolean): Promise<void> {
    const result = await this.pg.query(
      `UPDATE players 
       SET socket_id = $2, is_connected = $3, last_seen = NOW()
       WHERE id = $1
       RETURNING room_id`,
      [playerId, socketId, isConnected]
    );
    
    // Invalidate room cache
    if (result.rows.length > 0) {
      await this.redis.del(`room:${result.rows[0].room_id}`);
    }
  }

  async updatePlayerColor(playerId: string, color: string): Promise<void> {
    const result = await this.pg.query(
      `UPDATE players 
       SET color = $2
       WHERE id = $1
       RETURNING room_id`,
      [playerId, color]
    );
    
    // Invalidate room cache
    if (result.rows.length > 0) {
      await this.redis.del(`room:${result.rows[0].room_id}`);
    }
  }

  async updatePlayerIntercessions(playerId: string, intercessions: string[]): Promise<void> {
    const result = await this.pg.query(
      `UPDATE players 
       SET selected_intercessions = $2
       WHERE id = $1
       RETURNING room_id`,
      [playerId, JSON.stringify(intercessions)]
    );
    
    // Invalidate room cache
    if (result.rows.length > 0) {
      await this.redis.del(`room:${result.rows[0].room_id}`);
    }
  }

  async removePlayerFromRoom(playerId: string): Promise<string | null> {
    const result = await this.pg.query(
      'DELETE FROM players WHERE id = $1 RETURNING room_id',
      [playerId]
    );
    
    if (result.rows.length > 0) {
      const roomId = result.rows[0].room_id;
      await this.redis.del(`room:${roomId}`);
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
      
      // Invalidate cache
      await this.redis.del(`room:${roomId}`);
      
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
    return {
      id: dbRow.id,
      code: dbRow.code,
      hostId: dbRow.host_player_id,
      players: Array.isArray(dbRow.players) ? dbRow.players : [],
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
    
    // Clean up Redis cache
    for (const room of result.rows) {
      await this.redis.del(`room:${room.id}`, `room:code:${room.code}`);
    }
    
    console.log(`🧹 Cleaned up ${result.rows.length} expired rooms`);
  }

  async close(): Promise<void> {
    await this.pg.end();
    await this.redis.quit();
  }
} 