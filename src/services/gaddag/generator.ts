/* generator.ts – GADDAG move generator + leave-equity ordering
 * Copyright 2025  (your name) – GPLv3
 */
import {
  BOARD_SIZE, NUM_SQUARES, index, rowOf, colOf,
  LETTER_MULT, WORD_MULT
} from "./board";
import { Gaddag, SEPARATOR_CODE } from "./gaddag";
import { leaveEquity } from "./leave";

/* constants */
const BLANK     = "?";
const SCORE     = [1,3,3,2,1,4,2,4,1,8,5,1,3,1,1,3,10,1,1,1,1,4,4,8,4,10];
type Dir = "H" | "V";
const DELTA: Record<Dir,[number,number]> = { H:[0,1], V:[1,0] };

interface Built { code:number; blank:boolean; }

export interface Move {
  row:number; col:number; dir:Dir;
  word:string; score:number; rackLettersUsed:string;
  equity:number;               // ← NEW
}

/* ───────────── BoardPosition snapshot ───────────── */
export class BoardPosition {
  constructor(
    readonly mask  : Uint32Array,
    readonly anchor: Uint8Array,
    readonly tiles : Uint8Array
  ) {}

  /* main entry */
  generateMoves(rack:string, g:Gaddag): Move[] {
    const raw: Move[] = [];
    for (let i=0;i<NUM_SQUARES;++i) if (this.anchor[i])
      for (const d of ["H","V"] as const)
        this.left(i,d,rack,g,0,this.maxPref(i,d),raw,[]);
    return prune(dedupe(raw)).sort((a,b)=>b.equity-a.equity);
  }

  /* ───── prefix recursion ───── */
  private left(a:number,d:Dir,r:string,g:Gaddag,n:number,l:number,out:Move[],pre:Built[]){
    const pivot=child(g,n,SEPARATOR_CODE);
    if (pivot!==-1)
      this.right(a,d,r,g,pivot,out,[...pre,{code:SEPARATOR_CODE,blank:false}],0);

    if (!l) return;
    const [dr,dc]=DELTA[d];
    const rr=rowOf(a)-dr*(pre.length+1), cc=colOf(a)-dc*(pre.length+1);
    if (rr<0||cc<0||rr>=BOARD_SIZE||cc>=BOARD_SIZE) return;
    const idx=index(rr,cc);
    if (this.tiles[idx] || !this.mask[idx]) return;

    for (let i=0;i<r.length;++i){
      const ch=r[i];
      if (ch===BLANK){
        for (let L=65;L<=90;++L){
          if (!(this.mask[idx] & (1<<(L-65)))) continue;
          const nxt=child(g,n,L); if (nxt===-1) continue;
          this.left(a,d,r.slice(0,i)+r.slice(i+1),g,nxt,l-1,out,
                    [...pre,{code:L,blank:true}]);
        }
      } else {
        const code=ch.charCodeAt(0);
        if (!(this.mask[idx] & (1<<(code-65)))) continue;
        const nxt=child(g,n,code); if (nxt===-1) continue;
        this.left(a,d,r.slice(0,i)+r.slice(i+1),g,nxt,l-1,out,
                  [...pre,{code,blank:false}]);
      }
    }
  }

  /* ───── suffix recursion ───── */
  private right(a:number,d:Dir,r:string,g:Gaddag,n:number,out:Move[],
                built:Built[],off:number){
    const[dr,dc]=DELTA[d]; const rr=rowOf(a)+dr*off, cc=colOf(a)+dc*off;
    if (rr<0||cc<0||rr>=BOARD_SIZE||cc>=BOARD_SIZE) return;
    const idx=index(rr,cc);

    if (this.tiles[idx]){           /* extend over existing tile */
      const nxt=child(g,n,this.tiles[idx]); if (nxt===-1) return;
      built.push({code:this.tiles[idx],blank:false});
      if (g.isTerminal(nxt)) this.capture(a,d,built,out);
      this.right(a,d,r,g,nxt,out,built,off+1);
      built.pop(); return;
    }

    if (!this.mask[idx]) return;
    for (let i=0;i<r.length;++i){
      const ch=r[i];
      if (ch===BLANK){
        for (let L=65;L<=90;++L){
          if (!(this.mask[idx] & (1<<(L-65)))) continue;
          const nxt=child(g,n,L); if (nxt===-1) continue;
          built.push({code:L,blank:true});
          const newR=r.slice(0,i)+r.slice(i+1);
          if (g.isTerminal(nxt)) this.capture(a,d,built,out);
          this.right(a,d,newR,g,nxt,out,built,off+1);
          built.pop();
        }
      } else {
        const code=ch.charCodeAt(0);
        if (!(this.mask[idx] & (1<<(code-65)))) continue;
        const nxt=child(g,n,code); if (nxt===-1) continue;
        built.push({code,blank:false});
        const newR=r.slice(0,i)+r.slice(i+1);
        if (g.isTerminal(nxt)) this.capture(a,d,built,out);
        this.right(a,d,newR,g,nxt,out,built,off+1);
        built.pop();
      }
    }
  }

  /* ───── record a completed move ───── */
  private capture(a:number,d:Dir,tiles:Built[],out:Move[]){
    const sep=tiles.findIndex(t=>t.code===SEPARATOR_CODE);
    const pre=tiles.slice(0,sep).reverse(), suf=tiles.slice(sep+1);
    const wordTiles=[...pre,...suf]; if (!wordTiles.length) return;

    const sR=rowOf(a)-(d==="V"?pre.length:0);
    const sC=colOf(a)-(d==="H"?pre.length:0);
    const {total,placed}=this.score(sR,sC,d,wordTiles); if (!placed) return;

    const word = String.fromCharCode(...wordTiles.map(t=>t.code));
    const used = wordTiles.map(t =>
      t.blank ? String.fromCharCode(t.code).toLowerCase() : String.fromCharCode(t.code)
    ).join("");

    const leaveKey = "";            // we don't know full rack; assume empty
    const equity   = total + leaveEquity(leaveKey);

    out.push({ row:sR, col:sC, dir:d, word, score:total,
               rackLettersUsed:used, equity });
  }

  /* scoring helpers (unchanged) */
  private score(r0:number,c0:number,d:Dir,tiles:Built[]){
    const[dr,dc]=DELTA[d]; let word=0, mult=1, placed=0, cross=0;
    for (let i=0;i<tiles.length;++i){
      const r=r0+dr*i, c=c0+dc*i, idx=index(r,c);
      const {code,blank}=tiles[i]; const base=blank?0:SCORE[code-65];
      if (this.tiles[idx]) word+=base;
      else{
        placed++; word+=base*LETTER_MULT[idx]; mult*=WORD_MULT[idx];
        cross+=this.cross(r,c,d,base,blank);
      }
    }
    let total=word*mult+cross; if (placed===7) total+=50;
    return { total, placed };
  }
  private cross(r:number,c:number,m:Dir,base:number,blank:boolean){
    const p=m==="H"?"V":"H"; const[dr,dc]=DELTA[p];
    let before=0, after=0;
    for (let rr=r-dr,cc=c-dc; rr>=0&&cc>=0&&rr<BOARD_SIZE&&cc<BOARD_SIZE&&this.tiles[index(rr,cc)];
         rr-=dr,cc-=dc) before+=SCORE[this.tiles[index(rr,cc)]-65];
    for (let rr=r+dr,cc=c+dc; rr>=0&&cc>=0&&rr<BOARD_SIZE&&cc<BOARD_SIZE&&this.tiles[index(rr,cc)];
         rr+=dr,cc+=dc) after+=SCORE[this.tiles[index(rr,cc)]-65];
    if (!before&&!after) return 0;
    const idx=index(r,c); const l=blank?0:base*LETTER_MULT[idx];
    return (before+l+after)*WORD_MULT[idx];
  }
  private maxPref(i:number,d:Dir){const[dr,dc]=DELTA[d];
    let r=rowOf(i)-dr, c=colOf(i)-dc, dist=0;
    while(r>=0&&c>=0&&r<BOARD_SIZE&&c<BOARD_SIZE&&!this.tiles[index(r,c)]&&dist<7){
      dist++; r-=dr; c-=dc;
    } return dist; }
}

/* ───── utilities ───── */
function child(g:Gaddag,p:number,code:number){let n=g.firstChildIndex(p);
  while(n!==-1){ if (g.letter(n).charCodeAt(0)===code) return n;
                 n=g.nextSiblingIndex(n);} return -1; }

function dedupe(m:Move[]){
  const best=new Map<string,Move>();
  for (const mv of m){
    const k=`${mv.row}-${mv.col}-${mv.dir}-${mv.word}`;
    const prev=best.get(k);
    if (!prev || mv.score>prev.score) best.set(k,mv);
  }
  return [...best.values()];
}

function prune(m:Move[]){
  if (!m.length) return m;
  m.sort((a,b)=>b.score-a.score);
  const best=m[0].score, keep:Move[]=[];
  for (const mv of m){
    const placed=mv.rackLettersUsed.length;
    if (mv.score>=best-20 || placed>=6) keep.push(mv);
    if (keep.length>=500) break;
  }
  return keep;
}
