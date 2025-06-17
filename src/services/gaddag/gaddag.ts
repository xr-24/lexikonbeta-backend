/*
 * gaddag.ts — Initial TypeScript port of Quackle’s GADDAG builder.
 *
 * Derived from Quackle (https://github.com/quackle/quackle) “gaddagfactory.cpp”.
 * Copyright © 2005‑2019 Jason Katz‑Brown, John O’Laughlin & John Fultz.
 * Ported to TypeScript 2025 by <Your Name>.
 *
 * This file is licensed under the GNU General Public License v3.0;
 * you may redistribute it and/or modify it under the terms of that
 * license.  See <https://www.gnu.org/licenses/gpl-3.0.html>.
 */

import { promises as fs } from "fs";

/**
 * Numeric representation for the special ‘pivot’ character used by
 * the GADDAG to separate the reversed prefix from the forward suffix.
 */
export const SEPARATOR_CODE = "_".codePointAt(0)!;

/**
 * A compact node store that mirrors Quackle’s contiguous‑array layout.
 *
 *  • `letters[i]`           – UTF‑16 code unit (0‑255) held by node *i*.
 *  • `firstChild[i]`        – index of first child node, or –1 if none.
 *  • `nextSibling[i]`       – index of next sibling node, or –1 if none.
 *  • `terminalMask[i]`      – 1 if node completes a word, 0 otherwise.
 */
export class Gaddag {
  private letters: Uint8Array;
  private firstChild: Int32Array;
  private nextSibling: Int32Array;
  private terminalMask: Uint8Array;

  private _size = 1; // node 0 is the root and remains empty

  constructor(initialCapacity = 1024) {
    this.letters = new Uint8Array(initialCapacity);
    this.firstChild = new Int32Array(initialCapacity).fill(-1);
    this.nextSibling = new Int32Array(initialCapacity).fill(-1);
    this.terminalMask = new Uint8Array(initialCapacity);
  }

  /** Number of nodes currently in the GADDAG. */
  get size() {
    return this._size;
  }

  /** Ensures that the underlying typed‑arrays can hold *n* additional nodes. */
  private ensureCapacity(extra: number) {
    const required = this._size + extra;
    if (required <= this.letters.length) return;

    const grow = Math.max(required, this.letters.length * 2);

    const growUint8 = (buf: Uint8Array) => {
      const n = new Uint8Array(grow);
      n.set(buf);
      return n;
    };

    const growInt32 = (buf: Int32Array) => {
      const n = new Int32Array(grow).fill(-1);
      n.set(buf);
      return n;
    };

    this.letters = growUint8(this.letters);
    this.firstChild = growInt32(this.firstChild);
    this.nextSibling = growInt32(this.nextSibling);
    this.terminalMask = growUint8(this.terminalMask);
  }

  /**
   * Create a new node that stores `letter` and return its index.
   */
  private newNode(letter: number): number {
    this.ensureCapacity(1);
    const idx = this._size++;
    this.letters[idx] = letter;
    return idx;
  }

  /**
   * Inserts a single *arc* (array of code‑points) into the GADDAG.
   * Identical sub‑paths are shared just like in Quackle’s factory.
   */
  private insertArc(arc: number[]) {
    let node = 0; // start from root
    for (const ch of arc) {
      // Walk the child list looking for `ch`.
      let child = this.firstChild[node];
      let prev: number | null = null;
      while (child !== -1 && this.letters[child] !== ch) {
        prev = child;
        child = this.nextSibling[child];
      }
      if (child === -1) {
        // Need to create a new sibling at tail of list.
        child = this.newNode(ch);
        if (prev === null) {
          this.firstChild[node] = child;
        } else {
          this.nextSibling[prev] = child;
        }
      }
      node = child;
    }
    // Mark final node as terminal.
    this.terminalMask[node] = 1;
  }

  /**
   * Add a word (already UPPER‑CASE) to the GADDAG following Gordon’s
   * construction rules.
   */
  addWord(word: string) {
    const codes = [...word].map((c) => c.codePointAt(0)!);
    // For every split position i (0..n‑1) build REV(prefix) + ‘_’ + suffix.
    for (let i = 0; i < codes.length; ++i) {
      const revPrefix = codes.slice(0, i).reverse();
      const suffix = codes.slice(i);
      const arc = [...revPrefix, SEPARATOR_CODE, ...suffix];
      this.insertArc(arc);
    }
  }

  /** Convenience accessors replicating Quackle’s API. */
  letter(idx: number): string {
    return String.fromCharCode(this.letters[idx]);
  }
  firstChildIndex(idx: number) {
    return this.firstChild[idx];
  }
  nextSiblingIndex(idx: number) {
    return this.nextSibling[idx];
  }
  isTerminal(idx: number) {
    return this.terminalMask[idx] === 1;
  }
}

/**
 * Load a plain‑text dictionary (one word per line, already uppercase)
 * and build a GADDAG.  Returns the populated instance.
 */
export async function buildGaddagFromFile(path: string) {
  const raw = await fs.readFile(path, "utf8");
  const gaddag = new Gaddag();
  for (const line of raw.split(/\r?\n/)) {
    const word = line.trim();
    if (word) gaddag.addWord(word);
  }
  return gaddag;
}

// --- Minimal smoke test when run via `ts-node gaddag.ts WORDLIST ---
if (require.main === module) {
  (async () => {
    const [_, __, dictPath] = process.argv;
    if (!dictPath) {
      console.error("Usage: ts-node gaddag.ts <dictionary.txt>");
      process.exit(1);
    }
    console.time("build");
    const g = await buildGaddagFromFile(dictPath);
    console.timeEnd("build");
    console.log(`Constructed GADDAG with ${g.size} nodes.`);
  })();
}
