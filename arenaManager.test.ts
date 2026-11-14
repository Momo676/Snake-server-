import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '../game/netTypes.ts';
import { CASH_OUT_HOLD_MS } from '../game/rules.ts';
import { PRESET_SKINS } from '../game/skins.ts';
import { ArenaRoomManager, type ClientTransport } from './arenaManager.ts';

function createMockClient(id: string): {
  transport: ClientTransport;
  messages: ServerMessage[];
  lastState: () => Extract<ServerMessage, { type: 'state' }> | undefined;
} {
  const messages: ServerMessage[] = [];
  return {
    transport: {
      id,
      send: (msg: ServerMessage) => {
        messages.push(msg);
      },
    },
    messages,
    lastState: () => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].type === 'state') {
          return messages[i] as Extract<ServerMessage, { type: 'state' }>;
        }
      }
      return undefined;
    },
  };
}

test('two human clients in the same stake room share the exact live arena', () => {
  const manager = new ArenaRoomManager({ autoTick: false });
  const c1 = createMockClient('sock-1');
  const c2 = createMockClient('sock-2');
  const c3 = createMockClient('sock-3');

  manager.handleConnect(c1.transport);
  manager.handleConnect(c2.transport);
  manager.handleConnect(c3.transport);

  manager.handleMessage(
    'sock-1',
    { type: 'join', roomStake: 25, name: 'PlayerOne', skin: PRESET_SKINS[0] },
    1000,
  );
  manager.handleMessage(
    'sock-2',
    { type: 'join', roomStake: 25, name: 'PlayerTwo', skin: PRESET_SKINS[1] },
    1000,
  );
  manager.handleMessage(
    'sock-3',
    { type: 'join', roomStake: 50, name: 'HighRoller', skin: PRESET_SKINS[2] },
    1000,
  );

  manager.stepRoom(25, 0.04, 1040);
  manager.stepRoom(50, 0.04, 1040);

  const s1 = c1.lastState();
  const s2 = c2.lastState();
  const s3 = c3.lastState();
  assert.ok(s1 && s2 && s3);

  const namesIn25FromP1 = s1.snakes.map((s) => s.name);
  const namesIn25FromP2 = s2.snakes.map((s) => s.name);
  assert.ok(namesIn25FromP1.includes('PlayerOne'));
  assert.ok(namesIn25FromP1.includes('PlayerTwo'));
  assert.ok(!namesIn25FromP1.includes('HighRoller'));

  assert.ok(namesIn25FromP2.includes('PlayerOne'));
  assert.ok(namesIn25FromP2.includes('PlayerTwo'));
  assert.notEqual(s1.selfId, s2.selfId);

  const namesIn50 = s3.snakes.map((s) => s.name);
  assert.ok(namesIn50.includes('HighRoller'));
  assert.ok(!namesIn50.includes('PlayerOne'));

  manager.destroy();
});

test('server-authoritative cashout:hold validates 3000ms hold, cancels on release, and removes snake cleanly', () => {
  const manager = new ArenaRoomManager({ autoTick: false });
  const c1 = createMockClient('sock-1');

  manager.handleConnect(c1.transport);
  manager.handleMessage(
    'sock-1',
    { type: 'join', roomStake: 25, name: 'CashTester', skin: PRESET_SKINS[0] },
    1000,
  );

  // Hold for 1.5s then cancel -> should NOT cash out
  manager.handleMessage('sock-1', { type: 'cashout:hold', active: true }, 1000);
  manager.stepRoom(25, 0.04, 2500);
  let state = c1.lastState()!;
  const meHolding = state.snakes.find((s) => s.id === state.selfId);
  assert.ok(meHolding && meHolding.cashOutProgress > 0.45 && meHolding.cashOutProgress < 0.6);
  assert.equal(
    c1.messages.some((m) => m.type === 'cashedOut'),
    false,
  );

  manager.handleMessage('sock-1', { type: 'cashout:hold', active: false }, 2600);
  manager.stepRoom(25, 0.04, 5000);
  assert.equal(
    c1.messages.some((m) => m.type === 'cashedOut'),
    false,
  );

  // Hold full 3000ms -> server emits cashedOut and removes snake
  manager.handleMessage('sock-1', { type: 'cashout:hold', active: true }, 6000);
  manager.stepRoom(25, 0.04, 6000 + CASH_OUT_HOLD_MS);

  const cashedMsg = c1.messages.find((m) => m.type === 'cashedOut');
  assert.ok(cashedMsg && cashedMsg.type === 'cashedOut');
  assert.equal(cashedMsg.summary.cashedOut, true);
  assert.equal(cashedMsg.summary.payoutEgp, 25);

  assert.equal(manager.getRoomSnakeNames(25).includes('CashTester'), false);

  manager.destroy();
});

test('disconnect and duplicate join cleanup prevent ghost or duplicate snakes', () => {
  const manager = new ArenaRoomManager({ autoTick: false });
  const c1 = createMockClient('sock-1');
  manager.handleConnect(c1.transport);

  manager.handleMessage(
    'sock-1',
    { type: 'join', roomStake: 25, name: 'SoloOne', skin: PRESET_SKINS[0] },
    1000,
  );
  manager.handleMessage(
    'sock-1',
    { type: 'join', roomStake: 25, name: 'SoloOne', skin: PRESET_SKINS[0] },
    1100,
  );

  const matches = manager.getRoomSnakeNames(25).filter((n) => n === 'SoloOne');
  assert.equal(matches.length, 1);

  manager.handleDisconnect('sock-1');
  assert.equal(manager.getRoomSnakeNames(25).includes('SoloOne'), false);
  assert.equal(manager.getRoomClientCount(25), 0);

  manager.destroy();
});
