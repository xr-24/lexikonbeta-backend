-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Rooms table
CREATE TABLE rooms (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   code VARCHAR(6) UNIQUE NOT NULL,
   host_player_id VARCHAR(255) NOT NULL,
   max_players INTEGER DEFAULT 2,
   is_started BOOLEAN DEFAULT FALSE,
   intercession_selection_started BOOLEAN DEFAULT FALSE,
   game_state JSONB,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
   updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
   expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '2 hours')
);

-- Players table
CREATE TABLE players (
   id VARCHAR(255) PRIMARY KEY,
   room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
   socket_id VARCHAR(255),
   name VARCHAR(50) NOT NULL,
   is_host BOOLEAN DEFAULT FALSE,
   is_ai BOOLEAN DEFAULT FALSE,
   ai_personality VARCHAR(50),
   color VARCHAR(7),
   selected_intercessions TEXT[],
   is_connected BOOLEAN DEFAULT TRUE,
   joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
   last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Player sessions for reconnection
CREATE TABLE player_sessions (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
   player_id VARCHAR(255) REFERENCES players(id) ON DELETE CASCADE,
   room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
   ip_address INET,
   browser_fingerprint VARCHAR(255),
   session_token VARCHAR(255) UNIQUE,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
   expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Indexes for performance
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_expires_at ON rooms(expires_at);
CREATE INDEX idx_players_room_id ON players(room_id);
CREATE INDEX idx_players_socket_id ON players(socket_id);
CREATE INDEX idx_player_sessions_token ON player_sessions(session_token);
CREATE INDEX idx_player_sessions_expires_at ON player_sessions(expires_at);