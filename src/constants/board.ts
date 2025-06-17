import type { MultiplierType, BoardCell, Evocation, EvocationType } from '../types/game';
import { createEvocation } from './evocations';

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

function generateRandomEvocations(): Evocation[] {
  const evocationTypes: EvocationType[] = [
    'OROBAS', 'BUNE', 'GREMORY', 'ASTAROTH',
    'AIM', 'ANDROMALIUS', 'VALEFOR', 'DANTALION',
    'FURFUR', 'FORNEUS', 'MURMUR', 'HAAGENTI'
  ];
  const numEvocations = 10 + Math.floor(Math.random() * 6); // 10-15 evocations
  const selectedEvocations: Evocation[] = [];

  for (let i = 0; i < numEvocations; i++) {
    const randomType = evocationTypes[Math.floor(Math.random() * evocationTypes.length)];
    selectedEvocations.push(createEvocation(randomType));
  }

  return selectedEvocations;
}

function getValidEvocationPositions(): { row: number; col: number }[] {
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
  
  // Add random evocations
  const evocations = generateRandomEvocations();
  const validPositions = getValidEvocationPositions();
  
  // Shuffle positions and place evocations
  for (let i = validPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validPositions[i], validPositions[j]] = [validPositions[j], validPositions[i]];
  }
  
  evocations.forEach((evocation: Evocation, index: number) => {
    if (index < validPositions.length) {
      const { row, col } = validPositions[index];
      // For now, we'll store evocations in the powerUp field until we update the BoardCell type
      board[row][col].powerUp = evocation as any;
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
