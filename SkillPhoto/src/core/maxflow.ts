// Boykov–Kolmogorov max-flow / min-cut (the algorithm behind GrabCut-style segmentation).
// Integer capacities, flat typed arrays, arcs stored in sister pairs (a ^ 1 is the reverse arc).
// Source = foreground, sink = background.

const NONE = -1;
const TERMINAL = -2;
const ORPHAN = -3;
const INF = 0x3fffffff;

export class MaxFlow {
  readonly n: number;
  private first: Int32Array;
  private parent: Int32Array;
  private isSink: Uint8Array;
  private trCap: Int32Array;
  private dist: Int32Array;
  private ts: Int32Array;
  private head: Int32Array;
  private nextArc: Int32Array;
  private rCap: Int32Array;
  private arcs = 0;
  /** Flow pushed so far (the cut cost once `solve` returns). */
  flow = 0;

  private queue: Int32Array;
  private qHead = 0;
  private qLen = 0;
  private inQueue: Uint8Array;
  private orphans: number[] = [];
  private time = 0;

  constructor(nodes: number, maxEdges: number) {
    this.n = nodes;
    this.first = new Int32Array(nodes).fill(-1);
    this.parent = new Int32Array(nodes).fill(NONE);
    this.isSink = new Uint8Array(nodes);
    this.trCap = new Int32Array(nodes);
    this.dist = new Int32Array(nodes);
    this.ts = new Int32Array(nodes);
    this.head = new Int32Array(maxEdges * 2);
    this.nextArc = new Int32Array(maxEdges * 2);
    this.rCap = new Int32Array(maxEdges * 2);
    this.queue = new Int32Array(nodes);
    this.inQueue = new Uint8Array(nodes);
  }

  /** Edge i→j with capacity `cap` and j→i with `rev`. */
  addEdge(i: number, j: number, cap: number, rev: number) {
    const a = this.arcs;
    const b = a + 1;
    this.arcs += 2;
    this.head[a] = j;
    this.nextArc[a] = this.first[i];
    this.first[i] = a;
    this.rCap[a] = cap;
    this.head[b] = i;
    this.nextArc[b] = this.first[j];
    this.first[j] = b;
    this.rCap[b] = rev;
  }

  /** Terminal links: `src` is the cost of labelling i background, `snk` the cost of foreground. */
  addTWeights(i: number, src: number, snk: number) {
    const delta = this.trCap[i];
    if (delta > 0) src += delta;
    else snk -= delta;
    this.flow += Math.min(src, snk);
    this.trCap[i] = src - snk;
  }

  /** True when node i ends on the source (foreground) side of the minimum cut. */
  isSource(i: number) {
    return this.parent[i] !== NONE && !this.isSink[i];
  }

  private setActive(i: number) {
    if (this.inQueue[i]) return;
    this.inQueue[i] = 1;
    this.queue[(this.qHead + this.qLen) % this.n] = i;
    this.qLen++;
  }

  private nextActive(): number {
    while (this.qLen > 0) {
      const i = this.queue[this.qHead];
      this.qHead = (this.qHead + 1) % this.n;
      this.qLen--;
      this.inQueue[i] = 0;
      if (this.parent[i] !== NONE) return i;
    }
    return -1;
  }

  solve(): number {
    const { n, parent, isSink, trCap, dist, ts, head, nextArc, rCap, first } = this;
    for (let i = 0; i < n; i++) {
      if (trCap[i] > 0) {
        isSink[i] = 0;
        parent[i] = TERMINAL;
        dist[i] = 1;
        this.setActive(i);
      } else if (trCap[i] < 0) {
        isSink[i] = 1;
        parent[i] = TERMINAL;
        dist[i] = 1;
        this.setActive(i);
      } else parent[i] = NONE;
    }

    let cur = -1;
    for (;;) {
      let i = cur;
      if (i >= 0 && parent[i] === NONE) i = -1;
      if (i < 0) {
        i = this.nextActive();
        if (i < 0) break;
      }
      // Grow the tree of i until it touches the other tree
      let found = -1;
      if (!isSink[i]) {
        for (let a = first[i]; a !== -1; a = nextArc[a]) {
          if (rCap[a] <= 0) continue;
          const j = head[a];
          if (parent[j] === NONE) {
            isSink[j] = 0;
            parent[j] = a ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
            this.setActive(j);
          } else if (isSink[j]) {
            found = a;
            break;
          } else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
            parent[j] = a ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
          }
        }
      } else {
        for (let a = first[i]; a !== -1; a = nextArc[a]) {
          if (rCap[a ^ 1] <= 0) continue;
          const j = head[a];
          if (parent[j] === NONE) {
            isSink[j] = 1;
            parent[j] = a ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
            this.setActive(j);
          } else if (!isSink[j]) {
            found = a ^ 1;
            break;
          } else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
            parent[j] = a ^ 1;
            ts[j] = ts[i];
            dist[j] = dist[i] + 1;
          }
        }
      }
      this.time++;
      if (found >= 0) {
        cur = i;
        this.augment(found);
        this.adoptOrphans();
      } else cur = -1;
    }
    return this.flow;
  }

  /** Pushes the bottleneck along source-root → found arc → sink-root. */
  private augment(mid: number) {
    const { parent, head, rCap, trCap } = this;
    let b = rCap[mid];
    let i = head[mid ^ 1];
    for (;;) {
      const a = parent[i];
      if (a === TERMINAL) break;
      if (rCap[a ^ 1] < b) b = rCap[a ^ 1];
      i = head[a];
    }
    if (trCap[i] < b) b = trCap[i];
    i = head[mid];
    for (;;) {
      const a = parent[i];
      if (a === TERMINAL) break;
      if (rCap[a] < b) b = rCap[a];
      i = head[a];
    }
    if (-trCap[i] < b) b = -trCap[i];

    rCap[mid ^ 1] += b;
    rCap[mid] -= b;
    i = head[mid ^ 1];
    for (;;) {
      const a = parent[i];
      if (a === TERMINAL) break;
      rCap[a] += b;
      rCap[a ^ 1] -= b;
      if (rCap[a ^ 1] === 0) this.makeOrphan(i);
      i = head[a];
    }
    trCap[i] -= b;
    if (trCap[i] === 0) this.makeOrphan(i);
    i = head[mid];
    for (;;) {
      const a = parent[i];
      if (a === TERMINAL) break;
      rCap[a ^ 1] += b;
      rCap[a] -= b;
      if (rCap[a] === 0) this.makeOrphan(i);
      i = head[a];
    }
    trCap[i] += b;
    if (trCap[i] === 0) this.makeOrphan(i);
    this.flow += b;
  }

  private makeOrphan(i: number) {
    this.parent[i] = ORPHAN;
    this.orphans.push(i);
  }

  private adoptOrphans() {
    const list = this.orphans;
    for (let k = 0; k < list.length; k++) this.processOrphan(list[k]);
    list.length = 0;
  }

  private processOrphan(i: number) {
    const { parent, isSink, dist, ts, head, nextArc, rCap, first, time } = this;
    const sink = isSink[i] === 1;
    let best = -1;
    let dmin = INF;
    for (let a0 = first[i]; a0 !== -1; a0 = nextArc[a0]) {
      // Residual capacity toward i (source tree) or away from i (sink tree)
      if ((sink ? rCap[a0] : rCap[a0 ^ 1]) <= 0) continue;
      const j = head[a0];
      if (isSink[j] !== isSink[i] || parent[j] === NONE) continue;
      // Is j still connected to its terminal?
      let d = 0;
      let jj = j;
      for (;;) {
        if (ts[jj] === time) {
          d += dist[jj];
          break;
        }
        const a = parent[jj];
        d++;
        if (a === TERMINAL) {
          ts[jj] = time;
          dist[jj] = 1;
          break;
        }
        if (a === ORPHAN) {
          d = INF;
          break;
        }
        jj = head[a];
      }
      if (d < INF) {
        if (d < dmin) {
          best = a0;
          dmin = d;
        }
        for (jj = j; ts[jj] !== time; jj = head[parent[jj]]) {
          ts[jj] = time;
          dist[jj] = d--;
        }
      }
    }
    if (best >= 0) {
      parent[i] = best;
      ts[i] = time;
      dist[i] = dmin + 1;
      return;
    }
    parent[i] = NONE;
    for (let a0 = first[i]; a0 !== -1; a0 = nextArc[a0]) {
      const j = head[a0];
      const a = parent[j];
      if (isSink[j] !== isSink[i] || a === NONE) continue;
      if ((sink ? rCap[a0] : rCap[a0 ^ 1]) > 0) this.setActive(j);
      if (a !== TERMINAL && a !== ORPHAN && head[a] === i) this.makeOrphan(j);
    }
  }
}
