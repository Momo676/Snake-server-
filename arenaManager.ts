import type {
  ArenaBurstEvent,
  ClientMessage,
  SerializedOrb,
  SerializedSnake,
  ServerMessage,
  ServerRunSummary,
} from '../game/netTypes.ts';
import {
  ARENA_RADIUS,
  BASE_SPEED,
  BOOST_DRAIN_PER_SEC,
  BOOST_DROP_MASS_THRESHOLD,
  BOOST_DROP_ORB_VALUE,
  BOOST_SPEED,
  CASH_OUT_HOLD_MS,
  checkBoundaryCollision,
  checkHeadBodyCollision,
  computeLeaderboard,
  computeSegmentCount,
  computeSegmentSpacing,
  computeSnakeRadius,
  computeTurnRate,
  distributePotAcrossFragments,
  findSafeSpawnPoint,
  INITIAL_PLAYER_MASS,
  massToDisplayLength,
  MIN_BOOST_MASS,
  normalizeAngle,
  ORB_EAT_MASS_FACTOR,
  ROOM_STAKES,
  roundEgp,
  stepAngleTowards,
} from '../game/rules.ts';
import { getSegmentColor, PRESET_SKINS } from '../game/skins.ts';
import type {
  BotPolicy,
  EyeStyle,
  Orb,
  RoomStake,
  SkinDefinition,
  SkinPattern,
  Snake,
  Vec2,
} from '../game/types.ts';

const BOT_NAMES = [
  'NoodleKing',
  'Vortex99',
  'CoilZ',
  'SnackAttack',
  'MambaJamba',
  'ByteSnek',
  'SlipperyPete',
  'HexFang',
  'TurboWorm',
  'WiggleRoom',
  'SlyCobra',
  'ZebraCoil',
  'PrismBite',
  'ApexTail',
  'LootGoblin',
  'LoopMaster',
  'Sidewinder',
  'NeonFang',
];

const ORB_COLORS = [
  '#A3E635',
  '#38BDF8',
  '#FBBF24',
  '#F43F5E',
  '#2DD4BF',
  '#FB923C',
  '#E879F9',
];

const VALID_PATTERNS = new Set<SkinPattern>([
  'striped',
  'gradient',
  'spotted',
  'solid',
  'ringed',
]);
const VALID_EYES = new Set<EyeStyle>(['fierce', 'wide', 'cyber', 'cute']);
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export const SERVER_TICK_HZ = 25;
export const TARGET_MIN_SNAKES = 16;
export const TARGET_AMBIENT_ORBS = 55;

export interface ClientTransport {
  id: string;
  send: (message: ServerMessage) => void;
}

interface ServerSnake extends Snake {
  isHuman: boolean;
  clientId: string | null;
  wantsBoost: boolean;
  boostDropAccum: number;
  cashOutHoldStartMs: number | null;
  joinedAtMs: number;
  peakLength: number;
  peakRank: number;
}

interface ClientSubscription {
  transport: ClientTransport;
  roomStake: RoomStake;
  snakeId: string | null;
  needsFullOrbSync: boolean;
}

interface ArenaRoom {
  stake: RoomStake;
  snakes: ServerSnake[];
  orbs: Orb[];
  pendingEvents: ArenaBurstEvent[];
  nextOrbId: number;
  nextBotId: number;
  nextPlayerSeq: number;
  tick: number;
  orbsDirty: boolean;
  clients: Set<string>;
  interval: ReturnType<typeof setInterval> | null;
  lastStepMs: number;
}

function sanitizeRoomStake(raw: unknown): RoomStake {
  return ROOM_STAKES.includes(raw as RoomStake) ? (raw as RoomStake) : 25;
}

function sanitizeSkin(raw: unknown): SkinDefinition {
  if (!raw || typeof raw !== 'object') return PRESET_SKINS[0];
  const candidate = raw as Partial<SkinDefinition>;
  const colors = Array.isArray(candidate.colors)
    ? candidate.colors.filter((c) => typeof c === 'string' && HEX_COLOR_RE.test(c)).slice(0, 5)
    : [];
  return {
    id: typeof candidate.id === 'string' ? candidate.id.slice(0, 32) : 'custom',
    name: typeof candidate.name === 'string' ? candidate.name.slice(0, 32) : 'Serpent',
    colors: colors.length > 0 ? colors : PRESET_SKINS[0].colors,
    pattern: VALID_PATTERNS.has(candidate.pattern as SkinPattern)
      ? (candidate.pattern as SkinPattern)
      : 'striped',
    eyeStyle: VALID_EYES.has(candidate.eyeStyle as EyeStyle)
      ? (candidate.eyeStyle as EyeStyle)
      : 'fierce',
    trait: typeof candidate.trait === 'string' ? candidate.trait.slice(0, 48) : undefined,
    isCustom: Boolean(candidate.isCustom),
  };
}

function sanitizeCallsign(raw: unknown): string {
  if (typeof raw !== 'string') return 'Bruhv';
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 16);
  return cleaned || 'Bruhv';
}

export class ArenaRoomManager {
  private rooms = new Map<RoomStake, ArenaRoom>();
  private clients = new Map<string, ClientSubscription>();
  private autoTickEnabled: boolean;

  constructor(options?: { autoTick?: boolean }) {
    this.autoTickEnabled = options?.autoTick ?? true;
    for (const stake of ROOM_STAKES) {
      const room = this.createEmptyRoom(stake);
      this.initRoomWorld(room);
      this.rooms.set(stake, room);
    }
  }

  public destroy(): void {
    for (const room of this.rooms.values()) {
      if (room.interval !== null) {
        clearInterval(room.interval);
        room.interval = null;
      }
    }
    this.clients.clear();
  }

  public getRoomClientCount(stake: RoomStake): number {
    return this.rooms.get(stake)?.clients.size ?? 0;
  }

  public getRoomSnakeNames(stake: RoomStake): string[] {
    const room = this.rooms.get(stake);
    if (!room) return [];
    return room.snakes.filter((s) => s.alive).map((s) => s.name);
  }

  public handleConnect(transport: ClientTransport): void {
    const defaultStake: RoomStake = 25;
    const room = this.rooms.get(defaultStake)!;
    const sub: ClientSubscription = {
      transport,
      roomStake: defaultStake,
      snakeId: null,
      needsFullOrbSync: true,
    };
    this.clients.set(transport.id, sub);
    room.clients.add(transport.id);
    this.ensureRoomTicker(room);
    this.sendRoomStateToClient(room, sub, true);
  }

  public handleDisconnect(clientId: string): void {
    const sub = this.clients.get(clientId);
    if (!sub) return;
    this.removeClientSnake(sub);
    const room = this.rooms.get(sub.roomStake);
    if (room) {
      room.clients.delete(clientId);
      this.stopRoomTickerIfIdle(room);
    }
    this.clients.delete(clientId);
  }

  public handleMessage(clientId: string, raw: unknown, nowMs: number = Date.now()): void {
    const sub = this.clients.get(clientId);
    if (!sub || !raw || typeof raw !== 'object') return;
    const msg = raw as Partial<ClientMessage>;

    switch (msg.type) {
      case 'spectate': {
        const nextStake = sanitizeRoomStake(msg.roomStake);
        if (sub.roomStake !== nextStake || sub.snakeId !== null) {
          this.removeClientSnake(sub);
          const prevRoom = this.rooms.get(sub.roomStake);
          if (prevRoom) {
            prevRoom.clients.delete(clientId);
            this.stopRoomTickerIfIdle(prevRoom);
          }
          sub.roomStake = nextStake;
          const nextRoom = this.rooms.get(nextStake)!;
          nextRoom.clients.add(clientId);
          sub.needsFullOrbSync = true;
          this.ensureRoomTicker(nextRoom);
          this.sendRoomStateToClient(nextRoom, sub, true);
        }
        break;
      }

      case 'join': {
        const stake = sanitizeRoomStake(msg.roomStake);
        this.removeClientSnake(sub);
        if (sub.roomStake !== stake) {
          const prevRoom = this.rooms.get(sub.roomStake);
          if (prevRoom) {
            prevRoom.clients.delete(clientId);
            this.stopRoomTickerIfIdle(prevRoom);
          }
        }

        const room = this.rooms.get(stake)!;
        sub.roomStake = stake;
        room.clients.add(clientId);

        const spawn = findSafeSpawnPoint(room.snakes, ARENA_RADIUS, 360);
        const playerId = `p-${++room.nextPlayerSeq}`;
        const snake = this.createSnake(room, {
          id: playerId,
          name: sanitizeCallsign(msg.name),
          isHuman: true,
          clientId,
          skin: sanitizeSkin(msg.skin),
          x: spawn.x,
          y: spawn.y,
          angle: spawn.angle,
          mass: INITIAL_PLAYER_MASS,
          nowMs,
        });
        snake.spawnShield = 2.6;
        room.snakes.push(snake);
        sub.snakeId = playerId;
        sub.needsFullOrbSync = true;

        sub.transport.send({
          type: 'joined',
          playerId,
          roomStake: stake,
        });

        this.ensureRoomTicker(room);
        this.sendRoomStateToClient(room, sub, true);
        break;
      }

      case 'input': {
        if (!sub.snakeId) return;
        const room = this.rooms.get(sub.roomStake);
        if (!room) return;
        const snake = room.snakes.find((s) => s.id === sub.snakeId && s.alive);
        if (!snake) return;
        if (typeof msg.angle === 'number' && Number.isFinite(msg.angle)) {
          snake.targetAngle = normalizeAngle(msg.angle);
        }
        if (typeof msg.boosting === 'boolean') {
          snake.wantsBoost = msg.boosting;
        }
        break;
      }

      case 'cashout:hold': {
        if (!sub.snakeId) return;
        const room = this.rooms.get(sub.roomStake);
        if (!room) return;
        const snake = room.snakes.find((s) => s.id === sub.snakeId && s.alive);
        if (!snake) return;
        if (msg.active) {
          if (snake.cashOutHoldStartMs === null) {
            snake.cashOutHoldStartMs = nowMs;
          }
        } else {
          snake.cashOutHoldStartMs = null;
        }
        break;
      }

      case 'leave': {
        this.removeClientSnake(sub);
        const room = this.rooms.get(sub.roomStake);
        if (room) {
          this.sendRoomStateToClient(room, sub, false);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Exposed for deterministic unit testing and scheduled server loop */
  public stepRoom(stake: RoomStake, dt: number, nowMs: number = Date.now()): void {
    const room = this.rooms.get(stake);
    if (!room) return;
    room.tick += 1;

    // 1. Keep arena stocked with ambient orbs and minimum snake count
    let ambientCount = 0;
    for (let i = 0; i < room.orbs.length; i++) {
      if (!room.orbs[i].isLoot && !room.orbs[i].isBoostTrail) {
        ambientCount++;
      }
    }
    while (ambientCount < TARGET_AMBIENT_ORBS) {
      this.spawnAmbientOrb(room);
      ambientCount++;
    }

    let aliveCount = 0;
    for (let i = 0; i < room.snakes.length; i++) {
      if (room.snakes[i].alive) aliveCount++;
    }
    while (aliveCount < TARGET_MIN_SNAKES) {
      this.spawnBot(room, false, nowMs);
      aliveCount++;
    }

    // 2. Check server-authoritative Cash Out completions (3000ms hold)
    for (let i = 0; i < room.snakes.length; i++) {
      const s = room.snakes[i];
      if (!s.alive || !s.isHuman || s.cashOutHoldStartMs === null) continue;
      if (nowMs - s.cashOutHoldStartMs >= CASH_OUT_HOLD_MS) {
        this.completeCashOut(room, s, nowMs);
      }
    }

    // 3. Step AI bots, kinematics, and orb consumption
    for (let i = 0; i < room.snakes.length; i++) {
      const s = room.snakes[i];
      if (!s.alive) continue;

      if (s.spawnShield > 0) {
        s.spawnShield = Math.max(0, s.spawnShield - dt);
      }

      if (s.isHuman) {
        s.boosting = s.wantsBoost && s.mass > MIN_BOOST_MASS;
      } else {
        this.updateBotDecision(room, s, dt);
      }

      this.stepSnakeKinematics(room, s, dt);
      this.consumeNearbyOrbs(room, s, dt);
    }

    // 4. Resolve arena boundary + head-to-body collisions
    this.resolveCollisions(room, nowMs);

    // 5. Remove dead snakes and track peak ranks
    room.snakes = room.snakes.filter((s) => s.alive);
    const lb = computeLeaderboard(room.snakes, 5);
    const rankById = new Map<string, number>();
    const sortedAlive = [...room.snakes].sort((a, b) => b.mass - a.mass);
    for (let idx = 0; idx < sortedAlive.length; idx++) {
      rankById.set(sortedAlive[idx].id, idx + 1);
    }
    for (const s of room.snakes) {
      if (!s.isHuman) continue;
      const len = massToDisplayLength(s.mass);
      if (len > s.peakLength) s.peakLength = len;
      const r = rankById.get(s.id) ?? lb.totalAlive;
      if (r < s.peakRank) s.peakRank = r;
    }

    // 6. Broadcast room snapshot to all subscribed clients
    if (room.clients.size > 0) {
      const periodicOrbSync = room.tick % 20 === 0;
      const includeOrbs = room.orbsDirty || periodicOrbSync;
      const serializedSnakes = room.snakes.map((s) => this.serializeSnake(s, nowMs));
      const serializedOrbs = includeOrbs ? room.orbs.map((o) => this.serializeOrb(o)) : undefined;
      const events = room.pendingEvents.splice(0, room.pendingEvents.length);

      for (const clientId of room.clients) {
        const sub = this.clients.get(clientId);
        if (!sub) continue;
        const orbsPayload =
          serializedOrbs ??
          (sub.needsFullOrbSync ? room.orbs.map((o) => this.serializeOrb(o)) : undefined);
        sub.needsFullOrbSync = false;

        sub.transport.send({
          type: 'state',
          roomStake: room.stake,
          tick: room.tick,
          selfId: sub.snakeId,
          snakes: serializedSnakes,
          orbs: orbsPayload,
          events,
        });
      }
      room.orbsDirty = false;
    } else {
      room.pendingEvents.length = 0;
      room.orbsDirty = false;
    }
  }

  private createEmptyRoom(stake: RoomStake): ArenaRoom {
    return {
      stake,
      snakes: [],
      orbs: [],
      pendingEvents: [],
      nextOrbId: 1,
      nextBotId: 1,
      nextPlayerSeq: 0,
      tick: 0,
      orbsDirty: true,
      clients: new Set<string>(),
      interval: null,
      lastStepMs: Date.now(),
    };
  }

  private initRoomWorld(room: ArenaRoom): void {
    room.snakes = [];
    room.orbs = [];
    for (let i = 0; i < TARGET_AMBIENT_ORBS; i++) {
      this.spawnAmbientOrb(room);
    }
    for (let i = 0; i < TARGET_MIN_SNAKES; i++) {
      this.spawnBot(room, true, Date.now());
    }
  }

  private ensureRoomTicker(room: ArenaRoom): void {
    if (!this.autoTickEnabled || room.interval !== null || room.clients.size === 0) return;
    room.lastStepMs = Date.now();
    const stepMs = Math.round(1000 / SERVER_TICK_HZ);
    room.interval = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.06, Math.max(0.01, (now - room.lastStepMs) / 1000));
      room.lastStepMs = now;
      this.stepRoom(room.stake, dt, now);
    }, stepMs);
  }

  private stopRoomTickerIfIdle(room: ArenaRoom): void {
    if (room.clients.size === 0 && room.interval !== null) {
      clearInterval(room.interval);
      room.interval = null;
    }
  }

  private removeClientSnake(sub: ClientSubscription): void {
    if (!sub.snakeId) return;
    const room = this.rooms.get(sub.roomStake);
    if (room) {
      const before = room.snakes.length;
      room.snakes = room.snakes.filter((s) => s.id !== sub.snakeId);
      if (room.snakes.length !== before) {
        room.orbsDirty = false;
      }
    }
    sub.snakeId = null;
  }

  private sendRoomStateToClient(
    room: ArenaRoom,
    sub: ClientSubscription,
    includeOrbs: boolean,
    nowMs: number = Date.now(),
  ): void {
    sub.needsFullOrbSync = false;
    sub.transport.send({
      type: 'state',
      roomStake: room.stake,
      tick: room.tick,
      selfId: sub.snakeId,
      snakes: room.snakes.map((s) => this.serializeSnake(s, nowMs)),
      orbs: includeOrbs ? room.orbs.map((o) => this.serializeOrb(o)) : undefined,
      events: [],
    });
  }

  private serializeSnake(s: ServerSnake, nowMs: number): SerializedSnake {
    const progress =
      s.cashOutHoldStartMs !== null
        ? Math.min(1, Math.max(0, (nowMs - s.cashOutHoldStartMs) / CASH_OUT_HOLD_MS))
        : 0;
    return {
      id: s.id,
      name: s.name,
      isHuman: s.isHuman,
      skin: s.skin,
      x: Math.round(s.x * 10) / 10,
      y: Math.round(s.y * 10) / 10,
      angle: Math.round(s.angle * 1000) / 1000,
      targetAngle: Math.round(s.targetAngle * 1000) / 1000,
      mass: Math.round(s.mass * 100) / 100,
      boosting: s.boosting,
      kills: s.kills,
      potEgp: roundEgp(s.potEgp),
      spawnShield: Math.round(s.spawnShield * 100) / 100,
      cashOutProgress: Math.round(progress * 1000) / 1000,
      segments: s.segments.map((seg) => [Math.round(seg.x), Math.round(seg.y)]),
    };
  }

  private serializeOrb(o: Orb): SerializedOrb {
    return {
      id: o.id,
      x: Math.round(o.x),
      y: Math.round(o.y),
      value: Math.round(o.value * 100) / 100,
      egpValue: o.egpValue,
      radius: o.radius,
      color: o.color,
      phase: Math.round(o.phase * 100) / 100,
      isLoot: o.isLoot,
      isBoostTrail: o.isBoostTrail,
    };
  }

  private spawnAmbientOrb(room: ArenaRoom): void {
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 80);
    const value = Math.random() < 0.14 ? 2.6 : 1.1;
    room.orbs.push({
      id: room.nextOrbId++,
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      value,
      egpValue: 0,
      radius: value > 2 ? 7.5 : 5,
      color: ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)],
      phase: Math.random() * Math.PI * 2,
      isLoot: false,
    });
    room.orbsDirty = true;
  }

  private spawnLootOrb(
    room: ArenaRoom,
    x: number,
    y: number,
    value: number,
    color: string,
    egpValue: number,
  ): void {
    room.orbs.push({
      id: room.nextOrbId++,
      x,
      y,
      value,
      egpValue,
      radius: Math.min(8.0, 4.4 + Math.sqrt(value) * 0.75),
      color,
      phase: Math.random() * Math.PI * 2,
      isLoot: true,
    });
    room.orbsDirty = true;
  }

  private spawnBoostOrb(room: ArenaRoom, x: number, y: number, color: string): void {
    room.orbs.push({
      id: room.nextOrbId++,
      x,
      y,
      value: BOOST_DROP_ORB_VALUE,
      egpValue: 0,
      radius: 3.3,
      color,
      phase: Math.random() * Math.PI * 2,
      isLoot: false,
      isBoostTrail: true,
    });
    room.orbsDirty = true;
  }

  private spawnBot(room: ArenaRoom, initialSpread: boolean, nowMs: number): void {
    const policies: BotPolicy[] = ['forager', 'interceptor', 'scavenger'];
    const policy = policies[Math.floor(Math.random() * policies.length)];
    const skin = PRESET_SKINS[Math.floor(Math.random() * PRESET_SKINS.length)];
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const spawn = findSafeSpawnPoint(room.snakes, ARENA_RADIUS, 260);
    const mass = initialSpread
      ? 22 + Math.random() * 140
      : 20 + Math.random() * 38;

    const bot = this.createSnake(room, {
      id: `bot-${room.nextBotId++}`,
      name,
      isHuman: false,
      clientId: null,
      skin,
      policy,
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      mass,
      nowMs,
    });
    bot.spawnShield = 1.5;
    room.snakes.push(bot);
  }

  private createSnake(
    room: ArenaRoom,
    opts: {
      id: string;
      name: string;
      isHuman: boolean;
      clientId: string | null;
      skin: SkinDefinition;
      policy?: BotPolicy;
      x: number;
      y: number;
      angle: number;
      mass: number;
      nowMs: number;
    },
  ): ServerSnake {
    const segCount = computeSegmentCount(opts.mass);
    const radius = computeSnakeRadius(opts.mass);
    const spacing = computeSegmentSpacing(radius);
    const path: Vec2[] = [];
    const segments: Vec2[] = [];

    const totalPoints = segCount * 3;
    const step = spacing / 3;
    for (let i = 0; i < totalPoints; i++) {
      path.push({
        x: opts.x - Math.cos(opts.angle) * i * step,
        y: opts.y - Math.sin(opts.angle) * i * step,
      });
    }
    for (let i = 0; i < segCount; i++) {
      segments.push({
        x: opts.x - Math.cos(opts.angle) * i * spacing,
        y: opts.y - Math.sin(opts.angle) * i * spacing,
      });
    }

    return {
      id: opts.id,
      name: opts.name,
      isPlayer: opts.isHuman,
      isHuman: opts.isHuman,
      clientId: opts.clientId,
      skin: opts.skin,
      policy: opts.policy,
      x: opts.x,
      y: opts.y,
      angle: opts.angle,
      targetAngle: opts.angle,
      mass: opts.mass,
      boosting: false,
      wantsBoost: false,
      boostDropAccum: 0,
      cashOutHoldStartMs: null,
      joinedAtMs: opts.nowMs,
      peakLength: massToDisplayLength(opts.mass),
      peakRank: Math.max(1, room.snakes.length + 1),
      alive: true,
      kills: 0,
      potEgp: room.stake,
      spawnShield: 2.0,
      aiTimer: 0,
      aiTargetId: null,
      aiBias: Math.random() < 0.5 ? 1 : -1,
      path,
      segments,
    };
  }

  private updateBotDecision(room: ArenaRoom, bot: ServerSnake, dt: number): void {
    bot.aiTimer -= dt;
    const distFromCenter = Math.hypot(bot.x, bot.y);

    if (distFromCenter > ARENA_RADIUS - 300) {
      const inward = Math.atan2(-bot.y, -bot.x);
      bot.targetAngle = normalizeAngle(inward + bot.aiBias * 0.25);
      bot.boosting = false;
      return;
    }

    const lookAhead = 155 + computeSnakeRadius(bot.mass) * 3;
    const aheadX = bot.x + Math.cos(bot.angle) * lookAhead;
    const aheadY = bot.y + Math.sin(bot.angle) * lookAhead;

    let hazardX = 0;
    let hazardY = 0;
    let minHazardDistSq = Infinity;

    for (let i = 0; i < room.snakes.length; i++) {
      const other = room.snakes[i];
      if (!other.alive || other.id === bot.id) continue;

      for (let j = 0; j < other.segments.length; j += 2) {
        const seg = other.segments[j];
        const dx = seg.x - aheadX;
        const dy = seg.y - aheadY;
        const dSq = dx * dx + dy * dy;
        if (dSq < minHazardDistSq) {
          minHazardDistSq = dSq;
          hazardX = seg.x;
          hazardY = seg.y;
        }
      }
    }

    if (minHazardDistSq < 155 * 155) {
      const away = Math.atan2(bot.y - hazardY, bot.x - hazardX);
      bot.targetAngle = normalizeAngle(away + bot.aiBias * 0.35);
      bot.boosting = minHazardDistSq < 85 * 85 && bot.mass > 28;
      return;
    }

    if (bot.aiTimer > 0) return;
    bot.aiTimer = 0.22 + Math.random() * 0.28;

    if (bot.policy === 'interceptor') {
      let prey: ServerSnake | null = null;
      let bestDistSq = 680 * 680;
      for (const other of room.snakes) {
        if (!other.alive || other.id === bot.id || other.spawnShield > 0) continue;
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          prey = other;
        }
      }
      if (prey) {
        const leadX = prey.x + Math.cos(prey.angle) * 140;
        const leadY = prey.y + Math.sin(prey.angle) * 140;
        bot.targetAngle = Math.atan2(leadY - bot.y, leadX - bot.x);
        bot.boosting = bestDistSq < 340 * 340 && bot.mass > 32;
        return;
      }
    } else if (bot.policy === 'scavenger') {
      let bestLoot: Orb | null = null;
      let bestScore = -Infinity;
      for (let i = 0; i < room.orbs.length; i++) {
        const o = room.orbs[i];
        const dx = o.x - bot.x;
        const dy = o.y - bot.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 680) continue;
        const score = (o.isLoot ? o.value * 4.5 : o.value) / (dist + 40);
        if (score > bestScore) {
          bestScore = score;
          bestLoot = o;
        }
      }
      if (bestLoot) {
        bot.targetAngle = Math.atan2(bestLoot.y - bot.y, bestLoot.x - bot.x);
        bot.boosting = bestLoot.isLoot && bot.mass > 26;
        return;
      }
    }

    let targetOrb: Orb | null = null;
    let bestVal = -Infinity;
    for (let i = 0; i < room.orbs.length; i++) {
      const o = room.orbs[i];
      const dx = o.x - bot.x;
      const dy = o.y - bot.y;
      const d = Math.hypot(dx, dy);
      if (d > 640) continue;
      const weight = (o.isLoot ? 3.5 : 1) / (d + 35);
      if (weight > bestVal) {
        bestVal = weight;
        targetOrb = o;
      }
    }

    if (targetOrb) {
      bot.targetAngle = Math.atan2(targetOrb.y - bot.y, targetOrb.x - bot.x);
      bot.boosting = targetOrb.isLoot && bot.mass > 35 && Math.random() < 0.35;
    } else {
      bot.targetAngle = normalizeAngle(bot.angle + (Math.random() - 0.5) * 1.1);
      bot.boosting = false;
    }
  }

  private stepSnakeKinematics(room: ArenaRoom, snake: ServerSnake, dt: number): void {
    if (snake.boosting && snake.mass > MIN_BOOST_MASS) {
      const drained = BOOST_DRAIN_PER_SEC * dt;
      snake.mass = Math.max(MIN_BOOST_MASS, snake.mass - drained);

      if (snake.isHuman) {
        snake.boostDropAccum += drained;
        if (snake.boostDropAccum >= BOOST_DROP_MASS_THRESHOLD) {
          snake.boostDropAccum -= BOOST_DROP_MASS_THRESHOLD;
          const tail = snake.segments[snake.segments.length - 1] || snake;
          this.spawnBoostOrb(
            room,
            tail.x + (Math.random() - 0.5) * 10,
            tail.y + (Math.random() - 0.5) * 10,
            snake.skin.colors[0] || '#A3E635',
          );
        }
      }
    } else {
      snake.boosting = false;
    }

    const turnRate = computeTurnRate(snake.mass);
    snake.angle = stepAngleTowards(snake.angle, snake.targetAngle, turnRate * dt);

    const speed = snake.boosting ? BOOST_SPEED : BASE_SPEED;
    snake.x += Math.cos(snake.angle) * speed * dt;
    snake.y += Math.sin(snake.angle) * speed * dt;

    const head = snake.path[0];
    if (!head || Math.hypot(snake.x - head.x, snake.y - head.y) >= 3) {
      snake.path.unshift({ x: snake.x, y: snake.y });
    } else {
      head.x = snake.x;
      head.y = snake.y;
    }

    const targetCount = computeSegmentCount(snake.mass);
    const radius = computeSnakeRadius(snake.mass);
    const spacing = computeSegmentSpacing(radius);

    const newSegments: Vec2[] = [{ x: snake.x, y: snake.y }];
    let pathIdx = 0;
    let accumulated = 0;
    let nextTargetDist = spacing;

    while (newSegments.length < targetCount && pathIdx < snake.path.length - 1) {
      const p0 = snake.path[pathIdx];
      const p1 = snake.path[pathIdx + 1];
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);

      if (segLen < 0.0001) {
        pathIdx++;
        continue;
      }

      if (accumulated + segLen >= nextTargetDist) {
        const t = (nextTargetDist - accumulated) / segLen;
        newSegments.push({
          x: p0.x + (p1.x - p0.x) * t,
          y: p0.y + (p1.y - p0.y) * t,
        });
        nextTargetDist += spacing;
      } else {
        accumulated += segLen;
        pathIdx++;
      }
    }

    while (newSegments.length < targetCount) {
      const last = newSegments[newSegments.length - 1];
      newSegments.push({ x: last.x, y: last.y });
    }

    if (pathIdx + 6 < snake.path.length) {
      snake.path.length = pathIdx + 6;
    }

    snake.segments = newSegments;
  }

  private consumeNearbyOrbs(room: ArenaRoom, snake: ServerSnake, dt: number): void {
    const radius = computeSnakeRadius(snake.mass);
    const magnetRadius = radius + 44;
    const eatRadius = radius + 11;
    const magnetSq = magnetRadius * magnetRadius;
    const eatSq = eatRadius * eatRadius;

    for (let i = room.orbs.length - 1; i >= 0; i--) {
      const orb = room.orbs[i];
      const dx = snake.x - orb.x;
      const dy = snake.y - orb.y;
      const dSq = dx * dx + dy * dy;

      if (dSq <= eatSq) {
        snake.mass += orb.value * ORB_EAT_MASS_FACTOR;
        if (orb.egpValue > 0) {
          snake.potEgp = roundEgp(snake.potEgp + orb.egpValue);
        }
        if (snake.clientId) {
          const sub = this.clients.get(snake.clientId);
          sub?.transport.send({ type: 'ate', isLoot: orb.isLoot });
        }
        room.orbs.splice(i, 1);
        room.orbsDirty = true;
      } else if (dSq <= magnetSq) {
        const d = Math.sqrt(dSq) || 1;
        const pull = 360 * dt;
        orb.x += (dx / d) * pull;
        orb.y += (dy / d) * pull;
        room.orbsDirty = true;
      }
    }
  }

  private resolveCollisions(room: ArenaRoom, nowMs: number): void {
    for (let i = 0; i < room.snakes.length; i++) {
      const attacker = room.snakes[i];
      if (!attacker.alive) continue;

      const attackerRadius = computeSnakeRadius(attacker.mass);

      if (checkBoundaryCollision(attacker.x, attacker.y, attackerRadius, ARENA_RADIUS)) {
        this.eliminateSnake(room, attacker, null, 'Arena Perimeter', nowMs);
        continue;
      }

      if (attacker.spawnShield > 0) continue;

      for (let j = 0; j < room.snakes.length; j++) {
        if (i === j) continue;
        const defender = room.snakes[j];
        if (!defender.alive || defender.spawnShield > 0) continue;

        const defenderRadius = computeSnakeRadius(defender.mass);
        if (
          checkHeadBodyCollision(
            { x: attacker.x, y: attacker.y },
            attackerRadius,
            defender.segments,
            defenderRadius,
          )
        ) {
          this.eliminateSnake(room, attacker, defender, defender.name, nowMs);
          break;
        }
      }
    }
  }

  private eliminateSnake(
    room: ArenaRoom,
    victim: ServerSnake,
    killer: ServerSnake | null,
    killerLabel: string,
    nowMs: number,
  ): void {
    victim.alive = false;

    const totalSegments = victim.segments.length;
    const step = Math.max(4, Math.ceil(totalSegments / 20));
    const fragmentSegmentIndices: number[] = [];
    for (let i = 0; i < totalSegments; i += step) {
      fragmentSegmentIndices.push(i);
    }
    if (fragmentSegmentIndices.length === 0) {
      fragmentSegmentIndices.push(0);
    }

    const fragmentEgpValues = distributePotAcrossFragments(
      victim.potEgp,
      room.stake,
      fragmentSegmentIndices.length,
    );

    if (killer && killer.alive) {
      killer.kills += 1;
      if (killer.clientId) {
        const killerSub = this.clients.get(killer.clientId);
        killerSub?.transport.send({ type: 'killed' });
      }
    }

    const lootPerDrop = Math.max(
      1.8,
      (victim.mass * 0.68) / Math.max(4, fragmentSegmentIndices.length),
    );

    for (let idx = 0; idx < fragmentSegmentIndices.length; idx++) {
      const segIdx = fragmentSegmentIndices[idx];
      const seg = victim.segments[segIdx] || { x: victim.x, y: victim.y };
      const color = getSegmentColor(victim.skin, segIdx, totalSegments);
      this.spawnLootOrb(
        room,
        seg.x + (Math.random() - 0.5) * 16,
        seg.y + (Math.random() - 0.5) * 16,
        lootPerDrop,
        color,
        fragmentEgpValues[idx],
      );
    }

    room.pendingEvents.push({
      kind: 'burst',
      x: Math.round(victim.x),
      y: Math.round(victim.y),
      color: victim.skin.colors[0] || '#F43F5E',
      count: 18,
    });

    if (victim.clientId) {
      const sub = this.clients.get(victim.clientId);
      if (sub) {
        sub.snakeId = null;
        const finalLength = massToDisplayLength(victim.mass);
        const summary: ServerRunSummary = {
          finalLength,
          peakLength: Math.max(victim.peakLength, finalLength),
          peakRank: victim.peakRank,
          kills: victim.kills,
          survivedSeconds: Math.max(0, Math.round((nowMs - victim.joinedAtMs) / 1000)),
          defeatedBy: killerLabel,
          cashedOut: false,
          roomStake: room.stake,
          payoutEgp: 0,
        };
        sub.transport.send({ type: 'eliminated', summary });
      }
    }
  }

  private completeCashOut(room: ArenaRoom, player: ServerSnake, nowMs: number): void {
    player.alive = false;
    player.cashOutHoldStartMs = null;
    if (!player.clientId) return;

    const sub = this.clients.get(player.clientId);
    if (!sub) return;
    sub.snakeId = null;

    const finalLength = massToDisplayLength(player.mass);
    const summary: ServerRunSummary = {
      finalLength,
      peakLength: Math.max(player.peakLength, finalLength),
      peakRank: player.peakRank,
      kills: player.kills,
      survivedSeconds: Math.max(0, Math.round((nowMs - player.joinedAtMs) / 1000)),
      defeatedBy: 'Cashed Out',
      cashedOut: true,
      roomStake: room.stake,
      payoutEgp: roundEgp(player.potEgp),
    };

    sub.transport.send({ type: 'cashedOut', summary });
  }
}
