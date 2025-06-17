import type { MultiplierType, BoardCell, PowerUp, PowerUpType } from '../types/game';

export const BOARD_SIZE = 15;

// Scrabble board multiplier layout (15x15)
const MULTIPLIER_LAYOUT: (MultiplierType | null)[][] = [
  ['TRIPLE_WORD', null, null, 'DOUBLE_LETTER', null, null, null, 'TRIPLE_WORD', null, null, null, 'DOUBLE_LETTER', null, null, 'TRIPLE_WORD'],
  [null, 'DOUBLE_WORD', null, null, null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null, null, null, 'DOUBLE_WORD', null],
  [null, null, 'DOUBLE_WORD', null, null, null, 'DOUBLE_LETTER', null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_WORD', null, null],
  ['DOUBLE_LETTER', null, null, 'DOUBLE_WORD', null, null, null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_WORD', null, null, 'DOUBLE_LETTER'],
  [null, null, null, null, 'DOUBLE_WORD', null, null, null, null, null, 'DOUBLE_WORD', null, null, null, null],
  [null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null],
  [null, null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_LETTER', null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_LETTER', null, null],
  ['TRIPLE_WORD', null, null, 'DOUBLE_LETTER', null, null, null, 'CENTER', null, null, null, 'DOUBLE_LETTER', null, null, 'TRIPLE_WORD'],
  [null, null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_LETTER', null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_LETTER', null, null],
  [null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null],
  [null, null, null, null, 'DOUBLE_WORD', null, null, null, null, null, 'DOUBLE_WORD', null, null, null, null],
  ['DOUBLE_LETTER', null, null, 'DOUBLE_WORD', null, null, null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_WORD', null, null, 'DOUBLE_LETTER'],
  [null, null, 'DOUBLE_WORD', null, null, null, 'DOUBLE_LETTER', null, 'DOUBLE_LETTER', null, null, null, 'DOUBLE_WORD', null, null],
  [null, 'DOUBLE_WORD', null, null, null, 'TRIPLE_LETTER', null, null, null, 'TRIPLE_LETTER', null, null, null, 'DOUBLE_WORD', null],
  ['TRIPLE_WORD', null, null, 'DOUBLE_LETTER', null, null, null, 'TRIPLE_WORD', null, null, null, 'DOUBLE_LETTER', null, null, 'TRIPLE_WORD']
];

const POWER_UP_DEFINITIONS: Record<PowerUpType, Omit<PowerUp, 'id'>> = {
  SCROLL: {
    type: 'SCROLL',
    emoji: '📜',
    name: 'Scroll',
    description: 'Place a letter tile any number of times on the board, all letters in your possession can be used multiple times for that turn regardless of how many of that letter you actually have'
  },
  HEADSTONE: {
    type: 'HEADSTONE',
    emoji: '🪦',
    name: 'Headstone',
    description: 'Swap all 7 of your tiles for a new set, guaranteed to contain at least two vowels. (consumed on use)'
  },
  WILTED_ROSE: {
    type: 'WILTED_ROSE',
    emoji: '🥀',
    name: 'Wilted Rose',
    description: 'Swaps you and your opponents\' tiles.'
  },
  CRESCENT_MOON: {
    type: 'CRESCENT_MOON',
    emoji: '🌙',
    name: 'Crescent Moon',
    description: 'Adds an extra blank tile to your rack.'
  },
  BURN: {
    type: 'BURN',
    emoji: '🔥',
    name: 'Burn',
    description: 'Choose 2 tiles to force your opponent to discard from their rack.'
  },
  TILE_THIEF: {
    type: 'TILE_THIEF',
    emoji: '🗡️',
    name: 'Tile Thief',
    description: 'Steal 1 tile from opponent\'s rack. Your rack expands to 8/7 for this turn.'
  },
  MULTIPLIER_THIEF: {
    type: 'MULTIPLIER_THIEF',
    emoji: '💎',
    name: 'Multiplier Thief',
    description: 'Steal a Double Word or Triple Word multiplier from the board to use on your next word.'
  },
  DUPLICATE: {
    type: 'DUPLICATE',
    emoji: '🪞',
    name: 'Duplicate',
    description: 'Copy one of your own tiles to create an exact duplicate.'
  },
  EXTRA_TURN: {
    type: 'EXTRA_TURN',
    emoji: '🔄',
    name: 'Extra Turn',
    description: 'Play again immediately after your current turn ends.'
  },
  TILE_FREEZE: {
    type: 'TILE_FREEZE',
    emoji: '🧊',
    name: 'Tile Freeze',
    description: 'Freeze a tile on the board - opponents cannot connect new tiles to it on their next turn.'
  },
  SILENCE: {
    type: 'SILENCE',
    emoji: '🤐',
    name: 'Silence',
    description: 'Lock 3 random tiles on your opponent\'s rack, preventing them from being used on their next turn.'
  },
  EXTRA_TILES: {
    type: 'EXTRA_TILES',
    emoji: '📦',
    name: 'Extra Tiles',
    description: 'Get 3 bonus tiles for this turn only. Your rack expands to 10/7 temporarily.'
  }
};

function generateRandomPowerUps(): PowerUp[] {
  const powerUpTypes: PowerUpType[] = [
    'SCROLL', 'HEADSTONE', 'WILTED_ROSE', 'CRESCENT_MOON',
    'BURN', 'TILE_THIEF', 'MULTIPLIER_THIEF', 'DUPLICATE',
    'EXTRA_TURN', 'TILE_FREEZE', 'SILENCE', 'EXTRA_TILES'
  ];
  const numPowerUps = 10 + Math.floor(Math.random() * 6); // 10-15 power-ups
  const selectedPowerUps: PowerUp[] = [];

  for (let i = 0; i < numPowerUps; i++) {
    const randomType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    const powerUpDef = POWER_UP_DEFINITIONS[randomType];
    selectedPowerUps.push({
      id: `powerup-${i}`,
      ...powerUpDef
    });
  }

  return selectedPowerUps;
}

function getValidPowerUpPositions(): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];
  
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      // Avoid center square and existing multiplier squares
      if (MULTIPLIER_LAYOUT[row][col] === null) {
        positions.push({ row, col });
      }
    }
  }
  
  return positions;
}

export function createEmptyBoard(): BoardCell[][] {
  const board: BoardCell[][] = [];
  
  // Initialize empty board
  for (let row = 0; row < BOARD_SIZE; row++) {
    board[row] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      board[row][col] = {
        tile: null,
        multiplier: MULTIPLIER_LAYOUT[row][col],
        powerUp: null
      };
    }
  }
  
  // Add random power-ups
  const powerUps = generateRandomPowerUps();
  const validPositions = getValidPowerUpPositions();
  
  // Shuffle positions and place power-ups
  for (let i = validPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validPositions[i], validPositions[j]] = [validPositions[j], validPositions[i]];
  }
  
  powerUps.forEach((powerUp, index) => {
    if (index < validPositions.length) {
      const { row, col } = validPositions[index];
      board[row][col].powerUp = powerUp;
    }
  });
  
  return board;
}

export function getMultiplierDisplay(multiplier: MultiplierType | null): string {
  switch (multiplier) {
    case 'DOUBLE_LETTER': return 'L²';
    case 'TRIPLE_LETTER': return 'L³';
    case 'DOUBLE_WORD': return 'W²';
    case 'TRIPLE_WORD': return 'W³';
    case 'CENTER': return '★';
    default: return '';
  }
}

export function getMultiplierColor(multiplier: MultiplierType | null): string {
  switch (multiplier) {
    case 'DOUBLE_LETTER': return '#ADD8E6'; // Light blue
    case 'TRIPLE_LETTER': return '#0000FF'; // Blue
    case 'DOUBLE_WORD': return '#FFB6C1'; // Light pink
    case 'TRIPLE_WORD': return '#FF0000'; // Red
    case 'CENTER': return '#FFD700'; // Gold
    default: return '#A9A9A9'; // Dark grey
  }
}
