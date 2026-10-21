'use strict';

// AI 辅助生成项目：规则实现、渲染、AI 与训练模块由 AI 生成。
/* ============================================================
   纸上坦克 · Paper Tanks
   15×15 回合制战术小游戏
   ============================================================ */

const SIZE = 15;
const RED = 0;
const BLUE = 1;
const PLAYER_NAMES = ['红方', '蓝方'];
const OWNER_CSS = ['#b23a2f', '#2f5f9e'];
const OWNER_LIGHT = ['#f0cfc7', '#cddcf1'];
const INK = '#2c2a26';
const PAPER = '#f5eeda';

const UNIT_TYPES = {
  tank: {
    name: '坦克', short: '坦', cost: 3, hp: 6, dmg: 2,
    attackMask: 'diamond2', splash: 0, canMotorize: false,
  },
  artillery: {
    name: '火炮', short: '炮', cost: 2, hp: 2, dmg: 2,
    attackMask: 'artillery', splash: 1, canMotorize: true,
  },
  atgun: {
    name: '反坦克炮', short: '反', cost: 2, hp: 2, dmg: 2,
    attackMask: 'artillery', splash: 0, canMotorize: true,
  },
  infantry: {
    name: '步兵', short: '步', cost: 1, hp: 2, dmg: 1,
    attackMask: 'diamond2', splash: 0, canMotorize: true,
  },
};

const BASE_START = [
  { x: 1, y: 1 },
  { x: 13, y: 13 },
];

const OUTPOST_START = [
  [{ x: 1, y: 8 }, { x: 8, y: 1 }, { x: 5, y: 5 }],
  [{ x: 6, y: 13 }, { x: 13, y: 6 }, { x: 9, y: 9 }],
];

/* ============================================================
   范围图样
   ============================================================ */

function parseMask(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const cells = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (rows[r][c] === '1') {
        cells.push({ dx: c - cx, dy: cy - r });
      }
    }
  }
  return cells;
}

const PAT = {
  defense: parseMask([
    '01110',
    '11111',
    '11111',
    '11111',
    '01110',
  ]),
  diamond2: parseMask([
    '00100',
    '01110',
    '11111',
    '01110',
    '00100',
  ]),
  king: parseMask([
    '111',
    '111',
    '111',
  ]),
  artillery: parseMask([
    '0011100',
    '0111110',
    '1111111',
    '1111111',
    '1111111',
    '0111110',
    '0011100',
  ]),
  orth: [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ],
};

/* ============================================================
   基础工具
   ============================================================ */

function inBoard(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

function cheb(dx, dy) {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unitDef(u) {
  return UNIT_TYPES[u.type];
}

function pieceLabel(piece) {
  if (!piece) return '';
  if (piece.kind === 'base') return `${PLAYER_NAMES[piece.owner]}基地`;
  if (piece.kind === 'outpost') return `${PLAYER_NAMES[piece.owner]}哨站`;
  const def = UNIT_TYPES[piece.type];
  return `${PLAYER_NAMES[piece.owner]}${piece.motorized ? '摩托化' : ''}${def.name}`;
}

function cellsFromMask(cx, cy, mask) {
  const out = [];
  for (const o of mask) {
    const x = cx + o.dx;
    const y = cy + o.dy;
    if (inBoard(x, y)) out.push({ x, y });
  }
  return out;
}

function inPatternAt(px, py, cx, cy, mask) {
  for (const o of mask) {
    if (cx + o.dx === px && cy + o.dy === py) return true;
  }
  return false;
}

function hide(el) {
  if (el) el.classList.add('hidden');
}

function show(el) {
  if (el) el.classList.remove('hidden');
}

/* ============================================================
   音频
   ============================================================ */

const BGM_NAME = '战场的回响_BGM';
const SFX_MAX_SECONDS = 1;

// 线性音量换算：-3 dB / +3 dB
const BGM_VOLUME = 0.28 * Math.pow(10, -3 / 20);
const SFX_DB_GAIN = Math.pow(10, 3 / 20);

const SOUND_FILES = Object.fromEntries(
  [
    '坦克履带声',
    '坦克炮击声',
    '威廉尖叫',
    BGM_NAME,
    '步枪射击',
    '步炮行军脚步',
    '火炮开火',
    '胜利',
    '越野吉普车身颠簸',
  ].map((name) => [name, `resource/sound/${name}.mp3`])
);

const SFX_VOLUME = {
  '坦克履带声': 0.32,
  '步炮行军脚步': 0.34,
  '越野吉普车身颠簸': 0.34,
  '坦克炮击声': 0.6,
  '火炮开火': 0.52,
  '步枪射击': 0.4,
  '威廉尖叫': 0.46,
  '胜利': 0.65,
};

let bgm = null;
let bgmRequested = false;
const activeSfx = new Set();

function initAudio() {
  bgm = new Audio(SOUND_FILES[BGM_NAME]);
  bgm.loop = true;
  bgm.preload = 'auto';
  bgm.volume = BGM_VOLUME;
}

function startBgm() {
  if (simulationMode || !bgm) return;
  bgmRequested = true;
  bgm.loop = true;
  bgm.volume = BGM_VOLUME;
  try {
    bgm.currentTime = 0;
    const p = bgm.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) {
    // 浏览器可能阻止自动播放；游戏逻辑不受影响
  }
}

function stopBgm() {
  bgmRequested = false;
  if (simulationMode || !bgm) return;
  try {
    bgm.pause();
    bgm.currentTime = 0;
  } catch (err) {
    // ignore
  }
}

// 普通音效最多播放前 1 秒；短于 1 秒的会自然播放完；传入 full 可完整播放
function playSfx(name, opts = {}) {
  if (simulationMode || observerMatchInProgress) return;
  const src = SOUND_FILES[name];
  if (!src || typeof Audio === 'undefined') return;

  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.dataset.soundName = name;
  const baseVolume = SFX_VOLUME[name] != null ? SFX_VOLUME[name] : 0.55;
  audio.volume = Math.min(1, baseVolume * SFX_DB_GAIN);

  let timer = null;
  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    activeSfx.delete(audio);
  };

  activeSfx.add(audio);
  audio.addEventListener('ended', cleanup, { once: true });

  if (!opts.full) {
    const maxSeconds = opts.maxSeconds != null ? opts.maxSeconds : SFX_MAX_SECONDS;
    timer = setTimeout(() => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (err) {
        // ignore
      }
      cleanup();
    }, maxSeconds * 1000);
  }

  const p = audio.play();
  if (p && typeof p.catch === 'function') p.catch(() => cleanup());
}

function moveSoundFor(u) {
  if (u.motorized) return '越野吉普车身颠簸';
  if (u.type === 'tank') return '坦克履带声';
  return '步炮行军脚步';
}

function attackSoundFor(u) {
  if (u.type === 'tank') return '坦克炮击声';
  if (u.type === 'infantry') return '步枪射击';
  return '火炮开火';
}

/* ============================================================
   游戏状态
   ============================================================ */

let state = null;
let gameToken = 0;
let aiTimer = null;
let nextUnitId = 1;
let effects = [];
let hoverCell = null;

let canvas = null;
let ctx = null;
let layout = { cell: 40, pad: 26, w: 0, h: 0 };
let dom = {};

/* ============================================================
   AI 记忆 / 调试
   ============================================================ */

const AI_MEMORY_KEY = 'paperTanks.aiMemory.v1';

// 由调试模式自对弈训练得到，可在 AI 调试面板中继续训练或导入导出
const DEFAULT_AI_STRATEGY = {
  level1Weight: 0.8,
  level2Weight: 0.27,
  baseThreat: 1008.861,
  outpostThreat: 120,
  pressureWeight: 1.437,
  advanceWeight: 2.014,
  motorizationThreshold: 4,
  motorizationWeight: 0.8,
  ownControlWeight: 0.8,
  localControlWeight: 1.0,
  localPushWeight: 40,
  stagingWeight: 6,
  annihilationWeight: 2.5,
  outpostDefenseWeight: 12,
  claimWeight: 20,
  survivalWeight: 1,
  screenWeight: 1,
  positioningWeight: 1,
  splashGainPositionWeight: 0.3,
  splashRiskPositionWeight: 0.3,
  rangePositionWeight: 0.3,
  blockPositionWeight: 1,
  spongePositionWeight: 0.1,
  enemyControlWeight: 4.0,
  openingRounds: 4,
  advantageRatio: 1.15,
  defenseRatio: 0.9,
  tankBias: 1.0,
  motorizedUnitBias: 0.6,
  motorizationOpeningBonus: 70,
  motorizationAdvantageBonus: 45,
  motorizationEvenBonus: 28,
};

// “清空策略”使用的基础策略（未训练版本）
const BASE_AI_STRATEGY = {
  level1Weight: 1.0,
  level2Weight: 0.18,
  baseThreat: 900,
  outpostThreat: 120,
  pressureWeight: 1.1,
  advanceWeight: 2.2,
  motorizationThreshold: 4,
  motorizationWeight: 0.8,
  ownControlWeight: 0.8,
  localControlWeight: 1.0,
  localPushWeight: 40,
  stagingWeight: 6,
  annihilationWeight: 2.5,
  outpostDefenseWeight: 12,
  claimWeight: 20,
  survivalWeight: 1,
  screenWeight: 1,
  positioningWeight: 1,
  splashGainPositionWeight: 0.3,
  splashRiskPositionWeight: 0.3,
  rangePositionWeight: 0.3,
  blockPositionWeight: 1,
  spongePositionWeight: 0.1,
  enemyControlWeight: 4.0,
  openingRounds: 4,
  advantageRatio: 1.15,
  defenseRatio: 0.9,
  tankBias: 1.0,
  motorizedUnitBias: 0.6,
  motorizationOpeningBonus: 70,
  motorizationAdvantageBonus: 45,
  motorizationEvenBonus: 28,
};

const EMPTY_AI_TRAINING = {
  evaluations: 0,
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  econKilled: 0,
  econLost: 0,
  bestFitness: 0,
  lastTrainedAt: null,
  lastDurationMs: null,
  lastSeed: null,
};

// 棋力训练：7 类棋子（4 兵种 + 3 种摩托化）
const CHESS_PIECE_KINDS = [
  { key: 'tank', type: 'tank', motorized: false, name: '坦克' },
  { key: 'artillery', type: 'artillery', motorized: false, name: '火炮' },
  { key: 'artillery_moto', type: 'artillery', motorized: true, name: '摩托化火炮' },
  { key: 'atgun', type: 'atgun', motorized: false, name: '反坦克炮' },
  { key: 'atgun_moto', type: 'atgun', motorized: true, name: '摩托化反坦克炮' },
  { key: 'infantry', type: 'infantry', motorized: false, name: '步兵' },
  { key: 'infantry_moto', type: 'infantry', motorized: true, name: '摩托化步兵' },
];

function createEmptyPlayerLearning() {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    learnedGames: 0,
    globalScoreSum: 0,
    localSamples: 0,
    localScoreSum: 0,
    deployKinds: {},
    deployValue: 0,
    moves: 0,
    forwardMoves: 0,
    safeMoves: 0,
    attacks: 0,
    unitAttacks: 0,
    kills: 0,
    damageDealt: 0,
    lastAt: null,
    lastGlobal: null,
    lastLocal: null,
    lastApplied: null,
  };
}

function createEmptyChessStats() {
  const kinds = {};
  for (const kind of CHESS_PIECE_KINDS) kinds[kind.key] = {};
  return {
    runs: 0,
    games: 0,
    scoreSum: 0,
    lastScore: null,
    lastAt: null,
    lastSeed: null,
    kinds,
  };
}

const DEFAULT_AI_MEMORY = {
  version: 1,
  debug: {
    enabled: true,
    showEnemyControl: true,
    showOwnControl: true,
    observer: false,
    learnFromPlayer: false,
  },
  strategy: DEFAULT_AI_STRATEGY,
  training: {
    evaluations: 15,
    games: 60,
    wins: 28,
    losses: 32,
    draws: 0,
    econKilled: 0,
    econLost: 0,
    bestFitness: 0.908,
    lastTrainedAt: '2026-10-20T15:56:14.774Z',
    lastDurationMs: 11181,
    lastSeed: 4199106165,
  },
  history: [],
  chess: createEmptyChessStats(),
  playerLearning: createEmptyPlayerLearning(),
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAiMemory(raw) {
  const def = cloneJson(DEFAULT_AI_MEMORY);
  if (!raw || typeof raw !== 'object') return def;

  const mem = { ...def, ...raw };
  mem.debug = { ...def.debug, ...(raw.debug || {}) };
  mem.strategy = { ...def.strategy, ...(raw.strategy || {}) };
  mem.training = { ...def.training, ...(raw.training || {}) };
  mem.history = Array.isArray(raw.history) ? raw.history.slice(-8) : [];

  const rawChess = raw.chess && typeof raw.chess === 'object' ? raw.chess : {};
  mem.chess = { ...createEmptyChessStats(), ...rawChess };
  mem.chess.runs = Math.max(0, Number(rawChess.runs) || 0);
  mem.chess.games = Math.max(0, Number(rawChess.games) || 0);
  mem.chess.scoreSum = Number.isFinite(rawChess.scoreSum) ? rawChess.scoreSum : 0;
  mem.chess.lastScore = Number.isFinite(rawChess.lastScore) ? rawChess.lastScore : null;
  mem.chess.lastAt = typeof rawChess.lastAt === 'string' ? rawChess.lastAt : null;
  mem.chess.lastSeed = Number.isFinite(rawChess.lastSeed) ? rawChess.lastSeed : null;
  mem.chess.kinds = {};
  for (const kind of CHESS_PIECE_KINDS) {
    const src = rawChess.kinds && rawChess.kinds[kind.key];
    const buckets = {};
    if (src && typeof src === 'object') {
      for (const [x, b] of Object.entries(src)) {
        if (!/^\d+$/.test(x) || !b || typeof b !== 'object') continue;
        buckets[x] = {
          count: Math.max(0, Number(b.count) || 0),
          value: Math.max(0, Number(b.value) || 0),
          output: Math.max(0, Number(b.output) || 0),
          survivalHp: Math.max(0, Number(b.survivalHp) || 0),
        };
      }
    }
    mem.chess.kinds[kind.key] = buckets;
  }

  for (const key of Object.keys(def.strategy)) {
    if (!Number.isFinite(mem.strategy[key])) mem.strategy[key] = def.strategy[key];
  }
  delete mem.strategy.forceLimit;
  delete mem.strategy.controlL2Factor;
  mem.strategy.openingRounds = Math.max(1, Math.min(20, Math.round(mem.strategy.openingRounds)));
  const rawPlayer = raw.playerLearning && typeof raw.playerLearning === 'object'
    ? raw.playerLearning
    : {};
  const player = createEmptyPlayerLearning();
  for (const key of ['games', 'wins', 'losses', 'learnedGames', 'globalScoreSum',
    'localSamples', 'localScoreSum', 'deployValue', 'moves', 'forwardMoves',
    'safeMoves', 'attacks', 'unitAttacks', 'kills', 'damageDealt']) {
    player[key] = Math.max(0, Number(rawPlayer[key]) || 0);
  }
  player.deployKinds = {};
  if (rawPlayer.deployKinds && typeof rawPlayer.deployKinds === 'object') {
    for (const [kind, value] of Object.entries(rawPlayer.deployKinds)) {
      if (Number.isFinite(value) && value > 0) player.deployKinds[kind] = value;
    }
  }
  player.lastAt = typeof rawPlayer.lastAt === 'string' ? rawPlayer.lastAt : null;
  player.lastGlobal = Number.isFinite(rawPlayer.lastGlobal) ? rawPlayer.lastGlobal : null;
  player.lastLocal = Number.isFinite(rawPlayer.lastLocal) ? rawPlayer.lastLocal : null;
  player.lastApplied = rawPlayer.lastApplied && typeof rawPlayer.lastApplied === 'object'
    ? rawPlayer.lastApplied
    : null;
  mem.playerLearning = player;

  mem.debug.enabled = !!mem.debug.enabled;
  mem.debug.showEnemyControl = !!mem.debug.showEnemyControl;
  mem.debug.showOwnControl = !!mem.debug.showOwnControl;
  mem.debug.observer = !!mem.debug.observer;
  mem.debug.learnFromPlayer = !!mem.debug.learnFromPlayer;
  return mem;
}

function loadAiMemory() {
  try {
    const raw = localStorage.getItem(AI_MEMORY_KEY);
    if (!raw) return cloneJson(DEFAULT_AI_MEMORY);
    return normalizeAiMemory(JSON.parse(raw));
  } catch (err) {
    return cloneJson(DEFAULT_AI_MEMORY);
  }
}

function saveAiMemory() {
  try {
    localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(aiMemory));
  } catch (err) {
    // localStorage 不可用时保留内存中的策略
  }
}

let aiMemory = loadAiMemory();
let simStrategies = null;
let aiRng = Math.random;
let simulationMode = false;
let trainingInProgress = false;
let chessTrainingInProgress = false;
let playerLearningSession = null;
let observerMatchInProgress = false;
let observerStopRequested = false;
let potentialCache = new Map();
let aiThreat = null;
let aiThreatOwner = null;
let aiThreatDirty = true;
let aiControl = null;
let debugThreatCache = null;
let aiLastDecision = null;

function aiRand() {
  return aiRng();
}

function aiStrategyFor(owner) {
  if (simStrategies && simStrategies[owner]) return simStrategies[owner];
  return aiMemory.strategy;
}

const PREVIEW_BASES = BASE_START.map((p, owner) => ({
  kind: 'base', owner, x: p.x, y: p.y, hp: 16, maxHp: 16,
}));

const PREVIEW_OUTPOSTS = OUTPOST_START.flatMap((list, owner) =>
  list.map((p) => ({ kind: 'outpost', owner, x: p.x, y: p.y, hp: 8, maxHp: 8 }))
);

function newGame(mode, difficulty = 'normal') {
  gameToken++;
  playerLearningSession = null;
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  nextUnitId = 1;
  effects = [];
  hoverCell = null;

  const diff = mode === 'ai' && difficulty === 'hard' ? 'hard' : 'normal';

  const bases = BASE_START.map((p, owner) => ({
    id: `base-${owner}`,
    kind: 'base',
    owner,
    x: p.x,
    y: p.y,
    hp: 16,
    maxHp: 16,
    attacked: false,
  }));

  const outposts = [];
  OUTPOST_START.forEach((list, owner) => {
    list.forEach((p, idx) => {
      outposts.push({
        id: `op-${owner}-${idx}`,
        kind: 'outpost',
        owner,
        x: p.x,
        y: p.y,
        hp: 8,
        maxHp: 8,
        attacked: false,
        deployUsed: false,
      });
    });
  });

  state = {
    mode,
    difficulty: diff,
    current: RED,
    round: 1,
    points: [6, 6],
    economy: { killed: [0, 0], lost: [0, 0] },
    units: [],
    bases,
    outposts,
    selected: null,
    buildMode: null,
    gameOver: false,
    winner: null,
    aiThinking: false,
    log: [],
  };

  if (dom.buildGrid) {
    dom.buildGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
  }

  hide(dom.startOverlay);
  hide(dom.gameOverOverlay);
  hide(dom.rulesOverlay);
  hide(dom.debugOverlay);
  startBgm();

  deployInitialGarrisons();

  resizeCanvas();
  addLog(
    mode === 'ai'
      ? diff === 'hard'
        ? '战斗开始：你执红方，蓝方由电脑指挥（困难）。'
        : '战斗开始：你执红方，蓝方由电脑指挥。'
      : '战斗开始：双人同屏，红方先手。',
    'system'
  );
  addLog(
    diff === 'hard'
      ? '哨站初始驻军：红方每座 4 名步兵，蓝方每座 8 名步兵。'
      : '哨站初始驻军：双方每座哨站周围各 4 名步兵。',
    'system'
  );
  addLog('提示：基地与哨站每回合可以手动攻击一次；每座哨站还能部署一次非摩托化单位。', 'system');
  startTurn(RED, true);
  beginPlayerLearningSession();
  updateUI();
}

function deployInitialGarrisons() {
  if (!state) return;
  const hardAI = state.mode === 'ai' && state.difficulty === 'hard';

  for (const o of state.outposts) {
    if (o.hp <= 0) continue;
    const useEight = hardAI && o.owner === BLUE;
    const offsets = useEight
      ? PAT.king.filter((off) => !(off.dx === 0 && off.dy === 0))
      : PAT.orth;

    for (const off of offsets) {
      const x = o.x + off.dx;
      const y = o.y + off.dy;
      if (!inBoard(x, y) || pieceAt(x, y)) continue;
      spawnUnit(o.owner, 'infantry', x, y, false);
    }
  }
}

function startTurn(player, initial = false) {
  if (!state || state.gameOver) return;

  state.current = player;
  state.points[player] = 6;

  for (const u of state.units) {
    if (u.owner !== player) continue;
    u.moved = false;
    u.attacked = false;
    u.moveFrom = null;
    u.moveAdjacent = false;
  }

  for (const s of allStructures()) {
    if (s.owner !== player) continue;
    s.attacked = false;
    s.deployUsed = false;
  }

  state.selected = null;
  state.buildMode = null;
  if (dom.buildGrid) {
    dom.buildGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
  }

  addLog(`${PLAYER_NAMES[player]}回合开始，获得 6 点建造值。`, player === RED ? 'red' : 'blue');

  const isAI = state.mode === 'ai' && player === BLUE;
  if (isAI) state.aiThinking = true;

  updateUI();

  if (isAI && !state.gameOver) {
    const token = gameToken;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      aiTimer = null;
      runAITurn(token);
    }, 450);
  }
}

function beginNextTurn() {
  if (!state || state.gameOver) return;
  const next = state.current === RED ? BLUE : RED;
  if (next === RED) state.round++;
  startTurn(next, false);
}

function endTurnHuman() {
  if (observerMatchInProgress || !state || state.gameOver || state.aiThinking) return;
  if (state.mode === 'ai' && state.current === BLUE) return;
  state.selected = null;
  state.buildMode = null;
  addLog(`${PLAYER_NAMES[state.current]}结束回合。`, 'system');
  beginNextTurn();
}

function allStructures() {
  if (!state) return [];
  return [...state.bases, ...state.outposts];
}

function ownBase(owner) {
  if (!state) return null;
  return state.bases.find((b) => b.owner === owner && b.hp > 0) || null;
}

function pieceAt(x, y) {
  if (!state) return null;
  for (const u of state.units) {
    if (u.x === x && u.y === y && u.hp > 0) return u;
  }
  for (const b of state.bases) {
    if (b.x === x && b.y === y && b.hp > 0) return b;
  }
  for (const o of state.outposts) {
    if (o.x === x && o.y === y && o.hp > 0) return o;
  }
  return null;
}

/* ============================================================
   单位行动判定
   ============================================================ */

function moveMaskFor(u) {
  if (u.type === 'tank') return PAT.defense;
  if (u.type === 'infantry') return u.motorized ? PAT.defense : PAT.diamond2;
  return u.motorized ? PAT.defense : PAT.king;
}

function attackMaskFor(u) {
  return PAT[UNIT_TYPES[u.type].attackMask];
}

function canUnitMove(u, opts = {}) {
  const moved = opts.moved !== undefined ? opts.moved : u.moved;
  const attacked = opts.attacked !== undefined ? opts.attacked : u.attacked;

  if (moved) return false;
  if (attacked && !(u.type === 'tank' || u.type === 'infantry')) return false;
  return true;
}

function getMoveCells(u, opts = {}) {
  if (!canUnitMove(u, opts)) return [];

  const attacked = opts.attacked !== undefined ? opts.attacked : u.attacked;
  let cells = cellsFromMask(u.x, u.y, moveMaskFor(u)).filter((c) => !pieceAt(c.x, c.y));

  if (attacked && u.type === 'infantry' && !u.motorized) {
    cells = cells.filter((c) => cheb(c.x - u.x, c.y - u.y) === 1);
  }
  return cells;
}

function canUnitAttack(u) {
  if (u.attacked) return false;
  if (!u.moved) return true;
  if (u.type === 'tank') return true;
  if (u.type === 'infantry') return u.motorized ? true : u.moveAdjacent;
  if (u.type === 'artillery' || u.type === 'atgun') return u.motorized && u.moveAdjacent;
  return false;
}

function unitAttackTargetsAt(u, x, y) {
  const out = [];
  for (const c of cellsFromMask(x, y, attackMaskFor(u))) {
    const p = pieceAt(c.x, c.y);
    if (p && p.owner !== u.owner) out.push(p);
  }
  return out;
}

function getUnitAttackTargets(u) {
  return canUnitAttack(u) ? unitAttackTargetsAt(u, u.x, u.y) : [];
}

function getStructureTargets(s) {
  if (!state || !s || s.hp <= 0) return [];
  if (s.owner !== state.current || s.attacked) return [];

  const out = [];
  for (const c of cellsFromMask(s.x, s.y, PAT.defense)) {
    const p = pieceAt(c.x, c.y);
    if (p && p.kind === 'unit' && p.owner !== s.owner) out.push(p);
  }
  return out;
}

function isUnitDone(u) {
  return !canUnitMove(u) && !canUnitAttack(u);
}

/* ============================================================
   建造与部署
   ============================================================ */

function getSpawnCells(owner) {
  const base = ownBase(owner);
  if (!base) return [];

  return PAT.king
    .filter((o) => !(o.dx === 0 && o.dy === 0))
    .map((o) => ({ x: base.x + o.dx, y: base.y + o.dy }))
    .filter((c) => inBoard(c.x, c.y) && !pieceAt(c.x, c.y));
}

function getOutpostDeployCells(outpost) {
  if (!outpost || outpost.hp <= 0 || outpost.deployUsed) return [];

  return PAT.king
    .filter((o) => !(o.dx === 0 && o.dy === 0))
    .map((o) => ({
      x: outpost.x + o.dx,
      y: outpost.y + o.dy,
      source: 'outpost',
      outpost,
    }))
    .filter((c) => inBoard(c.x, c.y) && !pieceAt(c.x, c.y));
}

function getBaseDeployCells(owner) {
  return getSpawnCells(owner).map((c) => ({ ...c, source: 'base' }));
}

// 摩托化单位只能从基地部署；哨站不能部署坦克；其他非摩托化单位可用哨站
function getDeploymentCells(owner, motorized = false, type = null) {
  const cells = getBaseDeployCells(owner);
  if (motorized || type === 'tank') return cells;

  for (const o of state.outposts) {
    if (o.owner !== owner) continue;
    cells.push(...getOutpostDeployCells(o));
  }
  return cells;
}

function buildCost(type, motorized) {
  const def = UNIT_TYPES[type];
  if (!def) return Infinity;
  return def.cost + (def.canMotorize && motorized ? 1 : 0);
}

function beginBuild(type, motorized) {
  if (observerMatchInProgress || !state || state.gameOver || state.aiThinking) return;
  if (state.mode === 'ai' && state.current === BLUE) return;

  const def = UNIT_TYPES[type];
  if (!def) return;

  const moto = !!motorized && def.canMotorize;
  const cost = def.cost + (moto ? 1 : 0);
  if (state.points[state.current] < cost) return;

  const cells = getDeploymentCells(state.current, moto, type);
  if (!cells.length) {
    addLog(
      moto
        ? '基地周围没有空格，无法部署摩托化单位。'
        : '基地和可部署哨站周围没有空格，无法部署单位。',
      'warn'
    );
    updateUI();
    return;
  }

  state.buildMode = { type, motorized: moto, cost, cells };
  state.selected = null;
  updateUI();
}

function spawnUnit(owner, type, x, y, motorized) {
  const def = UNIT_TYPES[type];
  const unit = {
    id: `u-${nextUnitId++}`,
    kind: 'unit',
    type,
    owner,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    motorized: !!motorized && def.canMotorize,
    moved: false,
    attacked: false,
    moveFrom: null,
    moveAdjacent: false,
  };
  state.units.push(unit);
  return unit;
}

function placeBuiltUnit(x, y) {
  if (observerMatchInProgress || !state || !state.buildMode) return;
  const bm = state.buildMode;
  const target = bm.cells.find((c) => c.x === x && c.y === y);

  if (!target || pieceAt(x, y)) {
    state.buildMode = null;
    updateUI();
    return;
  }

  const fromOutpost = target.source === 'outpost';
  const outpost = target.outpost;
  if (fromOutpost && (bm.type === 'tank' || !outpost || outpost.hp <= 0 || outpost.deployUsed)) {
    state.buildMode = null;
    updateUI();
    return;
  }

  const cost = fromOutpost ? UNIT_TYPES[bm.type].cost : bm.cost;
  const motorized = fromOutpost ? false : bm.motorized;
  if (state.points[state.current] < cost) {
    state.buildMode = null;
    updateUI();
    return;
  }

  const unit = spawnUnit(state.current, bm.type, x, y, motorized);
  state.points[state.current] -= cost;
  if (fromOutpost) outpost.deployUsed = true;
  recordPlayerDeploy(unit, cost, fromOutpost ? 'outpost' : 'base');

  addLog(
    `${PLAYER_NAMES[state.current]}从${fromOutpost ? '哨站' : '基地'}部署了${
      motorized ? '摩托化' : ''
    }${UNIT_TYPES[bm.type].name}。`,
    state.current === RED ? 'red' : 'blue'
  );

  state.buildMode = null;
  state.selected = { kind: 'unit', id: unit.id };
  updateUI();
}

/* ============================================================
   移动与战斗
   ============================================================ */

function moveUnit(u, x, y) {
  if (!state || state.gameOver || !state.units.includes(u)) return false;
  if (!getMoveCells(u).some((c) => c.x === x && c.y === y)) return false;

  const dx = x - u.x;
  const dy = y - u.y;

  u.moveFrom = { x: u.x, y: u.y };
  u.moveAdjacent = cheb(dx, dy) === 1;
  u.x = x;
  u.y = y;
  u.moved = true;
  playSfx(moveSoundFor(u));

  effects.push({
    type: 'dust',
    x,
    y,
    t0: performance.now(),
    dur: 420,
  });

  recordPlayerMove(u, u.moveFrom, { x, y });

  addLog(
    `${PLAYER_NAMES[u.owner]}${unitDef(u).name}移动到 (${x}, ${y})。`,
    u.owner === RED ? 'red' : 'blue'
  );
  updateUI();
  return true;
}

function damageAgainst(u, target) {
  // 建筑单次至多受到 1 点伤害
  if (target.kind === 'base' || target.kind === 'outpost') return 1;

  let dmg = unitDef(u).dmg;
  if (u.type === 'atgun' && target.kind === 'unit') {
    if (target.type === 'tank') dmg += 1;
    else if (target.type === 'infantry') dmg = Math.max(0, dmg - 1);
  }
  return dmg;
}

function addShot(from, to) {
  effects.push({
    type: 'shot',
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    t0: performance.now(),
    dur: 480,
  });
}

function applyDamage(piece, amount, opts = {}) {
  if (!state || !piece || piece.hp <= 0) return 0;

  const isBuilding = piece.kind === 'base' || piece.kind === 'outpost';
  const dealt = Math.min(piece.hp, isBuilding ? Math.min(amount, 1) : amount);
  piece.hp -= dealt;

  // 棋力训练：按攻击者累计实际造成的伤害
  if (opts.source && state.chessStats && state.chessStats.output) {
    const id = opts.source.id;
    state.chessStats.output.set(id, (state.chessStats.output.get(id) || 0) + dealt);
  }

  effects.push({
    type: 'float',
    x: piece.x,
    y: piece.y,
    text: opts.label || `-${dealt}`,
    color: opts.color || '#a5352b',
    t0: performance.now(),
    dur: 900,
  });

  if (piece.hp <= 0) {
    piece.hp = 0;
    invalidateAiThreat();

    if (piece.kind === 'unit') {
      const victimValue = UNIT_TYPES[piece.type].cost + (piece.motorized ? 1 : 0);
      if (state.economy && typeof opts.owner === 'number') {
        state.economy.killed[opts.owner] += victimValue;
        state.economy.lost[piece.owner] += victimValue;
      }
      playSfx('威廉尖叫');
      state.units = state.units.filter((u) => u !== piece);
      addLog(`${pieceLabel(piece)}被摧毁。`, 'warn');
      if (state.selected && state.selected.kind === 'unit' && state.selected.id === piece.id) {
        state.selected = null;
      }
    } else if (piece.kind === 'outpost') {
      state.outposts = state.outposts.filter((o) => o !== piece);
      addLog(`${PLAYER_NAMES[piece.owner]}哨站被摧毁。`, 'warn');
      if (state.selected && state.selected.kind === 'outpost' && state.selected.id === piece.id) {
        state.selected = null;
      }
    } else if (piece.kind === 'base') {
      addLog(`${PLAYER_NAMES[piece.owner]}基地被摧毁！`, 'win');
      if (state.selected && state.selected.kind === 'base' && state.selected.id === piece.id) {
        state.selected = null;
      }
      endGame(piece.owner === RED ? BLUE : RED);
    }
  }

  return dealt;
}

function economyStats(owner) {
  const eco = state && state.economy ? state.economy : { killed: [0, 0], lost: [0, 0] };
  const killed = eco.killed[owner] || 0;
  const lost = eco.lost[owner] || 0;
  const ratio = lost > 0 ? killed / lost : killed > 0 ? Infinity : null;
  return { killed, lost, ratio };
}

function formatEconomyRatio(owner) {
  const { killed, lost, ratio } = economyStats(owner);
  const ratioText = ratio === null ? '—' : ratio === Infinity ? '∞' : ratio.toFixed(2);
  return `${ratioText}（${killed}/${lost}）`;
}

function formatEconomyShort(owner) {
  const { killed, lost, ratio } = economyStats(owner);
  const ratioText = ratio === null ? '—' : ratio === Infinity ? '∞' : ratio.toFixed(2);
  return `${ratioText} ${killed}/${lost}`;
}

function unitAttack(u, target) {
  if (!state || state.gameOver || !state.units.includes(u)) return;
  if (!getUnitAttackTargets(u).includes(target)) return;

  const def = unitDef(u);
  const dmg = damageAgainst(u, target);

  u.attacked = true;
  addShot(u, target);
  playSfx(attackSoundFor(u));
  addLog(
    `${PLAYER_NAMES[u.owner]}${def.name}攻击${pieceLabel(target)}，造成 ${dmg} 点伤害。`,
    u.owner === RED ? 'red' : 'blue'
  );

  const targetHpBefore = target.hp;
  let splashHits = 0;
  if (def.splash) {
    for (const o of PAT.orth) {
      const p = pieceAt(target.x + o.dx, target.y + o.dy);
      if (p && p.kind === 'unit' && p.owner !== u.owner && p.type !== 'tank') splashHits++;
    }
  }
  recordPlayerAttack(u, target, targetHpBefore, dmg, dmg >= targetHpBefore, splashHits);

  applyDamage(target, dmg, { color: '#a5352b', owner: u.owner, source: u });

  if (def.splash && !state.gameOver) {
    for (const o of PAT.orth) {
      const x = target.x + o.dx;
      const y = target.y + o.dy;
      if (!inBoard(x, y)) continue;

      const p = pieceAt(x, y);
      if (!p || p.kind !== 'unit' || p.owner === u.owner) continue;

      if (p.type === 'tank') {
        effects.push({
          type: 'float',
          x,
          y,
          text: '免疫',
          color: '#5d6b61',
          t0: performance.now(),
          dur: 750,
        });
        continue;
      }

      addLog(`火炮溅射命中${pieceLabel(p)}，造成 1 点伤害。`, u.owner === RED ? 'red' : 'blue');
      applyDamage(p, def.splash, { color: '#b06c3a', owner: u.owner, source: u });
    }
  }

  updateUI();
}

function structureAttack(s, target) {
  if (!state || state.gameOver || !s || s.hp <= 0 || s.attacked) return;
  if (s.owner !== state.current) return;
  if (!getStructureTargets(s).includes(target)) return;

  s.attacked = true;
  addShot(s, target);
  playSfx('火炮开火');

  const hpBefore = target.hp;
  const dealt = s.kind === 'base' ? hpBefore : Math.min(2, hpBefore);
  const killed = s.kind === 'base' || dealt >= hpBefore;
  recordPlayerStructureAttack(s, target, hpBefore, dealt, killed);

  if (s.kind === 'base') {
    addLog(
      `${PLAYER_NAMES[s.owner]}基地开火，秒杀${pieceLabel(target)}。`,
      s.owner === RED ? 'red' : 'blue'
    );
    applyDamage(target, 9999, { label: '秒杀', color: '#a5352b', owner: s.owner });
  } else {
    addLog(
      `${PLAYER_NAMES[s.owner]}哨站攻击${pieceLabel(target)}，造成 2 点伤害。`,
      s.owner === RED ? 'red' : 'blue'
    );
    applyDamage(target, 2, { color: '#a5352b', owner: s.owner });
  }

  updateUI();
}

function endGame(winner) {
  if (!state || state.gameOver) return;

  state.gameOver = true;
  state.winner = winner;
  state.aiThinking = false;
  state.selected = null;
  state.buildMode = null;

  if (simulationMode) {
    stopBgm();
    return;
  }
  if (observerMatchInProgress) return;

  finalizePlayerLearning(winner);

  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }

  stopBgm();
  playSfx('胜利', { full: true });

  addLog(`${PLAYER_NAMES[winner]}摧毁了敌方基地，获得胜利！`, 'win');

  dom.endEyebrow.textContent = '战斗结束';
  dom.endTitle.textContent = `${PLAYER_NAMES[winner]}胜利`;
  dom.endTitle.className = `end-title ${winner === RED ? 'red-win' : 'blue-win'}`;
  dom.endText.textContent =
    state.mode === 'ai'
      ? winner === RED
        ? '你摧毁了蓝方基地。'
        : '蓝方摧毁了你的基地。'
      : `${PLAYER_NAMES[winner]}摧毁了${PLAYER_NAMES[winner === RED ? BLUE : RED]}的基地。`;

  show(dom.gameOverOverlay);
  updateUI();
}

/* ============================================================
   选择与动作展示
   ============================================================ */

function getSelected() {
  if (!state || !state.selected) return null;
  const sel = state.selected;
  if (sel.kind === 'unit') {
    return state.units.find((u) => u.id === sel.id && u.hp > 0) || null;
  }
  if (sel.kind === 'base') {
    return state.bases.find((b) => b.id === sel.id && b.hp > 0) || null;
  }
  if (sel.kind === 'outpost') {
    return state.outposts.find((o) => o.id === sel.id && o.hp > 0) || null;
  }
  return null;
}

function selectPiece(piece) {
  if (!state || !piece) return;
  state.selected = { kind: piece.kind, id: piece.id };
  state.buildMode = null;
  updateUI();
}

function getSelectedActions() {
  const sel = getSelected();
  if (!sel) return { moves: [], attackCells: [], targets: [] };

  if (sel.kind === 'unit') {
    const moves = getMoveCells(sel);
    const canAtk = canUnitAttack(sel);
    const targets = canAtk ? getUnitAttackTargets(sel) : [];
    const attackCells = canAtk ? cellsFromMask(sel.x, sel.y, attackMaskFor(sel)) : [];
    return { moves, attackCells, targets };
  }

  if (sel.owner !== state.current || state.gameOver) {
    return { moves: [], attackCells: [], targets: [] };
  }

  const canAtk = !sel.attacked;
  const targets = canAtk ? getStructureTargets(sel) : [];
  const attackCells = canAtk ? cellsFromMask(sel.x, sel.y, PAT.defense) : [];
  return { moves: [], attackCells, targets };
}

function isActionable(x, y) {
  if (!state) return false;

  if (state.buildMode) {
    return state.buildMode.cells.some((c) => c.x === x && c.y === y);
  }

  const sel = getSelected();
  if (sel) {
    if (sel.kind === 'unit' && getMoveCells(sel).some((c) => c.x === x && c.y === y)) {
      return true;
    }
    const targets = sel.kind === 'unit' ? getUnitAttackTargets(sel) : getStructureTargets(sel);
    if (targets.some((t) => t.x === x && t.y === y)) return true;
  }

  const p = pieceAt(x, y);
  return !!(p && p.owner === state.current && (p.kind === 'unit' || p.kind === 'base' || p.kind === 'outpost'));
}

/* ============================================================
   输入处理
   ============================================================ */

function onBoardClick(x, y) {
  if (simulationMode || observerMatchInProgress || !state || state.gameOver || state.aiThinking) return;
  if (state.mode === 'ai' && state.current === BLUE) return;

  if (state.buildMode) {
    placeBuiltUnit(x, y);
    return;
  }

  const sel = getSelected();

  if (sel) {
    if (sel.kind === 'unit' && getMoveCells(sel).some((c) => c.x === x && c.y === y)) {
      moveUnit(sel, x, y);
      return;
    }

    const targets = sel.kind === 'unit' ? getUnitAttackTargets(sel) : getStructureTargets(sel);
    const target = targets.find((t) => t.x === x && t.y === y);
    if (target) {
      if (sel.kind === 'unit') unitAttack(sel, target);
      else structureAttack(sel, target);
      return;
    }
  }

  const piece = pieceAt(x, y);
  if (piece && piece.owner === state.current) {
    selectPiece(piece);
    return;
  }

  state.selected = null;
  updateUI();
}

function cellFromPointer(ev) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const mx = (ev.clientX - rect.left) * (layout.w / rect.width);
  const my = (ev.clientY - rect.top) * (layout.h / rect.height);
  const x = Math.floor((mx - layout.pad) / layout.cell);
  const row = Math.floor((my - layout.pad) / layout.cell);

  if (x < 0 || x >= SIZE || row < 0 || row >= SIZE) return null;
  return { x, y: SIZE - 1 - row };
}

function updateCursor() {
  if (!canvas) return;
  if (simulationMode || observerMatchInProgress) {
    canvas.style.cursor = 'default';
    return;
  }

  if (!state || state.gameOver || state.aiThinking) {
    canvas.style.cursor = 'default';
    return;
  }
  if (state.mode === 'ai' && state.current === BLUE) {
    canvas.style.cursor = 'default';
    return;
  }
  if (!hoverCell) {
    canvas.style.cursor = 'default';
    return;
  }
  canvas.style.cursor = isActionable(hoverCell.x, hoverCell.y) ? 'pointer' : 'default';
}

/* ============================================================
   人机 AI
   ============================================================ */

const THREAT_UNIT_BASE = { tank: 13, artillery: 18, atgun: 15, infantry: 7 };

function cellKey(x, y) {
  return `${x},${y}`;
}

// 某个单位下一回合可能攻击到的所有格子（当前射程 + 移动后射程）
function potentialAttackCellsForUnit(u, x = u.x, y = u.y) {
  const key = `${u.type}|${u.motorized ? 1 : 0}|${x},${y}`;
  const cached = potentialCache.get(key);
  if (cached) return cached;

  const out = new Set();
  const addPattern = (px, py) => {
    for (const c of cellsFromMask(px, py, attackMaskFor(u))) {
      out.add(cellKey(c.x, c.y));
    }
  };

  addPattern(x, y);

  if (u.type === 'tank' || (u.type === 'infantry' && u.motorized)) {
    for (const c of cellsFromMask(x, y, PAT.defense)) addPattern(c.x, c.y);
  } else if (u.type === 'infantry') {
    for (const c of cellsFromMask(x, y, PAT.king)) {
      if (c.x === x && c.y === y) continue;
      addPattern(c.x, c.y);
    }
  } else if (u.motorized) {
    for (const c of cellsFromMask(x, y, PAT.king)) {
      if (c.x === x && c.y === y) continue;
      addPattern(c.x, c.y);
    }
  }

  potentialCache.set(key, out);
  return out;
}

function threatWeightFor(targetUnit, enemyUnit) {
  if (!enemyUnit || enemyUnit.kind !== 'unit') return 0;
  const dmg = damageAgainst(enemyUnit, { kind: 'unit', type: targetUnit.type });
  const base = THREAT_UNIT_BASE[enemyUnit.type] || 8;
  const mobility = enemyUnit.motorized ? 1.1 : 1;
  return base * (0.75 + dmg * 0.12) * mobility;
}

// 一级控制区：对手当前直接射程；二级控制区：对手移动后仍能攻击到的范围
function buildThreatMap(owner) {
  const map = {
    owner,
    l1: new Map(),
    l2: new Map(),
    l1Cells: new Set(),
    l2Cells: new Set(),
  };

  const entryL1 = (key) => {
    let entry = map.l1.get(key);
    if (!entry) {
      entry = { units: new Map(), outposts: new Map(), base: false };
      map.l1.set(key, entry);
    }
    return entry;
  };
  const entryL2 = (key) => {
    let entry = map.l2.get(key);
    if (!entry) {
      entry = { units: new Map() };
      map.l2.set(key, entry);
    }
    return entry;
  };

  for (const e of state.units) {
    if (e.owner === owner || e.hp <= 0) continue;

    const direct = new Set();
    for (const c of cellsFromMask(e.x, e.y, attackMaskFor(e))) {
      const k = cellKey(c.x, c.y);
      direct.add(k);
      entryL1(k).units.set(e.id, e);
      map.l1Cells.add(k);
    }

    for (const k of potentialAttackCellsForUnit(e)) {
      if (direct.has(k)) continue;
      entryL2(k).units.set(e.id, e);
      map.l2Cells.add(k);
    }
  }

  for (const b of state.bases) {
    if (b.owner === owner || b.hp <= 0) continue;
    for (const c of cellsFromMask(b.x, b.y, PAT.defense)) {
      const k = cellKey(c.x, c.y);
      entryL1(k).base = true;
      map.l1Cells.add(k);
    }
  }

  for (const o of state.outposts) {
    if (o.owner === owner || o.hp <= 0) continue;
    for (const c of cellsFromMask(o.x, o.y, PAT.defense)) {
      const k = cellKey(c.x, c.y);
      entryL1(k).outposts.set(o.id, o);
      map.l1Cells.add(k);
    }
  }

  return map;
}

const CONTROL_BASE_POWER = 12;
const CONTROL_OUTPOST_POWER = 2;

// 控制区积分：当前火力 + 下一回合可打到的潜在火力（均为满值）
function buildFirepowerMap(owner) {
  const current = new Map();
  const potential = new Map();
  const total = new Map();
  const add = (map, key, value) => {
    if (value > 0) map.set(key, (map.get(key) || 0) + value);
  };

  for (const u of state.units) {
    if (u.owner !== owner || u.hp <= 0) continue;

    const power = unitDef(u).dmg;
    const direct = new Set();
    for (const c of cellsFromMask(u.x, u.y, attackMaskFor(u))) {
      const k = cellKey(c.x, c.y);
      direct.add(k);
      add(current, k, power);
    }
    for (const k of potentialAttackCellsForUnit(u)) {
      if (direct.has(k)) continue;
      add(potential, k, power);
    }
  }

  for (const b of state.bases) {
    if (b.owner !== owner || b.hp <= 0) continue;
    for (const c of cellsFromMask(b.x, b.y, PAT.defense)) {
      add(current, cellKey(c.x, c.y), CONTROL_BASE_POWER);
    }
  }

  for (const o of state.outposts) {
    if (o.owner !== owner || o.hp <= 0) continue;
    for (const c of cellsFromMask(o.x, o.y, PAT.defense)) {
      add(current, cellKey(c.x, c.y), CONTROL_OUTPOST_POWER);
    }
  }

  for (const [k, v] of current) total.set(k, (total.get(k) || 0) + v);
  for (const [k, v] of potential) total.set(k, (total.get(k) || 0) + v);

  return { owner, current, potential, total };
}

// 兰彻斯特式战力估算：单个战力 = 生命 × 攻击，总战力 = Σ(生命 × 攻击)
function sideCombatPower(owner) {
  let total = 0;
  for (const u of state.units) {
    if (u.owner === owner && u.hp > 0) {
      total += u.hp * unitDef(u).dmg;
    }
  }
  return total;
}

function computeAiPhase(owner, ownPower, enemyPower) {
  const strat = aiStrategyFor(owner);
  if (state.round <= (strat.openingRounds || 4)) return 'opening';

  const ratio = ownPower / Math.max(1, enemyPower);
  const econ = economyStats(owner);
  const econFav =
    econ.ratio === Infinity ||
    (Number.isFinite(econ.ratio) && econ.ratio >= 1.4);
  const econBad = Number.isFinite(econ.ratio) && econ.ratio <= 0.7;

  if (ratio >= (strat.advantageRatio || 1.15) || econFav) return 'advantage';
  if (ratio <= (strat.defenseRatio || 0.9) || econBad) return 'defense';
  return 'even';
}

function aiPhaseWeights(phase) {
  switch (phase) {
    case 'opening':
      return { advance: 1.0, risk: 0.9, attack: 1.0, own: 1.0, balance: 1.0 };
    case 'advantage':
      return { advance: 1.35, risk: 0.85, attack: 1.15, own: 1.0, balance: 1.2 };
    case 'defense':
      return { advance: 0.45, risk: 1.3, attack: 0.85, own: 1.3, balance: 1.2 };
    default:
      return { advance: 1.0, risk: 1.0, attack: 1.0, own: 1.0, balance: 1.0 };
  }
}

function phaseLabel(phase) {
  return (
    { opening: '开局', advantage: '优势', defense: '防守', even: '均势' }[phase] ||
    phase ||
    '—'
  );
}

function refreshAiControl(owner) {
  const strat = aiStrategyFor(owner);
  const enemyStrat = aiStrategyFor(1 - owner);
  const own = buildFirepowerMap(owner);
  const enemy = buildFirepowerMap(1 - owner);
  const ownPower = sideCombatPower(owner);
  const enemyPower = sideCombatPower(1 - owner);
  const powerRatio = ownPower / Math.max(1, enemyPower);

  aiControl = {
    owner,
    own,
    enemy,
    ownPower,
    enemyPower,
    powerRatio,
    phase: computeAiPhase(owner, ownPower, enemyPower),
  };
}

function refreshAiThreat(owner) {
  potentialCache.clear();
  aiThreat = buildThreatMap(owner);
  refreshAiControl(owner);
  aiThreatOwner = owner;
  aiThreatDirty = false;
}

function ensureAiThreat(owner) {
  if (!aiThreat || aiThreatOwner !== owner || aiThreatDirty) {
    refreshAiThreat(owner);
  }
}

function invalidateAiThreat() {
  aiThreatDirty = true;
}

// 评估一个单位能威胁到多少敌方目标（用于二级控制区/摩托化收益）
function coveragePriorityFor(unit) {
  const cells = potentialAttackCellsForUnit(unit);
  let value = 0;

  for (const e of state.units) {
    if (e.owner === unit.owner || e.hp <= 0) continue;
    if (cells.has(cellKey(e.x, e.y))) value += targetPriority(e);
  }
  for (const b of state.bases) {
    if (b.owner !== unit.owner && b.hp > 0 && cells.has(cellKey(b.x, b.y))) {
      value += targetPriority(b);
    }
  }
  for (const o of state.outposts) {
    if (o.owner !== unit.owner && o.hp > 0 && cells.has(cellKey(o.x, o.y))) {
      value += targetPriority(o);
    }
  }

  return value;
}

function bestEscapeSafety(unit) {
  let best = aiSafetyScore(unit, unit.x, unit.y, new Set());
  for (const c of cellsFromMask(unit.x, unit.y, moveMaskFor(unit))) {
    best = Math.max(best, aiSafetyScore(unit, c.x, c.y, new Set()));
  }
  return best;
}

// 计算摩托化带来的额外目标覆盖与更安全的落点
function aiMotorizationValue(owner, type, spawn) {
  const def = UNIT_TYPES[type];
  if (!def || !def.canMotorize) return 0;
  ensureAiThreat(owner);

  const baseUnit = {
    id: '__moto_base',
    kind: 'unit',
    type,
    owner,
    x: spawn.x,
    y: spawn.y,
    hp: def.hp,
    maxHp: def.hp,
    motorized: false,
    moved: false,
    attacked: false,
    moveAdjacent: false,
  };
  const motoUnit = { ...baseUnit, motorized: true };

  const coverageGain = Math.max(0, coveragePriorityFor(motoUnit) - coveragePriorityFor(baseUnit));
  const safetyGain = Math.max(0, bestEscapeSafety(motoUnit) - bestEscapeSafety(baseUnit));

  // 距离前线较远时，摩托化的额外机动本身也有价值
  let mobilityGain = 0;
  const dist = nearestObjectiveDist(owner, spawn.x, spawn.y);
  if (type === 'artillery' || type === 'atgun') {
    if (dist > 2) mobilityGain += 18;
  } else if (type === 'infantry') {
    if (dist > 3) mobilityGain += 6;
  }

  // 阶段化：开局/优势期更重视摩托化带来的先手与二级区压制
  const strat = aiStrategyFor(owner);
  const phase = aiControl ? aiControl.phase : 'even';
  let phaseBonus = 0;
  if (phase === 'opening') phaseBonus += strat.motorizationOpeningBonus || 0;
  else if (phase === 'advantage') phaseBonus += strat.motorizationAdvantageBonus || 0;
  else if (phase === 'even') phaseBonus += strat.motorizationEvenBonus || 0;
  else if (phase === 'defense') phaseBonus -= 6;

  return coverageGain + safetyGain * 0.8 + mobilityGain + phaseBonus;
}

// 二级控制区中的己方未来威胁，用于选位
function aiControlBalanceScore(u, x, y) {
  if (!aiControl || aiControl.owner !== u.owner) return 0;

  const strat = aiStrategyFor(u.owner);
  const key = cellKey(x, y);
  const ownPoints = aiControl.own.total.get(key) || 0;
  const enemyPoints = aiControl.enemy.total.get(key) || 0;
  const support = Math.max(0, ownPoints - unitDef(u).dmg);
  const phase = aiPhaseWeights(aiControl.phase);

  let score = support * (strat.ownControlWeight || 0) * phase.own;
  score += (support - enemyPoints) * (strat.localControlWeight || 0) * phase.balance;

  return score;
}

// 局部火力对比：候选点周围区域己方控制 vs 敌方控制，返回 -1..1
const AI_LOCAL_POWER_RADIUS = 2;

function aiLocalPowerBalance(owner, x, y, radius = AI_LOCAL_POWER_RADIUS) {
  if (!aiControl || aiControl.owner !== owner) return 0;

  let own = 0;
  let enemy = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (cheb(dx, dy) > radius) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBoard(nx, ny)) continue;
      const key = cellKey(nx, ny);
      // 基地的静态火力不计入“进攻性局部优势”，避免把部队吸回家里
      own += Math.max(
        0,
        (aiControl.own.total.get(key) || 0) - ownBaseFirepowerAt(owner, nx, ny)
      );
      enemy += aiControl.enemy.total.get(key) || 0;
    }
  }

  const total = own + enemy;
  if (total <= 0) return 0;
  return (own - enemy) / total;
}

// 从攒兵点向目标推进时，是否存在不在敌方当前火力下的下一步
function aiHasSafeApproach(owner, x, y) {
  const dist = nearestObjectiveDist(owner, x, y);
  if (dist <= 2) return true;

  for (const o of PAT.king) {
    if (o.dx === 0 && o.dy === 0) continue;
    const nx = x + o.dx;
    const ny = y + o.dy;
    if (!inBoard(nx, ny) || pieceAt(nx, ny)) continue;
    if (nearestObjectiveDist(owner, nx, ny) >= dist) continue;
    if (!aiControl) return true;
    if ((aiControl.enemy.current.get(cellKey(nx, ny)) || 0) <= 0) return true;
  }

  return false;
}

// 优质攒兵点：敌方控制不到、己方火力能覆盖，且有安全的推进路线
function aiStagingScore(owner, x, y) {
  if (!aiControl || aiControl.owner !== owner) return 0;
  const strat = aiStrategyFor(owner);

  const key = cellKey(x, y);
  if ((aiControl.enemy.current.get(key) || 0) > 0) return 0;

  // 基地自身的 12 点控制力会把“家”伪装成最强攒兵点，评估时剔除
  const ownSupport =
    (aiControl.own.current.get(key) || 0) +
    (aiControl.own.potential.get(key) || 0) -
    ownBaseFirepowerAt(owner, x, y);
  if (ownSupport <= 2) return 0;

  const dist = nearestObjectiveDist(owner, x, y);
  const forward = dist <= 2 ? 1 : Math.max(0, 1 - (dist - 2) * 0.15);
  const exposure = 1 / (1 + (aiControl.enemy.potential.get(key) || 0));
  const route = aiHasSafeApproach(owner, x, y) ? 1 : 0.35;
  const spread = 1 / (1 + aiFriendlyCrowding(owner, x, y) * 0.6);

  return ownSupport * forward * exposure * route * spread * (strat.stagingWeight || 0);
}

function aiFriendlyCrowding(owner, x, y) {
  let adjacent = 0;
  for (const f of state.units) {
    if (f.owner !== owner || f.hp <= 0) continue;
    if (f.x === x && f.y === y) continue;
    if (cheb(f.x - x, f.y - y) <= 1) adjacent++;
  }
  return adjacent;
}

function ownBaseFirepowerAt(owner, x, y) {
  const base = state.bases.find((b) => b.owner === owner && b.hp > 0);
  if (!base) return 0;
  for (const c of cellsFromMask(base.x, base.y, PAT.defense)) {
    if (c.x === x && c.y === y) return CONTROL_BASE_POWER;
  }
  return 0;
}

function nearestOwnBaseDist(owner, x, y) {
  const base = state.bases.find((b) => b.owner === owner && b.hp > 0);
  return base ? cheb(x - base.x, y - base.y) : Infinity;
}


// 下一回合能攻击到该哨站的敌方单位数量
function aiOutpostThreatCount(owner, outpost) {
  if (!aiThreat || aiThreat.owner !== owner) return 0;

  const key = cellKey(outpost.x, outpost.y);
  const units = new Set();
  const l1 = aiThreat.l1.get(key);
  if (l1) for (const e of l1.units.values()) if (e.hp > 0) units.add(e);
  const l2 = aiThreat.l2.get(key);
  if (l2) for (const e of l2.units.values()) if (e.hp > 0) units.add(e);
  return units.size;
}

// 该敌方单位能威胁到己方多少座哨站
function aiEnemyOutpostPressure(owner, enemy) {
  const cells = potentialAttackCellsForUnit(enemy);
  let pressure = 0;
  for (const o of state.outposts) {
    if (o.owner !== owner || o.hp <= 0) continue;
    if (cells.has(cellKey(o.x, o.y))) pressure++;
  }
  return pressure;
}

// 正在“白嫖”己方哨站/基地的敌方远程单位
function aiStandoffThreats(owner) {
  if (!aiThreat || aiThreat.owner !== owner) return [];
  if (aiThreat.standoff) return aiThreat.standoff;

  const base = state.bases.find((b) => b.owner === owner && b.hp > 0);
  const out = [];

  for (const e of state.units) {
    if (e.owner === owner || e.hp <= 0) continue;
    if (e.type !== 'artillery' && e.type !== 'atgun') continue;

    const cells = potentialAttackCellsForUnit(e);
    let threatens = aiEnemyOutpostPressure(owner, e) > 0;
    if (!threatens && base && cells.has(cellKey(base.x, base.y))) threatens = true;
    if (threatens) out.push(e);
  }

  aiThreat.standoff = out;
  return out;
}

// 反炮兵：奖励能打到敌方远程火力的位置，并适度向它靠拢
function aiCounterBatteryScore(u, x, y) {
  const strat = aiStrategyFor(u.owner);
  const targets = aiStandoffThreats(u.owner);
  if (!targets.length) return 0;

  const cells = potentialAttackCellsForUnit(u, x, y);
  let best = 0;
  let nearest = Infinity;

  for (const e of targets) {
    nearest = Math.min(nearest, cheb(e.x - x, e.y - y));
    if (cells.has(cellKey(e.x, e.y))) {
      best = Math.max(best, (strat.outpostDefenseWeight || 0) * 1.4);
    }
  }

  if (best > 0) return best;
  return -nearest * (strat.outpostDefenseWeight || 0) * 0.06;
}

// 哨站受威胁时，附近单位获得回防加分
function aiOutpostDefenseScore(owner, x, y) {
  if (!aiThreat || aiThreat.owner !== owner) return 0;
  const strat = aiStrategyFor(owner);
  let score = 0;

  for (const o of state.outposts) {
    if (o.owner !== owner || o.hp <= 0) continue;
    const threat = aiOutpostThreatCount(owner, o);
    if (threat <= 0) continue;
    const dist = cheb(x - o.x, y - o.y);
    if (dist > 4) continue;
    score += threat * (5 - dist) * (strat.outpostDefenseWeight || 0) * 0.4;
  }

  return score;
}

function aiPressureScore(u, x, y) {
  const strat = aiStrategyFor(u.owner);
  if (!strat.pressureWeight) return 0;

  const cells = potentialAttackCellsForUnit(u, x, y);
  let value = 0;

  for (const e of state.units) {
    if (e.owner === u.owner || e.hp <= 0) continue;
    if (cells.has(cellKey(e.x, e.y))) value += targetPriority(e) * 0.2;
  }
  for (const b of state.bases) {
    if (b.owner !== u.owner && b.hp > 0 && cells.has(cellKey(b.x, b.y))) {
      value += targetPriority(b) * 0.2;
    }
  }
  for (const o of state.outposts) {
    if (o.owner !== u.owner && o.hp > 0 && cells.has(cellKey(o.x, o.y))) {
      value += targetPriority(o) * 0.4;
    }
  }

  return value * strat.pressureWeight;
}

function aiSpacingScore(u, x, y) {
  let adjacent = 0;
  for (const f of state.units) {
    if (f.id === u.id || f.owner !== u.owner || f.hp <= 0) continue;
    if (cheb(f.x - x, f.y - y) <= 1) adjacent++;
  }
  return -Math.max(0, adjacent - 1) * 2.5;
}

function aiPlanCost(plan) {
  return plan.reduce(
    (sum, e) => sum + UNIT_TYPES[e.type].cost + (e.motorized ? 1 : 0),
    0
  );
}

const AI_UNIT_VALUE = { tank: 3.2, artillery: 3.4, atgun: 2.6, infantry: 1.3 };

function aiUnitPlanValue(type, motorized, owner) {
  const strat = aiStrategyFor(owner);
  const phase = aiControl ? aiControl.phase : 'even';
  let value = AI_UNIT_VALUE[type] || 1;

  if (type === 'tank') value *= strat.tankBias || 1;
  if (motorized) value += strat.motorizedUnitBias || 0;

  if (phase === 'opening' && motorized) value += 0.15;
  if (phase === 'advantage' && type === 'tank') value *= 1.1;
  if (phase === 'defense' && type === 'tank') value *= 0.9;
  if (phase === 'defense' && motorized) value *= 0.8;

  // 对面有远程火力白嫖哨站时，补充能反击/追击的兵种
  if (aiStandoffThreats(owner).length > 0) {
    if (type === 'artillery' || type === 'atgun') value += 0.7;
    if (type === 'tank') value += 0.4;
    if (type === 'infantry' && motorized) value += 0.3;
  }

  return value;
}

function aiPlanValue(plan, owner) {
  return plan.reduce(
    (sum, e) =>
      sum + aiUnitPlanValue(e.type, e.motorized, owner) + (e.motorized ? 0.4 : 0),
    0
  );
}

function aiFillPlan(plan, maxUnits) {
  let cost = aiPlanCost(plan);
  while (cost < 6 && plan.length < maxUnits) {
    plan.push({ type: 'infantry', motorized: false });
    cost += 1;
  }
  return plan;
}

function aiTrimPlan(plan, budget, protectedIndex) {
  const working = plan.map((e, idx) => ({ ...e, _idx: idx }));

  while (aiPlanCost(working) > budget) {
    let remove = -1;
    for (const type of ['infantry', 'atgun', 'artillery', 'tank']) {
      remove = working.findIndex((e) => e._idx !== protectedIndex && e.type === type);
      if (remove >= 0) break;
    }
    if (remove < 0) return null;
    working.splice(remove, 1);
  }

  return working.map(({ _idx, ...e }) => e);
}

function aiBestUnitForBudget(owner, points, spawn, allowMotorized = true, allowTank = true) {
  const strat = aiStrategyFor(owner);
  let best = null;
  let bestScore = -Infinity;

  for (const type of Object.keys(UNIT_TYPES)) {
    if (!allowTank && type === 'tank') continue;
    for (const motorized of allowMotorized ? [false, true] : [false]) {
      if (motorized && !UNIT_TYPES[type].canMotorize) continue;
      const cost = UNIT_TYPES[type].cost + (motorized ? 1 : 0);
      if (cost > points) continue;

      let score = aiUnitPlanValue(type, motorized, owner) * 8;
      if (motorized) {
        score += aiMotorizationValue(owner, type, spawn) * strat.motorizationWeight;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { type, motorized, cost };
      }
    }
  }

  return best;
}

function aiOk(token) {
  return token === gameToken && !!state && !state.gameOver;
}

async function runAITurn(token) {
  try {
    await aiTurnBody(token, BLUE);
  } catch (err) {
    console.error('AI turn error:', err);
    if (token === gameToken && state && !state.gameOver && state.current === BLUE) {
      state.aiThinking = false;
      state.selected = null;
      updateUI();
      beginNextTurn();
    }
  }
}

async function aiTurnBody(token, owner) {
  if (!aiOk(token)) return;

  state.aiThinking = true;
  state.selected = null;
  state.buildMode = null;
  refreshAiThreat(owner);
  updateUI();

  await sleep(280);
  if (!aiOk(token)) return;

  /* 建造 */
  const builds = aiChooseBuilds(owner);
  for (const b of builds) {
    if (!aiOk(token)) return;
    if (state.points[owner] < b.cost) continue;

    const cells = getDeploymentCells(owner, b.motorized, b.type);
    if (!cells.length) continue;

    const cell = aiChooseDeployCell(owner, cells, b);
    if (!cell) continue;

    spawnUnit(owner, b.type, cell.x, cell.y, b.motorized);
    state.points[owner] -= b.cost;
    if (cell.source === 'outpost') cell.outpost.deployUsed = true;

    addLog(
      `${PLAYER_NAMES[owner]}从${cell.source === 'outpost' ? '哨站' : '基地'}部署了${
        b.motorized ? '摩托化' : ''
      }${UNIT_TYPES[b.type].name}。`,
      owner === RED ? 'red' : 'blue'
    );
    updateUI();
    await sleep(100);
  }

  if (!aiOk(token)) return;
  await sleep(80);

  /* 基地 / 哨站攻击 */
  const structures = [state.bases[owner], ...state.outposts.filter((o) => o.owner === owner)];
  for (const s of structures) {
    if (!aiOk(token)) return;
    if (!s || s.hp <= 0 || s.attacked) continue;

    const targets = getStructureTargets(s);
    if (!targets.length) continue;

    const target = chooseStructureTarget(s, targets);
    if (!target) continue;

    state.selected = { kind: s.kind, id: s.id };
    updateUI();
    await sleep(120);
    if (!aiOk(token)) return;

    if (target.hp > 0 && getStructureTargets(s).includes(target)) {
      structureAttack(s, target);
      state.selected = null;
      updateUI();
      await sleep(180);
    }
  }

  if (!aiOk(token)) return;

  /* 单位行动 */
  const units = aiOrderUnits(owner, state.units.filter((u) => u.owner === owner));
  for (const u of units) {
    if (!aiOk(token)) return;
    if (!state.units.includes(u) || u.hp <= 0) continue;
    if (!canUnitMove(u) && !canUnitAttack(u)) continue;

    const plan = aiPlanUnit(u);
    if (!plan) continue;
    if (plan.order === 'hold') continue;

    state.selected = { kind: 'unit', id: u.id };
    updateUI();
    await sleep(80);
    if (!aiOk(token)) return;

    await aiExecutePlan(u, plan, token);
    state.selected = null;
    updateUI();
    await sleep(40);
  }

  if (!aiOk(token)) return;

  // 结束回合前检查是否还有剩余建造值
  await aiSpendRemainingPoints(token, owner);
  if (!aiOk(token)) return;

  state.selected = null;
  state.aiThinking = false;
  updateUI();
  await sleep(100);
  if (!aiOk(token)) return;

  addLog(`${PLAYER_NAMES[owner]}结束回合。`, 'system');
  beginNextTurn();
}

async function aiSpendRemainingPoints(token, owner) {
  let guard = 0;

  while (aiOk(token) && state.points[owner] > 0 && guard < 6) {
    guard++;

    const baseCells = getSpawnCells(owner);
    let cell = null;
    let choice = null;

    if (baseCells.length) {
      const spawn = aiChooseSpawnCell(owner, baseCells);
      choice = aiBestUnitForBudget(owner, state.points[owner], spawn, true);
      if (choice) cell = { ...spawn, source: 'base' };
    }

    if (!choice) {
      const outpostCells = getDeploymentCells(owner, false).filter((c) => c.source === 'outpost');
      if (!outpostCells.length) break;
      const spawn = aiChooseSpawnCell(owner, outpostCells);
      choice = aiBestUnitForBudget(owner, state.points[owner], spawn, false, false);
      if (!choice) break;
      cell = spawn;
    }

    spawnUnit(owner, choice.type, cell.x, cell.y, choice.motorized && cell.source === 'base');
    state.points[owner] -= choice.cost;
    if (cell.source === 'outpost') cell.outpost.deployUsed = true;

    addLog(
      `${PLAYER_NAMES[owner]}从${cell.source === 'outpost' ? '哨站' : '基地'}用剩余 ${
        choice.cost
      } 点建造值部署了${choice.motorized ? '摩托化' : ''}${UNIT_TYPES[choice.type].name}。`,
      owner === RED ? 'red' : 'blue'
    );
    updateUI();
    await sleep(120);
  }

  if (aiOk(token) && state.points[owner] > 0) {
    const reason = getDeploymentCells(owner, false).length
      ? '没有可部署的单位'
      : '基地和可部署哨站周围没有空格';
    addLog(
      `${PLAYER_NAMES[owner]}结束回合时仍有 ${state.points[owner]} 点建造值未使用（${reason}）。`,
      'warn'
    );
  }
}

function aiPlanImmediateBonus(owner, plan) {
  const values = [];

  for (const entry of plan) {
    const def = UNIT_TYPES[entry.type];
    if (!def) continue;

    const cells = getDeploymentCells(owner, entry.motorized, entry.type);
    let best = 0;

    for (const cell of cells) {
      const immediate = aiBestImmediateAction(
        owner,
        entry.type,
        entry.motorized,
        cell.x,
        cell.y
      );
      if (!immediate) continue;

      const fake = {
        id: '__plan_immediate',
        kind: 'unit',
        type: entry.type,
        owner,
        x: cell.x,
        y: cell.y,
        hp: def.hp,
        maxHp: def.hp,
        motorized: entry.motorized,
        moved: false,
        attacked: false,
        moveAdjacent: false,
      };

      const safety = aiSafetyScore(fake, immediate.end.x, immediate.end.y, immediate.kills);
      const value = immediate.value * 0.9 + safety * 0.2;
      if (value > best) best = value;
    }

    values.push(Math.max(0, best));
  }

  values.sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < Math.min(2, values.length); i++) {
    total += values[i] * (i === 0 ? 1 : 0.5);
  }
  return total * 0.45;
}

function aiChooseBuilds(owner) {
  ensureAiThreat(owner);

  const baseCells = getSpawnCells(owner);
  const allCells = getDeploymentCells(owner, false);
  if (!allCells.length) return [];

  const strat = aiStrategyFor(owner);

  const lists = [
    ['artillery', 'tank', 'infantry'],
    ['tank', 'artillery', 'infantry'],
    ['artillery', 'atgun', 'infantry', 'infantry'],
  ];
  const baseList = lists[(state.round - 1) % lists.length];
  let basePlan = baseList.map((type) => ({ type, motorized: false }));
  basePlan = aiFillPlan(basePlan, allCells.length);

  const spawn = baseCells.length ? aiChooseSpawnCell(owner, baseCells) : allCells[0];

  let bestPlan = basePlan;
  let bestScore =
    aiPlanValue(basePlan, owner) * 8 + aiPlanImmediateBonus(owner, basePlan);

  for (let i = 0; i < basePlan.length; i++) {
    const entry = basePlan[i];
    const def = UNIT_TYPES[entry.type];
    if (!def || !def.canMotorize || !baseCells.length) continue;

    const motoValue = aiMotorizationValue(owner, entry.type, spawn);
    if (motoValue < strat.motorizationThreshold) continue;

    let variant = basePlan.map((e, idx) => ({
      type: e.type,
      motorized: idx === i,
    }));
    variant = aiTrimPlan(variant, 6, i);
    if (!variant) continue;
    variant = aiFillPlan(variant, allCells.length);

    const score =
      aiPlanValue(variant, owner) * 8 +
      motoValue * strat.motorizationWeight +
      aiPlanImmediateBonus(owner, variant);
    if (score > bestScore) {
      bestScore = score;
      bestPlan = variant;
    }
  }

  return bestPlan.map((e) => ({
    type: e.type,
    motorized: e.motorized,
    cost: UNIT_TYPES[e.type].cost + (e.motorized ? 1 : 0),
  }));
}

function aiChooseSpawnCell(owner, cells) {
  const objectives = [
    state.bases.find((b) => b.owner !== owner && b.hp > 0),
    ...state.outposts.filter((o) => o.owner !== owner && o.hp > 0),
  ].filter(Boolean);

  if (!objectives.length) return cells[0];

  let best = cells[0];
  let bestD = Infinity;

  for (const c of cells) {
    let d = Infinity;
    for (const o of objectives) d = Math.min(d, cheb(c.x - o.x, c.y - o.y));
    if (d < bestD || (d === bestD && aiRand() < 0.5)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function aiImmediateAttackScore(unit, target) {
  let score = aiTargetScore(unit, target);
  const dmg = damageAgainst(unit, target);
  const kills = [];

  if (dmg >= target.hp) {
    kills.push(target);
  }

  if (unit.type === 'artillery') {
    for (const o of PAT.orth) {
      const p = pieceAt(target.x + o.dx, target.y + o.dy);
      if (!p || p.kind !== 'unit' || p.owner === unit.owner || p.type === 'tank') continue;
      score += 12;
      if (p.hp <= 1) {
        score += 25;
        kills.push(p);
      }
    }
  }

  return { score: score + 12, kills };
}

// 新部署单位当回合就能行动；评估部署点能否立刻开火/补刀
function aiBestImmediateAction(owner, type, motorized, x, y) {
  const def = UNIT_TYPES[type];
  if (!def) return null;

  const temp = {
    id: '__deploy_immediate',
    kind: 'unit',
    type,
    owner,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    motorized: !!motorized,
    moved: false,
    attacked: false,
    moveAdjacent: false,
  };

  let best = null;

  const consider = (targets, end, order) => {
    for (const target of targets) {
      const { score, kills } = aiImmediateAttackScore(temp, target);
      if (!best || score > best.value) {
        best = {
          value: score,
          end: { x: end.x, y: end.y },
          kills: new Set(kills),
          target,
          order,
        };
      }
    }
  };

  consider(unitAttackTargetsAt(temp, x, y), { x, y }, 'attack');

  for (const cell of cellsFromMask(x, y, moveMaskFor(temp))) {
    if (cell.x === x && cell.y === y) continue;
    if (pieceAt(cell.x, cell.y)) continue;
    if (!canAttackAfterMove(temp, cell)) continue;
    consider(unitAttackTargetsAt(temp, cell.x, cell.y), cell, 'move-then-attack');
  }

  return best;
}

function aiChooseDeployCell(owner, cells, planEntry) {
  const type = planEntry.type;
  const def = UNIT_TYPES[type];
  const strat = aiStrategyFor(owner);
  ensureAiThreat(owner);

  let best = null;
  let bestScore = -Infinity;

  for (const cell of cells) {
    const fake = {
      id: '__deploy_test',
      kind: 'unit',
      type,
      owner,
      x: cell.x,
      y: cell.y,
      hp: def.hp,
      maxHp: def.hp,
      motorized: !!planEntry.motorized,
      moved: false,
      attacked: false,
      moveAdjacent: false,
    };

    const immediate = aiBestImmediateAction(
      owner,
      type,
      !!planEntry.motorized,
      cell.x,
      cell.y
    );
    const evalEnd = immediate ? immediate.end : { x: cell.x, y: cell.y };
    const defeated = immediate ? immediate.kills : new Set();
    const safety = aiSafetyScore(fake, evalEnd.x, evalEnd.y, defeated);
    const incoming = aiIncomingThreat(fake, evalEnd.x, evalEnd.y, defeated);
    const dist = nearestObjectiveDist(owner, cell.x, cell.y);
    const localBalance = aiLocalPowerBalance(owner, evalEnd.x, evalEnd.y);

    let sourceBonus = 0;
    if (cell.source === 'outpost') {
      if (type === 'artillery' || type === 'atgun') sourceBonus += 6;
      else if (type === 'infantry') sourceBonus += 3;
      else sourceBonus -= 2;
    } else if (type === 'tank') {
      sourceBonus += 2;
    }
    // 局部火力占优时优先投入坦克突破；劣势区则更适合火力支援单位
    if (localBalance > 0.15 && type === 'tank') sourceBonus += localBalance * 8;
    if (localBalance < 0 && (type === 'artillery' || type === 'atgun')) sourceBonus += 4;

    // 被敌方远程火力白嫖的哨站：不要继续送兵，除非新单位能立即反击
    if (cell.source === 'outpost' && cell.outpost) {
      const threat = aiOutpostThreatCount(owner, cell.outpost);
      if (threat > 0) {
        sourceBonus -= threat * 5;
        if (immediate && immediate.value > 0) sourceBonus += threat * 7;
      }
    }

    let score =
      (immediate ? immediate.value * 0.9 : 0) +
      safety * 0.3 -
      dist * 1.2 +
      sourceBonus +
      aiStagingScore(owner, cell.x, cell.y) +
      aiOutpostDefenseScore(owner, evalEnd.x, evalEnd.y) * 0.6 +
      aiCounterBatteryScore(fake, evalEnd.x, evalEnd.y) * 0.6 +
      aiPositioningScore(fake, evalEnd.x, evalEnd.y, incoming);

    // 不要堵在家里：落点周围己方单位过多时降权
    score -= Math.max(0, aiFriendlyCrowding(owner, cell.x, cell.y) - 1) * 3;

    if (localBalance > 0) {
      score += localBalance * (strat.localPushWeight || 0);
    }

    if (aiControl) {
      const phaseW = aiPhaseWeights(aiControl.phase);
      const key = cellKey(evalEnd.x, evalEnd.y);
      const ownCtrl = aiControl.own.total.get(key) || 0;
      const enemyCtrl = aiControl.enemy.total.get(key) || 0;
      const support = Math.max(0, ownCtrl - def.dmg);

      score += support * (strat.ownControlWeight || 0) * phaseW.own * 0.6;
      score +=
        (support - enemyCtrl) *
        (strat.localControlWeight || 0) *
        phaseW.balance *
        0.4;
    }

    // 仍然把落点/行动终点的剩余二级威胁视为风险；已计划击杀的目标不计
    if (isDefensiveGun(fake) && aiThreat) {
      const entry = aiThreat.l2.get(cellKey(evalEnd.x, evalEnd.y));
      if (entry) {
        let remaining = 0;
        for (const e of entry.units.values()) {
          if (e.hp > 0 && !defeated.has(e)) remaining++;
        }
        if (remaining > 0) {
          const risk = 12 + remaining * 6;
          // 局部火力占优时，允许炮类顶到二级控制区前压攒兵
          score -= risk * (localBalance > 0.05 ? 0.5 : 1);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }

  return best;
}

function unitThreat(u) {
  const base = { artillery: 80, atgun: 70, tank: 60, infantry: 30 }[u.type] || 0;
  return base + (u.hp / u.maxHp) * 10 + (u.motorized ? 5 : 0);
}

function chooseStructureTarget(s, targets) {
  const sorted = targets.slice().sort((a, b) => {
    if (s.kind === 'outpost') {
      const ka = a.hp <= 2 ? 1 : 0;
      const kb = b.hp <= 2 ? 1 : 0;
      if (ka !== kb) return kb - ka;
    }
    return unitThreat(b) - unitThreat(a);
  });
  return sorted[0] || null;
}

function canAttackAfterMove(u, cell) {
  if (u.attacked || u.moved) return false;
  const dx = cell.x - u.x;
  const dy = cell.y - u.y;

  if (u.type === 'tank') return true;
  if (u.type === 'infantry') return u.motorized ? true : cheb(dx, dy) === 1;
  if (u.type === 'artillery' || u.type === 'atgun') {
    return u.motorized && cheb(dx, dy) === 1;
  }
  return false;
}

function targetPriority(t) {
  if (t.kind === 'base') return 260;
  if (t.kind === 'outpost') return 100;
  if (t.type === 'artillery') return 80;
  if (t.type === 'atgun') return 70;
  if (t.type === 'tank') return 60;
  if (t.type === 'infantry') return 30;
  return 10;
}

// 攻击目标估值：有生力量优先，残血补刀，反击威胁哨站的远程火力
function aiTargetScore(u, t) {
  const strat = aiStrategyFor(u.owner);
  const dmg = damageAgainst(u, t);
  const lethal = dmg >= t.hp;
  let score = targetPriority(t);

  if (t.kind === 'unit') {
    const def = UNIT_TYPES[t.type] || { dmg: 1, cost: 1 };
    score += t.hp * def.dmg * (strat.annihilationWeight || 0);
    score += def.cost * 3;
    if (t.hp <= 2) score += 10;
    if (t.type === 'artillery' || t.type === 'atgun') score += 8;

    const pressure = aiEnemyOutpostPressure(u.owner, t);
    if (pressure > 0) {
      const ranged = t.type === 'artillery' || t.type === 'atgun';
      score +=
        pressure *
        (strat.outpostDefenseWeight || 0) *
        (ranged ? 1.4 : 0.6);
    }
  } else if (t.kind === 'outpost') {
    score += 30;
  } else if (t.kind === 'base') {
    score += 80;
  }

  if (lethal) score += 55;
  return score;
}

function pickBestTarget(u, targets) {
  let best = null;
  let bestScore = -Infinity;

  for (const t of targets) {
    const score = aiTargetScore(u, t);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  return best;
}

function nearestObjectiveDist(owner, x, y) {
  const objectives = [];
  const base = state.bases.find((b) => b.owner !== owner && b.hp > 0);
  if (base) objectives.push(base);
  for (const o of state.outposts) {
    if (o.owner !== owner && o.hp > 0) objectives.push(o);
  }

  // 棋力训练没有基地/哨站：把最近的敌方单位当作推进目标
  if (!objectives.length) {
    let unitDist = Infinity;
    for (const u of state.units) {
      if (u.owner === owner || u.hp <= 0) continue;
      unitDist = Math.min(unitDist, cheb(x - u.x, y - u.y));
    }
    return Number.isFinite(unitDist) ? unitDist : 0;
  }

  let dist = Infinity;
  for (const o of objectives) dist = Math.min(dist, cheb(x - o.x, y - o.y));
  return dist;
}

function isDefensiveGun(u) {
  return (u.type === 'artillery' || u.type === 'atgun') && !u.motorized;
}

function nearestOwnAnchorDist(owner, x, y) {
  const anchors = [];
  const base = state.bases.find((b) => b.owner === owner && b.hp > 0);
  if (base) anchors.push(base);
  for (const o of state.outposts) {
    if (o.owner === owner && o.hp > 0) anchors.push(o);
  }
  if (!anchors.length) return 0;

  let dist = Infinity;
  for (const a of anchors) dist = Math.min(dist, cheb(x - a.x, y - a.y));
  return dist;
}

function aiSafetyScore(u, x, y, defeated) {
  ensureAiThreat(u.owner);
  if (!aiThreat) return 0;

  const strat = aiStrategyFor(u.owner);
  const key = cellKey(x, y);
  const fragile = u.maxHp <= 2 ? 1.45 : 1.0;
  const defensiveGun = isDefensiveGun(u);
  const l1Role = defensiveGun ? 1.25 : 1.0;
  const l2Role = defensiveGun ? 2.4 : 1.0;
  let score = 0;

  // 同一格被很多单位覆盖时取递减收益，避免“人墙”让所有位置都不可用
  const aggregateThreat = (weights) => {
    weights.sort((a, b) => b - a);
    const factors = [1, 0.6, 0.3, 0.15];
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += weights[i] * (factors[i] != null ? factors[i] : 0.08);
    }
    return sum;
  };

  const l1 = aiThreat.l1.get(key);
  if (l1) {
    if (l1.base) {
      const enemyBase = state.bases.find((b) => b.owner !== u.owner && b.hp > 0);
      if (enemyBase && !defeated.has(enemyBase)) score -= strat.baseThreat;
    }

    for (const o of l1.outposts.values()) {
      if (o.hp > 0 && !defeated.has(o)) score -= strat.outpostThreat * fragile;
    }

    const weights = [];
    for (const e of l1.units.values()) {
      if (e.hp <= 0 || defeated.has(e)) continue;
      weights.push(threatWeightFor(u, e));
    }
    score -= aggregateThreat(weights) * strat.level1Weight * fragile * l1Role;
  }

  const l2 = aiThreat.l2.get(key);
  if (l2) {
    const weights = [];
    for (const e of l2.units.values()) {
      if (e.hp <= 0 || defeated.has(e)) continue;
      weights.push(threatWeightFor(u, e));
    }
    score -= aggregateThreat(weights) * strat.level2Weight * fragile * l2Role;
  }

  if (aiControl && aiControl.enemy) {
    const controlPoints = aiControl.enemy.total.get(key) || 0;
    if (controlPoints > 0) {
      const phase = aiPhaseWeights(aiControl.phase);
      score -=
        controlPoints *
        (strat.enemyControlWeight || 0) *
        fragile *
        phase.risk;
    }
  }

  return score;
}

// 敌方火炮潜在覆盖到的格子（用于判断己方是否会被溅射）
function aiEnemySplashCells(owner) {
  if (!aiThreat || aiThreat.owner !== owner) return new Set();
  if (aiThreat.enemySplashCells) return aiThreat.enemySplashCells;

  const cells = new Set();
  for (const e of state.units) {
    if (e.owner === owner || e.hp <= 0 || e.type !== 'artillery') continue;
    for (const key of potentialAttackCellsForUnit(e)) cells.add(key);
  }

  aiThreat.enemySplashCells = cells;
  return cells;
}

// 己方火炮的站位是否能溅射到更多非坦克单位（只在不会被打死的位置才加分）
function aiSplashOpportunityScore(u, x, y, incoming) {
  if (u.type !== 'artillery') return 0;
  if (!incoming || incoming.total >= u.hp) return 0;

  const cells = potentialAttackCellsForUnit(u, x, y);
  let best = 0;

  for (const e of state.units) {
    if (e.owner === u.owner || e.hp <= 0) continue;
    if (!cells.has(cellKey(e.x, e.y))) continue;

    let extra = 0;
    for (const o of PAT.orth) {
      const p = pieceAt(e.x + o.dx, e.y + o.dy);
      if (p && p.kind === 'unit' && p.owner !== u.owner && p.type !== 'tank') extra++;
    }
    if (extra > 0) {
      best = Math.max(best, extra * 12 + targetPriority(e) * 0.08);
    }
  }

  return best;
}

// 站在友军旁边时，敌方火炮可以借溅射同时命中多个目标
function aiSplashRiskPenalty(u, x, y) {
  if (u.type === 'tank') return 0;

  const splashCells = aiEnemySplashCells(u.owner);
  if (!splashCells.size) return 0;

  const hereCovered = splashCells.has(cellKey(x, y));
  let risk = 0;

  for (const o of PAT.orth) {
    const nx = x + o.dx;
    const ny = y + o.dy;
    if (!inBoard(nx, ny)) continue;

    const p = pieceAt(nx, ny);
    if (!p || p.kind !== 'unit' || p.owner !== u.owner || p.type === 'tank') continue;
    if (p.id === u.id) continue;
    if (hereCovered || splashCells.has(cellKey(nx, ny))) risk++;
  }

  return -risk * 5;
}

// 射程压制：能打到对方，而对方当前射程打不到这里
function aiRangeAdvantageScore(u, x, y) {
  const cells = potentialAttackCellsForUnit(u, x, y);
  let score = 0;

  for (const e of state.units) {
    if (e.owner === u.owner || e.hp <= 0) continue;
    if (!cells.has(cellKey(e.x, e.y))) continue;

    let hitsBack = false;
    for (const c of cellsFromMask(e.x, e.y, attackMaskFor(e))) {
      if (c.x === x && c.y === y) {
        hitsBack = true;
        break;
      }
    }
    if (!hitsBack) score += 3 + targetPriority(e) * 0.04;
  }

  return Math.min(score, 36);
}

// 低价单位卡位：贴身缠住高价值敌人，或占据它下一回合想走的格子
function aiBlockingScore(u, x, y) {
  const value = unitDef(u).cost + (u.motorized ? 1 : 0);
  if (value > 2) return 0;

  let score = 0;

  for (const e of state.units) {
    if (e.owner === u.owner || e.hp <= 0) continue;
    const enemyValue = unitDef(e).cost + (e.motorized ? 1 : 0);
    if (enemyValue < 2) continue;

    if (cheb(e.x - x, e.y - y) <= 1) {
      score += 3 + enemyValue;
      continue;
    }

    for (const c of cellsFromMask(e.x, e.y, moveMaskFor(e))) {
      if (c.x === x && c.y === y) {
        score += 2;
        break;
      }
    }
  }

  return Math.min(score, 24);
}

// 必死局面下的牺牲价值：更低价的单位让敌人打出更多溢出伤害
function aiSurvivalEfficiencyScore(u, x, y, incoming) {
  if (!incoming || incoming.total < u.hp) return 0;

  const value = unitDef(u).cost + (u.motorized ? 1 : 0);
  if (value > 1 || incoming.max <= u.hp) return 0;

  return Math.min(6, (incoming.max - u.hp) * 3);
}

function aiPositioningScore(u, x, y, incoming) {
  const strat = aiStrategyFor(u.owner);
  const weight = strat.positioningWeight != null ? strat.positioningWeight : 1;
  if (weight <= 0) return 0;

  return (
    weight *
    (aiSplashOpportunityScore(u, x, y, incoming) *
      (strat.splashGainPositionWeight != null ? strat.splashGainPositionWeight : 1) +
      aiSplashRiskPenalty(u, x, y) *
        (strat.splashRiskPositionWeight != null ? strat.splashRiskPositionWeight : 1) +
      aiRangeAdvantageScore(u, x, y) *
        (strat.rangePositionWeight != null ? strat.rangePositionWeight : 1) +
      aiBlockingScore(u, x, y) *
        (strat.blockPositionWeight != null ? strat.blockPositionWeight : 1) +
      aiSurvivalEfficiencyScore(u, x, y, incoming) *
        (strat.spongePositionWeight != null ? strat.spongePositionWeight : 1))
  );
}

// 下一回合所有能打到该格的敌方单位造成的总伤害（用于判断落点是否会被击杀）
function aiIncomingThreat(u, x, y, defeated) {
  if (!aiThreat || aiThreat.owner !== u.owner) return { total: 0, max: 0 };

  const key = cellKey(x, y);
  const seen = new Set();
  let total = 0;
  let max = 0;

  for (const map of [aiThreat.l1, aiThreat.l2]) {
    const entry = map.get(key);
    if (!entry) continue;
    for (const e of entry.units.values()) {
      if (e.hp <= 0 || defeated.has(e) || seen.has(e)) continue;
      seen.add(e);
      const dmg = damageAgainst(e, u);
      total += dmg;
      if (dmg > max) max = dmg;
    }
  }

  return { total, max };
}

// 敌方单位中，正在威胁己方高价值单位（坦克/火炮/反坦克炮）的那些
function aiHighValueThreats(owner) {
  if (!aiThreat || aiThreat.owner !== owner) return [];
  if (aiThreat.hvThreats) return aiThreat.hvThreats;

  const threats = new Map();
  for (const f of state.units) {
    if (f.owner !== owner || f.hp <= 0) continue;
    if (f.type !== 'tank' && f.type !== 'artillery' && f.type !== 'atgun') continue;

    const key = cellKey(f.x, f.y);
    for (const map of [aiThreat.l1, aiThreat.l2]) {
      const entry = map.get(key);
      if (!entry) continue;
      for (const e of entry.units.values()) {
        if (e.hp <= 0) continue;
        let rec = threats.get(e.id);
        if (!rec) {
          rec = { enemy: e, friends: new Set() };
          threats.set(e.id, rec);
        }
        rec.friends.add(f.id);
      }
    }
  }

  aiThreat.hvThreats = [...threats.values()];
  return aiThreat.hvThreats;
}

// 掩护高价值单位：去能反击威胁者/贴身缠住威胁者的位置
function aiScreenHighValueScore(u, x, y) {
  const threats = aiHighValueThreats(u.owner);
  if (!threats.length) return 0;

  const cells = potentialAttackCellsForUnit(u, x, y);
  let score = 0;

  for (const rec of threats) {
    const e = rec.enemy;
    if (e.hp <= 0) continue;
    if (cells.has(cellKey(e.x, e.y))) {
      score += 12 + rec.friends.size * 4;
      if (damageAgainst(u, e) >= e.hp) score += 8;
    }
    if (cheb(e.x - x, e.y - y) <= 1) score += 4;
  }

  return score;
}

// 空白控制区：敌方当前/潜在火力都覆盖不到，向前占领它
function aiClaimScore(u, x, y) {
  if (!aiControl || aiControl.owner !== u.owner) return 0;
  const strat = aiStrategyFor(u.owner);

  const key = cellKey(x, y);
  const enemyControl =
    (aiControl.enemy.current.get(key) || 0) +
    (aiControl.enemy.potential.get(key) || 0);
  if (enemyControl > 0) return 0;

  const dist = nearestObjectiveDist(u.owner, x, y);
  if (dist > 8) return 0;

  const ownControl =
    (aiControl.own.current.get(key) || 0) +
    (aiControl.own.potential.get(key) || 0);
  const forward = 1 + Math.max(0, 6 - dist) * 0.15;
  const blank = ownControl <= 0 ? 1.25 : 1;

  return forward * blank * (strat.claimWeight || 0);
}

function countSplashVictims(target, owner) {
  let count = 0;
  for (const o of PAT.orth) {
    const p = pieceAt(target.x + o.dx, target.y + o.dy);
    if (p && p.kind === 'unit' && p.owner !== owner && p.type !== 'tank') count++;
  }
  return count;
}

function aiScorePlan(u, plan) {
  const strat = aiStrategyFor(u.owner);
  let score = 0;
  const defeated = new Set();
  let wins = false;

  if (plan.attack) {
    const t = plan.attack;
    score += aiTargetScore(u, t);

    const dmg = damageAgainst(u, t);
    if (dmg >= t.hp) {
      defeated.add(t);
      if (t.kind === 'base') wins = true;
    }
    if (u.type === 'artillery') {
      score += countSplashVictims(t, u.owner) * 18;
    }
    score += 12;
  }

  if (wins) return 100000;

  const phase = aiPhaseWeights(aiControl ? aiControl.phase : 'even');
  if (plan.attack) score += (phase.attack - 1) * 40;

  const end = plan.move ? plan.move : { x: u.x, y: u.y };
  const localBalance = aiLocalPowerBalance(u.owner, end.x, end.y);
  const endDist = nearestObjectiveDist(u.owner, end.x, end.y);
  const curDist = nearestObjectiveDist(u.owner, u.x, u.y);
  score += aiSafetyScore(u, end.x, end.y, defeated) * phase.risk;
  score += aiPressureScore(u, end.x, end.y);
  score += aiSpacingScore(u, end.x, end.y);
  score += aiControlBalanceScore(u, end.x, end.y);
  score += aiOutpostDefenseScore(u.owner, end.x, end.y);
  score += aiCounterBatteryScore(u, end.x, end.y);
  score += aiScreenHighValueScore(u, end.x, end.y) * (strat.screenWeight != null ? strat.screenWeight : 1);

  // 优先去下一回合不会被击杀的格子
  const incoming = aiIncomingThreat(u, end.x, end.y, defeated);
  score += aiPositioningScore(u, end.x, end.y, incoming);
  const survivalWeight = strat.survivalWeight != null ? strat.survivalWeight : 1;
  if (incoming.total >= u.hp) {
    score -= (40 + (incoming.total - u.hp) * 4) * survivalWeight;
  } else if (incoming.total > 0) {
    score -= incoming.total * 1.5 * survivalWeight;
  }

  // 局部火力占优且向前推进时才加分；原地不动不享受“优势”奖励
  if (plan.move && endDist < curDist) {
    if (localBalance > 0) {
      score += localBalance * (strat.localPushWeight || 0);
      score += aiStagingScore(u.owner, end.x, end.y) * 0.8;
    }
    // 有空白控制区时优先占领，而不是在争夺区硬碰
    if (!isDefensiveGun(u)) {
      score += aiClaimScore(u, end.x, end.y);
    }
  }

  if (isDefensiveGun(u)) {
    // 非摩托化炮类通常留在己方基地/哨站附近；局部火力占优时允许前压攒兵
    const forward = localBalance > 0.05;
    const anchorDist = nearestOwnAnchorDist(u.owner, end.x, end.y);
    score -= Math.max(0, anchorDist - 4) * 10 * (forward ? 0.35 : 1);
    score += Math.max(0, 4 - anchorDist) * 1.5 * (forward ? 0.4 : 1);
    if (aiThreat && aiThreat.l2.has(cellKey(end.x, end.y))) {
      score -= forward ? 35 : 80;
    }

    // 防守应围绕哨站和前线，而不是缩在基地：越靠前/越受威胁的哨站吸引力越大
    let anchorBonus = 0;
    for (const o of state.outposts) {
      if (o.owner !== u.owner || o.hp <= 0) continue;
      const d = cheb(end.x - o.x, end.y - o.y);
      if (d > 6) continue;
      const forward = Math.max(0, 12 - nearestObjectiveDist(u.owner, o.x, o.y));
      const threat = aiOutpostThreatCount(u.owner, o) * 3;
      anchorBonus = Math.max(
        anchorBonus,
        Math.max(0, 6 - d) * 2.5 + forward * 0.6 + threat
      );
    }
    if (anchorBonus > 0) score += anchorBonus;
    score -= Math.max(0, 4 - nearestOwnBaseDist(u.owner, end.x, end.y)) * 1.2;
  } else {
    // 局部优势时前压成本更低，避免均势/防守阶段一味龟缩
    const pushDiscount = localBalance > 0 ? 1 - Math.min(0.5, localBalance * 0.5) : 1;
    score -= endDist * strat.advanceWeight * phase.advance * pushDiscount;
  }

  return score;
}

function aiMoveThenFireOptions(u) {
  if (u.moved || u.attacked) return [];

  const out = [];
  for (const cell of getMoveCells(u)) {
    if (!canAttackAfterMove(u, cell)) continue;
    const targets = unitAttackTargetsAt(u, cell.x, cell.y);
    if (targets.length) out.push({ cell, targets });
  }
  return out;
}

// 行动顺序：先让“错过本回合就没机会”的单位开火
function aiFirePriority(u) {
  const targetsNow = getUnitAttackTargets(u);
  const moveFire = aiMoveThenFireOptions(u);
  if (!targetsNow.length && !moveFire.length) return 0;

  let priority = 20;

  if (targetsNow.length) {
    // 非摩托炮不能移动后开火，当前射击机会最宝贵
    if (isDefensiveGun(u)) priority += 55;
    // 只有一个目标：先打，避免目标被友军抢杀后浪费攻击
    if (targetsNow.length === 1) priority += 35;
    priority += 10;
  } else {
    // 本来打不到、走一步才能开火；若只有唯一解，更容易被友军占位破坏
    priority += 45;
    if (moveFire.length === 1) priority += 15;
    const ids = new Set();
    for (const option of moveFire) {
      for (const t of option.targets) ids.add(t.id);
    }
    if (ids.size === 1) priority += 15;
  }

  return priority;
}

function aiOrderUnits(owner, units) {
  return units
    .map((u, index) => ({ u, index, priority: aiFirePriority(u) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map((entry) => entry.u);
}

function aiPlanUnit(u) {
  ensureAiThreat(u.owner);

  const plans = [{ order: 'hold', attack: null, move: null }];

  const targetsNow = getUnitAttackTargets(u);
  if (targetsNow.length) {
    const best = pickBestTarget(u, targetsNow);
    plans.push({ order: 'attack', attack: best, move: null });

    if (!u.moved && (u.type === 'tank' || u.type === 'infantry')) {
      const afterMoves = getMoveCells(u, { attacked: true });
      for (const cell of afterMoves) {
        plans.push({ order: 'attack-then-move', attack: best, move: cell });
      }
    }
  }

  const moves = getMoveCells(u);
  for (const cell of moves) {
    if (!u.attacked && canAttackAfterMove(u, cell)) {
      const targets = unitAttackTargetsAt(u, cell.x, cell.y);
      if (targets.length) {
        plans.push({
          order: 'move-then-attack',
          move: cell,
          attack: pickBestTarget(u, targets),
        });
        continue;
      }
    }
    plans.push({ order: 'move', move: cell, attack: null });
  }

  if (!plans.length) return null;

  let bestPlan = null;
  let bestScore = -Infinity;

  for (const p of plans) {
    const score = aiScorePlan(u, p) + aiRand() * 0.001;
    if (score > bestScore) {
      bestScore = score;
      bestPlan = p;
    }
  }

  if (bestPlan) {
    const end = bestPlan.move || { x: u.x, y: u.y };
    aiLastDecision = {
      owner: u.owner,
      unit: unitDef(u).name,
      action: bestPlan.order,
      target: bestPlan.attack ? pieceLabel(bestPlan.attack) : '—',
      at: `(${end.x},${end.y})`,
      score: Math.round(bestScore),
      phase: aiControl ? aiControl.phase : '—',
      powerRatio: aiControl ? Number(aiControl.powerRatio.toFixed(2)) : null,
    };
  }

  return bestPlan;
}

async function aiExecutePlan(u, plan, token) {
  if (!aiOk(token) || !state.units.includes(u)) return;
  if (plan.order === 'hold') return;

  const canMoveTo = (cell) =>
    cell && getMoveCells(u).some((c) => c.x === cell.x && c.y === cell.y);

  if (plan.order === 'attack-then-move') {
    if (plan.attack && getUnitAttackTargets(u).includes(plan.attack)) {
      unitAttack(u, plan.attack);
      updateUI();
      await sleep(180);
    }
    if (!aiOk(token) || !state.units.includes(u) || !plan.move) return;
    if (canMoveTo(plan.move)) {
      moveUnit(u, plan.move.x, plan.move.y);
      updateUI();
      await sleep(140);
    }
    return;
  }

  if (plan.order === 'move-then-attack') {
    if (canMoveTo(plan.move)) {
      moveUnit(u, plan.move.x, plan.move.y);
      updateUI();
      await sleep(140);
    }
    if (!aiOk(token) || !state.units.includes(u) || !plan.attack) return;
    if (getUnitAttackTargets(u).includes(plan.attack)) {
      unitAttack(u, plan.attack);
      updateUI();
      await sleep(180);
    }
    return;
  }

  if (plan.order === 'attack') {
    if (plan.attack && getUnitAttackTargets(u).includes(plan.attack)) {
      unitAttack(u, plan.attack);
      updateUI();
      await sleep(180);
    }
    return;
  }

  if (plan.order === 'move') {
    if (canMoveTo(plan.move)) {
      moveUnit(u, plan.move.x, plan.move.y);
      updateUI();
      await sleep(140);
    }
    return;
  }
}

/* ============================================================
   调试模式 / 自对弈训练
   ============================================================ */

function setTrainStatus(text) {
  if (dom.debugTrainStatus) dom.debugTrainStatus.textContent = text;
}

function openDebug() {
  if (!dom.debugOverlay || observerMatchInProgress) return;
  show(dom.debugOverlay);
  updateDebugUI();
}

function closeDebug() {
  if (trainingInProgress) return;
  hide(dom.debugOverlay);
}

function renderPlayerLearningStats() {
  if (!dom.playerLearnStats) return;

  const pl = aiMemory.playerLearning || createEmptyPlayerLearning();
  const avgGlobal = pl.games > 0 ? pl.globalScoreSum / pl.games : null;
  const avgLocal = pl.localSamples > 0 ? pl.localScoreSum / pl.localSamples : null;
  const kinds = pl.deployKinds || {};
  const share = (kind) =>
    pl.deployValue > 0 ? ((kinds[kind] || 0) / pl.deployValue) * 100 : 0;
  const tankShare = share('tank');
  const rangedShare =
    share('artillery') +
    share('artillery_moto') +
    share('atgun') +
    share('atgun_moto');
  const infantryShare = share('infantry') + share('infantry_moto');
  const aggression = pl.moves > 0 ? (pl.forwardMoves / pl.moves) * 100 : null;
  const safety = pl.moves > 0 ? (pl.safeMoves / pl.moves) * 100 : null;
  const unitFocus = pl.attacks > 0 ? (pl.unitAttacks / pl.attacks) * 100 : null;
  const lastDate = pl.lastAt ? new Date(pl.lastAt) : null;
  const lastText =
    lastDate && !Number.isNaN(lastDate.getTime())
      ? lastDate.toLocaleString('zh-CN')
      : '尚未学习';
  const fmt = (value) => (value === null ? '—' : `${value.toFixed(1)}%`);
  const applied = pl.lastApplied;

  const style = [];
  if (aggression !== null) {
    style.push(aggression > 65 ? '进攻型' : aggression < 35 ? '防守型' : '均衡推进');
  }
  if (unitFocus !== null) {
    style.push(unitFocus > 70 ? '歼灭优先' : unitFocus < 40 ? '拆建筑优先' : '目标均衡');
  }
  if (pl.deployValue > 0) {
    if (tankShare > 40) style.push('装甲为主');
    if (rangedShare > 50) style.push('远程火力为主');
    if (infantryShare > 50) style.push('步兵为主');
  }
  if (safety !== null) {
    style.push(safety > 70 ? '谨慎走位' : safety < 40 ? '冒险走位' : '走位均衡');
  }

  dom.playerLearnStats.innerHTML = `
    <div>已观察对局：<b>${pl.games}</b> 局（胜 ${pl.wins} / 负 ${pl.losses}）</div>
    <div>已采用学习：<b>${pl.learnedGames}</b> 局</div>
    <div>全局平均表现：<b>${avgGlobal === null ? '—' : avgGlobal.toFixed(2)}</b></div>
    <div>局部样本 / 平均局部表现：<b>${pl.localSamples}</b> / <b>${
      avgLocal === null ? '—' : avgLocal.toFixed(2)
    }</b></div>
    <div>玩家画像：坦克 <b>${fmt(tankShare)}</b> · 远程 <b>${fmt(rangedShare)}</b> · 步兵 <b>${fmt(infantryShare)}</b></div>
    <div>进攻性 / 安全走位 / 单位目标：<b>${fmt(aggression)}</b> / <b>${fmt(safety)}</b> / <b>${fmt(unitFocus)}</b></div>
    <div>玩家风格：<b>${style.length ? style.join(' · ') : '样本不足'}</b></div>
    <div>上次学习：<b>${lastText}</b>${
      applied
        ? `（全局 ${applied.globalPerf} / 局部 ${applied.localQuality} / lr ${applied.lr}）`
        : ''
    }</div>
  `;
}

function clearPlayerLearning() {
  if (trainingInProgress || observerMatchInProgress) return;
  if (!window.confirm('清空玩家操作学习数据？（已学到的策略权重不会回滚）')) return;

  aiMemory.playerLearning = createEmptyPlayerLearning();
  playerLearningSession = null;
  saveAiMemory();
  updateDebugUI();
}

function renderChessStats() {
  if (!dom.debugChessStats) return;

  const chess = aiMemory.chess || createEmptyChessStats();
  const avgScore = chess.games > 0 ? chess.scoreSum / chess.games : null;
  const lastDate = chess.lastAt ? new Date(chess.lastAt) : null;
  const lastText =
    lastDate && !Number.isNaN(lastDate.getTime())
      ? lastDate.toLocaleString('zh-CN')
      : '尚未运行';

  let html = `
    <div class="chess-summary">
      棋力运行 <b>${chess.runs}</b> 次 · 样本对局 <b>${chess.games}</b> 局 ·
      先手平均保留战力 <b>${avgScore === null ? '—' : `${avgScore.toFixed(1)}%`}</b>
      · 上次：${lastText}
    </div>
  `;
  html += '<div class="chess-tables">';

  for (const kind of CHESS_PIECE_KINDS) {
    const buckets = (chess.kinds && chess.kinds[kind.key]) || {};
    const xs = Object.keys(buckets)
      .map(Number)
      .filter((x) => Number.isFinite(x) && buckets[String(x)] && buckets[String(x)].count > 0);
    const maxX = xs.length ? Math.min(Math.max(...xs), 60) : -1;

    html += `<div class="chess-table"><h4>${kind.name}</h4>`;

    if (maxX < 0) {
      html += '<div class="chess-empty">暂无样本</div>';
    } else {
      html +=
        '<table><thead><tr><th>火力</th><th>次数</th><th>输出/价值</th><th>存活×HP/价值</th></tr></thead><tbody>';

      let totalCount = 0;
      let totalValue = 0;
      let totalOutput = 0;
      let totalSurvivalHp = 0;
      for (const x of xs) {
        const b = buckets[String(x)];
        if (!b || !b.count) continue;
        totalCount += b.count;
        totalValue += b.value;
        totalOutput += b.output;
        totalSurvivalHp += b.survivalHp;
      }
      const avgOutput = totalValue > 0 ? totalOutput / totalValue : 0;
      const avgSurvival = totalValue > 0 ? totalSurvivalHp / totalValue : 0;
      html +=
        `<tr class="chess-avg" title="全部火力区间的合计">` +
        `<td>平均</td><td>${totalCount}</td>` +
        `<td>${avgOutput.toFixed(3)}</td><td>${avgSurvival.toFixed(3)}</td></tr>`;

      for (let x = 0; x <= maxX; x++) {
        const b = buckets[String(x)];
        if (!b || !b.count) {
          html += `<tr><td>${x}</td><td colspan="3" class="chess-empty-cell">—</td></tr>`;
          continue;
        }
        const m1 = b.value > 0 ? b.output / b.value : 0;
        const m2 = b.value > 0 ? b.survivalHp / b.value : 0;
        html +=
          `<tr title="总输出 ${b.output.toFixed(0)} · 总价值 ${b.value} · 总存活×HP ${b.survivalHp.toFixed(0)}">` +
          `<td>${x}</td><td>${b.count}</td><td>${m1.toFixed(3)}</td><td>${m2.toFixed(3)}</td></tr>`;
      }
      html += '</tbody></table>';
    }

    html += '</div>';
  }

  html += '</div>';
  dom.debugChessStats.innerHTML = html;
}

function updateDebugUI() {
  if (!dom.debugEnabledToggle) return;

  const d = aiMemory.debug;
  const t = aiMemory.training;
  const locked = trainingInProgress || observerMatchInProgress;

  dom.debugEnabledToggle.checked = d.enabled;
  dom.debugEnemyControlToggle.checked = d.showEnemyControl;
  dom.debugOwnControlToggle.checked = d.showOwnControl;
  dom.debugObserverToggle.checked = d.observer;
  if (dom.debugLearnPlayerToggle) dom.debugLearnPlayerToggle.checked = !!d.learnFromPlayer;

  dom.debugEnabledToggle.disabled = locked;
  dom.debugEnemyControlToggle.disabled = locked || !d.enabled;
  dom.debugOwnControlToggle.disabled = locked || !d.enabled;
  dom.debugObserverToggle.disabled = locked || !d.enabled;
  if (dom.debugLearnPlayerToggle) dom.debugLearnPlayerToggle.disabled = locked;
  dom.debugTrainBtn.disabled = locked || !d.enabled || !state || state.aiThinking;
  dom.debugResetBtn.disabled = locked;
  dom.debugClearBtn.disabled = locked;
  dom.debugExportBtn.disabled = locked;
  dom.debugImportBtn.disabled = locked;
  dom.debugCloseBtn.disabled = locked;
  dom.debugTrainBtn.textContent = trainingInProgress
    ? '训练中…'
    : observerMatchInProgress
    ? '观战中…'
    : d.observer
    ? '播放 AI 对战'
    : '开始训练';

  if (dom.chessTrainBtn) {
    dom.chessTrainBtn.disabled = locked || !d.enabled || !state || state.aiThinking;
    dom.chessTrainBtn.textContent = chessTrainingInProgress
      ? '棋力训练中…'
      : '开始棋力训练';
    dom.chessClearBtn.disabled = locked;
    renderChessStats();
  }

  renderPlayerLearningStats();

  const last = t.lastTrainedAt
    ? new Date(t.lastTrainedAt).toLocaleString('zh-CN')
    : '尚未训练';
  const fitness = Number.isFinite(t.bestFitness) ? Number(t.bestFitness).toFixed(2) : '0.00';
  const econKilled = Number(t.econKilled) || 0;
  const econLost = Number(t.econLost) || 0;
  const econRatio =
    econLost > 0 ? (econKilled / econLost).toFixed(2) : econKilled > 0 ? '∞' : '—';

  dom.debugStats.innerHTML = `
    <div>调试模式：<b>${d.enabled ? '已启用' : '已关闭'}</b></div>
    <div>策略评估：<b>${t.evaluations}</b> 组</div>
    <div>训练对局：<b>${t.games}</b> 局</div>
    <div>胜 / 负 / 平：<b>${t.wins} / ${t.losses} / ${t.draws}</b></div>
    <div>经济交换比（候选）：<b>${econRatio}</b>（${econKilled}/${econLost}）</div>
    <div>最近提升适应度：<b>${fitness}</b></div>
    <div>上次训练：<b>${last}</b></div>
  `;

  dom.debugStrategyJson.textContent = JSON.stringify(aiMemory.strategy, null, 2);

  if (aiLastDecision) {
    const x = aiLastDecision;
    dom.debugDecision.textContent =
      `${PLAYER_NAMES[x.owner]} ${x.unit} · ${x.action} · 目标 ${x.target} · 落点 ${x.at}` +
      ` · 阶段 ${phaseLabel(x.phase)}` +
      `${x.powerRatio != null ? ` · 战力比 ${x.powerRatio}` : ''}` +
      ` · 评分 ${x.score}`;
  } else {
    dom.debugDecision.textContent = '暂无';
  }

  if (!locked && !dom.debugTrainStatus.textContent) {
    dom.debugTrainStatus.textContent = !d.enabled
      ? '调试已关闭，策略数据仍然保留。'
      : d.observer
      ? '观察者模式：点击“播放 AI 对战”观看 1 局演示，不写入训练统计。'
      : '训练会进行快速自对弈，并把最优策略保存到本地 memory。';
  }
}

function resetAiStrategy() {
  if (trainingInProgress || observerMatchInProgress) return;
  if (!window.confirm('重置为默认 AI 策略并清空训练统计？')) return;

  const debug = cloneJson(aiMemory.debug);
  const reset = cloneJson(DEFAULT_AI_MEMORY);
  reset.debug = debug;
  aiMemory = reset;
  saveAiMemory();

  aiThreatDirty = true;
  potentialCache.clear();
  debugThreatCache = null;
  updateDebugUI();
  setTrainStatus('已重置为默认策略。');
  updateUI();
}

function clearAiStrategy() {
  if (trainingInProgress || observerMatchInProgress) return;
  if (!window.confirm('清空训练策略和统计数据，恢复为基础策略？调试模式设置会保留。')) return;

  const debug = cloneJson(aiMemory.debug);
  try {
    localStorage.removeItem(AI_MEMORY_KEY);
  } catch (err) {
    // ignore
  }

  aiMemory = {
    version: 1,
    debug,
    strategy: cloneJson(BASE_AI_STRATEGY),
    training: cloneJson(EMPTY_AI_TRAINING),
    history: [],
    chess: createEmptyChessStats(),
    playerLearning: createEmptyPlayerLearning(),
  };
  saveAiMemory();

  aiThreatDirty = true;
  potentialCache.clear();
  debugThreatCache = null;
  updateDebugUI();
  setTrainStatus('已清空策略与训练数据，恢复基础策略。');
  updateUI();
}

function exportAiMemory() {
  if (trainingInProgress || observerMatchInProgress) return;
  const payload = {
    app: 'paper-tanks',
    version: 1,
    exportedAt: new Date().toISOString(),
    memory: aiMemory,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'paper-tanks-ai-memory.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importAiMemoryFile(ev) {
  if (trainingInProgress || observerMatchInProgress) return;
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    aiMemory = normalizeAiMemory(parsed.memory || parsed);
    saveAiMemory();
    aiThreatDirty = true;
    potentialCache.clear();
    debugThreatCache = null;
    updateDebugUI();
    setTrainStatus('策略已导入。');
    updateUI();
  } catch (err) {
    setTrainStatus(`导入失败：${err.message}`);
  }
}

/* ---------------- 快速自对弈 ---------------- */

function createSimulationState() {
  const bases = BASE_START.map((p, owner) => ({
    id: `sim-base-${owner}`,
    kind: 'base',
    owner,
    x: p.x,
    y: p.y,
    hp: 16,
    maxHp: 16,
    attacked: false,
  }));

  const outposts = [];
  OUTPOST_START.forEach((list, owner) => {
    list.forEach((p, idx) => {
      outposts.push({
        id: `sim-op-${owner}-${idx}`,
        kind: 'outpost',
        owner,
        x: p.x,
        y: p.y,
        hp: 8,
        maxHp: 8,
        attacked: false,
        deployUsed: false,
      });
    });
  });

  return {
    mode: 'sim',
    difficulty: 'normal',
    current: RED,
    round: 1,
    points: [6, 6],
    economy: { killed: [0, 0], lost: [0, 0] },
    units: [],
    bases,
    outposts,
    selected: null,
    buildMode: null,
    gameOver: false,
    winner: null,
    aiThinking: false,
    log: [],
  };
}

function simAdvanceTurn() {
  if (!state || state.gameOver) return;

  const next = state.current === RED ? BLUE : RED;
  if (next === RED) state.round++;
  state.current = next;
  state.points[next] = 6;

  for (const u of state.units) {
    if (u.owner !== next) continue;
    u.moved = false;
    u.attacked = false;
    u.moveFrom = null;
    u.moveAdjacent = false;
  }
  for (const s of allStructures()) {
    if (s.owner !== next) continue;
    s.attacked = false;
    s.deployUsed = false;
  }
}

function aiExecutePlanSync(u, plan) {
  if (!state.units.includes(u)) return;
  if (plan.order === 'hold') return;

  const canMoveTo = (cell) =>
    cell && getMoveCells(u).some((c) => c.x === cell.x && c.y === cell.y);

  if (plan.order === 'attack-then-move') {
    if (plan.attack && getUnitAttackTargets(u).includes(plan.attack)) {
      unitAttack(u, plan.attack);
    }
    if (state.gameOver || !state.units.includes(u) || !plan.move) return;
    if (canMoveTo(plan.move)) moveUnit(u, plan.move.x, plan.move.y);
    return;
  }

  if (plan.order === 'move-then-attack') {
    if (canMoveTo(plan.move)) moveUnit(u, plan.move.x, plan.move.y);
    if (state.gameOver || !state.units.includes(u) || !plan.attack) return;
    if (getUnitAttackTargets(u).includes(plan.attack)) unitAttack(u, plan.attack);
    return;
  }

  if (plan.order === 'attack') {
    if (plan.attack && getUnitAttackTargets(u).includes(plan.attack)) {
      unitAttack(u, plan.attack);
    }
    return;
  }

  if (plan.order === 'move') {
    if (canMoveTo(plan.move)) moveUnit(u, plan.move.x, plan.move.y);
  }
}

function aiSpendRemainingFast(owner) {
  let guard = 0;

  while (guard++ < 6 && state.points[owner] > 0) {
    const baseCells = getSpawnCells(owner);
    let cell = null;
    let choice = null;

    if (baseCells.length) {
      const spawn = aiChooseSpawnCell(owner, baseCells);
      choice = aiBestUnitForBudget(owner, state.points[owner], spawn, true);
      if (choice) cell = { ...spawn, source: 'base' };
    }

    if (!choice) {
      const outpostCells = getDeploymentCells(owner, false).filter((c) => c.source === 'outpost');
      if (!outpostCells.length) break;
      const spawn = aiChooseSpawnCell(owner, outpostCells);
      choice = aiBestUnitForBudget(owner, state.points[owner], spawn, false, false);
      if (!choice) break;
      cell = spawn;
    }

    spawnUnit(owner, choice.type, cell.x, cell.y, choice.motorized && cell.source === 'base');
    state.points[owner] -= choice.cost;
    if (cell.source === 'outpost') cell.outpost.deployUsed = true;
  }
}

function aiTakeTurnFast(owner) {
  if (!state || state.gameOver) return;

  state.current = owner;
  refreshAiThreat(owner);

  for (const b of aiChooseBuilds(owner)) {
    if (state.points[owner] < b.cost) continue;

    const cells = getDeploymentCells(owner, b.motorized, b.type);
    if (!cells.length) continue;

    const cell = aiChooseDeployCell(owner, cells, b);
    if (!cell) continue;

    spawnUnit(owner, b.type, cell.x, cell.y, b.motorized);
    state.points[owner] -= b.cost;
    if (cell.source === 'outpost') cell.outpost.deployUsed = true;
  }

  const structures = [state.bases[owner], ...state.outposts.filter((o) => o.owner === owner)];
  for (const s of structures) {
    if (!s || s.hp <= 0 || s.attacked) continue;
    const targets = getStructureTargets(s);
    if (!targets.length) continue;

    const target = chooseStructureTarget(s, targets);
    if (target) structureAttack(s, target);
    if (state.gameOver) return;
  }

  const units = aiOrderUnits(owner, state.units.filter((u) => u.owner === owner));
  for (const u of units) {
    if (!state.units.includes(u) || u.hp <= 0) continue;
    if (!canUnitMove(u) && !canUnitAttack(u)) continue;

    const plan = aiPlanUnit(u);
    if (plan) aiExecutePlanSync(u, plan);
    if (state.gameOver) return;
  }

  aiSpendRemainingFast(owner);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function simSideValue(owner) {
  let value = 0;
  for (const u of state.units) {
    if (u.owner === owner) value += UNIT_TYPES[u.type].cost + (u.motorized ? 1 : 0);
  }
  for (const o of state.outposts) {
    if (o.owner === owner) value += o.hp * 0.8;
  }
  return value;
}

function simulateMatch(redStrategy, blueStrategy, seed) {
  simStrategies = [cloneJson(redStrategy), cloneJson(blueStrategy)];
  aiRng = makeRng(seed);

  state = createSimulationState();
  deployInitialGarrisons();
  effects = [];
  potentialCache.clear();
  aiThreat = null;
  aiThreatDirty = true;

  const MAX_TURNS = 160;
  const MAX_UNITS = 70;
  let turns = 0;

  while (!state.gameOver && turns < MAX_TURNS && state.units.length < MAX_UNITS) {
    aiTakeTurnFast(state.current);
    if (state.gameOver) break;
    simAdvanceTurn();
    turns++;
  }

  const redBase = state.bases.find((b) => b.owner === RED);
  const blueBase = state.bases.find((b) => b.owner === BLUE);
  const redValue = simSideValue(RED);
  const blueValue = simSideValue(BLUE);

  let winner = state.gameOver ? state.winner : null;
  if (winner == null) {
    if (redBase.hp !== blueBase.hp) winner = redBase.hp > blueBase.hp ? RED : BLUE;
    else if (Math.abs(redValue - blueValue) > 0.01) winner = redValue > blueValue ? RED : BLUE;
    else winner = -1;
  }

  return {
    winner,
    redHp: redBase.hp,
    blueHp: blueBase.hp,
    redValue,
    blueValue,
    turns,
    units: state.units.length,
    gameOver: state.gameOver,
    economy: {
      killed: state.economy ? [...state.economy.killed] : [0, 0],
      lost: state.economy ? [...state.economy.lost] : [0, 0],
    },
  };
}

function matchFitness(result, candidateSide) {
  const ownHp = candidateSide === RED ? result.redHp : result.blueHp;
  const oppHp = candidateSide === RED ? result.blueHp : result.redHp;
  const ownValue = candidateSide === RED ? result.redValue : result.blueValue;
  const oppValue = candidateSide === RED ? result.blueValue : result.redValue;

  let fitness = (ownHp - oppHp) / 16;
  fitness += (ownValue - oppValue) / 40;
  if (result.winner === candidateSide) fitness += 1.5;
  else if (result.winner === 1 - candidateSide) fitness -= 1.5;
  return fitness;
}

/* ---------------- 棋力训练 ---------------- */

const CHESS_MAX_ROUNDS = 40;
const CHESS_SCENARIOS = 12;

function createChessTrainingState() {
  return {
    mode: 'sim',
    difficulty: 'normal',
    current: RED,
    round: 1,
    points: [0, 0],
    economy: { killed: [0, 0], lost: [0, 0] },
    units: [],
    bases: [],
    outposts: [],
    selected: null,
    buildMode: null,
    gameOver: false,
    winner: null,
    aiThinking: false,
    log: [],
    chessStats: { output: new Map() },
  };
}

function chessKindValue(kind) {
  return UNIT_TYPES[kind.type].cost + (kind.motorized ? 1 : 0);
}

function hasLiveUnits(owner) {
  return state.units.some((u) => u.owner === owner && u.hp > 0);
}

// 15×15，主对角线留空；红方在 x>y 一侧随机布子，蓝方中心对称；无基地/哨站
function simulateChessMatch(strategy, seed) {
  const rng = makeRng(seed);

  simStrategies = [cloneJson(strategy), cloneJson(strategy)];
  aiRng = rng;
  nextUnitId = 1;
  state = createChessTrainingState();
  effects = [];
  potentialCache.clear();
  aiThreat = null;
  aiThreatOwner = null;
  aiThreatDirty = true;
  aiControl = null;

  const kinds = CHESS_PIECE_KINDS.slice();
  const extra = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < extra; i++) {
    kinds.push(CHESS_PIECE_KINDS[Math.floor(rng() * CHESS_PIECE_KINDS.length)]);
  }

  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = y + 1; x < SIZE; x++) cells.push({ x, y });
  }

  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  };
  shuffle(kinds);
  shuffle(cells);

  const tracked = [];
  const count = Math.min(kinds.length, cells.length);

  for (let i = 0; i < count; i++) {
    const kind = kinds[i];
    const cell = cells[i];
    const red = spawnUnit(RED, kind.type, cell.x, cell.y, kind.motorized);
    const blue = spawnUnit(
      BLUE,
      kind.type,
      SIZE - 1 - cell.x,
      SIZE - 1 - cell.y,
      kind.motorized
    );

    const value = chessKindValue(kind);
    tracked.push({
      id: red.id,
      owner: RED,
      kindKey: kind.key,
      hp: red.maxHp,
      value,
      firepower: 0,
      survivalRounds: 0,
    });
    tracked.push({
      id: blue.id,
      owner: BLUE,
      kindKey: kind.key,
      hp: blue.maxHp,
      value,
      firepower: 0,
      survivalRounds: 0,
    });
  }

  // 开局时该格下一回合可遭遇的敌方最大火力，作为统计表的 X
  potentialCache.clear();
  const redMap = buildFirepowerMap(RED);
  const blueMap = buildFirepowerMap(BLUE);
  const byId = new Map(state.units.map((u) => [u.id, u]));
  for (const rec of tracked) {
    const unit = byId.get(rec.id);
    if (!unit) continue;
    const map = rec.owner === RED ? blueMap : redMap;
    rec.firepower = map.total.get(cellKey(unit.x, unit.y)) || 0;
  }

  const initialRedPower = sideCombatPower(RED);
  let rounds = 0;

  for (let r = 0; r < CHESS_MAX_ROUNDS; r++) {
    if (!hasLiveUnits(RED) || !hasLiveUnits(BLUE)) break;

    aiTakeTurnFast(RED);
    if (!hasLiveUnits(RED) || !hasLiveUnits(BLUE)) break;

    state.points[RED] = 0;
    state.points[BLUE] = 0;
    simAdvanceTurn();

    aiTakeTurnFast(BLUE);
    rounds = r + 1;

    const liveIds = new Set(state.units.filter((u) => u.hp > 0).map((u) => u.id));
    for (const rec of tracked) {
      if (liveIds.has(rec.id)) rec.survivalRounds++;
    }

    if (!hasLiveUnits(RED) || !hasLiveUnits(BLUE)) break;

    state.points[RED] = 0;
    state.points[BLUE] = 0;
    simAdvanceTurn();
    state.points[RED] = 0;
    state.points[BLUE] = 0;
  }

  const finalRedPower = sideCombatPower(RED);
  const score =
    initialRedPower > 0
      ? Math.max(0, Math.min(100, (finalRedPower / initialRedPower) * 100))
      : 0;

  const stats = tracked.map((rec) => ({
    kindKey: rec.kindKey,
    firepower: rec.firepower,
    value: rec.value,
    hp: rec.hp,
    output: state.chessStats.output.get(rec.id) || 0,
    survivalRounds: rec.survivalRounds,
  }));

  return { seed, score, rounds, initialRedPower, finalRedPower, stats };
}

function mergeChessStats(result) {
  const chess = aiMemory.chess;
  chess.games++;
  chess.scoreSum += result.score;
  chess.lastAt = new Date().toISOString();
  chess.lastSeed = result.seed;

  for (const rec of result.stats) {
    const buckets = chess.kinds[rec.kindKey];
    if (!buckets) continue;

    const key = String(rec.firepower);
    let bucket = buckets[key];
    if (!bucket) {
      bucket = buckets[key] = { count: 0, value: 0, output: 0, survivalHp: 0 };
    }
    bucket.count++;
    bucket.value += rec.value;
    bucket.output += rec.output;
    bucket.survivalHp += rec.survivalRounds * rec.hp;
  }
}

/* ---------------- 玩家操作学习 ---------------- */

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function playerLearningActive() {
  return !!(
    aiMemory &&
    aiMemory.debug.learnFromPlayer &&
    state &&
    !simulationMode &&
    !observerMatchInProgress &&
    state.mode === 'ai' &&
    !state.gameOver &&
    !state.aiThinking
  );
}

function beginPlayerLearningSession() {
  playerLearningSession = null;
  if (!playerLearningActive()) return;

  playerLearningSession = {
    actions: 0,
    localSamples: 0,
    localScoreSum: 0,
    deployKinds: {},
    deployValue: 0,
    moves: 0,
    forwardMoves: 0,
    safeMoves: 0,
    attacks: 0,
    unitAttacks: 0,
    kills: 0,
    damageDealt: 0,
  };
}

function ensurePlayerLearningSession() {
  if (!playerLearningSession) beginPlayerLearningSession();
  return playerLearningSession;
}

function chessKindKeyFor(type, motorized) {
  const kind = CHESS_PIECE_KINDS.find(
    (k) => k.type === type && k.motorized === !!motorized
  );
  return kind ? kind.key : type;
}

function nearestEnemyDist(owner, x, y) {
  if (!state) return 0;
  let dist = Infinity;

  for (const u of state.units) {
    if (u.owner === owner || u.hp <= 0) continue;
    dist = Math.min(dist, cheb(x - u.x, y - u.y));
  }
  for (const s of allStructures()) {
    if (s.owner === owner || s.hp <= 0) continue;
    dist = Math.min(dist, cheb(x - s.x, y - s.y));
  }

  return Number.isFinite(dist) ? dist : 0;
}

function isUnderEnemyAttack(owner, x, y) {
  if (!state) return false;

  for (const e of state.units) {
    if (e.owner === owner || e.hp <= 0) continue;
    for (const c of cellsFromMask(e.x, e.y, attackMaskFor(e))) {
      if (c.x === x && c.y === y) return true;
    }
  }
  for (const s of allStructures()) {
    if (s.owner === owner || s.hp <= 0) continue;
    for (const c of cellsFromMask(s.x, s.y, PAT.defense)) {
      if (c.x === x && c.y === y) return true;
    }
  }
  return false;
}

function recordPlayerDeploy(unit, cost, source) {
  const session = ensurePlayerLearningSession();
  if (!session || !unit || unit.owner !== RED || state.current !== RED) return;

  let local = 0.6;
  if (source === 'outpost') local += 0.1;
  if (nearestObjectiveDist(RED, unit.x, unit.y) <= 5) local += 0.15;
  if (aiBestImmediateAction(RED, unit.type, unit.motorized, unit.x, unit.y)) local += 0.1;
  local = clampValue(local, 0, 1);

  const kind = chessKindKeyFor(unit.type, unit.motorized);
  const weighted = local * cost;
  session.deployKinds[kind] = (session.deployKinds[kind] || 0) + weighted;
  session.deployValue += weighted;
  session.actions++;
  session.localSamples++;
  session.localScoreSum += local;
}

function recordPlayerMove(u, from, to) {
  const session = ensurePlayerLearningSession();
  if (!session || !u || u.owner !== RED || state.current !== RED) return;

  const before = nearestEnemyDist(RED, from.x, from.y);
  const after = nearestEnemyDist(RED, to.x, to.y);
  const forward = after < before;
  const safe = !isUnderEnemyAttack(RED, to.x, to.y);
  const local = clampValue(
    0.5 + (forward ? 0.25 : -0.15) + (safe ? 0.2 : -0.25),
    0,
    1
  );

  session.moves += local;
  if (forward) session.forwardMoves += local;
  if (safe) session.safeMoves += local;
  session.actions++;
  session.localSamples++;
  session.localScoreSum += local;
}

function recordPlayerAttack(u, target, hpBefore, dmg, killed, splashHits) {
  const session = ensurePlayerLearningSession();
  if (!session || !u || u.owner !== RED || state.current !== RED) return;

  let local = 0.35 + 0.25 * Math.min(1, dmg / Math.max(1, hpBefore));
  if (killed) local += 0.35;
  if (splashHits > 0) local += Math.min(0.15, splashHits * 0.05);
  if (target.kind === 'base') local += 0.15;
  else if (target.kind === 'outpost') local += 0.05;
  local = clampValue(local, 0, 1);

  session.attacks += local;
  if (target.kind === 'unit') session.unitAttacks += local;
  if (killed) session.kills++;
  session.damageDealt += dmg;
  session.actions++;
  session.localSamples++;
  session.localScoreSum += local;
}

function recordPlayerStructureAttack(s, target, hpBefore, dealt, killed) {
  const session = ensurePlayerLearningSession();
  if (!session || !s || s.owner !== RED || state.current !== RED) return;

  let local = 0.45 + 0.25 * Math.min(1, dealt / Math.max(1, hpBefore));
  if (killed) local += 0.35;
  local = clampValue(local, 0, 1);

  session.attacks += local;
  if (target.kind === 'unit') session.unitAttacks += local;
  if (killed) session.kills++;
  session.damageDealt += dealt;
  session.actions++;
  session.localSamples++;
  session.localScoreSum += local;
}

function applyPlayerLearning(globalPerf, localQuality) {
  const pl = aiMemory.playerLearning;
  const strat = aiMemory.strategy;
  const lr = clampValue(
    0.18 * Math.max(0, globalPerf) * Math.max(0, localQuality),
    0.01,
    0.12
  );

  const share = (kind) =>
    pl.deployValue > 0 ? (pl.deployKinds[kind] || 0) / pl.deployValue : 0;
  const tankShare = share('tank');
  const rangedShare =
    share('artillery') +
    share('artillery_moto') +
    share('atgun') +
    share('atgun_moto');
  const infantryShare = share('infantry') + share('infantry_moto');
  const aggression = pl.moves > 0 ? pl.forwardMoves / pl.moves : 0.5;
  const safety = pl.moves > 0 ? pl.safeMoves / pl.moves : 0.5;
  const unitFocus = pl.attacks > 0 ? pl.unitAttacks / pl.attacks : 0.5;

  const targets = {};
  if (pl.deployValue > 0) {
    targets.tankBias = clampValue(0.6 + tankShare * 2.4, 0.5, 2);
    targets.blockPositionWeight = clampValue(0.4 + infantryShare * 2, 0, 2);
    targets.rangePositionWeight = clampValue(0.2 + rangedShare * 1.8, 0, 2);
    targets.splashGainPositionWeight = clampValue(rangedShare * 1.5, 0, 2);
  }
  if (pl.moves > 0) {
    targets.advanceWeight = clampValue(0.6 + aggression * 2, 0.1, 2.5);
    targets.localPushWeight = clampValue(aggression * 90, 0, 100);
    targets.survivalWeight = clampValue(0.5 + safety, 0, 2);
  }
  if (pl.attacks > 0) {
    targets.annihilationWeight = clampValue(unitFocus * 5.5, 0, 6);
  }

  const applied = {};
  for (const [key, target] of Object.entries(targets)) {
    if (!Number.isFinite(strat[key])) continue;
    strat[key] = Number((strat[key] * (1 - lr) + target * lr).toFixed(3));
    applied[key] = strat[key];
  }

  pl.lastApplied = {
    at: new Date().toISOString(),
    lr: Number(lr.toFixed(4)),
    globalPerf: Number(globalPerf.toFixed(3)),
    localQuality: Number(localQuality.toFixed(3)),
    changes: applied,
  };
}

function finalizePlayerLearning(winner) {
  const session = playerLearningSession;
  playerLearningSession = null;

  if (!session || !state || state.mode !== 'ai') return;
  if (!aiMemory.debug.learnFromPlayer || session.actions < 3) return;

  const pl = aiMemory.playerLearning;
  const econ = economyStats(RED);
  const ratio =
    econ.lost > 0 ? econ.killed / econ.lost : econ.killed > 0 ? 3 : 1;
  const econNorm = Math.min(1, ratio / 2);
  const winnerScore = winner === RED ? 1 : winner === BLUE ? -1 : 0;
  const redHp = (state.bases.find((b) => b.owner === RED) || {}).hp || 0;
  const blueHp = (state.bases.find((b) => b.owner === BLUE) || {}).hp || 0;
  const hpDiff = (redHp - blueHp) / 16;
  const globalPerf = clampValue(
    0.55 * winnerScore + 0.3 * (econNorm * 2 - 1) + 0.15 * hpDiff,
    -1,
    1
  );
  const localQuality =
    session.localSamples > 0 ? session.localScoreSum / session.localSamples : 0;

  pl.games++;
  if (winner === RED) pl.wins++;
  else if (winner === BLUE) pl.losses++;
  pl.globalScoreSum += globalPerf;
  pl.localSamples += session.localSamples;
  pl.localScoreSum += session.localScoreSum;
  pl.lastGlobal = Number(globalPerf.toFixed(3));
  pl.lastLocal = Number(localQuality.toFixed(3));
  pl.lastAt = new Date().toISOString();

  const shouldLearn =
    globalPerf > 0.1 && localQuality > 0.35 && session.localSamples >= 12;

  if (shouldLearn) {
    pl.learnedGames++;
    pl.deployValue += session.deployValue;
    for (const [kind, value] of Object.entries(session.deployKinds)) {
      pl.deployKinds[kind] = (pl.deployKinds[kind] || 0) + value;
    }
    pl.moves += session.moves;
    pl.forwardMoves += session.forwardMoves;
    pl.safeMoves += session.safeMoves;
    pl.attacks += session.attacks;
    pl.unitAttacks += session.unitAttacks;
    pl.kills += session.kills;
    pl.damageDealt += session.damageDealt;
    applyPlayerLearning(globalPerf, localQuality);
    addLog(
      `AI 已根据本局玩家表现调整策略（全局 ${globalPerf.toFixed(2)} / 局部 ${localQuality.toFixed(2)}）。`,
      'system'
    );
  }

  saveAiMemory();
  if (dom && dom.debugStats) updateDebugUI();
}

function perturbStrategy(base) {
  const ranges = {
    level1Weight: { min: 0.3, max: 2.5, step: 0.35 },
    level2Weight: { min: 0.05, max: 1.5, step: 0.2 },
    baseThreat: { min: 400, max: 1600, step: 150 },
    outpostThreat: { min: 40, max: 300, step: 40 },
    pressureWeight: { min: 0, max: 2, step: 0.3 },
    advanceWeight: { min: 0.1, max: 2.5, step: 0.3 },
    motorizationThreshold: { min: 0, max: 40, step: 6 },
    motorizationWeight: { min: 0, max: 1.5, step: 0.2 },
    ownControlWeight: { min: 0, max: 2, step: 0.3 },
    localControlWeight: { min: 0, max: 2.5, step: 0.3 },
    localPushWeight: { min: 0, max: 100, step: 15 },
    stagingWeight: { min: 0, max: 16, step: 3 },
    annihilationWeight: { min: 0, max: 6, step: 1.2 },
    outpostDefenseWeight: { min: 0, max: 30, step: 6 },
    claimWeight: { min: 0, max: 50, step: 10 },
    survivalWeight: { min: 0, max: 2, step: 0.4 },
    screenWeight: { min: 0, max: 2, step: 0.4 },
    positioningWeight: { min: 0, max: 2.5, step: 0.5 },
    splashGainPositionWeight: { min: 0, max: 2, step: 0.4 },
    splashRiskPositionWeight: { min: 0, max: 2, step: 0.4 },
    rangePositionWeight: { min: 0, max: 2, step: 0.4 },
    blockPositionWeight: { min: 0, max: 2, step: 0.4 },
    spongePositionWeight: { min: 0, max: 2, step: 0.4 },
    enemyControlWeight: { min: 0, max: 10, step: 1.2 },
    openingRounds: { min: 2, max: 10, step: 1 },
    advantageRatio: { min: 1.0, max: 1.6, step: 0.06 },
    defenseRatio: { min: 0.6, max: 1.0, step: 0.05 },
    tankBias: { min: 0.5, max: 2, step: 0.2 },
    motorizedUnitBias: { min: 0, max: 1, step: 0.15 },
    motorizationOpeningBonus: { min: 0, max: 80, step: 12 },
    motorizationAdvantageBonus: { min: 0, max: 50, step: 10 },
    motorizationEvenBonus: { min: 0, max: 30, step: 6 },
  };
  const keys = Object.keys(ranges);
  const strategy = cloneJson(base);

  const change = (key) => {
    const range = ranges[key];
    const next = strategy[key] + (Math.random() * 2 - 1) * range.step;
    strategy[key] = Number(Math.max(range.min, Math.min(range.max, next)).toFixed(3));
  };

  change(keys[Math.floor(Math.random() * keys.length)]);
  if (Math.random() < 0.3) {
    change(keys[Math.floor(Math.random() * keys.length)]);
  }
  strategy.openingRounds = Math.round(strategy.openingRounds);

  return strategy;
}

async function runAiTraining() {
  if (trainingInProgress || observerMatchInProgress) return;
  if (!aiMemory.debug.enabled) {
    setTrainStatus('请先启用调试模式。');
    return;
  }
  if (!state || state.aiThinking) {
    setTrainStatus('请等电脑行动结束后再训练。');
    return;
  }
  if (aiMemory.debug.observer) {
    await runAiObserverMatch();
    return;
  }

  trainingInProgress = true;
  updateDebugUI();
  setTrainStatus('正在准备训练…');

  const saved = {
    state,
    effects,
    potentialCache,
    aiThreat,
    aiThreatOwner,
    aiLastDecision,
  };

  const startTime = performance.now();
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const candidates = 5;
  const gamesPerCandidate = 4;
  const totalGames = candidates * gamesPerCandidate;
  let doneGames = 0;
  let adopted = 0;
  let best = cloneJson(aiMemory.strategy);
  let finalStatus = '';

  try {
    simulationMode = true;
    effects = [];
    potentialCache = new Map();
    aiThreat = null;
    aiThreatDirty = true;
    aiRng = Math.random;

    for (let c = 0; c < candidates; c++) {
      const candidate = perturbStrategy(best);
      let fitnessSum = 0;

      for (let g = 0; g < gamesPerCandidate; g++) {
        const candidateSide = g % 2;
        const redStrategy = candidateSide === RED ? candidate : best;
        const blueStrategy = candidateSide === BLUE ? candidate : best;
        const result = simulateMatch(redStrategy, blueStrategy, (seed + c * 31 + g) >>> 0);

        const fitness = matchFitness(result, candidateSide);
        fitnessSum += fitness;
        doneGames++;

        aiMemory.training.games++;
        if (result.winner === candidateSide) aiMemory.training.wins++;
        else if (result.winner === 1 - candidateSide) aiMemory.training.losses++;
        else aiMemory.training.draws++;
        aiMemory.training.econKilled += result.economy.killed[candidateSide];
        aiMemory.training.econLost += result.economy.lost[candidateSide];

        setTrainStatus(`训练中：第 ${doneGames}/${totalGames} 局（候选 ${c + 1}/${candidates}）`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const fitness = fitnessSum / gamesPerCandidate;
      aiMemory.training.evaluations++;
      aiMemory.training.lastSeed = seed;

      if (fitness > 0.05) {
        best = cloneJson(candidate);
        aiMemory.strategy = cloneJson(candidate);
        aiMemory.training.bestFitness = Number(fitness.toFixed(3));
        aiMemory.history.push({
          at: new Date().toISOString(),
          fitness: Number(fitness.toFixed(3)),
          strategy: cloneJson(candidate),
        });
        if (aiMemory.history.length > 8) aiMemory.history.shift();
        adopted++;
        saveAiMemory();
        setTrainStatus(`候选 ${c + 1} 更优：适应度 ${fitness.toFixed(2)}，已采用。`);
      } else {
        setTrainStatus(`候选 ${c + 1} 未超过当前策略：适应度 ${fitness.toFixed(2)}。`);
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    aiMemory.training.lastTrainedAt = new Date().toISOString();
    aiMemory.training.lastDurationMs = Math.round(performance.now() - startTime);
    saveAiMemory();

    finalStatus = adopted > 0
      ? `训练完成：${totalGames} 局，采用了 ${adopted} 组更优策略。`
      : `训练完成：${totalGames} 局，未发现更优策略。`;
  } catch (err) {
    console.error('AI training error:', err);
    finalStatus = `训练失败：${err.message}`;
  } finally {
    simulationMode = false;
    trainingInProgress = false;
    state = saved.state;
    effects = saved.effects;
    potentialCache = saved.potentialCache;
    aiThreat = saved.aiThreat;
    aiThreatOwner = saved.aiThreatOwner;
    aiThreatDirty = true;
    aiControl = null;
    aiLastDecision = saved.aiLastDecision;
    aiRng = Math.random;
    simStrategies = null;
    debugThreatCache = null;

    updateDebugUI();
    setTrainStatus(finalStatus);
    updateUI();
  }
}

function setChessStatus(text) {
  if (dom.chessTrainStatus) dom.chessTrainStatus.textContent = text;
}

async function runChessTraining() {
  if (trainingInProgress || observerMatchInProgress) return;
  if (!aiMemory.debug.enabled) {
    setChessStatus('请先启用调试模式。');
    return;
  }
  if (!state || state.aiThinking) {
    setChessStatus('请等电脑行动结束后再训练。');
    return;
  }

  const saved = {
    state,
    effects,
    potentialCache,
    aiThreat,
    aiThreatOwner,
    aiLastDecision,
    nextUnitId,
  };

  chessTrainingInProgress = true;
  trainingInProgress = true;
  simulationMode = true;
  updateDebugUI();

  const startTime = performance.now();
  const seed = (Math.random() * 0xffffffff) >>> 0;
  let scoreSum = 0;
  let finalStatus = '';

  try {
    for (let g = 0; g < CHESS_SCENARIOS; g++) {
      setChessStatus(`棋力训练：第 ${g + 1}/${CHESS_SCENARIOS} 局…`);
      const result = simulateChessMatch(
        aiMemory.strategy,
        (seed + Math.imul(g + 1, 2654435761)) >>> 0
      );
      mergeChessStats(result);
      scoreSum += result.score;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    aiMemory.chess.runs++;
    aiMemory.chess.lastScore = Number((scoreSum / CHESS_SCENARIOS).toFixed(2));
    aiMemory.chess.lastAt = new Date().toISOString();
    aiMemory.chess.lastSeed = seed;
    saveAiMemory();

    finalStatus = `棋力训练完成：${CHESS_SCENARIOS} 局，先手平均保留战力 ${(
      scoreSum / CHESS_SCENARIOS
    ).toFixed(1)}%（用时 ${Math.round(performance.now() - startTime)} ms）。`;
  } catch (err) {
    console.error('Chess training error:', err);
    finalStatus = `棋力训练失败：${err.message}`;
  } finally {
    chessTrainingInProgress = false;
    trainingInProgress = false;
    simulationMode = false;

    state = saved.state;
    effects = saved.effects;
    potentialCache = saved.potentialCache;
    aiThreat = saved.aiThreat;
    aiThreatOwner = saved.aiThreatOwner;
    aiThreatDirty = true;
    aiControl = null;
    aiLastDecision = saved.aiLastDecision;
    nextUnitId = saved.nextUnitId;
    aiRng = Math.random;
    simStrategies = null;
    debugThreatCache = null;

    updateDebugUI();
    setChessStatus(finalStatus);
    updateUI();
  }
}

function clearChessStats() {
  if (trainingInProgress || observerMatchInProgress) return;
  if (!window.confirm('清空棋力训练的全部统计表？')) return;

  aiMemory.chess = createEmptyChessStats();
  saveAiMemory();
  updateDebugUI();
  setChessStatus('棋力统计已清空。');
}

function updateObserverBar() {
  if (!dom.observerText) return;
  if (!observerMatchInProgress) {
    dom.observerText.textContent = 'AI 观战';
    if (dom.observerEconomy) dom.observerEconomy.textContent = '';
    return;
  }

  if (!state) {
    dom.observerText.textContent = 'AI 观战';
    if (dom.observerEconomy) dom.observerEconomy.textContent = '';
    return;
  }

  if (state.gameOver) {
    dom.observerText.textContent = 'AI 观战 · 结束';
  } else {
    const phase =
      aiControl && aiControl.owner === state.current ? phaseLabel(aiControl.phase) : '';
    dom.observerText.textContent =
      `AI 观战 · ${PLAYER_NAMES[state.current]}${state.aiThinking ? '行动中' : ''}` +
      ` · 第 ${state.round} 回合${phase ? ` · ${phase}` : ''}`;
  }

  if (dom.observerEconomy) {
    dom.observerEconomy.textContent =
      `经济比 红 ${formatEconomyShort(RED)} · 蓝 ${formatEconomyShort(BLUE)}` +
      ` ｜ 战力 红 ${sideCombatPower(RED)} / 蓝 ${sideCombatPower(BLUE)}`;
  }
}

function stopObserverMatch() {
  if (!observerMatchInProgress) return;
  observerStopRequested = true;
  if (state) state.gameOver = true;
  if (dom.observerStopBtn) {
    dom.observerStopBtn.disabled = true;
    dom.observerStopBtn.textContent = '停止中…';
  }
  updateObserverBar();
}

async function runAiObserverMatch() {
  if (observerMatchInProgress || trainingInProgress) return;
  if (!aiMemory.debug.enabled) {
    setTrainStatus('请先启用调试模式。');
    return;
  }
  if (!state || state.aiThinking) {
    setTrainStatus('请等电脑行动结束后再观察。');
    return;
  }

  const saved = {
    state,
    effects,
    potentialCache,
    aiThreat,
    aiThreatOwner,
    aiLastDecision,
  };

  observerMatchInProgress = true;
  observerStopRequested = false;
  trainingInProgress = false;
  simulationMode = false;

  if (dom.observerStopBtn) {
    dom.observerStopBtn.disabled = false;
    dom.observerStopBtn.textContent = '停止观察';
  }
  hide(dom.debugOverlay);
  show(dom.observerBar);

  state = createSimulationState();
  deployInitialGarrisons();
  simStrategies = [cloneJson(aiMemory.strategy), cloneJson(aiMemory.strategy)];
  aiRng = makeRng((Math.random() * 0xffffffff) >>> 0);
  effects = [];
  potentialCache = new Map();
  aiThreat = null;
  aiThreatOwner = null;
  aiThreatDirty = true;
  aiLastDecision = null;
  debugThreatCache = null;

  updateUI();
  updateObserverBar(1);

  let turns = 0;
  let resultText = '';

  try {
    while (!observerStopRequested && !state.gameOver) {
      const owner = state.current;
      updateObserverBar(turns + 1);
      await aiTurnBody(gameToken, owner);
      turns++;
      updateObserverBar(turns + 1);

      if (observerStopRequested || state.gameOver) break;
      await sleep(220);
    }

    const econText = state.economy
      ? `；经济比 红 ${formatEconomyShort(RED)} / 蓝 ${formatEconomyShort(BLUE)}`
      : '';

    if (observerStopRequested) {
      resultText = `观察已停止（进行了 ${turns} 回合）${econText}。`;
    } else {
      resultText = `${PLAYER_NAMES[state.winner]}胜利：敌方基地被摧毁${econText}。`;
    }
  } catch (err) {
    console.error('AI observer error:', err);
    resultText = `观察出错：${err.message}`;
  } finally {
    observerMatchInProgress = false;
    observerStopRequested = false;

    state = saved.state;
    effects = saved.effects;
    potentialCache = saved.potentialCache;
    aiThreat = saved.aiThreat;
    aiThreatOwner = saved.aiThreatOwner;
    aiThreatDirty = true;
    aiControl = null;
    aiLastDecision = saved.aiLastDecision;
    aiRng = Math.random;
    simStrategies = null;
    debugThreatCache = null;

    hide(dom.observerBar);
    if (dom.observerStopBtn) {
      dom.observerStopBtn.disabled = false;
      dom.observerStopBtn.textContent = '停止观察';
    }
    show(dom.debugOverlay);
    updateDebugUI();
    setTrainStatus(resultText || '观察结束。');
    updateUI();
  }
}

/* ============================================================
   界面更新
   ============================================================ */

function updatePips(points) {
  if (!dom.pointsPips) return;
  const pips = dom.pointsPips.children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].classList.toggle('on', points !== null && i < points);
  }
}

function updateBuildCards() {
  if (!dom.buildGrid) return;

  const started = !!state;
  const humanCan =
    started &&
    !observerMatchInProgress &&
    !state.gameOver &&
    !state.aiThinking &&
    !(state.mode === 'ai' && state.current === BLUE);
  const points = started ? state.points[state.current] : 0;

  dom.buildGrid.querySelectorAll('.build-card').forEach((card) => {
    const type = card.dataset.type;
    const def = UNIT_TYPES[type];
    if (!def) return;

    const moto = card.querySelector('input[data-moto]');
    const motoOn = !!(moto && moto.checked);
    const cost = def.cost + (def.canMotorize && motoOn ? 1 : 0);
    const spawnCount = started ? getDeploymentCells(state.current, motoOn, type).length : 0;

    const costEl = card.querySelector('.build-cost b');
    if (costEl) costEl.textContent = String(cost);

    card.classList.toggle('moto-on', motoOn);

    const can = humanCan && points >= cost && spawnCount > 0;
    card.classList.toggle('disabled', !can);

    const btn = card.querySelector('.build-main');
    if (btn) btn.disabled = !can;

    if (moto) {
      moto.disabled = !humanCan;
      const wrap = moto.closest('label');
      if (wrap) wrap.classList.toggle('disabled', !humanCan);
    }
  });
}

function renderInfo() {
  if (!state) {
    dom.infoPanel.innerHTML = `
      <div class="info-title">欢迎</div>
      <div class="info-line">选择一种模式开始游戏。</div>
    `;
    return;
  }

  if (state.buildMode) {
    const bm = state.buildMode;
    const def = UNIT_TYPES[bm.type];
    dom.infoPanel.innerHTML = `
      <div class="info-title">部署单位</div>
      <div class="info-line">
        <span class="owner-chip ${state.current === RED ? 'red' : 'blue'}"></span>
        ${bm.motorized ? '摩托化' : ''}${def.name}
        <span class="cost-tag">花费 ${bm.cost}</span>
      </div>
      <div class="info-tip">点击基地或哨站周围的绿色格子放置。哨站部署仅限非摩托化火炮/反坦克炮/步兵，不能部署坦克，按基础价格扣费；新单位当回合即可行动。</div>
      <button id="cancelBuildBtn" class="mini-btn" type="button">取消部署（Esc）</button>
    `;
    return;
  }

  const sel = getSelected();

  if (sel && sel.kind === 'unit') {
    const def = UNIT_TYPES[sel.type];
    const hpPct = Math.round((sel.hp / sel.maxHp) * 100);
    const canMove = canUnitMove(sel);
    const canAtk = canUnitAttack(sel);
    const done = !canMove && !canAtk;

    let note = '';
    if (sel.type === 'tank') {
      note = '攻击 2；移动与攻击顺序不限；免疫溅射伤害。';
    } else if (sel.type === 'artillery') {
      note = `移动或攻击二选一；造成 2 伤害并溅射 1。${
        sel.motorized ? '摩托化：可先移动再攻击，但落点必须与起点相邻。' : ''
      }`;
    } else if (sel.type === 'atgun') {
      note = `移动或攻击二选一；对坦克伤害 3，对步兵伤害 1，其他单位 2。${
        sel.motorized ? '摩托化：可先移动再攻击，但落点必须与起点相邻。' : ''
      }`;
    } else {
      note = sel.motorized
        ? '摩托化：移动范围等同坦克，移动/攻击顺序不限。'
        : '相邻移动后可攻击，或攻击后相邻移动；跨格移动当回合不能攻击。';
    }

    dom.infoPanel.innerHTML = `
      <div class="info-title">${def.name}${sel.motorized ? ' <span class="badge-moto">摩托化</span>' : ''}</div>
      <div class="info-line">
        <span class="owner-chip ${sel.owner === RED ? 'red' : 'blue'}"></span>
        ${PLAYER_NAMES[sel.owner]} · (${sel.x}, ${sel.y})
      </div>
      <div class="hp-line">
        <div class="hp-bar"><i style="width:${hpPct}%"></i></div>
        <span>${sel.hp}/${sel.maxHp} HP</span>
      </div>
      <div class="status-line">
        <span class="${canMove ? 'ok' : 'no'}">移动：${sel.moved ? '已用' : canMove ? '可用' : '不可'}</span>
        <span class="${canAtk ? 'ok' : 'no'}">攻击：${sel.attacked ? '已用' : canAtk ? '可用' : '不可'}</span>
      </div>
      <div class="info-tip">${note}</div>
      ${done ? '<div class="info-tip done">本回合已行动完毕。</div>' : '<div class="info-tip">蓝格移动 · 红圈攻击</div>'}
    `;
    return;
  }

  if (sel && (sel.kind === 'base' || sel.kind === 'outpost')) {
    const isBase = sel.kind === 'base';
    const hpPct = Math.round((sel.hp / sel.maxHp) * 100);
    const hasTargets = getStructureTargets(sel).length > 0;

    dom.infoPanel.innerHTML = `
      <div class="info-title">${isBase ? '基地' : '哨站'}</div>
      <div class="info-line">
        <span class="owner-chip ${sel.owner === RED ? 'red' : 'blue'}"></span>
        ${PLAYER_NAMES[sel.owner]} · (${sel.x}, ${sel.y})
      </div>
      <div class="hp-line">
        <div class="hp-bar"><i style="width:${hpPct}%"></i></div>
        <span>${sel.hp}/${sel.maxHp} HP</span>
      </div>
      <div class="status-line">
        <span class="${sel.attacked ? 'no' : 'ok'}">防御攻击：${sel.attacked ? '本回合已用' : '可用（每回合一次）'}</span>
        ${
          isBase
            ? ''
            : `<span class="${sel.deployUsed ? 'no' : 'ok'}">部署：${
                sel.deployUsed ? '本回合已用' : '可用（每回合一次）'
              }</span>`
        }
      </div>
      <div class="info-tip">${isBase ? '秒杀攻击范围内的一个敌方单位。' : '对攻击范围内的一个敌方单位造成 2 伤害。'}免疫溅射；被单位攻击时，单次最多受到 1 点伤害。</div>
      ${
        isBase
          ? ''
          : '<div class="info-tip">哨站部署：点兵种卡后选哨站周围绿格；仅限非摩托化火炮/反坦克炮/步兵，不能部署坦克，照样扣建造值。</div>'
      }
      ${!sel.attacked && hasTargets ? '<div class="info-tip">点击红圈中的敌方单位发动攻击。</div>' : ''}
      ${!sel.attacked && !hasTargets ? '<div class="info-tip">当前范围内没有敌方单位。</div>' : ''}
    `;
    return;
  }

  if (observerMatchInProgress) {
    dom.infoPanel.innerHTML = `
      <div class="info-title">AI 观战</div>
      <div class="info-line">双方 AI 正在自动作战。</div>
      <div class="info-tip">点击下方“停止观察”可返回原游戏。</div>
    `;
    return;
  }

  dom.infoPanel.innerHTML = `
    <div class="info-title">操作提示</div>
    <div class="info-line">点击己方单位或建筑查看行动范围。</div>
    <div class="info-tip">蓝格 = 移动，红圈 = 可攻击，橙格 = 防御射程。</div>
    <div class="info-tip">建造：点兵种卡片，再点基地或哨站旁的绿色格子。</div>
    <div class="info-tip">${
      state.gameOver
        ? '本局已结束，可以重新开局。'
        : state.mode === 'ai' && state.current === BLUE
        ? '电脑正在行动，请稍候。'
        : '点击“结束回合”交给对方。'
    }</div>
  `;
}

function renderLog() {
  if (!dom.logPanel) return;
  if (!state) {
    dom.logPanel.innerHTML = '';
    return;
  }

  dom.logPanel.innerHTML = '';
  const items = state.log.slice(-14).reverse();
  for (const item of items) {
    const div = document.createElement('div');
    div.className = `log-entry ${item.cls || 'system'}`;
    div.textContent = item.text;
    dom.logPanel.appendChild(div);
  }
}

function addLog(text, cls = 'system') {
  if (!state || simulationMode) return;
  state.log.push({ text, cls });
  if (state.log.length > 80) state.log.shift();
  renderLog();
}

function updateUI() {
  if (simulationMode) return;
  if (!dom.turnText) return;

  if (!state) {
    dom.turnText.textContent = '等待开局';
    dom.turnBanner.className = 'turn-banner';
    dom.modeLabel.textContent = '未开始';
    dom.pointsText.textContent = '—';
    updatePips(null);
    dom.endTurnBtn.disabled = true;
    renderInfo();
    renderLog();
    updateBuildCards();
    updateCursor();
    return;
  }

  const humanTurn =
    !observerMatchInProgress &&
    !state.gameOver &&
    !state.aiThinking &&
    !(state.mode === 'ai' && state.current === BLUE);

  if (observerMatchInProgress) {
    dom.turnText.textContent = state.gameOver
      ? 'AI 观战 · 结束'
      : `AI 观战 · ${PLAYER_NAMES[state.current]}${state.aiThinking ? '行动中' : ''}`;
  } else {
    dom.turnText.textContent = state.gameOver
      ? `${PLAYER_NAMES[state.winner]}胜利`
      : state.aiThinking
      ? `${PLAYER_NAMES[state.current]}思考中…`
      : `${PLAYER_NAMES[state.current]}回合`;
  }

  dom.turnBanner.className = 'turn-banner';
  if (state.gameOver) {
    dom.turnBanner.classList.add(state.winner === RED ? 'red' : 'blue');
  } else {
    dom.turnBanner.classList.add(state.current === RED ? 'red' : 'blue');
  }
  if (state.aiThinking) dom.turnBanner.classList.add('thinking');

  dom.modeLabel.textContent = observerMatchInProgress
    ? 'AI 观战'
    : state.mode === 'ai'
    ? state.difficulty === 'hard'
      ? '人机对战 · 困难'
      : '人机对战 · 普通'
    : '双人同屏';
  dom.pointsText.textContent = String(state.points[state.current]);
  updatePips(state.points[state.current]);
  document.body.classList.toggle('observing', observerMatchInProgress);

  dom.endTurnBtn.disabled = !humanTurn;
  if (dom.mobileEndTurnBtn) dom.mobileEndTurnBtn.disabled = !humanTurn;
  if (dom.mobileBar) {
    const overlayOpen =
      !dom.startOverlay.classList.contains('hidden') ||
      !dom.gameOverOverlay.classList.contains('hidden') ||
      !dom.rulesOverlay.classList.contains('hidden') ||
      !dom.debugOverlay.classList.contains('hidden');
    dom.mobileBar.classList.toggle(
      'hidden',
      !state || state.gameOver || state.aiThinking || observerMatchInProgress || overlayOpen
    );
  }
  if (dom.restartBtn) dom.restartBtn.disabled = observerMatchInProgress;
  if (dom.debugBtn) dom.debugBtn.disabled = observerMatchInProgress;

  updateBuildCards();
  renderInfo();
  renderLog();
  if (observerMatchInProgress) updateObserverBar();
  if (dom.debugOverlay && !dom.debugOverlay.classList.contains('hidden')) {
    updateDebugUI();
  }
  updateCursor();
}

/* ============================================================
   画布与渲染
   ============================================================ */

function roundRectPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function polygonPath(cx, cy, r, sides, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * Math.PI * 2) / sides;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function diamondPath(cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function resizeCanvas() {
  const wrap = document.getElementById('boardWrap');
  if (!wrap || !canvas || !ctx) return;

  const rect = wrap.getBoundingClientRect();
  const availW = Math.max(260, rect.width - 24);
  const availH = Math.max(260, (rect.height > 80 ? rect.height : window.innerHeight * 0.62) - 24);

  let cell = Math.floor(Math.min((availW - 40) / SIZE, (availH - 40) / SIZE, 46));
  cell = Math.max(15, cell);

  const pad = Math.max(18, Math.round(cell * 0.62));
  const w = cell * SIZE + pad * 2;
  const h = cell * SIZE + pad * 2;

  layout = { cell, pad, w, h };

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  updateCursor();
}

function cellRect(x, y) {
  const c = layout.cell;
  return {
    x: layout.pad + x * c,
    y: layout.pad + (SIZE - 1 - y) * c,
    w: c,
    h: c,
  };
}

function cellCenter(x, y) {
  const r = cellRect(x, y);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function hpColor(ratio) {
  if (ratio > 0.6) return '#4f7a45';
  if (ratio > 0.3) return '#b07a24';
  return '#a83a2e';
}

function drawGrid(bx, by, cell) {
  const size = cell * SIZE;
  ctx.save();

  for (let i = 0; i <= SIZE; i++) {
    const major = i === 0 || i === SIZE || i % 5 === 0;
    ctx.strokeStyle = major ? 'rgba(74, 66, 48, 0.42)' : 'rgba(74, 66, 48, 0.17)';
    ctx.lineWidth = major ? 1.4 : 0.8;

    ctx.beginPath();
    ctx.moveTo(bx + i * cell, by);
    ctx.lineTo(bx + i * cell, by + size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bx, by + i * cell);
    ctx.lineTo(bx + size, by + i * cell);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(44, 42, 38, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, size, size);
  ctx.restore();
}

function drawCoords(bx, by, cell) {
  const size = cell * SIZE;
  ctx.save();
  ctx.fillStyle = 'rgba(74, 66, 48, 0.58)';
  ctx.font = `${Math.max(8, Math.min(11, Math.round(cell * 0.24)))}px "KaiTi", "STKaiti", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < SIZE; i++) {
    ctx.fillText(String(i), bx + i * cell + cell / 2, by + size + layout.pad * 0.55);
    ctx.fillText(String(i), bx - layout.pad * 0.55, by + (SIZE - 1 - i) * cell + cell / 2);
  }
  ctx.restore();
}

function drawHpBar(cx, y, width, hp, maxHp) {
  const h = Math.max(3, layout.cell * 0.075);
  const x = cx - width / 2;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));

  ctx.save();
  roundRectPath(x, y, width, h, h / 2);
  ctx.fillStyle = 'rgba(44, 42, 38, 0.32)';
  ctx.fill();

  if (ratio > 0) {
    roundRectPath(x, y, Math.max(h, width * ratio), h, h / 2);
    ctx.fillStyle = hpColor(ratio);
    ctx.fill();
  }
  ctx.restore();
}

function drawHpChip(rect, hp) {
  if (layout.cell < 24) return;

  const text = String(hp);
  const fs = Math.max(8, Math.round(layout.cell * 0.22));
  ctx.save();
  ctx.font = `bold ${fs}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + 8;
  const h = fs + 5;
  const x = rect.x + rect.w - w - 2;
  const y = rect.y + 2;

  roundRectPath(x, y, w, h, 3);
  ctx.fillStyle = 'rgba(251, 244, 226, 0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60, 54, 42, 0.32)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

function drawGlyph(text, cx, cy, s, color, factor = 0.36) {
  ctx.save();
  ctx.font = `bold ${Math.max(8, Math.round(s * factor))}px "KaiTi", "STKaiti", "Kaiti SC", "Noto Serif SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function basePath(cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.22);
  ctx.lineTo(cx + r * 1.05, cy - r * 0.34);
  ctx.lineTo(cx + r * 0.8, cy + r * 0.9);
  ctx.lineTo(cx - r * 0.8, cy + r * 0.9);
  ctx.lineTo(cx - r * 1.05, cy - r * 0.34);
  ctx.closePath();
}

function drawBase(b) {
  const rect = cellRect(b.x, b.y);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const s = layout.cell;
  const r = s * 0.33;
  const color = OWNER_CSS[b.owner];
  const light = OWNER_LIGHT[b.owner];

  ctx.save();
  ctx.shadowColor = 'rgba(25, 22, 16, 0.3)';
  ctx.shadowBlur = s * 0.14;
  ctx.shadowOffsetY = s * 0.05;
  basePath(cx, cy, r);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.restore();

  basePath(cx, cy, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.055);
  ctx.stroke();

  /* 小旗 */
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.55, cy - r * 0.95);
  ctx.lineTo(cx + r * 0.55, cy - r * 1.52);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx + r * 0.55, cy - r * 1.52);
  ctx.lineTo(cx + r * 1.2, cy - r * 1.34);
  ctx.lineTo(cx + r * 0.55, cy - r * 1.16);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  drawGlyph('基', cx, cy - s * 0.005, s, color, 0.32);
  drawHpBar(cx, rect.y + rect.h - s * 0.15, s * 0.64, b.hp, b.maxHp);
  drawHpChip(rect, b.hp);
}

function drawOutpost(o) {
  const rect = cellRect(o.x, o.y);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const s = layout.cell;
  const w = s * 0.56;
  const h = s * 0.5;
  const color = OWNER_CSS[o.owner];
  const light = OWNER_LIGHT[o.owner];

  ctx.save();
  ctx.shadowColor = 'rgba(25, 22, 16, 0.28)';
  ctx.shadowBlur = s * 0.12;
  ctx.shadowOffsetY = s * 0.04;
  roundRectPath(cx - w / 2, cy - h / 2 + s * 0.06, w, h, s * 0.05);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.restore();

  roundRectPath(cx - w / 2, cy - h / 2 + s * 0.06, w, h, s * 0.05);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.8, s * 0.05);
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = color;
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(cx + i * s * 0.16 - s * 0.045, cy - h / 2 - s * 0.005, s * 0.09, s * 0.1);
  }
  ctx.restore();

  drawGlyph('哨', cx, cy + s * 0.035, s, color, 0.3);
  drawHpBar(cx, rect.y + rect.h - s * 0.15, s * 0.64, o.hp, o.maxHp);
  drawHpChip(rect, o.hp);
}

function drawUnitDecoration(u, cx, cy, size, s) {
  const angle = u.owner === RED ? -Math.PI / 4 : Math.PI * 0.75;

  if (u.type === 'tank' || u.type === 'artillery') {
    ctx.save();
    ctx.strokeStyle = 'rgba(44, 42, 38, 0.72)';
    ctx.lineWidth = Math.max(1.3, s * (u.type === 'tank' ? 0.07 : 0.05));
    ctx.lineCap = 'round';
    const inner = size * 0.1;
    const outer = size * (u.type === 'tank' ? 0.56 : 0.7);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
    ctx.restore();
  }

  if (u.type === 'atgun') {
    ctx.save();
    ctx.strokeStyle = 'rgba(44, 42, 38, 0.5)';
    ctx.lineWidth = Math.max(1.1, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.28, cy + size * 0.2);
    ctx.lineTo(cx, cy + size * 0.36);
    ctx.lineTo(cx + size * 0.28, cy + size * 0.2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawWheels(cx, cy, size, s) {
  const r = Math.max(1.4, s * 0.042);
  ctx.save();
  ctx.fillStyle = '#3a372f';
  for (const dx of [-size * 0.28, size * 0.28]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + size * 0.44, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDoneMark(rect, s) {
  ctx.save();
  ctx.strokeStyle = 'rgba(44, 42, 38, 0.55)';
  ctx.lineWidth = Math.max(1.4, s * 0.04);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const x = rect.x + rect.w - s * 0.16;
  const y = rect.y + s * 0.14;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.08, y);
  ctx.lineTo(x - s * 0.02, y + s * 0.055);
  ctx.lineTo(x + s * 0.085, y - s * 0.065);
  ctx.stroke();
  ctx.restore();
}

function unitTokenPath(u, cx, cy, size) {
  if (u.type === 'tank') {
    roundRectPath(cx - size / 2, cy - size / 2, size, size, size * 0.18);
  } else if (u.type === 'artillery') {
    polygonPath(cx, cy, size * 0.52, 6, Math.PI / 6);
  } else if (u.type === 'atgun') {
    diamondPath(cx, cy, size * 0.55);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  }
}

function drawUnit(u) {
  const rect = cellRect(u.x, u.y);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const s = layout.cell;
  const size = s * 0.66;
  const color = OWNER_CSS[u.owner];
  const light = OWNER_LIGHT[u.owner];
  const done = isUnitDone(u);

  ctx.save();
  if (done) ctx.globalAlpha = 0.62;

  ctx.save();
  ctx.shadowColor = 'rgba(25, 22, 16, 0.3)';
  ctx.shadowBlur = s * 0.1;
  ctx.shadowOffsetY = s * 0.045;
  unitTokenPath(u, cx, cy, size);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.restore();

  unitTokenPath(u, cx, cy, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.8, s * 0.055);
  ctx.stroke();

  if (u.motorized) {
    unitTokenPath(u, cx, cy, size * 1.12);
    ctx.strokeStyle = 'rgba(199, 149, 47, 0.82)';
    ctx.lineWidth = Math.max(1, s * 0.028);
    ctx.stroke();
  }

  drawUnitDecoration(u, cx, cy, size, s);

  ctx.font = `bold ${Math.max(9, Math.round(s * 0.36))}px "KaiTi", "STKaiti", "Kaiti SC", "Noto Serif SC", serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(UNIT_TYPES[u.type].short, cx, cy + s * 0.012);

  if (u.motorized) drawWheels(cx, cy, size, s);
  drawHpBar(cx, cy + size * 0.54, size * 0.9, u.hp, u.maxHp);
  if (done) drawDoneMark(rect, s);

  ctx.restore();
}

function drawSelectionRing(sel, now) {
  const rect = cellRect(sel.x, sel.y);
  const pulse = 0.5 + 0.5 * Math.sin(now / 260);

  ctx.save();
  ctx.strokeStyle = `rgba(207, 160, 52, ${0.72 + pulse * 0.24})`;
  ctx.lineWidth = Math.max(2, layout.cell * 0.06);
  ctx.setLineDash([layout.cell * 0.16, layout.cell * 0.1]);
  ctx.lineDashOffset = -now / 55;
  roundRectPath(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, 6);
  ctx.stroke();
  ctx.restore();
}

function drawSpawnOverlay(now) {
  if (!state || !state.buildMode) return;
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);

  for (const c of state.buildMode.cells) {
    const r = cellRect(c.x, c.y);
    ctx.save();
    ctx.fillStyle = `rgba(64, 132, 82, ${0.13 + pulse * 0.07})`;
    roundRectPath(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 5);
    ctx.fill();

    ctx.strokeStyle = `rgba(53, 118, 72, ${0.5 + pulse * 0.25})`;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(53, 118, 72, 0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const d = layout.cell * 0.11;
    ctx.moveTo(cx - d, cy);
    ctx.lineTo(cx + d, cy);
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx, cy + d);
    ctx.stroke();
    ctx.restore();
  }
}

function drawOverlays(now) {
  if (state.buildMode) drawSpawnOverlay(now);

  const sel = getSelected();
  if (!sel) return;

  const actions = getSelectedActions();
  const isStructure = sel.kind !== 'unit';

  for (const c of actions.moves) {
    const r = cellRect(c.x, c.y);
    ctx.save();
    ctx.fillStyle = 'rgba(54, 116, 158, 0.14)';
    roundRectPath(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(54, 116, 158, 0.34)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(54, 116, 158, 0.55)';
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.max(1.5, layout.cell * 0.045), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const atkFill = isStructure ? 'rgba(185, 125, 38, 0.07)' : 'rgba(176, 64, 48, 0.055)';
  const atkEdge = isStructure ? 'rgba(170, 112, 24, 0.3)' : 'rgba(160, 54, 40, 0.28)';

  for (const c of actions.attackCells) {
    const r = cellRect(c.x, c.y);
    ctx.save();
    ctx.fillStyle = atkFill;
    roundRectPath(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 4);
    ctx.fill();

    ctx.strokeStyle = atkEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  const pulse = 0.5 + 0.5 * Math.sin(now / 230);
  for (const t of actions.targets) {
    const r = cellRect(t.x, t.y);
    const inset = 2 + pulse * 2;
    ctx.save();
    ctx.strokeStyle = `rgba(172, 48, 38, ${0.55 + pulse * 0.35})`;
    ctx.lineWidth = Math.max(1.6, layout.cell * 0.05);
    roundRectPath(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, 5);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPreview() {
  for (const b of PREVIEW_BASES) drawBase(b);
  for (const o of PREVIEW_OUTPOSTS) drawOutpost(o);
}

function debugBoardSignature() {
  if (!state) return '';
  const parts = [];
  for (const u of state.units) {
    parts.push(`${u.id}:${u.owner}:${u.type}:${u.motorized ? 1 : 0}:${u.x},${u.y}:${u.hp}`);
  }
  for (const b of state.bases) parts.push(`B${b.owner}:${b.hp}`);
  for (const o of state.outposts) parts.push(`O${o.id}:${o.hp}`);
  return parts.join('|');
}

function getDebugControlMaps() {
  const viewer = state.mode === 'ai' ? BLUE : state.current;
  const sig = debugBoardSignature();

  if (!debugThreatCache || debugThreatCache.viewer !== viewer || debugThreatCache.sig !== sig) {
    debugThreatCache = {
      viewer,
      sig,
      own: buildFirepowerMap(viewer),
      enemy: buildFirepowerMap(1 - viewer),
    };
  }

  return debugThreatCache;
}

function drawDebugControlZones() {
  if (!state) return;
  const { own, enemy } = getDebugControlMaps();
  const showOwn = aiMemory.debug.showOwnControl;
  const showEnemy = aiMemory.debug.showEnemyControl;
  if (!showOwn && !showEnemy) return;

  const keys = new Set([...own.total.keys(), ...enemy.total.keys()]);
  const cap = 12;

  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    const r = cellRect(x, y);
    const ownPts = showOwn ? own.total.get(key) || 0 : 0;
    const enemyPts = showEnemy ? enemy.total.get(key) || 0 : 0;
    if (ownPts <= 0 && enemyPts <= 0) continue;

    const alpha = 0.05 + Math.min(1, (ownPts + enemyPts) / cap) * 0.28;

    ctx.save();
    roundRectPath(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 4);

    if (ownPts > 0 && enemyPts > 0) {
      const grd = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      grd.addColorStop(0, `rgba(47, 111, 158, ${Math.min(0.4, alpha + 0.04)})`);
      grd.addColorStop(1, `rgba(178, 58, 47, ${Math.min(0.4, alpha + 0.04)})`);
      ctx.fillStyle = grd;
    } else if (ownPts > 0) {
      ctx.fillStyle = `rgba(47, 111, 158, ${alpha})`;
    } else {
      ctx.fillStyle = `rgba(178, 58, 47, ${alpha})`;
    }
    ctx.fill();

    ctx.strokeStyle =
      ownPts > 0 && enemyPts > 0
        ? 'rgba(95, 76, 60, 0.18)'
        : ownPts > 0
        ? 'rgba(47, 111, 158, 0.24)'
        : 'rgba(178, 58, 47, 0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function formatControlPoints(value) {
  if (value >= 10) return String(Math.round(value));
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function drawControlChip(x, y, cell, text, color, align) {
  const fs = Math.max(7, Math.round(cell * 0.19));
  ctx.save();
  ctx.font = `bold ${fs}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + 6;
  const h = fs + 4;
  const px = align === 'left' ? x + 2 : x + cell - w - 2;
  const py = align === 'left' ? y + 2 : y + cell - h - 2;

  roundRectPath(px, py, w, h, 3);
  ctx.fillStyle = 'rgba(250, 246, 236, 0.9)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + w / 2, py + h / 2 + 0.5);
  ctx.restore();
}

function drawDebugControlNumbers() {
  if (!state) return;
  const showOwn = aiMemory.debug.showOwnControl;
  const showEnemy = aiMemory.debug.showEnemyControl;
  if (!showOwn && !showEnemy) return;
  if (layout.cell < 24) return;

  const { own, enemy } = getDebugControlMaps();
  const keys = new Set([...own.total.keys(), ...enemy.total.keys()]);

  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    const r = cellRect(x, y);
    const ownPts = showOwn ? own.total.get(key) || 0 : 0;
    const enemyPts = showEnemy ? enemy.total.get(key) || 0 : 0;

    if (ownPts > 0) {
      drawControlChip(r.x, r.y, layout.cell, formatControlPoints(ownPts), '#2f6f9e', 'left');
    }
    if (enemyPts > 0) {
      drawControlChip(r.x, r.y, layout.cell, formatControlPoints(enemyPts), '#b23a2f', 'right');
    }
  }
}

function drawHover() {
  if (!hoverCell || !state || state.gameOver) return;

  const rect = cellRect(hoverCell.x, hoverCell.y);
  const actionable = isActionable(hoverCell.x, hoverCell.y);

  ctx.save();
  ctx.strokeStyle = actionable ? 'rgba(30, 30, 25, 0.58)' : 'rgba(30, 30, 25, 0.18)';
  ctx.lineWidth = actionable ? 2 : 1;
  roundRectPath(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 4);
  ctx.stroke();
  ctx.restore();
}

function drawEffects(now) {
  effects = effects.filter((e) => now - e.t0 < e.dur);

  for (const e of effects) {
    const progress = Math.max(0, Math.min(1, (now - e.t0) / e.dur));

    if (e.type === 'shot') {
      const a = cellCenter(e.from.x, e.from.y);
      const b = cellCenter(e.to.x, e.to.y);

      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#2c2a26';
      ctx.lineWidth = Math.max(1.6, layout.cell * 0.045);
      ctx.setLineDash([layout.cell * 0.12, layout.cell * 0.08]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = '#d9a52f';
      ctx.beginPath();
      ctx.arc(a.x, a.y, layout.cell * 0.075 * (1 - progress * 0.4), 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(172, 48, 38, ${1 - progress})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, layout.cell * (0.08 + progress * 0.3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'float') {
      const c = cellCenter(e.x, e.y);
      const yy = c.y - layout.cell * 0.12 - layout.cell * 0.55 * progress;

      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.font = `bold ${Math.max(10, Math.round(layout.cell * 0.32))}px "KaiTi", "STKaiti", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(248, 241, 224, 0.9)';
      ctx.strokeText(e.text, c.x, yy);
      ctx.fillStyle = e.color || '#a5352b';
      ctx.fillText(e.text, c.x, yy);
      ctx.restore();
    } else if (e.type === 'dust') {
      const c = cellCenter(e.x, e.y);

      ctx.save();
      ctx.globalAlpha = (1 - progress) * 0.45;
      ctx.strokeStyle = '#8b7a58';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const r = layout.cell * (0.08 + progress * 0.18 + i * 0.04);
        ctx.beginPath();
        ctx.arc(c.x + (i - 1) * layout.cell * 0.1, c.y + layout.cell * 0.2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function render(now) {
  if (simulationMode) return;
  if (!ctx || !layout.w) return;

  const { w, h, pad, cell } = layout;
  const bx = pad;
  const by = pad;
  const size = cell * SIZE;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  grd.addColorStop(1, 'rgba(160, 136, 88, 0.12)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = '#fbf4e2';
  ctx.fillRect(bx, by, size, size);
  ctx.restore();

  drawGrid(bx, by, cell);
  drawCoords(bx, by, cell);

  if (state) {
    if (
      aiMemory.debug.enabled &&
      (aiMemory.debug.showEnemyControl || aiMemory.debug.showOwnControl) &&
      !state.gameOver
    ) {
      drawDebugControlZones();
    }

    drawOverlays(now);
    for (const b of state.bases) {
      if (b.hp > 0) drawBase(b);
    }
    for (const o of state.outposts) {
      if (o.hp > 0) drawOutpost(o);
    }

    const units = state.units.slice().sort((a, b) => b.y - a.y);
    for (const u of units) drawUnit(u);

    const sel = getSelected();
    if (sel) drawSelectionRing(sel, now);

    if (
      aiMemory.debug.enabled &&
      (aiMemory.debug.showEnemyControl || aiMemory.debug.showOwnControl) &&
      !state.gameOver
    ) {
      drawDebugControlNumbers();
    }

    drawEffects(now);
  } else {
    drawPreview();
  }

  drawHover();
}

function loop(now) {
  render(now);
  requestAnimationFrame(loop);
}

/* ============================================================
   启动与事件
   ============================================================ */

function cacheDom() {
  canvas = document.getElementById('board');
  ctx = canvas.getContext('2d');

  dom = {
    startOverlay: document.getElementById('startOverlay'),
    rulesOverlay: document.getElementById('rulesOverlay'),
    gameOverOverlay: document.getElementById('gameOverOverlay'),
    rulesBtn: document.getElementById('rulesBtn'),
    rulesCloseBtn: document.getElementById('rulesCloseBtn'),
    startRulesBtn: document.getElementById('startRulesBtn'),
    againBtn: document.getElementById('againBtn'),
    changeModeBtn: document.getElementById('changeModeBtn'),
    viewBoardBtn: document.getElementById('viewBoardBtn'),
    endTurnBtn: document.getElementById('endTurnBtn'),
    restartBtn: document.getElementById('restartBtn'),
    turnBanner: document.getElementById('turnBanner'),
    turnText: document.getElementById('turnText'),
    modeLabel: document.getElementById('modeLabel'),
    pointsText: document.getElementById('pointsText'),
    pointsPips: document.getElementById('pointsPips'),
    buildGrid: document.getElementById('buildGrid'),
    infoPanel: document.getElementById('infoPanel'),
    logPanel: document.getElementById('logPanel'),
    endTitle: document.getElementById('endTitle'),
    endEyebrow: document.getElementById('endEyebrow'),
    endText: document.getElementById('endText'),
    debugBtn: document.getElementById('debugBtn'),
    debugOverlay: document.getElementById('debugOverlay'),
    debugCloseBtn: document.getElementById('debugCloseBtn'),
    debugEnabledToggle: document.getElementById('debugEnabledToggle'),
    debugEnemyControlToggle: document.getElementById('debugEnemyControlToggle'),
    debugOwnControlToggle: document.getElementById('debugOwnControlToggle'),
    debugStats: document.getElementById('debugStats'),
    debugTrainBtn: document.getElementById('debugTrainBtn'),
    debugResetBtn: document.getElementById('debugResetBtn'),
    debugClearBtn: document.getElementById('debugClearBtn'),
    debugExportBtn: document.getElementById('debugExportBtn'),
    debugImportBtn: document.getElementById('debugImportBtn'),
    debugImportInput: document.getElementById('debugImportInput'),
    debugTrainStatus: document.getElementById('debugTrainStatus'),
    debugDecision: document.getElementById('debugDecision'),
    debugStrategyJson: document.getElementById('debugStrategyJson'),
    debugObserverToggle: document.getElementById('debugObserverToggle'),
    chessTrainBtn: document.getElementById('chessTrainBtn'),
    chessClearBtn: document.getElementById('chessClearBtn'),
    chessTrainStatus: document.getElementById('chessTrainStatus'),
    debugChessStats: document.getElementById('debugChessStats'),
    debugLearnPlayerToggle: document.getElementById('debugLearnPlayerToggle'),
    playerLearnClearBtn: document.getElementById('playerLearnClearBtn'),
    playerLearnStats: document.getElementById('playerLearnStats'),
    mobileBar: document.getElementById('mobileBar'),
    mobileEndTurnBtn: document.getElementById('mobileEndTurnBtn'),
    observerBar: document.getElementById('observerBar'),
    observerText: document.getElementById('observerText'),
    observerEconomy: document.getElementById('observerEconomy'),
    observerStopBtn: document.getElementById('observerStopBtn'),
  };

  dom.pointsPips.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    dom.pointsPips.appendChild(pip);
  }
}

function openRules() {
  show(dom.rulesOverlay);
}

function closeRules() {
  hide(dom.rulesOverlay);
}

function showStartScreen() {
  if (observerMatchInProgress) return;
  gameToken++;
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  stopBgm();
  if (state) {
    state.aiThinking = false;
    state.selected = null;
    state.buildMode = null;
    const radio = document.querySelector(
      `input[name="difficulty"][value="${state.difficulty === 'hard' ? 'hard' : 'normal'}"]`
    );
    if (radio) radio.checked = true;
  }
  hoverCell = null;
  hide(dom.gameOverOverlay);
  hide(dom.rulesOverlay);
  hide(dom.debugOverlay);
  show(dom.startOverlay);
  updateUI();
}

function setupEvents() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const checked = document.querySelector('input[name="difficulty"]:checked');
      newGame(btn.dataset.mode, checked ? checked.value : 'normal');
    });
  });

  dom.rulesBtn.addEventListener('click', openRules);
  dom.startRulesBtn.addEventListener('click', openRules);
  dom.rulesCloseBtn.addEventListener('click', closeRules);
  dom.rulesOverlay.addEventListener('click', (ev) => {
    if (ev.target === dom.rulesOverlay) closeRules();
  });

  dom.debugBtn.addEventListener('click', openDebug);
  dom.debugCloseBtn.addEventListener('click', closeDebug);
  dom.debugOverlay.addEventListener('click', (ev) => {
    if (ev.target === dom.debugOverlay) closeDebug();
  });
  dom.debugEnabledToggle.addEventListener('change', () => {
    aiMemory.debug.enabled = dom.debugEnabledToggle.checked;
    saveAiMemory();
    debugThreatCache = null;
    updateDebugUI();
  });
  dom.debugEnemyControlToggle.addEventListener('change', () => {
    aiMemory.debug.showEnemyControl = dom.debugEnemyControlToggle.checked;
    saveAiMemory();
    debugThreatCache = null;
    updateDebugUI();
  });
  dom.debugOwnControlToggle.addEventListener('change', () => {
    aiMemory.debug.showOwnControl = dom.debugOwnControlToggle.checked;
    saveAiMemory();
    debugThreatCache = null;
    updateDebugUI();
  });
  dom.debugTrainBtn.addEventListener('click', runAiTraining);
  dom.chessTrainBtn.addEventListener('click', runChessTraining);
  dom.chessClearBtn.addEventListener('click', clearChessStats);
  dom.debugResetBtn.addEventListener('click', resetAiStrategy);
  dom.debugClearBtn.addEventListener('click', clearAiStrategy);
  dom.debugExportBtn.addEventListener('click', exportAiMemory);
  dom.debugImportBtn.addEventListener('click', () => dom.debugImportInput.click());
  dom.debugImportInput.addEventListener('change', importAiMemoryFile);
  dom.debugObserverToggle.addEventListener('change', () => {
    aiMemory.debug.observer = dom.debugObserverToggle.checked;
    saveAiMemory();
    updateDebugUI();
    setTrainStatus(
      aiMemory.debug.observer
        ? '观察者模式：点击“播放 AI 对战”观看 1 局演示。'
        : '已关闭观察者模式。'
    );
  });

  if (dom.debugLearnPlayerToggle) {
    dom.debugLearnPlayerToggle.addEventListener('change', () => {
      aiMemory.debug.learnFromPlayer = dom.debugLearnPlayerToggle.checked;
      playerLearningSession = null;
      if (aiMemory.debug.learnFromPlayer) beginPlayerLearningSession();
      saveAiMemory();
      updateDebugUI();
    });
  }
  if (dom.playerLearnClearBtn) {
    dom.playerLearnClearBtn.addEventListener('click', clearPlayerLearning);
  }
  dom.observerStopBtn.addEventListener('click', stopObserverMatch);

  dom.endTurnBtn.addEventListener('click', endTurnHuman);
  if (dom.mobileEndTurnBtn) {
    dom.mobileEndTurnBtn.addEventListener('click', endTurnHuman);
  }

  // 手机浏览器可能在首次手势后才允许播放音频
  document.addEventListener(
    'pointerdown',
    () => {
      if (!bgmRequested || !bgm || !bgm.paused) return;
      try {
        const p = bgm.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (err) {
        // ignore
      }
    },
    { passive: true }
  );

  dom.restartBtn.addEventListener('click', () => {
    if (observerMatchInProgress) return;
    if (state && !state.gameOver && !window.confirm('重新开局？当前进度会丢失。')) return;
    showStartScreen();
  });

  dom.againBtn.addEventListener('click', () => {
    const mode = state ? state.mode : 'pvp';
    const difficulty = state ? state.difficulty : 'normal';
    hide(dom.gameOverOverlay);
    newGame(mode, difficulty);
  });

  dom.changeModeBtn.addEventListener('click', showStartScreen);
  dom.viewBoardBtn.addEventListener('click', () => hide(dom.gameOverOverlay));

  dom.buildGrid.querySelectorAll('.build-card').forEach((card) => {
    const type = card.dataset.type;
    const main = card.querySelector('.build-main');
    const moto = card.querySelector('input[data-moto]');

    main.addEventListener('click', () => {
      beginBuild(type, !!(moto && moto.checked));
    });

    if (moto) {
      moto.addEventListener('change', updateUI);
    }
  });

  dom.infoPanel.addEventListener('click', (ev) => {
    if (ev.target.closest('#cancelBuildBtn')) {
      if (state) state.buildMode = null;
      updateUI();
    }
  });

  canvas.addEventListener('mousemove', (ev) => {
    hoverCell = cellFromPointer(ev);
    updateCursor();
  });

  canvas.addEventListener('mouseleave', () => {
    hoverCell = null;
    updateCursor();
  });

  canvas.addEventListener('click', (ev) => {
    const cell = cellFromPointer(ev);
    if (cell) onBoardClick(cell.x, cell.y);
  });

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (!state) return;
    if (state.buildMode) state.buildMode = null;
    else state.selected = null;
    updateUI();
  });

  document.addEventListener('keydown', (ev) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';

    if (ev.key === 'Escape') {
      if (observerMatchInProgress) {
        stopObserverMatch();
        return;
      }
      if (!dom.debugOverlay.classList.contains('hidden')) {
        closeDebug();
        return;
      }
      if (!dom.rulesOverlay.classList.contains('hidden')) {
        closeRules();
        return;
      }
      if (!dom.gameOverOverlay.classList.contains('hidden')) {
        hide(dom.gameOverOverlay);
        return;
      }
      if (state) {
        if (state.buildMode) state.buildMode = null;
        else state.selected = null;
        updateUI();
      }
      return;
    }

    if (ev.key === 'Enter') {
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
      if (observerMatchInProgress) return;
      if (!dom.debugOverlay.classList.contains('hidden')) return;
      if (!dom.rulesOverlay.classList.contains('hidden')) return;
      if (!dom.startOverlay.classList.contains('hidden')) return;
      if (!dom.gameOverOverlay.classList.contains('hidden')) return;
      endTurnHuman();
    }
  });

  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) {
    new ResizeObserver(() => resizeCanvas()).observe(document.getElementById('boardWrap'));
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function init() {
  cacheDom();
  initAudio();
  setupEvents();
  registerServiceWorker();
  resizeCanvas();
  updateUI();
  show(dom.startOverlay);
  requestAnimationFrame(loop);
  requestAnimationFrame(resizeCanvas);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
