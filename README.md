# Scrabble Backend Server

A Node.js/Express/Socket.io backend server for the multiplayer Scrabble game. This server handles real-time multiplayer game logic, room management, and all game mechanics including word validation, scoring, and power-ups.

## Features

- **Real-time Multiplayer**: Socket.io for instant game updates
- **Room Management**: Create and join games with 6-digit room codes
- **Complete Game Logic**: All Scrabble rules implemented
- **Word Validation**: SOWPODS dictionary with 267,000+ words
- **Power-up System**: Special tiles and board effects
- **Score Calculation**: Accurate Scrabble scoring with multipliers
- **Move History**: Track all player moves and actions
- **Game State Management**: Persistent game states across connections

## Tech Stack

- **Node.js** - Runtime environment
- **Express** - Web framework
- **Socket.io** - Real-time communication
- **TypeScript** - Type safety
- **SOWPODS Dictionary** - Word validation

## Project Structure

```
scrabble-backend/
├── src/
│   ├── types/
│   │   ├── game.ts              # Game type definitions
│   │   └── room.ts              # Room and player types
│   ├── constants/
│   │   ├── board.ts             # Board layout and multipliers
│   │   └── tiles.ts             # Tile distribution and values
│   ├── services/
│   │   ├── GameService.ts       # Core game logic
│   │   ├── RoomManager.ts       # Room management
│   │   ├── moveManager.ts       # Move validation and execution
│   │   ├── scoreCalculator.ts   # Score calculation
│   │   ├── wordValidator.ts     # Word validation
│   │   ├── dictionaryService.ts # Dictionary loading
│   │   └── PowerUpManager.ts    # Power-up system
│   ├── events/
│   │   ├── gameEvents.ts        # Socket.io game event handlers
│   │   └── roomEvents.ts        # Socket.io room event handlers
│   └── server.ts                # Main Express + Socket.io server
├── public/
│   └── sowpods.txt              # Dictionary file
├── package.json
├── tsconfig.json
└── README.md
```

## Installation

1. **Clone and navigate to backend directory**
```bash
cd scrabble-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Ensure dictionary file is present**
The `public/sowpods.txt` file should be copied from the frontend project.

## Development

**Start development server**
```bash
npm run dev
```

The server will start on `http://localhost:3001` with hot reloading.

**Build for production**
```bash
npm run build
```

**Start production server**
```bash
npm start
```

## API Endpoints

### HTTP Endpoints

- `GET /` - Health check with basic server info
- `GET /health` - Detailed health check with dictionary status

### Socket.io Events

#### Room Events
- `create-room` - Create a new game room
- `join-room` - Join existing room with code
- `leave-room` - Leave current room
- `start-game` - Start game (host only)
- `get-room-info` - Get current room information

#### Game Events
- `place-tile` - Place tile on board
- `remove-tile` - Remove tile from board
- `commit-move` - Execute current move
- `exchange-tiles` - Exchange tiles with bag
- `pass-turn` - Skip current turn
- `end-game` - End player's game
- `activate-powerup` - Activate collected power-up
- `activate-powerup-tile` - Use power-up tile
- `get-game-state` - Get current game state
- `clear-pending-move` - Clear pending tile placements

## Environment Variables

```bash
PORT=3001                           # Server port
NODE_ENV=production                 # Environment
CORS_ORIGIN=https://beta.unkind.dev  # Frontend URL
```

## Game Features

### Room Management
- 6-digit room codes for easy joining
- Up to 4 players per room
- Host controls game start
- Automatic room cleanup after 1 hour

### Game Mechanics
- Standard Scrabble rules
- 15x15 board with premium squares
- 7 tiles per player
- Word validation against SOWPODS dictionary
- Accurate scoring with multipliers
- Exchange tiles functionality
- Pass turn option
- End game when desired

### Power-up System
- **Headstone**: Swap all tiles, guarantee vowels
- **Wilted Rose**: Swap tiles with random opponent
- **Crescent Moon**: Add blank tile to rack
- **Scroll**: Double score for next move
- Board power-ups collected when tiles placed

### Real-time Features
- Instant game state updates
- Live tile placement preview
- Turn notifications
- Move history tracking
- Player connection status

## Deployment

### Railway (Recommended)

1. **Create Railway account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Connect repository**
   - Create new project from GitHub repo
   - Railway auto-detects Node.js

3. **Set environment variables**
   ```
   NODE_ENV=production
   CORS_ORIGIN=https://beta.unkind.dev
   ```

4. **Deploy**
   - Railway automatically builds and deploys
   - Get deployment URL for frontend configuration

### Alternative: Render.com

1. **Create Render account**
2. **Connect GitHub repository**
3. **Configure build settings**:
   - Build Command: `npm run build`
   - Start Command: `npm start`
4. **Set environment variables**
5. **Deploy**

## Frontend Integration

The frontend needs to be updated to connect to this backend:

1. **Install Socket.io client**
```bash
npm install socket.io-client
```

2. **Update frontend to use Socket.io instead of Zustand for game logic**
3. **Add room creation/joining UI**
4. **Configure backend URL in frontend**

## Monitoring

- Health check endpoint at `/health`
- Console logging for all major events
- Error handling with graceful shutdown
- Memory usage monitoring

## Security

- CORS configured for frontend domain
- Input validation on all Socket.io events
- Turn validation (players can only act on their turn)
- Room access control
- Automatic cleanup of inactive rooms

## Performance

- In-memory game state storage
- Efficient dictionary lookup with Set
- Room cleanup every 30 minutes
- Graceful handling of disconnections

## Development Notes

- All game logic extracted from frontend gameStore
- Type-safe with TypeScript throughout
- Modular architecture for easy maintenance
- Comprehensive error handling
- Real-time multiplayer ready

## Support

For issues or questions about the backend server, check the console logs and health endpoint for diagnostic information.
