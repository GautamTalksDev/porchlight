/**
 * Hybrid Logical Clock (Kulkarni et al., 2014).
 * Gives a total order that respects causality even when laptop clocks disagree,
 * which they will during an outage with no NTP.
 */
export interface HlcTimestamp {
  wall: number;
  logical: number;
  node: string;
}

export class HybridClock {
  private last: HlcTimestamp;

  constructor(
    private readonly node: string,
    private readonly now: () => number = Date.now,
  ) {
    this.last = { wall: 0, logical: 0, node };
  }

  tick(): HlcTimestamp {
    const pt = this.now();
    if (pt > this.last.wall) {
      this.last = { wall: pt, logical: 0, node: this.node };
    } else {
      this.last = { wall: this.last.wall, logical: this.last.logical + 1, node: this.node };
    }
    return { ...this.last };
  }

  /** Merge a remote timestamp so our next tick is causally after it. */
  observe(remote: HlcTimestamp): void {
    const pt = this.now();
    const wall = Math.max(pt, this.last.wall, remote.wall);
    let logical: number;
    if (wall === this.last.wall && wall === remote.wall) {
      logical = Math.max(this.last.logical, remote.logical) + 1;
    } else if (wall === this.last.wall) {
      logical = this.last.logical + 1;
    } else if (wall === remote.wall) {
      logical = remote.logical + 1;
    } else {
      logical = 0;
    }
    this.last = { wall, logical, node: this.node };
  }
}

export function encodeHlc(t: HlcTimestamp): string {
  return `${t.wall.toString().padStart(15, "0")}.${t.logical.toString().padStart(6, "0")}.${t.node}`;
}

export function decodeHlc(s: string): HlcTimestamp {
  const m = /^(\d{15})\.(\d{6})\.([0-9a-f]{16})$/.exec(s);
  if (!m) throw new Error(`invalid hlc: ${s}`);
  return { wall: Number(m[1]), logical: Number(m[2]), node: m[3]! };
}

/** Encoded HLCs sort lexically in causal order. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
