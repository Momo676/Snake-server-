import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_RADIUS,
  BOOST_DRAIN_PER_SEC,
  BOOST_DROP_MASS_THRESHOLD,
  BOOST_DROP_ORB_VALUE,
  ORB_EAT_MASS_FACTOR,
  checkBoundaryCollision,
  checkHeadBodyCollision,
  computeLeaderboard,
  computeSegmentCount,
  computeSnakeRadius,
  findSafeSpawnPoint,
  isDoubleTapWithinWindow,
  massToDisplayLength,
  normalizeAngle,
  stepAngleTowards,
  stepTouchStick,
  canAffordRoom,
  computeNormalizedZoom,
  distributePotAcrossFragments,
  formatEgp,
  roundEgp,
} from './rules';

test('mass scales radius, segment count, and display length monotonically', () => {
  assert.equal(massToDisplayLength(30), 300);
  assert.ok(computeSnakeRadius(100) > computeSnakeRadius(30));
  assert.ok(computeSegmentCount(100) > computeSegmentCount(30));
});

test('stepAngleTowards wraps cleanly across PI/-PI boundary', () => {
  const current = Math.PI - 0.1;
  const target = -Math.PI + 0.1;
  const next = stepAngleTowards(current, target, 0.3);
  assert.ok(Math.abs(normalizeAngle(next - target)) < 1e-6);
});

test('boundary collision triggers near arena perimeter and stays safe inside', () => {
  assert.equal(checkBoundaryCollision(0, 0, 15, ARENA_RADIUS), false);
  assert.equal(checkBoundaryCollision(ARENA_RADIUS - 200, 0, 15, ARENA_RADIUS), false);
  assert.equal(checkBoundaryCollision(ARENA_RADIUS - 5, 0, 15, ARENA_RADIUS), true);
});

test('head-to-body collision detects overlap accurately', () => {
  const defenderSegments = [
    { x: 100, y: 100 },
    { x: 112, y: 100 },
    { x: 124, y: 100 },
  ];
  assert.equal(
    checkHeadBodyCollision({ x: 112, y: 110 }, 14, defenderSegments, 14),
    true,
  );
  assert.equal(
    checkHeadBodyCollision({ x: 112, y: 150 }, 14, defenderSegments, 14),
    false,
  );
});

test('findSafeSpawnPoint keeps clear distance from active snakes and boundary', () => {
  const busySnakes = [
    {
      alive: true,
      x: 0,
      y: 0,
      segments: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    },
  ];
  let seed = 0.25;
  const deterministicRng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const spawn = findSafeSpawnPoint(busySnakes, ARENA_RADIUS, 300, deterministicRng);
  const distFromCenter = Math.hypot(spawn.x, spawn.y);
  assert.ok(distFromCenter < ARENA_RADIUS * 0.75);
  assert.ok(distFromCenter >= 300);
});

test('computeLeaderboard sorts descending and tracks player rank', () => {
  const snakes = [
    {
      id: 'b1',
      name: 'Alpha',
      mass: 80,
      isPlayer: false,
      alive: true,
      skin: { id: 'a', name: 'A', colors: ['#fff'], pattern: 'solid' as const, eyeStyle: 'fierce' as const },
    },
    {
      id: 'p1',
      name: 'You',
      mass: 50,
      isPlayer: true,
      alive: true,
      skin: { id: 'b', name: 'B', colors: ['#0f0'], pattern: 'solid' as const, eyeStyle: 'fierce' as const },
    },
    {
      id: 'b2',
      name: 'Dead',
      mass: 999,
      isPlayer: false,
      alive: false,
      skin: { id: 'c', name: 'C', colors: ['#f00'], pattern: 'solid' as const, eyeStyle: 'fierce' as const },
    },
  ];

  const lb = computeLeaderboard(snakes, 5);
  assert.equal(lb.totalAlive, 2);
  assert.equal(lb.playerRank, 2);
  assert.equal(lb.top[0].name, 'Alpha');
  assert.equal(lb.top[1].isPlayer, true);
});

test('stepTouchStick follows finger swipe and pulls anchor within leash radius', () => {
  const start = {
    anchorX: 300,
    anchorY: 700,
    currentX: 300,
    currentY: 700,
    hasDragged: false,
    angle: null,
  };

  // Tiny jitter inside 6px deadzone does not engage drag
  const jitter = stepTouchStick(start, 302, 701, 48, 6);
  assert.equal(jitter.hasDragged, false);
  assert.equal(jitter.angle, null);

  // Swipe right past 48px leash -> anchor pulls right behind finger
  const swipeRight = stepTouchStick(jitter, 400, 700, 48, 6);
  assert.equal(swipeRight.hasDragged, true);
  assert.ok(Math.abs((swipeRight.angle ?? 99) - 0) < 1e-6);
  assert.ok(Math.abs(swipeRight.anchorX - 352) < 1e-6);

  // Quick counter-swipe left reverses immediately
  const reverseSwipe = stepTouchStick(swipeRight, 340, 700, 48, 6);
  assert.ok(Math.abs(Math.abs(reverseSwipe.angle ?? 0) - Math.PI) < 1e-6);
});

test('room affordability, fragment EGP distribution, and double-tap boost timing', () => {
  assert.equal(canAffordRoom(25, 25), true);
  assert.equal(canAffordRoom(24, 25), false);
  assert.equal(canAffordRoom(100, 50), true);

  // 25 EGP split across 50 fragments = 0.50 EGP (50 cents) each
  const evenFragments = distributePotAcrossFragments(25, 25, 50);
  assert.equal(evenFragments.length, 50);
  assert.equal(evenFragments[0], 0.5);
  assert.equal(evenFragments[49], 0.5);
  assert.equal(
    roundEgp(evenFragments.reduce((sum, v) => sum + v, 0)),
    25,
  );

  // Non-divisible pot splits cleanly down to exact cents with zero loss
  const unevenFragments = distributePotAcrossFragments(37.5, 25, 47);
  assert.equal(unevenFragments.length, 47);
  assert.equal(
    roundEgp(unevenFragments.reduce((sum, v) => sum + v, 0)),
    37.5,
  );

  assert.equal(formatEgp(25), '25');
  assert.equal(formatEgp(25.5), '25.50');
  assert.equal(formatEgp(25.75), '25.75');

  assert.equal(isDoubleTapWithinWindow(null, 1000, 340), false);
  assert.equal(isDoubleTapWithinWindow(1000, 1250, 340), true);
  assert.equal(isDoubleTapWithinWindow(1000, 1450, 340), false);
});

test('normalized camera zoom equalizes visible map span across mobile, desktop-mode, iPad, and desktop', () => {
  const mobileZoom = computeNormalizedZoom(390, 844, 30);
  const desktopModeMobileZoom = computeNormalizedZoom(980, 1870, 30);
  const ipadZoom = computeNormalizedZoom(576, 1024, 30);
  const desktopZoom = computeNormalizedZoom(450, 800, 30);

  const spanMobile = 844 / mobileZoom;
  const spanDesktopMode = 1870 / desktopModeMobileZoom;
  const spanIpad = 1024 / ipadZoom;
  const spanDesktop = 800 / desktopZoom;

  assert.ok(Math.abs(spanMobile - spanDesktopMode) < 1e-6);
  assert.ok(Math.abs(spanMobile - spanIpad) < 1e-6);
  assert.ok(Math.abs(spanMobile - spanDesktop) < 1e-6);
  assert.ok(computeNormalizedZoom(450, 800, 200) < desktopZoom);
});

test('boosting drops sparse pebbles and drains far more mass than eating them recovers', () => {
  const dropsPerSecond = BOOST_DRAIN_PER_SEC / BOOST_DROP_MASS_THRESHOLD;
  assert.ok(dropsPerSecond <= 2.5);
  const massRecoveredPerDrop = BOOST_DROP_ORB_VALUE * ORB_EAT_MASS_FACTOR;
  assert.ok(massRecoveredPerDrop < BOOST_DROP_MASS_THRESHOLD * 0.25);
});

