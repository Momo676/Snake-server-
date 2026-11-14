export type SkinPattern = 'striped' | 'gradient' | 'spotted' | 'solid' | 'ringed';
export type EyeStyle = 'fierce' | 'wide' | 'cyber' | 'cute';

export interface SkinDefinition {
  id: string;
  name: string;
  colors: string[];
  pattern: SkinPattern;
  eyeStyle: EyeStyle;
  trait?: string;
  isCustom?: boolean;
}

export interface PhotoAnalysisResult {
  model: string;
  title: string;
  description: string;
  palette: string[];
  pattern: SkinPattern;
  eyeStyle: EyeStyle;
  trait: string;
  previewDataUrl: string;
}

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type RoomStake = 25 | 50 | 100;

export type BotPolicy = 'forager' | 'interceptor' | 'scavenger';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  name: string;
  isPlayer: boolean;
  skin: SkinDefinition;
  policy?: BotPolicy;
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  mass: number;
  boosting: boolean;
  alive: boolean;
  kills: number;
  potEgp: number;
  spawnShield: number;
  aiTimer: number;
  aiTargetId: string | null;
  aiBias: number;
  /** High-resolution breadcrumb trail from head backwards */
  path: Vec2[];
  /** Computed segment centers from head (0) to tail */
  segments: Vec2[];
}

export interface Orb {
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
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  length: number;
  isPlayer: boolean;
  rank: number;
  accentColor: string;
}

export interface HudSnapshot {
  length: number;
  kills: number;
  rank: number;
  totalSnakes: number;
  canBoost: boolean;
  boostCharge: number; // 0 to 100 normalized for display
  roomStake: RoomStake;
  potEgp: number;
  leaderboard: LeaderboardEntry[];
  killNotice: string | null;
}

export interface RunSummary {
  finalLength: number;
  peakLength: number;
  peakRank: number;
  kills: number;
  survivedSeconds: number;
  defeatedBy: string;
  isNewBest: boolean;
  bestLength: number;
  cashedOut: boolean;
  roomStake: RoomStake;
  payoutEgp: number;
}
