import type { LeaderboardEntry, Snake, Vec2 } from './types';

export const ARENA_RADIUS = 2200;
export const INITIAL_PLAYER_MASS = 30;
export const MIN_BOOST_MASS = 16;
export const BOOST_DRAIN_PER_SEC = 2.4;
export const BOOST_DROP_MASS_THRESHOLD = 1.6;
export const BOOST_DROP_ORB_VALUE = 0.55;
export const ORB_EAT_MASS_FACTOR = 0.45;
export const BASE_SPEED = 225;
export const BOOST_SPEED = 415;

/** Visual score / length displayed to the player */
export function massToDisplayLength(mass: number): number {
  return Math.max(10, Math.round(mass * 10));
}

/** Head and body segment radius scales smoothly with square root of mass */
export function computeSnakeRadius(mass: number): number {
  return Math.min(34, 11 + Math.sqrt(Math.max(10, mass)) * 0.85);
}

/** Number of visible body segments from head to tail */
export function computeSegmentCount(mass: number): number {
  return Math.min(260, Math.max(10, Math.floor(8 + mass * 0.42)));
}

/** Spacing between consecutive segment centers along the path */
export function computeSegmentSpacing(radius: number): number {
  return Math.max(5.5, radius * 0.56);
}

/** Slightly tighter turns when small, heavier sweep when giant */
export function computeTurnRate(mass: number): number {
  const sizeFactor = Math.min(1, Math.max(0, (mass - 20) / 400));
  return 5.4 - sizeFactor * 2.1; // rad/s
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function stepAngleTowards(
  current: number,
  target: number,
  maxDelta: number,
): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

export function checkBoundaryCollision(
  headX: number,
  headY: number,
  headRadius: number,
  arenaRadius: number = ARENA_RADIUS,
): boolean {
  const distSq = headX * headX + headY * headY;
  const limit = arenaRadius - headRadius * 0.7;
  return distSq >= limit * limit;
}

/**
 * Checks if an attacker's head overlaps any segment of a defender snake.
 * Uses a fair hitbox slightly tighter than visual radius (0.88x) so near-misses feel great.
 */
export function checkHeadBodyCollision(
  attackerHead: Vec2,
  attackerRadius: number,
  defenderSegments: Vec2[],
  defenderRadius: number,
): boolean {
  if (defenderSegments.length === 0) return false;
  const hitDist = (attackerRadius + defenderRadius) * 0.84;
  const hitDistSq = hitDist * hitDist;

  for (let i = 0; i < defenderSegments.length; i++) {
    const seg = defenderSegments[i];
    const dx = attackerHead.x - seg.x;
    const dy = attackerHead.y - seg.y;
    if (dx * dx + dy * dy <= hitDistSq) {
      return true;
    }
  }
  return false;
}

/**
 * Finds an open spawn coordinate inside the arena well clear of existing snakes and the boundary.
 */
export function findSafeSpawnPoint(
  snakes: Pick<Snake, 'alive' | 'segments' | 'x' | 'y'>[],
  arenaRadius: number = ARENA_RADIUS,
  minClearance: number = 320,
  rng: () => number = Math.random,
): { x: number; y: number; angle: number } {
  const maxSpawnR = arenaRadius * 0.65;
  let best = { x: 0, y: 0, minDistSq: -1 };

  for (let attempt = 0; attempt < 24; attempt++) {
    const theta = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * maxSpawnR;
    const cx = Math.cos(theta) * r;
    const cy = Math.sin(theta) * r;

    let nearestSq = Infinity;
    for (const s of snakes) {
      if (!s.alive) continue;
      if (s.segments.length === 0) {
        const dx = cx - s.x;
        const dy = cy - s.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < nearestSq) nearestSq = dSq;
      } else {
        for (let i = 0; i < s.segments.length; i += 3) {
          const seg = s.segments[i];
          const dx = cx - seg.x;
          const dy = cy - seg.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < nearestSq) nearestSq = dSq;
        }
      }
    }

    if (nearestSq >= minClearance * minClearance) {
      const inwardAngle = Math.atan2(-cy, -cx) + (rng() - 0.5) * 0.9;
      return { x: cx, y: cy, angle: normalizeAngle(inwardAngle) };
    }

    if (nearestSq > best.minDistSq) {
      best = { x: cx, y: cy, minDistSq: nearestSq };
    }
  }

  const fallbackAngle = Math.atan2(-best.y, -best.x);
  return { x: best.x, y: best.y, angle: normalizeAngle(fallbackAngle) };
}

export function computeLeaderboard(
  snakes: Pick<Snake, 'id' | 'name' | 'mass' | 'isPlayer' | 'alive' | 'skin'>[],
  topN: number = 5,
): { top: LeaderboardEntry[]; playerRank: number; totalAlive: number } {
  const alive = snakes
    .filter((s) => s.alive)
    .sort((a, b) => b.mass - a.mass);

  let playerRank = 0;
  const entries: LeaderboardEntry[] = alive.map((s, idx) => {
    const rank = idx + 1;
    if (s.isPlayer) playerRank = rank;
    return {
      id: s.id,
      name: s.name,
      length: massToDisplayLength(s.mass),
      isPlayer: s.isPlayer,
      rank,
      accentColor: s.skin.colors[0] || '#A3E635',
    };
  });

  return {
    top: entries.slice(0, topN),
    playerRank,
    totalAlive: alive.length,
  };
}

export interface TouchStickState {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
  hasDragged: boolean;
  angle: number | null;
}

/**
 * Floating follow-anchor virtual thumbstick for mobile swipe steering.
 * Steers along finger swipe vector immediately after crossing deadzone,
 * and pulls the anchor along at a tight maxRadius leash so reversing direction
 * only requires a short counter-swipe anywhere on screen.
 */
export function stepTouchStick(
  stick: TouchStickState,
  nextX: number,
  nextY: number,
  maxRadius: number = 48,
  deadzone: number = 6,
): TouchStickState {
  let anchorX = stick.anchorX;
  let anchorY = stick.anchorY;
  let dx = nextX - anchorX;
  let dy = nextY - anchorY;
  let dist = Math.hypot(dx, dy);

  if (dist < deadzone && !stick.hasDragged) {
    return {
      anchorX,
      anchorY,
      currentX: nextX,
      currentY: nextY,
      hasDragged: false,
      angle: stick.angle,
    };
  }

  if (dist > maxRadius) {
    const ratio = (dist - maxRadius) / dist;
    anchorX += dx * ratio;
    anchorY += dy * ratio;
    dx = nextX - anchorX;
    dy = nextY - anchorY;
    dist = maxRadius;
  }

  const angle = dist >= deadzone ? Math.atan2(dy, dx) : stick.angle;
  return {
    anchorX,
    anchorY,
    currentX: nextX,
    currentY: nextY,
    hasDragged: true,
    angle,
  };
}

export const ROOM_STAKES = [25, 50, 100] as const;
export const CASH_OUT_HOLD_MS = 3000;
export const DOUBLE_TAP_WINDOW_MS = 340;

export function canAffordRoom(walletEgp: number, stake: number): boolean {
  return Number.isFinite(walletEgp) && walletEgp >= stake && stake > 0;
}

export function isDoubleTapWithinWindow(
  lastTapMs: number | null,
  currentTapMs: number,
  windowMs: number = DOUBLE_TAP_WINDOW_MS,
): boolean {
  if (lastTapMs === null) return false;
  const delta = currentTapMs - lastTapMs;
  return delta >= 0 && delta <= windowMs;
}

export function roundEgp(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatEgp(amount: number): string {
  const rounded = roundEgp(amount);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Splits a defeated snake's EGP pot across its dropped body fragments
 * down to exact piasters (cents) so the fragments sum precisely to the snake's pot.
 */
export function distributePotAcrossFragments(
  victimPotEgp: number,
  roomStake: number,
  fragmentCount: number,
): number[] {
  const totalEgp = Math.max(roomStake, roundEgp(victimPotEgp));
  const count = Math.max(1, Math.floor(fragmentCount));
  const totalPiasters = Math.round(totalEgp * 100);
  const basePiasters = Math.floor(totalPiasters / count);
  const remainder = totalPiasters % count;

  const values: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const piasters = basePiasters + (i < remainder ? 1 : 0);
    values[i] = piasters / 100;
  }
  return values;
}

export const BASE_WORLD_VIEW_WIDTH = 1575;
export const BASE_WORLD_VIEW_HEIGHT = 2800;

/**
 * Normalizes camera zoom across mobile, desktop-mode mobile, iPad, and desktop
 * so high-resolution or desktop-mode viewports cannot see a larger portion of the map.
 */
export function computeNormalizedZoom(
  viewportWidth: number,
  viewportHeight: number,
  mass: number,
): number {
  const safeW = Math.max(240, viewportWidth);
  const safeH = Math.max(320, viewportHeight);
  const refZoom = Math.max(
    safeW / BASE_WORLD_VIEW_WIDTH,
    safeH / BASE_WORLD_VIEW_HEIGHT,
  );
  const massScale = Math.max(0.68, 1 - Math.sqrt(Math.max(10, mass)) * 0.015);
  return refZoom * massScale;
}
