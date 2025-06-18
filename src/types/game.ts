export interface Tile {
  letter: string;
  value: number;
  id: string;
  isPowerUp?: boolean;
  powerUpType?: PowerUpType;
  emoji?: string;
  isBlank?: boolean;
  chosenLetter?: string;
  placedByPlayerId?: string;
}

export interface PowerUp {
  id: string;
  type: PowerUpType;
  emoji: string;
  name: string;
  description: string;
}

export type PowerUpType = 
  | 'SCROLL'           // 📜 - unlimited tile usage
  | 'HEADSTONE'        // 🪦 - swap all tiles with vowel guarantee
  | 'WILTED_ROSE'      // 🥀 - swap tiles with opponent
  | 'CRESCENT_MOON'    // 🌙 - add extra blank tile
  | 'BURN'             // 🔥 - choose 2 tiles to force opponent to discard
  | 'TILE_THIEF'       // 🗡️ - steal 1 tile from opponent's rack
  | 'MULTIPLIER_THIEF' // 💎 - steal a DW/TW from the board
  | 'DUPLICATE'        // 🪞 - copy one of your own tiles
  | 'EXTRA_TURN'       // 🔄 - play again after current turn
  | 'TILE_FREEZE'      // 🧊 - freeze a board tile, opponents can't connect to it
  | 'SILENCE'          // 🤐 - lock 3 random opponent tiles for their next turn
  | 'EXTRA_TILES';     // 📦 - get 3 bonus tiles for that turn only (10/7 rack)

export interface Evocation {
  id: string;
  type: EvocationType;
  name: string;
  description: string;
  color: string; // pentagram color
}

export type EvocationType = 
  | 'OROBAS'           // unlimited tile usage
  | 'BUNE'             // fresh rack with vowels
  | 'GREMORY'          // swap racks with opponent
  | 'ASTAROTH'         // add blank tile
  | 'AIM'              // force opponent discard 2
  | 'ANDROMALIUS'      // steal 1 tile
  | 'VALEFOR'          // steal multiplier
  | 'DANTALION'        // duplicate tile
  | 'FURFUR'           // extra turn
  | 'FORNEUS'          // freeze tile
  | 'MURMUR'           // lock 3 opponent tiles
  | 'HAAGENTI';        // expand rack to 10

export interface Intercession {
  id: string;
  type: IntercessionsType;
  name: string;
  description: string;
  cooldown: number;
  currentCooldown: number;
}

export type IntercessionsType =
  | 'MICHAEL'          // 30 direct damage
  | 'SAMAEL'           // double damage next word
  | 'RAPHAEL'          // heal 50 HP
  | 'URIEL'            // 50% damage reduction next turn
  | 'GABRIEL'          // auto-play best word
  | 'METATRON';        // heal 100 HP

export interface BoardCell {
  tile: Tile | null;
  multiplier: MultiplierType | null;
  powerUp: PowerUp | null; // Legacy field - now stores evocations
  evocation?: Evocation | null; // New field for evocations
}

export type MultiplierType = 
  | 'DOUBLE_LETTER' 
  | 'TRIPLE_LETTER' 
  | 'DOUBLE_WORD' 
  | 'TRIPLE_WORD' 
  | 'CENTER';

export interface Player {
  id: string;
  name: string;
  tiles: Tile[];
  score: number;
  hp: number;
  hasEndedGame: boolean;
  activePowerUps: PowerUp[];
  activePowerUpForTurn: PowerUp | null;
  evocations: Evocation[];
  intercessions: Intercession[];
  tileColor?: string;
  isAI?: boolean;
  aiPersonality?: string;
  // Intercession effects
  samaelDoubleDamage?: boolean;  // Next word deals double damage
  urielProtection?: boolean;     // 50% damage reduction next turn
  silencedTiles?: string[];      // Tiles locked for current turn
  // Evocation effects
  hasExtraTurn?: boolean;        // FURFUR evocation grants extra turn
}

export interface GameState {
  board: BoardCell[][];
  players: Player[];
  currentPlayerIndex: number;
  tileBag: Tile[];
  gamePhase: 'SETUP' | 'PLAYING' | 'FINISHED';
  turnNumber: number;
  playersEndedGame: string[];
  moveHistory: MoveHistoryEntry[];
}

export interface PlacedTile {
  tile: Tile;
  row: number;
  col: number;
}

export interface WordPlacement {
  word: string;
  tiles: PlacedTile[];
  direction: 'HORIZONTAL' | 'VERTICAL';
  startRow: number;
  startCol: number;
}

export interface MoveHistoryEntry {
  playerId: string;
  playerName: string;
  turnNumber: number;
  moveType: 'WORD' | 'EXCHANGE' | 'PASS' | 'EVOCATION' | 'INTERCESSION';
  words?: string[];
  score: number;
  timestamp: Date;
  // Spell information
  spellType?: 'EVOCATION' | 'INTERCESSION';
  spellName?: string;
  spellEffect?: string;
  // Damage information
  damageDealt?: number;
  damageTarget?: string;
}
