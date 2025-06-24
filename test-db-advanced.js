require('dotenv').config();
const { Pool } = require('pg');
const Redis = require('ioredis');

async function testDatabaseStructure() {
  console.log('🔄 Testing existing database structure...');
  
  try {
    const pg = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    
    // Test what tables exist
    const tablesResult = await pg.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('📊 Existing tables:', tablesResult.rows.map(r => r.table_name));
    
    // Test rooms table structure
    const roomsStructure = await pg.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'rooms' 
      ORDER BY ordinal_position;
    `);
    
    console.log('🏠 Rooms table structure:');
    roomsStructure.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Test if we can create a realistic room entry
    const roomResult = await pg.query(`
      INSERT INTO rooms (code, host_player_id, max_players, is_started, intercession_selection_started)
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id, code, created_at;
    `, ['REAL01', 'host-player-123', 2, false, false]);
    
    console.log('✅ Created test room:', roomResult.rows[0]);
    const roomId = roomResult.rows[0].id;
    
    // Test if players table exists and works
    try {
      await pg.query(`
        INSERT INTO players (id, room_id, socket_id, name, is_host, is_connected)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, ['player-host-123', roomId, 'socket-abc', 'TestPlayer', true, true]);
      
      console.log('✅ Created test player');
      
      // Test player sessions table
      await pg.query(`
        INSERT INTO player_sessions (player_id, room_id, ip_address, session_token)
        VALUES ($1, $2, $3, $4);
      `, ['player-host-123', roomId, '127.0.0.1', 'test-session-token-123']);
      
      console.log('✅ Created test session');
      
    } catch (playerError) {
      console.log('⚠️  Players/sessions tables issue:', playerError.message);
    }
    
    // Test complex query (join)
    const joinResult = await pg.query(`
      SELECT r.code, r.is_started, p.name, p.is_host 
      FROM rooms r
      LEFT JOIN players p ON r.id = p.room_id
      WHERE r.code = $1;
    `, ['REAL01']);
    
    console.log('✅ Join query result:', joinResult.rows);
    
    // Clean up
    await pg.query('DELETE FROM rooms WHERE code = $1', ['REAL01']);
    console.log('✅ Cleaned up test data');
    
    await pg.end();
    
    // Test Redis
    const redis = new Redis(process.env.REDIS_URL);
    await redis.set('structure-test', 'working');
    const redisTest = await redis.get('structure-test');
    await redis.del('structure-test');
    await redis.quit();
    
    console.log('✅ Redis test:', redisTest);
    
    console.log('🎉 Database structure is compatible! Ready to proceed.');
    
  } catch (error) {
    console.error('❌ Structure test failed:', error.message);
    
    if (error.message.includes('does not exist')) {
      console.log('💡 Need to create missing tables');
    }
  }
}

testDatabaseStructure(); 