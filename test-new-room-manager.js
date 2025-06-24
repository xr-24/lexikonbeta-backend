require('dotenv').config();
const { NewRoomManager } = require('./dist/services/NewRoomManager');

async function testNewRoomManager() {
  console.log('🔄 Testing NewRoomManager...');
  
  try {
    const roomManager = new NewRoomManager();
    
    // Test room creation
    const createResult = await roomManager.createRoom('socket1', {
      playerName: 'Alice'
    }, '192.168.1.1');
    
    if (!createResult.success) {
      throw new Error(`Room creation failed: ${createResult.error}`);
    }
    
    console.log('✅ Room created:', createResult.room.code);
    
    // Test joining room
    const joinResult = await roomManager.joinRoom('socket2', {
      roomCode: createResult.room.code,
      playerName: 'Bob'
    }, '192.168.1.2');
    
    if (!joinResult.success) {
      throw new Error(`Room join failed: ${joinResult.error}`);
    }
    
    console.log('✅ Player joined room, total players:', joinResult.room.players.length);
    
    // Test getting room by socket
    const room = await roomManager.getRoomBySocketId('socket1');
    console.log('✅ Room retrieved by socket ID:', room ? 'found' : 'not found');
    
    // Test player disconnect
    const disconnectResult = await roomManager.handlePlayerDisconnect('socket2');
    console.log('✅ Player disconnect handled:', disconnectResult.playerId ? 'success' : 'failed');
    
    // Test session lookup
    const session = await roomManager.checkSessionByIP('192.168.1.1');
    console.log('✅ Session lookup:', session ? 'found' : 'not found');
    
    // Cleanup
    await roomManager.leaveRoom('socket1');
    await roomManager.shutdown();
    
    console.log('🎉 NewRoomManager test completed successfully!');
    
  } catch (error) {
    console.error('❌ NewRoomManager test failed:', error.message);
    process.exit(1);
  }
}

testNewRoomManager(); 