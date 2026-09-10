import type { Character, Task } from "@queuest/domain";

/**
 * Data-driven 12x14 pixel sprite. Every frame is a list of row strings; each
 * character is a palette key. `.` is transparent, and in job overlays `.`
 * means "keep the pose pixel".
 */
export const SPRITE_WIDTH = 12;
export const SPRITE_HEIGHT = 14;

export const SPRITE_STATES = ["idle", "doing", "review", "done", "blocked"] as const;
export type SpriteState = (typeof SPRITE_STATES)[number];
export type SpriteJob = Character["job"];

export const SPRITE_JOBS: readonly SpriteJob[] = ["developer", "planner", "designer"];

type Grid = readonly string[];

const BASE_PALETTE = {
  k: "#2d2a25", // ink outline
  e: "#2d2a25", // eyes
  s: "#f0c9a3", // skin
  h: "#4a3a2c", // hair
  p: "#4e4a44", // trousers
  w: "#fffdf5", // paper white
  r: "#a85c3a", // blocked / error
} as const;

/** Job outfit (`j`) and accent (`a`) in the gold/teal/rust language. */
const JOB_PALETTE: Record<SpriteJob, { j: string; a: string }> = {
  developer: { j: "#176b68", a: "#f4d98b" },
  planner: { j: "#f4d98b", a: "#176b68" },
  designer: { j: "#d88955", a: "#176b68" },
};

// Shared body poses. Two frames per state; frame 1 is the motion frame.
const POSES: Record<SpriteState, readonly [Grid, Grid]> = {
  idle: [
    [
      "....hhhh....",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      "...ssssss...",
      "..jjjjjjjj..",
      ".jjjjjjjjjj.",
      ".sjjjjjjjjs.",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
    [
      "....hhhh....",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssksskss..", // blink
      "..ssssssss..",
      "...ssssss...",
      "..jjjjjjjj..",
      ".jjjjjjjjjj.",
      ".sjjjjjjjjs.",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
  ],
  doing: [
    [
      "....hhhh....",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      "...ssssss...",
      "..jjjjjjjj..",
      ".jjjjjjjjjj.",
      ".jjsjjjjsjj.", // hands forward, typing
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
    [
      "....hhhh....",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      "...ssssss...",
      "..jjjjjjjj..",
      ".jjjjjjjjjj.",
      ".jjjsjjsjjj.", // alternate key
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
  ],
  review: [
    [
      "....hhhh..w.",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      "...ssssss.s.", // hand on chin
      "..jjjjjjjjs.",
      ".jjjjjjjjjj.",
      ".sjjjjjjjj..",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
    [
      "....hhhh.ww.",
      "...hhhhhh.w.",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      "...ssssss.s.",
      "..jjjjjjjjs.",
      ".jjjjjjjjjj.",
      ".sjjjjjjjj..",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
  ],
  done: [
    [
      "....hhhh....",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      ".s.ssssss.s.", // arms up
      ".sjjjjjjjjs.",
      "..jjjjjjjj..",
      "..jjjjjjjj..",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
    [
      "a...hhhh...a", // sparkles
      "...hhhhhh...",
      "..hssssssh..",
      "..ssessess..",
      "..ssssssss..",
      ".s.ssssss.s.",
      ".sjjjjjjjjs.",
      "..jjjjjjjj..",
      "..jjjjjjjj..",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
  ],
  blocked: [
    [
      "....hhhh...r", // exclamation mark
      "...hhhhhh..r",
      "..hssssssh..",
      "..ssessess.r",
      "..ssssssss..",
      "...ssssss...",
      "..jjjjjjjj..",
      ".jjjjjjjjjj.",
      "..jsjjjjsj..", // arms crossed
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
    [
      "....hhhh....",
      "...hhhhhh...",
      "..hssssssh..",
      "..ssksskss..",
      "..ssssssss..",
      "...ssssss...",
      "..jjjjjjjj..",
      ".jjjjjjjjjj.",
      "..jsjjjjsj..",
      "..jjjjjjjj..",
      "..pppppppp..",
      "..ppp..ppp..",
      "..ppp..ppp..",
      ".kkkk..kkkk.",
    ],
  ],
};

// Job overlays give each class a silhouette that reads at 12px: headset,
// glasses+clipboard, beret+brush.
const JOB_OVERLAYS: Record<SpriteJob, Grid> = {
  developer: [
    "...kkkkkk...", // headset band
    "............",
    "............",
    ".k........k.", // ear cups
    "............",
    "............",
    "............",
    "............",
    ".....aa.....", // badge
    "............",
    "............",
    "............",
    "............",
    "............",
  ],
  planner: [
    "............",
    ".........a..", // hair tie
    "............",
    "...k.kk.k...", // glasses
    "............",
    "............",
    "............",
    "..........w.", // clipboard
    "..........w.",
    "..........w.",
    "............",
    "............",
    "............",
    "............",
  ],
  designer: [
    "...aaaaa....", // beret
    "..aaaaaaa...",
    "............",
    "............",
    "...r........", // paint smudge
    "............",
    "..........a.", // brush tip
    "..........k.", // brush handle
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
  ],
};

export interface SpritePixel {
  x: number;
  y: number;
  fill: string;
}

function isSpriteJob(value: string): value is SpriteJob {
  return (SPRITE_JOBS as readonly string[]).includes(value);
}

/** Versioned appearance stored in the existing spriteId column; legacy ids remain valid. */
export interface SpriteAppearance {
  style: SpriteJob;
  skin: string;
  hair: string;
  outfit: string;
}

export const APPEARANCE_COLORS = {
  skin: ["#f0c9a3", "#ffe0bd", "#d9a477", "#ad7550", "#754a35"],
  hair: ["#4a3a2c", "#252528", "#b87938", "#ddd3bd", "#865b91"],
  outfit: ["#176b68", "#f4d98b", "#d88955", "#647db0", "#865b91"],
} as const;

export function encodeSpriteAppearance(appearance: SpriteAppearance): string {
  return ["v1", appearance.style, appearance.skin, appearance.hair, appearance.outfit].join(":");
}

export function resolveSpriteAppearance(character: Pick<Character, "job" | "spriteId">): SpriteAppearance {
  const [version, style, skin, hair, outfit, extra] = character.spriteId.split(":");
  if (version === "v1" && isSpriteJob(style) && extra === undefined &&
      [skin, hair, outfit].every((color) => /^#[0-9a-f]{6}$/i.test(color ?? ""))) {
    return { style, skin, hair, outfit };
  }
  const fallback = isSpriteJob(character.spriteId) ? character.spriteId : character.job;
  return { style: fallback, skin: BASE_PALETTE.s, hair: BASE_PALETTE.h, outfit: JOB_PALETTE[fallback].j };
}

export function resolveSpriteJob(character: Pick<Character, "job" | "spriteId">): SpriteJob {
  return resolveSpriteAppearance(character).style;
}

export function composeSpriteFrame(job: SpriteJob, state: SpriteState, frame: 0 | 1): Grid {
  const pose = POSES[state][frame];
  const overlay = JOB_OVERLAYS[job];
  return pose.map((row, y) =>
    row
      .split("")
      .map((cell, x) => (overlay[y][x] === "." ? cell : overlay[y][x]))
      .join(""),
  );
}

export function spriteFrameToPixels(job: SpriteJob, grid: Grid, appearance?: SpriteAppearance): SpritePixel[] {
  const palette: Record<string, string> = { ...BASE_PALETTE, ...JOB_PALETTE[job] };
  if (appearance) Object.assign(palette, { s: appearance.skin, h: appearance.hair, j: appearance.outfit });
  const pixels: SpritePixel[] = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const key = row[x];
      if (key === ".") continue;
      const fill = palette[key];
      if (!fill) throw new Error(`Unknown sprite palette key "${key}" at ${x},${y}`);
      pixels.push({ x, y, fill });
    }
  });
  return pixels;
}

export const SPRITE_STATE_LABEL: Record<SpriteState, string> = {
  idle: "대기 중",
  doing: "작업 중",
  review: "검토 중",
  done: "완료",
  blocked: "막힘",
};

/** Mood of the character derived from the tasks it currently owns. */
export function deriveSpriteState(tasks: readonly Pick<Task, "status" | "blocked">[]): SpriteState {
  if (tasks.some((task) => task.blocked && task.status !== "done")) return "blocked";
  if (tasks.some((task) => task.status === "doing")) return "doing";
  if (tasks.some((task) => task.status === "review")) return "review";
  if (tasks.length > 0 && tasks.every((task) => task.status === "done")) return "done";
  return "idle";
}

/** Double the drawing grid while retaining the original silhouette and animation. */
export function refineSpritePixels(pixels: readonly SpritePixel[]): SpritePixel[] {
  const cells = new Map(pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel.fill]));
  const shade = (hex: string, amount: number) => "#" + [1, 3, 5].map((offset) =>
    Math.max(0, Math.min(255, parseInt(hex.slice(offset, offset + 2), 16) + amount))
      .toString(16).padStart(2, "0")).join("");
  return pixels.flatMap(({ x, y, fill }) => {
    const topEdge = cells.get(`${x},${y - 1}`) !== fill;
    const bottomEdge = cells.get(`${x},${y + 1}`) !== fill;
    // Keep eyes and ink crisp; model only the surfaces around them.
    const ink = fill === BASE_PALETTE.k;
    return [0, 1].flatMap((dy) => [0, 1].map((dx) => ({
      x: x * 2 + dx,
      y: y * 2 + dy,
      fill: ink ? fill : shade(fill, dy === 0 && topEdge ? 12 : dy === 1 && bottomEdge ? -16 : 0),
    })));
  });
}
