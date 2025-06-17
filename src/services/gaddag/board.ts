/* board.ts — Scrabble board data + incremental cross-check maintenance
 *
 * Exports
 * ─────────────────────────────────────────────────────────────
 *   BOARD_SIZE       15
 *   NUM_SQUARES      225
 *   index(r,c)       → 1-D index
 *   rowOf(i) / colOf(i)
 *   LETTER_MULT[i]   1 | 2 | 3
 *   WORD_MULT[i]     1 | 2 | 3
 *   class Board      (tiles + incremental refresh + generateMoves wrapper)
 *
 * Board depends on two other modules:
 *   • generator.ts  — exports BoardPosition and Move
 *   • gaddag.ts     — exports Gaddag
 *
 * Usage
 * ─────────────────────────────────────────────────────────────
 *   const words  = new Set<string>(...);         // dictionary
 *   const board  = new Board(words);             // empty board
 *   const gaddag = await buildGaddagFromFile(...);
 *
 *   const moves = board.generateMoves("QUIZZED?", gaddag);
 *   board.place(7, 7, "H", "QUIZ".split("").map(c => c.charCodeAt(0)));
 *   const moves2 = board.generateMoves("AEIOU??", gaddag);
 */

import { BoardPosition, Move } from "./generator";
import { Gaddag } from "./gaddag";

/* ─────────────────────────────────────────────────────────────
   Basic geometry helpers
   ───────────────────────────────────────────────────────────── */

export const BOARD_SIZE = 15;
export const NUM_SQUARES = BOARD_SIZE * BOARD_SIZE;

export const index = (r: number, c: number) => r * BOARD_SIZE + c;
export const rowOf = (i: number) => Math.floor(i / BOARD_SIZE);
export const colOf = (i: number) => i % BOARD_SIZE;

/* ─────────────────────────────────────────────────────────────
   Premium-square layouts  (same layout Quackle / Hasbro uses)
   Fill in the actual arrays you already had; placeholders below.
   ───────────────────────────────────────────────────────────── */

export const LETTER_MULT: number[] = new Array(NUM_SQUARES).fill(1);
export const WORD_MULT:   number[] = new Array(NUM_SQUARES).fill(1);

/* ---------- FILL IN THE PREMIUM SQUARES ---------- */
function fillPremiumSquares() {
  /* center star */
  WORD_MULT[index(7, 7)] = 2;

  /* triple-word */
  [index(0,0), index(0,14), index(14,0), index(14,14),
   index(0,7), index(7,0), index(7,14), index(14,7)]
    .forEach(i => WORD_MULT[i] = 3);

  /* double-word (diagonals) */
  [0, 1, 2, 3, 4, 7].forEach(d => {
    WORD_MULT[index(d,d)]                 = 2;
    WORD_MULT[index(d,14-d)]              = 2;
    WORD_MULT[index(14-d,d)]              = 2;
    WORD_MULT[index(14-d,14-d)]           = 2;
  });

  /* triple-letter */
  [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],
   [9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]
    .forEach(([r,c]) => {
      LETTER_MULT[index(r,c)]             = 3;
      LETTER_MULT[index(14-r,c)]          = 3;
      LETTER_MULT[index(r,14-c)]          = 3;
      LETTER_MULT[index(14-r,14-c)]       = 3;
    });

  /* double-letter */
  [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],
   [6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],
   [8,6],[8,8],[8,12],[11,0],[11,7],[11,14],
   [12,6],[12,8],[14,3],[14,11]]
    .forEach(([r,c]) => {
      LETTER_MULT[index(r,c)]             = 2;
      LETTER_MULT[index(14-r,c)]          = 2;
      LETTER_MULT[index(r,14-c)]          = 2;
      LETTER_MULT[index(14-r,14-c)]       = 2;
    });
}
fillPremiumSquares();   // ← run once at load time

/* ─────────────────────────────────────────────────────────────
   Board class
   ───────────────────────────────────────────────────────────── */

export class Board {
  /** 0 = empty; else 65-90 letter */
  readonly tiles = new Uint8Array(NUM_SQUARES);

  /** A-Z bitmask for each square (0 for occupied) */
  readonly crossMask = new Uint32Array(NUM_SQUARES);

  /** 1 = anchor square (adjacent to at least one tile) */
  readonly anchor = new Uint8Array(NUM_SQUARES);

  constructor(private readonly dict: ReadonlySet<string>) {
    this.fullRecompute();
  }

  /* ── getters / setters ── */
  get(r: number, c: number) { return this.tiles[index(r, c)]; }
  set(r: number, c: number, code: number) { this.tiles[index(r, c)] = code; }

  /* ─────────────────────────────────────────────────────────
     Public helpers
     ───────────────────────────────────────────────────────── */

  /**
   * Place a word on the board and update masks + anchors
   * @param r0  row of first letter
   * @param c0  col of first letter
   * @param dir "H" | "V"
   * @param codes  array of char codes (65-90) for the word
   */
  place(r0: number, c0: number, dir: "H" | "V", codes: number[]) {
    const [dr, dc] = dir === "H" ? [0, 1] : [1, 0];
    for (let i = 0; i < codes.length; ++i)
      this.set(r0 + dr * i, c0 + dc * i, codes[i]);
    this.incrementalRefresh(r0, c0, dir, codes.length);
  }

  /**
   * Convenience: call the move generator exactly like before.
   * Under the hood we build a BoardPosition snapshot and call its method.
   */
  generateMoves(rack: string, gaddag: Gaddag): Move[] {
    const pos = new BoardPosition(this.crossMask, this.anchor, this.tiles);
    return pos.generateMoves(rack, gaddag);
  }

  /* ─────────────────────────────────────────────────────────
     Internal: full recompute (startup or reset)
     ───────────────────────────────────────────────────────── */

  private fullRecompute() {
    const ALL_MASK = (1 << 26) - 1;
    this.crossMask.fill(ALL_MASK);
    this.anchor.fill(0);
    this.anchor[index(7, 7)] = 1; // center star

    /* occupied squares -> mask = 0 */
    for (let i = 0; i < NUM_SQUARES; ++i)
      if (this.tiles[i]) this.crossMask[i] = 0;

    for (let r = 0; r < BOARD_SIZE; ++r)
      for (let c = 0; c < BOARD_SIZE; ++c)
        if (!this.tiles[index(r, c)]) this.updateSquare(r, c);
	
	this.anchor[index(7, 7)] = 1;
  }

  /* ─────────────────────────────────────────────────────────
     Internal: incremental refresh after placing a word
     ───────────────────────────────────────────────────────── */

  private incrementalRefresh(r0: number, c0: number, dir: "H" | "V", len: number) {
    const [dr, dc] = dir === "H" ? [0, 1] : [1, 0];

    /* update every empty square in the two full lines that intersect the word */
    for (let i = -7; i <= len + 7; ++i) {
      /** horizontal line (row r0) if word vertical, and vice versa */
      const rr = dir === "H" ? rowOf(r0 * BOARD_SIZE + c0) : r0 + dr * i;
      const cc = dir === "H" ? c0 + i : colOf(r0 * BOARD_SIZE + c0);
      if (rr < 0 || cc < 0 || rr >= BOARD_SIZE || cc >= BOARD_SIZE) continue;
      if (!this.tiles[index(rr, cc)]) this.updateSquare(rr, cc);
    }
    for (let i = -7; i <= len + 7; ++i) {
      const rr = dir === "H" ? r0 + i : rowOf(r0 * BOARD_SIZE + c0);
      const cc = dir === "H" ? colOf(r0 * BOARD_SIZE + c0) : c0 + dc * i;
      if (rr < 0 || cc < 0 || rr >= BOARD_SIZE || cc >= BOARD_SIZE) continue;
      if (!this.tiles[index(rr, cc)]) this.updateSquare(rr, cc);
    }
  }

  /* ─────────────────────────────────────────────────────────
     Internal: recompute one empty square’s crossMask & anchor
     ───────────────────────────────────────────────────────── */

  private updateSquare(r: number, c: number) {
    const i = index(r, c);
    const ALL_MASK = (1 << 26) - 1;

    /* anchor flag */
    this.anchor[i] = (
      (r && this.tiles[index(r - 1, c)]) ||
      (r < BOARD_SIZE - 1 && this.tiles[index(r + 1, c)]) ||
      (c && this.tiles[index(r, c - 1)]) ||
      (c < BOARD_SIZE - 1 && this.tiles[index(r, c + 1)])
    ) ? 1 : 0;

    /* build vertical fragment (affects horizontal placements) */
    const above: number[] = [];
    for (let rr = r - 1; rr >= 0 && this.tiles[index(rr, c)]; --rr)
      above.unshift(this.tiles[index(rr, c)]);
    const below: number[] = [];
    for (let rr = r + 1; rr < BOARD_SIZE && this.tiles[index(rr, c)]; ++rr)
      below.push(this.tiles[index(rr, c)]);

    /* build horizontal fragment (affects vertical placements) */
    const left: number[] = [];
    for (let cc = c - 1; cc >= 0 && this.tiles[index(r, cc)]; --cc)
      left.unshift(this.tiles[index(r, cc)]);
    const right: number[] = [];
    for (let cc = c + 1; cc < BOARD_SIZE && this.tiles[index(r, cc)]; ++cc)
      right.push(this.tiles[index(r, cc)]);

    /* if no fragments in either direction, allow all letters */
    if (!above.length && !below.length && !left.length && !right.length) {
      this.crossMask[i] = ALL_MASK;
      return;
    }

    let mask = ALL_MASK; // start with all letters allowed

    /* restrict based on vertical fragment (for horizontal moves) */
    if (above.length || below.length) {
      let verticalMask = 0;
      const pre = String.fromCharCode(...above);
      const suf = String.fromCharCode(...below);
      for (let L = 65; L <= 90; ++L) {
        const candidate = pre + String.fromCharCode(L) + suf;
        if (this.dict.has(candidate)) verticalMask |= 1 << (L - 65);
      }
      mask &= verticalMask;
    }

    /* restrict based on horizontal fragment (for vertical moves) */
    if (left.length || right.length) {
      let horizontalMask = 0;
      const pre = String.fromCharCode(...left);
      const suf = String.fromCharCode(...right);
      for (let L = 65; L <= 90; ++L) {
        const candidate = pre + String.fromCharCode(L) + suf;
        if (this.dict.has(candidate)) horizontalMask |= 1 << (L - 65);
      }
      mask &= horizontalMask;
    }

    this.crossMask[i] = mask;
  }
}
