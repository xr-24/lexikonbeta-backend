import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
// Beta deployment trigger - v1.0.2
import { registerRoomEvents } from './events/roomEvents';
import { registerGameEvents } from './events/gameEvents';
import { dictionaryService } from './services/dictionaryService';
import { quackleGaddagAIService } from './services/QuackleGADDAGAIService';
import { gameService } from './services/GameService';

const app = express();
const server = createServer(app);

// Configure CORS with stricter settings
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://beta.unkind.dev']
    : ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Limit request size

// Socket.io server with CORS and connection limits
const io = new Server(server, {
  cors: corsOptions,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  maxHttpBufferSize: 1e6, // 1MB max buffer size
});

// Track connections per IP for basic DoS protection
const connectionsPerIP = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 10;

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Scrabble Backend Server Running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Health check with more details
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    dictionary: {
      loaded: dictionaryService.isDictionaryLoaded(),
      size: dictionaryService.getDictionarySize()
    }
  });
});

// Basic connection limiting middleware
io.use((socket, next) => {
  try {
    const clientIP = socket.handshake.address;
    const currentConnections = connectionsPerIP.get(clientIP) || 0;
    
    if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
      console.warn(`Connection limit exceeded for IP: ${clientIP}`);
      return next(new Error('Too many connections from this IP'));
    }
    
    connectionsPerIP.set(clientIP, currentConnections + 1);
    
    // Clean up on disconnect
    socket.on('disconnect', () => {
      const connections = connectionsPerIP.get(clientIP) || 1;
      if (connections <= 1) {
        connectionsPerIP.delete(clientIP);
      } else {
        connectionsPerIP.set(clientIP, connections - 1);
      }
    });
    
    next();
  } catch (error) {
    console.error('Connection middleware error:', error);
    next(new Error('Connection error'));
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  try {
    // Register all event handlers with error wrapping
    registerRoomEvents(socket, io);
    registerGameEvents(socket, io);
    
    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to Scrabble server',
      socketId: socket.id
    });
  } catch (error) {
    console.error('Error setting up socket connection:', error);
    socket.emit('error', { message: 'Connection setup failed' });
    socket.disconnect();
  }
});

// Global error handlers
io.engine.on('connection_error', (err) => {
  console.error('Socket.io connection error:', err);
});

// Initialize dictionary and AI on startup
async function initializeServer() {
  const PORT = process.env.PORT || 3001;
  
  // Start server first, then load dictionary
  server.listen(PORT, () => {
    console.log(`🚀 Scrabble Backend Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 CORS origins: ${JSON.stringify(corsOptions.origin)}`);
    console.log(`🛡️  Security measures enabled`);
  });

  // Load dictionary asynchronously after server starts
  try {
    console.log('Loading dictionary...');
    await dictionaryService.loadDictionary();
    console.log(`📚 Dictionary loaded successfully with ${dictionaryService.getDictionarySize()} words`);

    // Pre-warm the GADDAG AI
    await quackleGaddagAIService.initialize();
    
    console.log('✅ Server initialization complete');
  } catch (error) {
    console.error('⚠️  Warning: Failed to load dictionary or initialize AI:', error);
    console.log('🔄 Server will continue running with limited functionality');
    // Don't exit - let the server run even if dictionary fails
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
initializeServer();
