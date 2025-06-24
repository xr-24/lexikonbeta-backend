require('dotenv').config();

// Mock the room types since we're testing with JavaScript
const generateRandomCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateRandomId = () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const hostId = generateRandomId();
const mockRoom = {
  code: generateRandomCode(),
  hostId: hostId,
  players: [{
    id: hostId,
    name: 'TestHost',
    socketId: 'socket-123',
    isHost: true,
    joinedAt: new Date()
  }],
  isStarted: false,
  intercessionSelectionStarted: false,
  createdAt: new Date(),
  maxPlayers: 2
};

async function testDatabaseService() {
  console.log('🔄 Testing DatabaseService...');
  
  try {
    // Import the compiled DatabaseService
    const { DatabaseService } = require('./dist/services/DatabaseService');
    const db = new DatabaseService();
    
    console.log('✅ DatabaseService created and connected');
    
    // Test room creation
    const createdRoom = await db.createRoom(mockRoom);
    console.log('✅ Room created:', { id: createdRoom.id, code: createdRoom.code });
    
    // Test room retrieval by ID
    const roomById = await db.getRoomById(createdRoom.id);
    console.log('✅ Room retrieved by ID:', roomById ? 'found' : 'not found');
    
    // Test room retrieval by code
    const roomByCode = await db.getRoomByCode(createdRoom.code);
    console.log('✅ Room retrieved by code:', roomByCode ? 'found' : 'not found');
    
    // Test adding a player
    const playerId = generateRandomId();
    const newPlayer = {
      id: playerId,
      name: 'TestPlayer2',
      socketId: 'socket-456',
      isHost: false,
      joinedAt: new Date()
    };
    
    await db.addPlayerToRoom(createdRoom.id, newPlayer);
    console.log('✅ Player added to room');
    
    // Test updated room retrieval
    const updatedRoom = await db.getRoomById(createdRoom.id);
    console.log('✅ Updated room has players:', updatedRoom.players.length);
    
    // Test session creation
    const sessionToken = await db.createPlayerSession(
      hostId,
      createdRoom.id,
      '127.0.0.1',
      'test-fingerprint'
    );
    console.log('✅ Session created:', sessionToken.substring(0, 8) + '...');
    
    // Test session retrieval
    const session = await db.getPlayerSession(sessionToken);
    console.log('✅ Session retrieved:', session ? 'found' : 'not found');
    
    // Test room update
    const gameStateTest = { currentPlayer: 0, turn: 1 };
    await db.updateRoom(createdRoom.id, { 
      isStarted: true, 
      gameState: gameStateTest 
    });
    console.log('✅ Room updated with game state');
    
    // Test final room state
    const finalRoom = await db.getRoomById(createdRoom.id);
    console.log('✅ Final room state:', {
      isStarted: finalRoom.isStarted,
      hasGameState: !!finalRoom.gameState,
      playerCount: finalRoom.players.length
    });
    
    // Clean up
    await db.removePlayerFromRoom(playerId);
    await db.removePlayerFromRoom(hostId);
    
    // Room should be automatically cleaned up when last player leaves
    console.log('✅ Test data cleaned up');
    
    await db.close();
    console.log('🎉 DatabaseService test completed successfully!');
    
  } catch (error) {
    console.error('❌ DatabaseService test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testDatabaseService(); 