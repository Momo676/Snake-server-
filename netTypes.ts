import type { RoomStake, RunSummary, SkinDefinition } from './types.ts';

export interface SerializedSnake {
  id: string;
  name: string;
  isHuman: boolean;
  skin: SkinDefinition;
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  mass: number;
  boosting: boolean;
  kills: number;
  potEgp: number;
  spawnShield: number;
  cashOutProgress: number;
  segments: [number, number][];
}

export interface SerializedOrb {
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

export interface ArenaBurstEvent {
  kind: 'burst';
  x: number;
  y: number;
  color: string;
  count: number;
}

export type ServerRunSummary = Omit<RunSummary, 'isNewBest' | 'bestLength'>;

export type ClientMessage =
  | {
      type: 'spectate';
      roomStake: RoomStake;
    }
  | {
      type: 'join';
      roomStake: RoomStake;
      name: string;
      skin: SkinDefinition;
    }
  | {
      type: 'input';
      angle: number;
      boosting: boolean;
    }
  | {
      type: 'cashout:hold';
      active: boolean;
    }
  | {
      type: 'leave';
    };

export type ServerMessage =
  | {
      type: 'joined';
      playerId: string;
      roomStake: RoomStake;
    }
  | {
      type: 'state';
      roomStake: RoomStake;
      tick: number;
      selfId: string | null;
      snakes: SerializedSnake[];
      orbs?: SerializedOrb[];
      events: ArenaBurstEvent[];
    }
  | {
      type: 'ate';
      isLoot: boolean;
    }
  | {
      type: 'killed';
    }
  | {
      type: 'eliminated';
      summary: ServerRunSummary;
    }
  | {
      type: 'cashedOut';
      summary: ServerRunSummary;
    }
  | {
      type: 'error';
      message: string;
    };
