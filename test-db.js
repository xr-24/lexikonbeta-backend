   require('dotenv').config();
   const { Pool } = require('pg');
   const Redis = require('ioredis');

   async function testConnections() {
     console.log('🔄 Testing database connections...');
     
     try {
       // Test PostgreSQL
       const pg = new Pool({
         connectionString: process.env.DATABASE_URL,
       });
       
       const pgResult = await pg.query('SELECT NOW()');
       console.log('✅ PostgreSQL connected:', pgResult.rows[0].now);
       
       // Test creating a room
       const roomResult = await pg.query(
         `INSERT INTO rooms (code, host_player_id, max_players) 
          VALUES ($1, $2, $3) RETURNING *`,
         ['TEST01', 'test-player-123', 2]
       );
       console.log('✅ Test room created:', roomResult.rows[0].code);
       
       // Clean up test data
       await pg.query('DELETE FROM rooms WHERE code = $1', ['TEST01']);
       console.log('✅ Test data cleaned up');
       
       await pg.end();
       
       // Test Redis
       const redis = new Redis(process.env.REDIS_URL);
       await redis.ping();
       console.log('✅ Redis connected');
       
       await redis.set('test-key', 'test-value');
       const value = await redis.get('test-key');
       console.log('✅ Redis test value:', value);
       
       await redis.del('test-key');
       await redis.quit();
       
       console.log('🎉 All tests passed! Your setup is working correctly.');
       
     } catch (error) {
       console.error('❌ Test failed:', error.message);
       
       if (error.message.includes('password authentication failed')) {
         console.log('💡 Check your DATABASE_URL password in .env');
       }
       if (error.message.includes('ECONNREFUSED')) {
         console.log('💡 Make sure PostgreSQL and Redis are running');
       }
     }
   }

   testConnections();