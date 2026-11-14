import { getCurrencyUnit, type AppLanguage } from '../i18n';
import { soundEngine } from './audio';
import {
  ARENA_RADIUS,
  BASE_SPEED,
  BOOST_DRAIN_PER_SEC,
  BOOST_DROP_MASS_THRESHOLD,
  BOOST_DROP_ORB_VALUE,
  BOOST_SPEED,
  checkBoundaryCollision,
  checkHeadBodyCollision,
  computeLeaderboard,
  computeNormalizedZoom,
  computeSegmentCount,
  computeSegmentSpacing,
  computeSnakeRadius,
  computeTurnRate,
  distributePotAcrossFragments,
  findSafeSpawnPoint,
  formatEgp,
  INITIAL_PLAYER_MASS,
  isDoubleTapWithinWindow,
  massToDisplayLength,
  MIN_BOOST_MASS,
  normalizeAngle,
  ORB_EAT_MASS_FACTOR,
  roundEgp,
  stepAngleTowards,
  stepTouchStick,
  type TouchStickState,
} from './rules';
import { getSegmentColor, PRESET_SKINS } from './skins';
import type {
  ClientMessage,
  SerializedSnake,
  ServerMessage,
} from './netTypes';
import type {
  BotPolicy,
  GamePhase,
  HudSnapshot,
  Orb,
  RoomStake,
  RunSummary,
  SkinDefinition,
  Snake,
  Vec2,
} from './types';

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

const TARGET_BOT_COUNT = 16;
const TARGET_AMBIENT_ORBS = 55;
const PARTICLE_POOL_SIZE = 380;

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatingCallout {
  active: boolean;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface EngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onGameOver: (summary: RunSummary) => void;
}

export class SlitherEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private callbacks: EngineCallbacks;

  private phase: GamePhase = 'title';
  private rafId: number | null = null;
  private lastTime = 0;

  private snakes: Snake[] = [];
  private orbs: Orb[] = [];
  private nextOrbId = 1;
  private nextBotId = 1;

  // Zero-GC particle and callout pools
  private particles: PooledParticle[] = [];
  private particleCursor = 0;
  private callouts: FloatingCallout[] = [];
  private calloutCursor = 0;

  // Camera state
  private camX = 0;
  private camY = 0;
  private camZoom = 1;
  private trauma = 0;
  private tourAngle = 0;

  // Player configuration & run stats
  private playerName = 'Bruhv';
  private playerSkin: SkinDefinition = PRESET_SKINS[0];
  private roomStake: RoomStake = 25;
  private runElapsed = 0;
  private peakLength = 300;
  private peakRank = 99;
  private bestLength = 300;
  private deathTimer = 0;
  private pendingSummary: RunSummary | null = null;
  private killNoticeText = '';
  private killNoticeTimer = 0;
  private hudThrottle = 0;
  private boostDropAccum = 0;
  private cashOutProgress = 0;
  private lang: AppLanguage = 'en';

  // Input state
  private pointerActive = false;
  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private pointerDown = false;
  private touchPointerId: number | null = null;
  private touchStick: TouchStickState | null = null;
  private secondaryTouchIds = new Set<number>();
  private lastTouchTapMs: number | null = null;
  private touchDoubleTapBoost = false;
  private keysHeld = new Set<string>();
  private viewportWidth = 1280;
  private viewportHeight = 720;
  private dpr = 1;
  private resizeObserver: ResizeObserver | null = null;

  // WebSocket multiplayer client state
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsMode = false;
  private wsFailedCount = 0;
  private reconnectTimer: number | null = null;
  private destroyed = false;
  private selfPlayerId: string | null = null;
  private pendingJoin: {
    name: string;
    skin: SkinDefinition;
    roomStake: RoomStake;
  } | null = null;
  private lastSentAngle = 0;
  private lastSentBoost = false;
  private lastInputSendMs = 0;
  private serverCashOutActive = false;
  private snakeCashOutMap = new Map<string, number>();
  private remoteTargets = new Map<
    string,
    {
      x: number;
      y: number;
      angle: number;
      targetAngle: number;
      mass: number;
      boosting: boolean;
      potEgp: number;
      kills: number;
      spawnShield: number;
      cashOutProgress: number;
      segments: Vec2[];
    }
  >();

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not acquire 2D canvas context');
    }
    this.ctx = context;
    this.callbacks = callbacks;

    try {
      const savedBest = Number(localStorage.getItem('damn_bruh_best_length') || '300');
      if (Number.isFinite(savedBest) && savedBest >= 300) {
        this.bestLength = savedBest;
      }
    } catch {
      // Ignore storage failures
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 3,
        color: '#A3E635',
      });
    }

    for (let i = 0; i < 12; i++) {
      this.callouts.push({
        active: false,
        x: 0,
        y: 0,
        text: '',
        color: '#FBBF24',
        life: 0,
        maxLife: 1,
      });
    }

    this.initArenaWorld();
    this.bindInputListeners();
    this.handleResize();
    this.connectWebSocket();
  }

  public setMinimapCanvas(canvas: HTMLCanvasElement | null): void {
    this.minimapCanvas = canvas;
  }

  public setPlayerSetup(name: string, skin: SkinDefinition): void {
    const trimmed = name.trim().slice(0, 16);
    this.playerName = trimmed || 'Bruhv';
    this.playerSkin = skin;
  }

  public getPhase(): GamePhase {
    return this.phase;
  }

  public isMultiplayerActive(): boolean {
    return this.wsMode && this.wsConnected;
  }

  public setSpectateRoom(roomStake: RoomStake): void {
    this.roomStake = roomStake;
    if (this.phase === 'title' && this.wsConnected) {
      this.sendWs({ type: 'spectate', roomStake });
    }
  }

  public setCashOutProgress(progress: number): void {
    this.cashOutProgress = Number.isFinite(progress)
      ? Math.min(1, Math.max(0, progress))
      : 0;
    if (this.wsMode && this.wsConnected && this.phase === 'playing') {
      const shouldHold = this.cashOutProgress > 0;
      if (shouldHold !== this.serverCashOutActive) {
        this.serverCashOutActive = shouldHold;
        this.sendWs({ type: 'cashout:hold', active: shouldHold });
      }
    }
  }

  public setLanguage(lang: AppLanguage): void {
    this.lang = lang;
  }

  public startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      if (this.phase !== 'paused' || this.wsMode) {
        this.update(dt);
        this.render();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unbindInputListeners();
    this.resizeObserver?.disconnect();
  }

  public startNewRun(
    name: string,
    skin: SkinDefinition,
    roomStake: RoomStake = 25,
  ): void {
    this.setPlayerSetup(name, skin);
    this.roomStake = roomStake;
    this.clearHeldInputs();
    this.deathTimer = 0;
    this.pendingSummary = null;
    this.killNoticeText = '';
    this.killNoticeTimer = 0;
    this.runElapsed = 0;
    this.boostDropAccum = 0;
    this.cashOutProgress = 0;
    this.serverCashOutActive = false;
    this.trauma = 0;
    this.lastSentBoost = false;
    this.lastInputSendMs = 0;

    if (this.wsConnected) {
      this.pendingJoin = null;
      this.selfPlayerId = null;
      this.peakLength = INITIAL_PLAYER_MASS * 10;
      this.peakRank = 99;
      this.phase = 'playing';
      this.sendWs({
        type: 'join',
        roomStake,
        name: this.playerName,
        skin: this.playerSkin,
      });
      return;
    }

    if (
      this.wsMode ||
      (this.ws && this.ws.readyState === WebSocket.CONNECTING)
    ) {
      this.pendingJoin = {
        name: this.playerName,
        skin: this.playerSkin,
        roomStake,
      };
      this.selfPlayerId = null;
      this.peakLength = INITIAL_PLAYER_MASS * 10;
      this.peakRank = 99;
      this.phase = 'playing';
      return;
    }

    this.startOfflineRun(roomStake);
  }

  private startOfflineRun(roomStake: RoomStake): void {
    // Offline static fallback when no WebSocket game server is present
    this.initArenaWorld();

    const spawn = findSafeSpawnPoint(this.snakes, ARENA_RADIUS, 360);
    const player = this.createSnake({
      id: 'player',
      name: this.playerName,
      isPlayer: true,
      skin: this.playerSkin,
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      mass: INITIAL_PLAYER_MASS,
    });
    player.spawnShield = 2.6;
    this.snakes.push(player);

    this.camX = player.x;
    this.camY = player.y;
    this.camZoom = this.computeTargetZoom(player.mass);
    this.peakLength = massToDisplayLength(player.mass);
    this.peakRank = this.snakes.length;
    this.roomStake = roomStake;
    this.phase = 'playing';
    this.emitHudSnapshot();
  }

  public pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.cashOutProgress = 0;
    if (this.serverCashOutActive) {
      this.serverCashOutActive = false;
      this.sendWs({ type: 'cashout:hold', active: false });
    }
    this.clearHeldInputs();
    if (this.wsMode && this.wsConnected) {
      this.sendWs({ type: 'input', angle: this.lastSentAngle, boosting: false });
    }
    this.render();
  }

  public resume(): void {
    if (this.phase !== 'paused') return;
    this.clearHeldInputs();
    this.phase = 'playing';
  }

  public returnToTitle(): void {
    this.clearHeldInputs();
    this.cashOutProgress = 0;
    this.serverCashOutActive = false;
    this.pendingJoin = null;
    this.deathTimer = 0;
    this.pendingSummary = null;
    this.phase = 'title';

    if (this.wsMode) {
      this.selfPlayerId = null;
      this.sendWs({ type: 'leave' });
      this.sendWs({ type: 'spectate', roomStake: this.roomStake });
      return;
    }

    this.snakes = this.snakes.filter((s) => !s.isPlayer && s.alive);
    while (this.snakes.length < TARGET_BOT_COUNT) {
      this.spawnBot();
    }
  }

  public cashOutRun(): RunSummary | null {
    if (this.phase !== 'playing') return null;
    const player = this.snakes.find((s) => s.isPlayer && s.alive);
    if (!player) return null;

    this.cashOutProgress = 0;
    this.clearHeldInputs();
    soundEngine.playKill();

    const finalLength = massToDisplayLength(player.mass);
    const isNewBest = finalLength > this.bestLength;
    if (isNewBest) {
      this.bestLength = finalLength;
      try {
        localStorage.setItem('damn_bruh_best_length', String(this.bestLength));
      } catch {
        // Ignore storage errors
      }
    }

    const summary: RunSummary = {
      finalLength,
      peakLength: Math.max(this.peakLength, finalLength),
      peakRank: this.peakRank,
      kills: player.kills,
      survivedSeconds: Math.round(this.runElapsed),
      defeatedBy: 'Cashed Out',
      isNewBest,
      bestLength: this.bestLength,
      cashedOut: true,
      roomStake: this.roomStake,
      payoutEgp: roundEgp(player.potEgp),
    };

    player.alive = false;
    this.snakes = this.snakes.filter((s) => s.alive);
    this.phase = 'gameover';
    this.render();
    return summary;
  }

  private computeTargetZoom(mass: number): number {
    return computeNormalizedZoom(this.viewportWidth, this.viewportHeight, mass);
  }

  private clearHeldInputs(): void {
    this.keysHeld.clear();
    this.pointerDown = false;
    this.touchDoubleTapBoost = false;
    this.lastTouchTapMs = null;
    this.touchPointerId = null;
    this.touchStick = null;
    this.secondaryTouchIds.clear();
  }

  private initArenaWorld(): void {
    this.snakes = [];
    this.orbs = [];

    for (let i = 0; i < TARGET_AMBIENT_ORBS; i++) {
      this.spawnAmbientOrb();
    }
    for (let i = 0; i < TARGET_BOT_COUNT; i++) {
      this.spawnBot(true);
    }
  }

  private spawnAmbientOrb(): void {
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 80);
    const value = Math.random() < 0.14 ? 2.6 : 1.1;
    this.orbs.push({
      id: this.nextOrbId++,
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      value,
      egpValue: 0,
      radius: value > 2 ? 7.5 : 5,
      color: ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)],
      phase: Math.random() * Math.PI * 2,
      isLoot: false,
    });
  }

  private spawnLootOrb(
    x: number,
    y: number,
    value: number,
    color: string,
    egpValue: number = 0,
  ): void {
    this.orbs.push({
      id: this.nextOrbId++,
      x,
      y,
      value,
      egpValue,
      radius: Math.min(8.0, 4.4 + Math.sqrt(value) * 0.75),
      color,
      phase: Math.random() * Math.PI * 2,
      isLoot: true,
    });
  }

  private spawnBoostOrb(x: number, y: number, color: string): void {
    this.orbs.push({
      id: this.nextOrbId++,
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
  }

  private spawnBot(initialSpread = false): void {
    const policies: BotPolicy[] = ['forager', 'interceptor', 'scavenger'];
    const policy = policies[Math.floor(Math.random() * policies.length)];
    const skin = PRESET_SKINS[Math.floor(Math.random() * PRESET_SKINS.length)];
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const spawn = findSafeSpawnPoint(this.snakes, ARENA_RADIUS, 260);
    const mass = initialSpread
      ? 22 + Math.random() * 140
      : 20 + Math.random() * 38;

    const bot = this.createSnake({
      id: `bot-${this.nextBotId++}`,
      name,
      isPlayer: false,
      skin,
      policy,
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      mass,
    });
    bot.spawnShield = 1.5;
    this.snakes.push(bot);
  }

  private createSnake(opts: {
    id: string;
    name: string;
    isPlayer: boolean;
    skin: SkinDefinition;
    policy?: BotPolicy;
    x: number;
    y: number;
    angle: number;
    mass: number;
  }): Snake {
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
      isPlayer: opts.isPlayer,
      skin: opts.skin,
      policy: opts.policy,
      x: opts.x,
      y: opts.y,
      angle: opts.angle,
      targetAngle: opts.angle,
      mass: opts.mass,
      boosting: false,
      alive: true,
      kills: 0,
      potEgp: this.roomStake,
      spawnShield: 2.0,
      aiTimer: 0,
      aiTargetId: null,
      aiBias: Math.random() < 0.5 ? 1 : -1,
      path,
      segments,
    };
  }

  private connectWebSocket(): void {
    if (
      this.destroyed ||
      typeof window === 'undefined' ||
      typeof WebSocket === 'undefined'
    ) {
      return;
    }
    const proto = window.location.protocol;
    if (proto !== 'http:' && proto !== 'https:') return;

    const wsProto = proto === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProto}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.destroyed) {
          ws.close();
          return;
        }
        this.wsConnected = true;
        this.wsMode = true;
        this.wsFailedCount = 0;

        if (this.pendingJoin) {
          const pending = this.pendingJoin;
          this.pendingJoin = null;
          this.sendWs({
            type: 'join',
            roomStake: pending.roomStake,
            name: pending.name,
            skin: pending.skin,
          });
        } else if (this.phase === 'title') {
          this.sendWs({ type: 'spectate', roomStake: this.roomStake });
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          this.handleServerMessage(msg);
        } catch {
          // Ignore malformed server packets
        }
      };

      const onSocketClosed = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        this.wsConnected = false;
        if (this.destroyed) return;

        this.wsFailedCount += 1;

        // If static export (no WS server) and user clicked Play while connecting, start offline
        if (!this.wsMode && this.wsFailedCount >= 2 && this.pendingJoin) {
          const pending = this.pendingJoin;
          this.pendingJoin = null;
          this.startOfflineRun(pending.roomStake);
          return;
        }

        if (this.wsMode || this.wsFailedCount < 2) {
          const delay = Math.min(4000, 600 * Math.pow(1.6, this.wsFailedCount - 1));
          if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
          }
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWebSocket();
          }, delay);
        }
      };

      ws.onclose = onSocketClosed;
      ws.onerror = () => {
        // Browser will also emit onclose; handle cleanly without noisy exceptions
      };
    } catch {
      // Ignore WebSocket construction errors on restricted origins
    }
  }

  private sendWs(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'joined': {
        this.selfPlayerId = msg.playerId;
        this.roomStake = msg.roomStake;
        break;
      }

      case 'ate': {
        soundEngine.playEat(msg.isLoot);
        break;
      }

      case 'killed': {
        soundEngine.playKill();
        this.trauma = Math.min(1, this.trauma + 0.45);
        break;
      }

      case 'eliminated': {
        this.selfPlayerId = null;
        this.serverCashOutActive = false;
        this.cashOutProgress = 0;

        if (this.phase === 'playing' || this.phase === 'paused') {
          soundEngine.playDeath();
          this.trauma = 0.9;
          const selfSnake = this.snakes.find((s) => s.isPlayer);
          this.spawnCallout(
            selfSnake ? selfSnake.x : this.camX,
            (selfSnake ? selfSnake.y : this.camY) - 18,
            this.lang === 'ar' ? 'يا نهار أبيض!' : 'DAMN BRUH...',
            '#F43F5E',
          );

          const finalLength = msg.summary.finalLength;
          const isNewBest = finalLength > this.bestLength;
          if (isNewBest) {
            this.bestLength = finalLength;
            try {
              localStorage.setItem('damn_bruh_best_length', String(this.bestLength));
            } catch {
              // Ignore storage errors
            }
          }

          this.pendingSummary = {
            ...msg.summary,
            isNewBest,
            bestLength: this.bestLength,
          };
          this.deathTimer = 0.52;
          this.emitHudSnapshot();
        }
        break;
      }

      case 'cashedOut': {
        this.selfPlayerId = null;
        this.serverCashOutActive = false;
        this.cashOutProgress = 0;
        this.clearHeldInputs();
        soundEngine.playKill();

        const finalLength = msg.summary.finalLength;
        const isNewBest = finalLength > this.bestLength;
        if (isNewBest) {
          this.bestLength = finalLength;
          try {
            localStorage.setItem('damn_bruh_best_length', String(this.bestLength));
          } catch {
            // Ignore storage errors
          }
        }

        const fullSummary: RunSummary = {
          ...msg.summary,
          isNewBest,
          bestLength: this.bestLength,
        };

        this.phase = 'gameover';
        this.render();
        this.callbacks.onGameOver(fullSummary);
        break;
      }

      case 'state': {
        this.applyServerState(msg.selfId, msg.snakes, msg.orbs, msg.events);
        break;
      }

      default:
        break;
    }
  }

  private applyServerState(
    selfId: string | null,
    remoteSnakes: SerializedSnake[],
    remoteOrbs:
      | {
          id: number;
          x: number;
          y: number;
          value: number;
          egpValue: number;
          radius: number;
          color: string;
          phase: number;
          isLoot: boolean;
          isBoostTrail?: boolean;
        }[]
      | undefined,
    events: { kind: 'burst'; x: number; y: number; color: string; count: number }[],
  ): void {
    if (selfId !== null) {
      this.selfPlayerId = selfId;
    } else if (this.phase === 'title') {
      this.selfPlayerId = null;
    }

    if (remoteOrbs) {
      const phaseById = new Map<number, number>();
      for (let i = 0; i < this.orbs.length; i++) {
        phaseById.set(this.orbs[i].id, this.orbs[i].phase);
      }
      this.orbs = remoteOrbs.map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        value: o.value,
        egpValue: o.egpValue,
        radius: o.radius,
        color: o.color,
        phase: phaseById.get(o.id) ?? o.phase,
        isLoot: o.isLoot,
        isBoostTrail: o.isBoostTrail,
      }));
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.kind === 'burst') {
        for (let p = 0; p < ev.count; p++) {
          const ang = (p / ev.count) * Math.PI * 2;
          const spd = 90 + Math.random() * 190;
          this.spawnParticle(
            ev.x,
            ev.y,
            Math.cos(ang) * spd,
            Math.sin(ang) * spd,
            0.6,
            5,
            ev.color,
          );
        }
      }
    }

    const existingById = new Map<string, Snake>();
    for (let i = 0; i < this.snakes.length; i++) {
      existingById.set(this.snakes[i].id, this.snakes[i]);
    }

    const activeIds = new Set<string>();
    const nextSnakes: Snake[] = [];

    for (let i = 0; i < remoteSnakes.length; i++) {
      const r = remoteSnakes[i];
      activeIds.add(r.id);
      const isPlayer = Boolean(this.selfPlayerId && r.id === this.selfPlayerId);
      const convertedSegments: Vec2[] = r.segments.map(([sx, sy]) => ({ x: sx, y: sy }));

      this.snakeCashOutMap.set(r.id, r.cashOutProgress);
      this.remoteTargets.set(r.id, {
        x: r.x,
        y: r.y,
        angle: r.angle,
        targetAngle: r.targetAngle,
        mass: r.mass,
        boosting: r.boosting,
        potEgp: r.potEgp,
        kills: r.kills,
        spawnShield: r.spawnShield,
        cashOutProgress: r.cashOutProgress,
        segments: convertedSegments,
      });

      const prev = existingById.get(r.id);
      if (prev) {
        const jumpDist = Math.hypot(r.x - prev.x, r.y - prev.y);
        prev.name = r.name;
        prev.isPlayer = isPlayer;
        prev.skin = r.skin;
        prev.mass = r.mass;
        prev.boosting = r.boosting;
        prev.potEgp = r.potEgp;
        prev.kills = r.kills;
        prev.spawnShield = r.spawnShield;
        if (!isPlayer) {
          prev.targetAngle = r.targetAngle;
        }
        if (jumpDist > 260) {
          prev.x = r.x;
          prev.y = r.y;
          prev.angle = r.angle;
          prev.segments = convertedSegments.map((seg) => ({ x: seg.x, y: seg.y }));
        }
        nextSnakes.push(prev);
      } else {
        const created: Snake = {
          id: r.id,
          name: r.name,
          isPlayer,
          skin: r.skin,
          x: r.x,
          y: r.y,
          angle: r.angle,
          targetAngle: r.targetAngle,
          mass: r.mass,
          boosting: r.boosting,
          alive: true,
          kills: r.kills,
          potEgp: r.potEgp,
          spawnShield: r.spawnShield,
          aiTimer: 0,
          aiTargetId: null,
          aiBias: 1,
          path: [],
          segments: convertedSegments.map((seg) => ({ x: seg.x, y: seg.y })),
        };
        if (isPlayer && this.runElapsed < 0.35) {
          this.camX = created.x;
          this.camY = created.y;
          this.camZoom = this.computeTargetZoom(created.mass);
        }
        nextSnakes.push(created);
      }
    }

    for (const id of this.remoteTargets.keys()) {
      if (!activeIds.has(id)) {
        this.remoteTargets.delete(id);
        this.snakeCashOutMap.delete(id);
      }
    }

    this.snakes = nextSnakes;
  }

  private update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.updateParticles(dt);
    this.updateCallouts(dt);

    if (this.phase === 'playing') {
      this.runElapsed += dt;
      if (this.killNoticeTimer > 0) {
        this.killNoticeTimer = Math.max(0, this.killNoticeTimer - dt);
        if (this.killNoticeTimer === 0) {
          this.killNoticeText = '';
        }
      }
    }

    // Handle post-death dramatic beat before showing Game Over modal
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0 && this.pendingSummary) {
        const summary = this.pendingSummary;
        this.pendingSummary = null;
        this.phase = 'gameover';
        this.callbacks.onGameOver(summary);
        return;
      }
    }

    if (this.wsMode) {
      this.updateMultiplayerClient(dt);
      return;
    }

    if (this.phase === 'paused') {
      return;
    }

    // Offline single-player simulation fallback (static export / file://)
    let ambientCount = 0;
    for (let i = 0; i < this.orbs.length; i++) {
      if (!this.orbs[i].isLoot && !this.orbs[i].isBoostTrail) ambientCount++;
    }
    while (ambientCount < TARGET_AMBIENT_ORBS) {
      this.spawnAmbientOrb();
      ambientCount++;
    }

    const aliveBots = this.snakes.filter((s) => !s.isPlayer && s.alive).length;
    if (aliveBots < TARGET_BOT_COUNT) {
      this.spawnBot(false);
    }

    // Update all alive snakes
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive) continue;

      if (s.spawnShield > 0) {
        s.spawnShield = Math.max(0, s.spawnShield - dt);
      }

      if (s.isPlayer) {
        this.updatePlayerInput(s);
      } else {
        this.updateBotDecision(s, dt);
      }

      this.stepSnakeKinematics(s, dt);
      this.consumeNearbyOrbs(s, dt);
    }

    // Check collisions (boundary + head-to-body)
    this.resolveCollisions();

    // Clean out dead snakes
    this.snakes = this.snakes.filter((s) => s.alive);

    // Update camera
    const player = this.snakes.find((s) => s.isPlayer && s.alive);
    if (this.phase === 'playing' && player) {
      const lerp = 1 - Math.exp(-8.5 * dt);
      this.camX += (player.x - this.camX) * lerp;
      this.camY += (player.y - this.camY) * lerp;

      const targetZoom = this.computeTargetZoom(player.mass);
      this.camZoom += (targetZoom - this.camZoom) * (1 - Math.exp(-3.2 * dt));

      const currentLen = massToDisplayLength(player.mass);
      if (currentLen > this.peakLength) this.peakLength = currentLen;
    } else if (this.phase === 'title') {
      this.tourAngle += dt * 0.14;
      const tourR = 620;
      const tx = Math.cos(this.tourAngle) * tourR;
      const ty = Math.sin(this.tourAngle * 0.8) * tourR;
      const lerp = 1 - Math.exp(-2.0 * dt);
      this.camX += (tx - this.camX) * lerp;
      this.camY += (ty - this.camY) * lerp;
      const tourZoom = this.computeTargetZoom(60);
      this.camZoom += (tourZoom - this.camZoom) * lerp;
    }

    // Throttled HUD updates (~12Hz)
    if (this.phase === 'playing') {
      this.hudThrottle += dt;
      if (this.hudThrottle >= 0.08) {
        this.hudThrottle = 0;
        this.emitHudSnapshot();
      }
    }
  }

  private updateMultiplayerClient(dt: number): void {
    const player = this.snakes.find((s) => s.isPlayer && s.alive);
    if (this.phase === 'playing' && player) {
      this.updatePlayerInput(player);
      const nowMs = performance.now();
      const angleDiff = Math.abs(normalizeAngle(player.targetAngle - this.lastSentAngle));
      const wantsBoost = player.boosting;
      if (
        this.wsConnected &&
        (wantsBoost !== this.lastSentBoost ||
          (angleDiff > 0.025 && nowMs - this.lastInputSendMs >= 28) ||
          nowMs - this.lastInputSendMs >= 90)
      ) {
        this.lastSentAngle = player.targetAngle;
        this.lastSentBoost = wantsBoost;
        this.lastInputSendMs = nowMs;
        this.sendWs({
          type: 'input',
          angle: player.targetAngle,
          boosting: wantsBoost,
        });
      }
    }

    // Smooth 60fps interpolation between 25Hz server snapshots
    const posLerp = 1 - Math.exp(-20 * dt);
    const segLerp = 1 - Math.exp(-22 * dt);

    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      const target = this.remoteTargets.get(s.id);
      if (!target) continue;

      const speed = target.boosting ? BOOST_SPEED : BASE_SPEED;
      target.x += Math.cos(target.angle) * speed * dt;
      target.y += Math.sin(target.angle) * speed * dt;

      s.x += (target.x - s.x) * posLerp;
      s.y += (target.y - s.y) * posLerp;
      s.angle = stepAngleTowards(s.angle, target.angle, 14 * dt);

      const tSegs = target.segments;
      if (tSegs.length > 0) {
        while (s.segments.length < tSegs.length) {
          const fallback = tSegs[s.segments.length];
          s.segments.push({ x: fallback.x, y: fallback.y });
        }
        if (s.segments.length > tSegs.length) {
          s.segments.length = tSegs.length;
        }
        s.segments[0].x = s.x;
        s.segments[0].y = s.y;
        for (let k = 1; k < tSegs.length; k++) {
          s.segments[k].x += (tSegs[k].x - s.segments[k].x) * segLerp;
          s.segments[k].y += (tSegs[k].y - s.segments[k].y) * segLerp;
        }
      }

      if (s.boosting && Math.random() < 0.45) {
        const tail = s.segments[s.segments.length - 1] || s;
        this.spawnParticle(
          tail.x + (Math.random() - 0.5) * 12,
          tail.y + (Math.random() - 0.5) * 12,
          -Math.cos(s.angle) * 70 + (Math.random() - 0.5) * 50,
          -Math.sin(s.angle) * 70 + (Math.random() - 0.5) * 50,
          0.32,
          3.2,
          s.skin.colors[0] || '#A3E635',
        );
      }
    }

    if ((this.phase === 'playing' || this.phase === 'paused') && player) {
      const lerp = 1 - Math.exp(-8.5 * dt);
      this.camX += (player.x - this.camX) * lerp;
      this.camY += (player.y - this.camY) * lerp;

      const targetZoom = this.computeTargetZoom(player.mass);
      this.camZoom += (targetZoom - this.camZoom) * (1 - Math.exp(-3.2 * dt));

      const currentLen = massToDisplayLength(player.mass);
      if (currentLen > this.peakLength) this.peakLength = currentLen;
    } else if (this.phase === 'title') {
      this.tourAngle += dt * 0.14;
      const tourR = 620;
      const tx = Math.cos(this.tourAngle) * tourR;
      const ty = Math.sin(this.tourAngle * 0.8) * tourR;
      const lerp = 1 - Math.exp(-2.0 * dt);
      this.camX += (tx - this.camX) * lerp;
      this.camY += (ty - this.camY) * lerp;
      const tourZoom = this.computeTargetZoom(60);
      this.camZoom += (tourZoom - this.camZoom) * lerp;
    }

    if (this.phase === 'playing') {
      this.hudThrottle += dt;
      if (this.hudThrottle >= 0.08) {
        this.hudThrottle = 0;
        this.emitHudSnapshot();
      }
    }
  }

  private updatePlayerInput(player: Snake): void {
    // 1. Check keyboard directional steering first
    let kx = 0;
    let ky = 0;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) kx -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) kx += 1;
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) ky -= 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) ky += 1;

    if (kx !== 0 || ky !== 0) {
      player.targetAngle = Math.atan2(ky, kx);
    } else if (this.touchStick) {
      if (this.touchStick.hasDragged && this.touchStick.angle !== null) {
        player.targetAngle = this.touchStick.angle;
      } else {
        const dx = this.touchStick.currentX - this.viewportWidth * 0.5;
        const dy = this.touchStick.currentY - this.viewportHeight * 0.5;
        if (dx * dx + dy * dy > 576) {
          player.targetAngle = Math.atan2(dy, dx);
        }
      }
    } else if (this.pointerActive) {
      const dx = this.pointerScreenX - this.viewportWidth * 0.5;
      const dy = this.pointerScreenY - this.viewportHeight * 0.5;
      if (dx * dx + dy * dy > 144) {
        player.targetAngle = Math.atan2(dy, dx);
      }
    }

    const wantsBoost =
      this.pointerDown ||
      this.touchDoubleTapBoost ||
      this.secondaryTouchIds.size > 0 ||
      this.keysHeld.has('Space') ||
      this.keysHeld.has('ShiftLeft') ||
      this.keysHeld.has('ShiftRight');

    player.boosting = wantsBoost && player.mass > MIN_BOOST_MASS;
  }

  private updateBotDecision(bot: Snake, dt: number): void {
    bot.aiTimer -= dt;
    const distFromCenter = Math.hypot(bot.x, bot.y);

    // 1. Urgent arena boundary avoidance
    if (distFromCenter > ARENA_RADIUS - 300) {
      const inward = Math.atan2(-bot.y, -bot.x);
      bot.targetAngle = normalizeAngle(inward + bot.aiBias * 0.25);
      bot.boosting = false;
      return;
    }

    // 2. Immediate obstacle avoidance (ray / lookahead against other snakes)
    const lookAhead = 155 + computeSnakeRadius(bot.mass) * 3;
    const aheadX = bot.x + Math.cos(bot.angle) * lookAhead;
    const aheadY = bot.y + Math.sin(bot.angle) * lookAhead;

    let hazardX = 0;
    let hazardY = 0;
    let minHazardDistSq = Infinity;

    for (let i = 0; i < this.snakes.length; i++) {
      const other = this.snakes[i];
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

    // 3. Policy-specific hunting / foraging behavior
    if (bot.policy === 'interceptor') {
      // Hunt a nearby snake and try to cut across its nose
      let prey: Snake | null = null;
      let bestDistSq = 680 * 680;
      for (const other of this.snakes) {
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
      // Prioritize high-value loot orbs or orbit giant snakes
      let bestLoot: Orb | null = null;
      let bestScore = -Infinity;
      for (let i = 0; i < this.orbs.length; i++) {
        const o = this.orbs[i];
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

    // Default 'forager' policy: seek closest cluster of orbs
    let targetOrb: Orb | null = null;
    let bestVal = -Infinity;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
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

  private stepSnakeKinematics(snake: Snake, dt: number): void {
    if (snake.boosting && snake.mass > MIN_BOOST_MASS) {
      const drained = BOOST_DRAIN_PER_SEC * dt;
      snake.mass = Math.max(MIN_BOOST_MASS, snake.mass - drained);

      if (snake.isPlayer) {
        this.boostDropAccum += drained;
        if (this.boostDropAccum >= BOOST_DROP_MASS_THRESHOLD) {
          this.boostDropAccum -= BOOST_DROP_MASS_THRESHOLD;
          const tail = snake.segments[snake.segments.length - 1] || snake;
          this.spawnBoostOrb(
            tail.x + (Math.random() - 0.5) * 10,
            tail.y + (Math.random() - 0.5) * 10,
            snake.skin.colors[0] || '#A3E635',
          );
        }
      }

      if (Math.random() < 0.45) {
        const tail = snake.segments[snake.segments.length - 1] || snake;
        this.spawnParticle(
          tail.x + (Math.random() - 0.5) * 12,
          tail.y + (Math.random() - 0.5) * 12,
          -Math.cos(snake.angle) * 70 + (Math.random() - 0.5) * 50,
          -Math.sin(snake.angle) * 70 + (Math.random() - 0.5) * 50,
          0.32,
          3.2,
          snake.skin.colors[0] || '#A3E635',
        );
      }
    } else {
      snake.boosting = false;
    }

    const turnRate = computeTurnRate(snake.mass);
    snake.angle = stepAngleTowards(snake.angle, snake.targetAngle, turnRate * dt);

    const speed = snake.boosting ? BOOST_SPEED : BASE_SPEED;
    snake.x += Math.cos(snake.angle) * speed * dt;
    snake.y += Math.sin(snake.angle) * speed * dt;

    // Record high-resolution breadcrumb at head
    const head = snake.path[0];
    if (!head || Math.hypot(snake.x - head.x, snake.y - head.y) >= 3) {
      snake.path.unshift({ x: snake.x, y: snake.y });
    } else {
      head.x = snake.x;
      head.y = snake.y;
    }

    // Recompute exact arc-length segment positions along path
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

    // Trim excess path breadcrumbs
    if (pathIdx + 6 < snake.path.length) {
      snake.path.length = pathIdx + 6;
    }

    snake.segments = newSegments;
  }

  private consumeNearbyOrbs(snake: Snake, dt: number): void {
    const radius = computeSnakeRadius(snake.mass);
    const magnetRadius = radius + 44;
    const eatRadius = radius + 11;
    const magnetSq = magnetRadius * magnetRadius;
    const eatSq = eatRadius * eatRadius;

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      const dx = snake.x - orb.x;
      const dy = snake.y - orb.y;
      const dSq = dx * dx + dy * dy;

      if (dSq <= eatSq) {
        snake.mass += orb.value * ORB_EAT_MASS_FACTOR;
        if (orb.egpValue > 0) {
          snake.potEgp = roundEgp(snake.potEgp + orb.egpValue);
        }
        if (snake.isPlayer) {
          soundEngine.playEat(orb.isLoot);
        }
        this.spawnParticle(
          orb.x,
          orb.y,
          (Math.random() - 0.5) * 90,
          (Math.random() - 0.5) * 90,
          0.25,
          orb.isLoot ? 4.5 : 3,
          orb.color,
        );
        this.orbs.splice(i, 1);
      } else if (dSq <= magnetSq) {
        const d = Math.sqrt(dSq) || 1;
        const pull = 360 * dt;
        orb.x += (dx / d) * pull;
        orb.y += (dy / d) * pull;
      }
    }
  }

  private resolveCollisions(): void {
    for (let i = 0; i < this.snakes.length; i++) {
      const attacker = this.snakes[i];
      if (!attacker.alive) continue;

      const attackerRadius = computeSnakeRadius(attacker.mass);

      // 1. Arena Perimeter Collision
      if (checkBoundaryCollision(attacker.x, attacker.y, attackerRadius, ARENA_RADIUS)) {
        this.eliminateSnake(attacker, null, 'Arena Perimeter');
        continue;
      }

      if (attacker.spawnShield > 0) continue;

      // 2. Head-to-Body Collision against other snakes
      for (let j = 0; j < this.snakes.length; j++) {
        if (i === j) continue;
        const defender = this.snakes[j];
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
          this.eliminateSnake(attacker, defender, defender.name);
          break;
        }
      }
    }
  }

  private eliminateSnake(
    victim: Snake,
    killer: Snake | null,
    killerLabel: string,
  ): void {
    victim.alive = false;

    // Split victim's EGP pot across fewer dropped fragment pebbles
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
      this.roomStake,
      fragmentSegmentIndices.length,
    );

    if (killer && killer.alive) {
      killer.kills += 1;
      if (killer.isPlayer) {
        soundEngine.playKill();
        this.trauma = Math.min(1, this.trauma + 0.45);
      }
    }

    // Burst victim body into money-bearing loot fragments & particles
    const lootPerDrop = Math.max(
      1.8,
      (victim.mass * 0.68) / Math.max(4, fragmentSegmentIndices.length),
    );

    for (let idx = 0; idx < fragmentSegmentIndices.length; idx++) {
      const segIdx = fragmentSegmentIndices[idx];
      const seg = victim.segments[segIdx] || { x: victim.x, y: victim.y };
      const color = getSegmentColor(victim.skin, segIdx, totalSegments);
      this.spawnLootOrb(
        seg.x + (Math.random() - 0.5) * 16,
        seg.y + (Math.random() - 0.5) * 16,
        lootPerDrop,
        color,
        fragmentEgpValues[idx],
      );
      if (segIdx % 4 === 0) {
        this.spawnParticle(
          seg.x,
          seg.y,
          (Math.random() - 0.5) * 220,
          (Math.random() - 0.5) * 220,
          0.55,
          5.5,
          color,
        );
      }
    }

    // Big head burst
    const headColor = victim.skin.colors[0] || '#F43F5E';
    for (let p = 0; p < 18; p++) {
      const ang = (p / 18) * Math.PI * 2;
      const spd = 90 + Math.random() * 190;
      this.spawnParticle(
        victim.x,
        victim.y,
        Math.cos(ang) * spd,
        Math.sin(ang) * spd,
        0.6,
        5,
        headColor,
      );
    }

    if (victim.isPlayer && this.phase === 'playing') {
      this.cashOutProgress = 0;
      soundEngine.playDeath();
      this.trauma = 0.9;
      this.spawnCallout(
        victim.x,
        victim.y - 18,
        this.lang === 'ar' ? 'يا نهار أبيض!' : 'DAMN BRUH...',
        '#F43F5E',
      );

      const finalLength = massToDisplayLength(victim.mass);
      const isNewBest = finalLength > this.bestLength;
      if (isNewBest) {
        this.bestLength = finalLength;
        try {
          localStorage.setItem('damn_bruh_best_length', String(this.bestLength));
        } catch {
          // Ignore storage errors
        }
      }

      this.pendingSummary = {
        finalLength,
        peakLength: Math.max(this.peakLength, finalLength),
        peakRank: this.peakRank,
        kills: victim.kills,
        survivedSeconds: Math.round(this.runElapsed),
        defeatedBy: killerLabel,
        isNewBest,
        bestLength: this.bestLength,
        cashedOut: false,
        roomStake: this.roomStake,
        payoutEgp: 0,
      };
      this.deathTimer = 0.52;
      this.emitHudSnapshot();
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    maxLife: number,
    size: number,
    color: string,
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.size = size;
    p.color = color;
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }

  private spawnCallout(x: number, y: number, text: string, color: string): void {
    const c = this.callouts[this.calloutCursor];
    this.calloutCursor = (this.calloutCursor + 1) % this.callouts.length;
    c.active = true;
    c.x = x;
    c.y = y;
    c.text = text;
    c.color = color;
    c.life = 1.1;
    c.maxLife = 1.1;
  }

  private updateCallouts(dt: number): void {
    for (const c of this.callouts) {
      if (!c.active) continue;
      c.life -= dt;
      c.y -= 36 * dt;
      if (c.life <= 0) c.active = false;
    }
  }

  private emitHudSnapshot(): void {
    const player = this.snakes.find((s) => s.isPlayer && s.alive);
    const lb = computeLeaderboard(this.snakes, 5);

    if (player && lb.playerRank > 0 && lb.playerRank < this.peakRank) {
      this.peakRank = lb.playerRank;
    }

    const mass = player ? player.mass : 0;
    const boostPct = player
      ? Math.min(100, Math.max(0, Math.round(((mass - MIN_BOOST_MASS) / 45) * 100)))
      : 0;

    this.callbacks.onHudUpdate({
      length: player ? massToDisplayLength(mass) : 0,
      kills: player ? player.kills : this.pendingSummary?.kills || 0,
      rank: lb.playerRank || lb.totalAlive,
      totalSnakes: lb.totalAlive,
      canBoost: mass > MIN_BOOST_MASS,
      boostCharge: boostPct,
      roomStake: this.roomStake,
      potEgp: player ? roundEgp(player.potEgp) : 0,
      leaderboard: lb.top,
      killNotice: this.killNoticeTimer > 0 ? this.killNoticeText : null,
    });
  }

  private render(): void {
    const ctx = this.ctx;
    const w = this.viewportWidth;
    const h = this.viewportHeight;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Clear deep obsidian slate background
    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, w, h);

    // Apply camera transform + decaying trauma shake
    const shakeMag = this.trauma * this.trauma * 16;
    const shakeX = shakeMag > 0.2 ? (Math.random() - 0.5) * 2 * shakeMag : 0;
    const shakeY = shakeMag > 0.2 ? (Math.random() - 0.5) * 2 * shakeMag : 0;

    ctx.translate(w * 0.5 + shakeX, h * 0.5 + shakeY);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);

    const halfW = (w * 0.5) / this.camZoom + 120;
    const halfH = (h * 0.5) / this.camZoom + 120;

    this.drawHexGrid(ctx, this.camX - halfW, this.camY - halfH, this.camX + halfW, this.camY + halfH);
    this.drawArenaBoundary(ctx);
    this.drawOrbs(ctx, halfW, halfH);
    this.drawParticles(ctx);
    this.drawSnakes(ctx, halfW, halfH);
    this.drawCallouts(ctx);

    ctx.restore();

    // Screen-space floating thumbstick guide when actively swiping on touch
    if (this.phase === 'playing' && this.touchStick && this.touchStick.hasDragged) {
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.strokeStyle = 'rgba(163, 230, 53, 0.42)';
      ctx.fillStyle = 'rgba(17, 23, 34, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.touchStick.anchorX, this.touchStick.anchorY, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(163, 230, 53, 0.85)';
      ctx.beginPath();
      ctx.arc(this.touchStick.currentX, this.touchStick.currentY, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.phase === 'playing' && this.minimapCanvas) {
      this.drawMinimap(this.minimapCanvas);
    }
  }

  private drawHexGrid(
    ctx: CanvasRenderingContext2D,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const r = 56;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);

    const startCol = Math.floor(minX / dx) - 1;
    const endCol = Math.ceil(maxX / dx) + 1;
    const startRow = Math.floor(minY / dy) - 1;
    const endRow = Math.ceil(maxY / dy) + 1;

    ctx.strokeStyle = '#151D2B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let col = startCol; col <= endCol; col++) {
      const cx = col * dx;
      const offsetY = (col & 1) !== 0 ? dy * 0.5 : 0;
      for (let row = startRow; row <= endRow; row++) {
        const cy = row * dy + offsetY;
        if (cx * cx + cy * cy > (ARENA_RADIUS + 140) * (ARENA_RADIUS + 140)) {
          continue;
        }
        // Draw 3 edges of hexagon to avoid overdrawing shared borders
        for (let k = 0; k < 3; k++) {
          const a0 = (Math.PI / 3) * k;
          const a1 = (Math.PI / 3) * (k + 1);
          ctx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
          ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
        }
      }
    }
    ctx.stroke();
  }

  private drawArenaBoundary(ctx: CanvasRenderingContext2D): void {
    // Outer danger zone wash
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS + 1200, 0, Math.PI * 2);
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.10)';
    ctx.fill();

    // Crisp glowing crimson perimeter ring
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#F43F5E';
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS - 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawOrbs(ctx: CanvasRenderingContext2D, halfW: number, halfH: number): void {
    const now = performance.now() * 0.004;
    const orbScale = Math.min(1.55, Math.max(1, 0.45 / Math.max(0.18, this.camZoom)));
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (
        Math.abs(o.x - this.camX) > halfW ||
        Math.abs(o.y - this.camY) > halfH
      ) {
        continue;
      }
      const pulse = 1 + Math.sin(now + o.phase) * 0.12;
      const r = o.radius * pulse * orbScale;

      // Soft outer halo
      ctx.globalAlpha = o.isLoot ? 0.30 : 0.20;
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 1.65, 0, Math.PI * 2);
      ctx.fill();

      // Core orb
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Crisp bright center spec
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(o.x - r * 0.22, o.y - r * 0.22, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawSnakes(ctx: CanvasRenderingContext2D, halfW: number, halfH: number): void {
    // Identify current #1 leader for crown marker
    let leaderId: string | null = null;
    let maxMass = -1;
    for (const s of this.snakes) {
      if (s.alive && s.mass > maxMass) {
        maxMass = s.mass;
        leaderId = s.id;
      }
    }

    // Draw bots first, player last so player sits cleanly on top
    const ordered = [...this.snakes].sort((a, b) =>
      a.isPlayer === b.isPlayer ? 0 : a.isPlayer ? 1 : -1,
    );

    for (const snake of ordered) {
      if (!snake.alive || snake.segments.length === 0) continue;

      const radius = computeSnakeRadius(snake.mass);
      const total = snake.segments.length;
      const isShielded = snake.spawnShield > 0;

      // Quick viewport cull check across bounding points
      let anyVisible = false;
      for (let i = 0; i < total; i += 4) {
        const seg = snake.segments[i];
        if (
          Math.abs(seg.x - this.camX) <= halfW + radius * 2 &&
          Math.abs(seg.y - this.camY) <= halfH + radius * 2
        ) {
          anyVisible = true;
          break;
        }
      }
      if (!anyVisible) continue;

      ctx.save();
      if (isShielded) {
        ctx.globalAlpha = 0.55 + Math.sin(performance.now() * 0.018) * 0.25;
      }

      // Boost energy aura
      if (snake.boosting) {
        ctx.strokeStyle = snake.skin.colors[0] || '#A3E635';
        ctx.lineWidth = radius * 2.55;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.moveTo(snake.segments[0].x, snake.segments[0].y);
        for (let i = 2; i < total; i += 2) {
          ctx.lineTo(snake.segments[i].x, snake.segments[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = isShielded ? 0.7 : 1;
      }

      // Draw body segments from tail to head
      for (let i = total - 1; i >= 0; i--) {
        const seg = snake.segments[i];
        if (
          Math.abs(seg.x - this.camX) > halfW + radius &&
          Math.abs(seg.y - this.camY) > halfH + radius
        ) {
          continue;
        }
        const taper = i > total - 6 ? (total - i) / 6 : 1;
        const segR = radius * (0.45 + 0.55 * taper);
        const color = getSegmentColor(snake.skin, i, total);

        // Dark outer outline for crisp contrast
        ctx.fillStyle = '#070A10';
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, segR + 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Main segment fill
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, segR, 0, Math.PI * 2);
        ctx.fill();

        // Subtle dorsal highlight on every other segment
        if (i % 2 === 0 && i < total - 3) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.beginPath();
          ctx.arc(seg.x - segR * 0.2, seg.y - segR * 0.22, segR * 0.48, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw expressive eyes on the head
      this.drawSnakeEyes(ctx, snake, radius);

      // Scale label & crown inversely with camera zoom so text stays crisp when zoomed out
      const uiScale = Math.min(3.2, Math.max(1, 0.68 / Math.max(0.18, this.camZoom)));
      ctx.globalAlpha = 1;

      // Crown icon for #1 leader
      if (snake.id === leaderId) {
        this.drawCrown(ctx, snake.x, snake.y - radius - 14 * uiScale, uiScale * 0.9);
      }

      // Crisp labels above head: player displays money; every other snake displays username + money
      const moneyLabel = `${formatEgp(snake.potEgp)} ${getCurrencyUnit(this.lang)}`;
      const fontSize = Math.round((snake.isPlayer ? 13 : 11) * uiScale);
      ctx.font = `700 ${fontSize}px "JetBrains Mono", "Cairo", "Outfit", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 * uiScale;
      ctx.strokeStyle = '#0B0F17';
      const labelY = snake.y - radius - (snake.id === leaderId ? 26 : 12) * uiScale;

      const snakeCashOut = snake.isPlayer
        ? Math.max(this.cashOutProgress, this.snakeCashOutMap.get(snake.id) ?? 0)
        : (this.snakeCashOutMap.get(snake.id) ?? 0);

      if (snakeCashOut > 0) {
        const labelCenterY = labelY - fontSize * 0.36;
        const textWidth = ctx.measureText(moneyLabel).width;
        const ringR = Math.max(textWidth * 0.5 + 3 * uiScale, fontSize * 0.78);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + Math.PI * 2 * snakeCashOut;

        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
        ctx.lineWidth = 2.1 * uiScale;
        ctx.beginPath();
        ctx.arc(snake.x, labelCenterY, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = snakeCashOut >= 0.9 ? '#A3E635' : '#38BDF8';
        ctx.lineWidth = 2.6 * uiScale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(snake.x, labelCenterY, ringR, startAngle, endAngle);
        ctx.stroke();

        const tipX = snake.x + Math.cos(endAngle) * ringR;
        const tipY = labelCenterY + Math.sin(endAngle) * ringR;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 1.7 * uiScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (!snake.isPlayer) {
        const nameFontSize = Math.round(10.5 * uiScale);
        const nameY = labelY - fontSize * 1.15;
        ctx.save();
        ctx.font = `600 ${nameFontSize}px "Outfit", "Cairo", sans-serif`;
        ctx.lineWidth = 2.8 * uiScale;
        ctx.strokeStyle = '#0B0F17';
        ctx.strokeText(snake.name, snake.x, nameY);
        ctx.fillStyle = '#E2E8F0';
        ctx.fillText(snake.name, snake.x, nameY);
        ctx.restore();
      }

      ctx.strokeText(moneyLabel, snake.x, labelY);
      ctx.fillStyle = '#FBBF24';
      ctx.fillText(moneyLabel, snake.x, labelY);

      ctx.restore();
    }
  }

  private drawSnakeEyes(
    ctx: CanvasRenderingContext2D,
    snake: Snake,
    radius: number,
  ): void {
    const cos = Math.cos(snake.angle);
    const sin = Math.sin(snake.angle);
    const perpX = -sin;
    const perpY = cos;

    const fwd = radius * 0.38;
    const side = radius * 0.44;
    const eyeR = Math.max(3.2, radius * 0.27);

    const lx = snake.x + cos * fwd + perpX * side;
    const ly = snake.y + sin * fwd + perpY * side;
    const rx = snake.x + cos * fwd - perpX * side;
    const ry = snake.y + sin * fwd - perpY * side;

    if (snake.skin.eyeStyle === 'cyber') {
      // Glowing visor slit eyes
      ctx.save();
      ctx.translate(snake.x + cos * fwd, snake.y + sin * fwd);
      ctx.rotate(snake.angle);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-eyeR * 0.6, -side - eyeR * 0.6, eyeR * 1.4, (side + eyeR * 0.6) * 2);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-eyeR * 0.2, -side - eyeR * 0.2, eyeR * 0.8, (side + eyeR * 0.2) * 2);
      ctx.restore();
      return;
    }

    const pupilShift = eyeR * 0.34;
    const lookDx = Math.cos(snake.targetAngle) * pupilShift;
    const lookDy = Math.sin(snake.targetAngle) * pupilShift;

    for (const [ex, ey] of [
      [lx, ly],
      [rx, ry],
    ]) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0B0F17';
      ctx.beginPath();
      ctx.arc(
        ex + lookDx,
        ey + lookDy,
        snake.skin.eyeStyle === 'cute' ? eyeR * 0.62 : eyeR * 0.52,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      if (snake.skin.eyeStyle === 'cute' || snake.skin.eyeStyle === 'wide') {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(ex + lookDx - eyeR * 0.18, ey + lookDy - eyeR * 0.18, eyeR * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number = 1): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#FBBF24';
    ctx.strokeStyle = '#0B0F17';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-9, 5);
    ctx.lineTo(-10, -5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(0, -8);
    ctx.lineTo(4, 0);
    ctx.lineTo(10, -5);
    ctx.lineTo(9, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawCallouts(ctx: CanvasRenderingContext2D): void {
    const uiScale = Math.min(3.2, Math.max(1, 0.68 / Math.max(0.18, this.camZoom)));
    const fontSize = Math.round(20 * uiScale);
    for (const c of this.callouts) {
      if (!c.active) continue;
      const alpha = Math.min(1, c.life / 0.35);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${fontSize}px "Outfit", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4.5 * uiScale;
      ctx.strokeStyle = '#0B0F17';
      ctx.strokeText(c.text, c.x, c.y);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
      ctx.restore();
    }
  }

  private drawMinimap(mini: HTMLCanvasElement): void {
    const mctx = mini.getContext('2d');
    if (!mctx) return;

    const size = mini.width;
    const half = size * 0.5;
    const mapR = half - 6;

    mctx.clearRect(0, 0, size, size);

    // Arena disc
    mctx.fillStyle = 'rgba(11, 15, 23, 0.85)';
    mctx.beginPath();
    mctx.arc(half, half, mapR, 0, Math.PI * 2);
    mctx.fill();

    mctx.strokeStyle = '#263248';
    mctx.lineWidth = 1.5;
    mctx.stroke();

    // Crosshair lines
    mctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.moveTo(half, 6);
    mctx.lineTo(half, size - 6);
    mctx.moveTo(6, half);
    mctx.lineTo(size - 6, half);
    mctx.stroke();

    // Leader detection
    let leaderId: string | null = null;
    let maxMass = -1;
    for (const s of this.snakes) {
      if (s.alive && s.mass > maxMass) {
        maxMass = s.mass;
        leaderId = s.id;
      }
    }

    // Plot snakes
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const mx = half + (s.x / ARENA_RADIUS) * mapR;
      const my = half + (s.y / ARENA_RADIUS) * mapR;

      if (s.isPlayer) {
        mctx.fillStyle = '#A3E635';
        mctx.beginPath();
        mctx.arc(mx, my, 4, 0, Math.PI * 2);
        mctx.fill();
        mctx.strokeStyle = '#0B0F17';
        mctx.lineWidth = 1.5;
        mctx.stroke();
      } else if (s.id === leaderId) {
        mctx.fillStyle = '#FBBF24';
        mctx.beginPath();
        mctx.arc(mx, my, 3.2, 0, Math.PI * 2);
        mctx.fill();
      } else {
        mctx.fillStyle = 'rgba(244, 63, 94, 0.68)';
        mctx.beginPath();
        mctx.arc(mx, my, 2.1, 0, Math.PI * 2);
        mctx.fill();
      }
    }
  }

  private handleResize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.viewportWidth = rect.width;
    this.viewportHeight = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    if (this.phase === 'paused') {
      this.render();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.pointerType === 'touch') {
      if (this.touchPointerId === e.pointerId && this.touchStick) {
        this.touchStick = stepTouchStick(this.touchStick, x, y, 48, 6);
      }
      return;
    }

    this.pointerActive = true;
    this.pointerScreenX = x;
    this.pointerScreenY = y;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.phase !== 'playing') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.pointerType === 'touch') {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures
      }
      if (this.touchPointerId === null) {
        const now = performance.now();
        if (isDoubleTapWithinWindow(this.lastTouchTapMs, now)) {
          this.touchDoubleTapBoost = true;
          this.lastTouchTapMs = null;
        } else {
          this.touchDoubleTapBoost = false;
          this.lastTouchTapMs = now;
        }
        this.touchPointerId = e.pointerId;
        this.touchStick = {
          anchorX: x,
          anchorY: y,
          currentX: x,
          currentY: y,
          hasDragged: false,
          angle: null,
        };
      } else {
        // Second finger anywhere on screen also triggers boost
        this.secondaryTouchIds.add(e.pointerId);
      }
      return;
    }

    if (e.button === 0) {
      this.pointerDown = true;
      this.pointerActive = true;
      this.pointerScreenX = x;
      this.pointerScreenY = y;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      try {
        if (this.canvas.hasPointerCapture(e.pointerId)) {
          this.canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore release errors
      }
      if (this.touchPointerId === e.pointerId) {
        // Keep snake gliding along last steered angle when finger lifts
        this.pointerActive = false;
        this.touchPointerId = null;
        this.touchStick = null;
        this.touchDoubleTapBoost = false;
      } else {
        this.secondaryTouchIds.delete(e.pointerId);
      }
      return;
    }
    this.pointerDown = false;
  };

  private onTouchPreventDefault = (e: TouchEvent): void => {
    if (this.phase === 'playing') {
      e.preventDefault();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.phase !== 'playing') return;
    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      e.preventDefault();
    }
    this.keysHeld.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
  };

  private onBlurOrVisibility = (): void => {
    this.clearHeldInputs();
  };

  private onWindowPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    this.onPointerMove(e);
  };

  private onWindowPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || this.phase !== 'playing') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, select, label, [role="dialog"]')) return;
    if (e.target === this.canvas) return;
    this.onPointerDown(e);
  };

  private bindInputListeners(): void {
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.canvas);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerdown', this.onWindowPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('touchstart', this.onTouchPreventDefault, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchPreventDefault, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlurOrVisibility);
    document.addEventListener('visibilitychange', this.onBlurOrVisibility);
  }

  private unbindInputListeners(): void {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerdown', this.onWindowPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('touchstart', this.onTouchPreventDefault);
    this.canvas.removeEventListener('touchmove', this.onTouchPreventDefault);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlurOrVisibility);
    document.removeEventListener('visibilitychange', this.onBlurOrVisibility);
  }
}
