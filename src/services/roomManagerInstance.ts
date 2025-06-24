import { NewRoomManager } from './NewRoomManager';

// Create and export the room manager instance
// NewRoomManager creates its own DatabaseService internally and starts cleanup timer automatically
export const roomManager = new NewRoomManager();

console.log('✅ Room manager initialized with database persistence'); 