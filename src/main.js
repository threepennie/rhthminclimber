const canvas = document.querySelector("#game");
const screenCtx = canvas.getContext("2d");
const pixelScale = 1;
const pixelGrid = 2;
const pixelOutlineWidth = 3;
const pixelCanvas = typeof document.createElement === "function" ? document.createElement("canvas") : canvas;
if (pixelCanvas !== canvas) {
  pixelCanvas.width = Math.ceil(canvas.width / pixelScale);
  pixelCanvas.height = Math.ceil(canvas.height / pixelScale);
}
const rawCtx = pixelCanvas.getContext("2d");
let suppressPixelText = false;
const snapToPixelGrid = (value) => Math.round(value / pixelGrid) * pixelGrid;
const pixelCoordinateMethods = new Set([
  "fillRect", "strokeRect", "clearRect", "moveTo", "lineTo", "translate", "quadraticCurveTo",
]);
const ctx = new Proxy(rawCtx, {
  get(target, property) {
    const value = target[property];
    if (typeof value !== "function") return value;
    if (pixelCoordinateMethods.has(property)) {
      return (...args) => value.apply(target, args.map((arg) => typeof arg === "number" ? snapToPixelGrid(arg) : arg));
    }
    if (property === "arc") {
      return (x, y, radius, startAngle, endAngle, counterclockwise) => target.arc(
        snapToPixelGrid(x), snapToPixelGrid(y), Math.max(pixelGrid, snapToPixelGrid(radius)),
        startAngle, endAngle, counterclockwise,
      );
    }
    if (property === "ellipse") {
      return (x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise) => target.ellipse(
        snapToPixelGrid(x), snapToPixelGrid(y), Math.max(pixelGrid, snapToPixelGrid(radiusX)),
        Math.max(pixelGrid, snapToPixelGrid(radiusY)), rotation, startAngle, endAngle, counterclockwise,
      );
    }
    if (property === "fillText" || property === "strokeText") {
      return (text, x, y, maxWidth) => {
        if (!suppressPixelText) value.call(target, text, snapToPixelGrid(x), snapToPixelGrid(y), maxWidth);
      };
    }
    return value.bind(target);
  },
  set(target, property, value) {
    target[property] = property === "lineWidth" ? Math.max(pixelOutlineWidth, snapToPixelGrid(value)) : value;
    return true;
  },
});
ctx.imageSmoothingEnabled = false;
screenCtx.imageSmoothingEnabled = false;
if (pixelCanvas !== canvas && typeof ctx.setTransform === "function") {
  ctx.setTransform(1 / pixelScale, 0, 0, 1 / pixelScale, 0, 0);
}
const teaser = document.querySelector("#teaser");
const birdBriefingSprite = document.querySelector("#birdBriefing");

function presentPixelFrame() {
  if (pixelCanvas === canvas) return;
  screenCtx.imageSmoothingEnabled = false;
  screenCtx.clearRect(0, 0, canvas.width, canvas.height);
  screenCtx.drawImage(pixelCanvas, 0, 0, canvas.width, canvas.height);
}

const ui = {
  height: document.querySelector("#height"),
  score: document.querySelector("#score"),
  lives: document.querySelector("#lives"),
  combo: document.querySelector("#combo"),
  beatJudge: document.querySelector("#beatJudge"),
  pad: document.querySelector("#padStatus"),
};

const cols = 8;
const rowsOnScreen = 15;
const cellW = canvas.width / cols;
const cellH = 42;
const buildingX = 96;
const buildingW = 768;
const colW = buildingW / cols;
const windowW = 66;
const windowH = 36;
const windowFrame = 3;
const dead = 0.45;
const bpm = 116;
const openingBpm = 132;
const openingMelody = [523.25, 659.25, 783.99, 1046.5, 880, 783.99, 659.25, 587.33,
  523.25, 659.25, 783.99, 880, 698.46, 659.25, 587.33, 493.88];
const openingBass = [130.81, 110, 174.61, 196];
const stageBriefingDuration = 1.5;
const briefingShirtRed = "#c83f3a";
const startFanfareDuration = 2.4;
const rooftopScoreStart = 14;
const rooftopScoreDuration = 1.5;
const startFanfareMelody = [392, 523.25, 659.25, 783.99, 1046.5];
const gameOverMelody = [392, 349.23, 293.66, 261.63];
const beatMs = 60000 / bpm;
const audioMix = { bgm: 0.9, voice: 0.18, sfx: 1 };
const voiceAdvanceSeconds = 0.04;
const activeVoiceGains = new Set();
const activeVoices = new Set();
let successZoomTimes = [];
let hiPopTimes = [];

function successZoomScale() {
  if (!state.music.context) return 1;
  const now = state.music.context.currentTime;
  successZoomTimes = successZoomTimes.filter((time) => now - time < 0.3);
  let pulse = 0;
  for (const time of successZoomTimes) {
    const age = now - time;
    if (age >= -0.000001) pulse = Math.max(pulse, Math.pow(1 - Math.max(0, age) / 0.3, 2));
  }
  return 1 + pulse * 0.05;
}

function stageHeightLabel() {
  return `${Math.min(state.height, state.stageTarget)}/${state.stageTarget}F`;
}

function setAudioVolume(channel, value) {
  audioMix[channel] = Math.max(0, Math.min(1, Number(value)));
  if (channel === "bgm" && state.music.master) {
    state.music.master.gain.value = audioMix.bgm;
  }
  if (channel === "voice") {
    for (const gain of activeVoiceGains) gain.gain.value = audioMix.voice;
  }
  if (channel === "sfx" && state.music.sfx) {
    state.music.sfx.gain.value = audioMix.sfx;
  }
}
const windowBalance = {
  stages: {
    1: { baseOpenChance: 0.995, minimumOpenChance: 0.92 },
    2: { baseOpenChance: 0.965, minimumOpenChance: 0.88 },
    3: { baseOpenChance: 0.935, minimumOpenChance: 0.84 },
    4: { baseOpenChance: 0.905, minimumOpenChance: 0.80 },
    5: { baseOpenChance: 0.875, minimumOpenChance: 0.76 },
    6: { baseOpenChance: 0.845, minimumOpenChance: 0.72 },
  },
  laterStageDrop: { baseOpenChance: 0.025, minimumOpenChance: 0.035 },
  minimumBaseOpenChance: 0.69,
  minimumOpenChance: 0.28,
  difficultyRows: 48,
  stageRows: 10,
};
const towelAndDumbbellStartStage = 2;
const sniperStartStage = 5;
const tysonStartStage = 6;
const tysonJabFrameDuration = 0.12;
const tysonLanes = {
  left: { columns: [1, 2], punchFromCol: 2, direction: 1 },
  right: { columns: [5, 6], punchFromCol: 5, direction: -1 },
};
const tysonBlockBottomByStage = { 6: 40 };
const sniperTestChance = 0.16;
const sniperAimAge = 1;
const sniperFireAge = 2.5;
const technoBass = [55, 55, 65.41, 55, 49, 49, 65.41, 73.42];
const technoStab = [220, 0, 261.63, 0, 196, 0, 293.66, 0, 220, 0, 261.63, 0, 196, 0, 329.63, 0];
const stageHazardBriefingMap = {
  1: [{ id: "vase", label: "TRANSFORMER" }, { id: "beam", label: "REINFORCEMENT" }],
  2: [{ id: "shirt", label: "CABLE BUNDLE" }, { id: "dumbbell", label: "TOOL MODULE" }],
  3: [{ id: "bird", label: "PATROL DRONE" }, { id: "pinkBeam", label: "REBOUND FRAME" }],
  4: [{ id: "wind", label: "EXHAUST DRAFT" }],
  5: [{ id: "sniper", label: "SENTINEL TURRET" }],
  6: [{ id: "tyson", label: "HYDRAULIC ARM" }],
};

function stageHazardBriefings(stage) {
  return stageHazardBriefingMap[stage] || [];
}

const state = {
  mode: "teaser",
  fall: { time: 0, recoveryHeight: 5 },
  rooftop: { time: 0, speed: 1 },
  briefing: { time: 0 },
  intro: { time: 0, fanfareScheduled: false },
  stageClear: { time: 0 },
  gameOverScheduled: false,
  titleInputLock: 0,
  restartHeld: false,
  startKeyPressed: false,
  menuKeyPressed: false,
  stage: 1,
  stageStartHeight: 0,
  stageTarget: 50,
  descentLocked: true,
  neutralTime: 0,
  score: 0,
  stagePenalty: 0,
  stageDamaged: false,
  sluggishMoves: 0,
  inputBlockEvents: 0,
  wind: { timeUntil: 5, warning: 0, direction: 0, active: 0 },
  height: 0,
  lives: 3,
  combo: 0,
  beatJudge: "---",
  beatFlash: 0,
  judgementAge: 0,
  scorePop: { time: 0, value: 0 },
  feverPop: { time: 0 },
  lastRhythmBeat: null,
  rhythmBonus: 0,
  camera: 0,
  shake: 0,
  slipTimer: 0,
  splatTimer: 0,
  message: "PRESS A / START / SPACE",
  climber: {
    col: 4,
    row: 1,
    hurtTimer: 0,
    freezeTimer: 0,
  },
  hands: {
    left: { col: 4, row: 1, cooldown: 0, ready: true, upBuffer: 0, color: "#f0c64a" },
    right: { col: 4, row: 1, cooldown: 0, ready: true, upBuffer: 0, color: "#7dc6ff" },
  },
  obstacles: [],
  birds: [],
  residents: [],
  towels: [],
  snipers: [],
  tysons: [],
  shotMarks: [],
  windows: new Map(),
  escapeWindow: null,
  keys: new Set(),
  lastTime: 0,
  spawnTimer: 0,
  fallingSoundTimers: { beam: 0, dumbbell: 0, vase: 0 },
  music: {
    context: null,
    master: null,
    sfx: null,
    timer: null,
    startedAt: 0,
    nextBeat: 0,
    beatIndex: 0,
    running: false,
  },
};

function ensureMusic() {
  if (state.music.context) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = audioMix.bgm;
  master.connect(context.destination);
  const sfx = context.createGain();
  sfx.gain.value = audioMix.sfx;
  sfx.connect(context.destination);
  state.music.context = context;
  state.music.master = master;
  state.music.sfx = sfx;
  prepareClimbVoice();
}

function playTone(time, frequency, duration, gainValue, type = "square") {
  const context = state.music.context;
  if (!context || !state.music.master) return;

  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(gainValue, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(state.music.master);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function playEffectSweep(frequencyStart, frequencyEnd, duration, gainValue, type = "square", offset = 0) {
  const context = state.music.context;
  if (!context || !(state.music.sfx || state.music.master) || !context.createOscillator || !context.createGain) return;

  const time = context.currentTime + offset;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequencyStart, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, frequencyEnd), time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(gainValue, time + 0.012);
  gain.gain.setValueAtTime(gainValue, time + duration * 0.82);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(state.music.sfx || state.music.master);
  osc.start(time);
  osc.stop(time + duration + 0.025);
}

function playEffectTone(offset, frequency, duration, gainValue, type = "square") {
  const context = state.music.context;
  if (!context || !(state.music.sfx || state.music.master) || !context.createOscillator || !context.createGain) return;

  const time = context.currentTime + offset;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(gainValue, time + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(state.music.sfx || state.music.master);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function playSniperCharge() {
  const duration = sniperFireAge - sniperAimAge - 0.04;
  playEffectSweep(420, 1380, duration, 0.38, "sawtooth");
  playEffectSweep(680, 1680, duration, 0.17, "square");
}

function playSniperShot() {
  playEffectSweep(2800, 300, 0.13, 0.62, "square");
  playEffectSweep(150, 52, 0.24, 0.34, "sawtooth");
}

function fallingSoundOffset() {
  const context = state.music.context;
  if (!context || !state.music.running) return 0;
  const halfBeat = 30 / bpm;
  const elapsed = Math.max(0, context.currentTime - state.music.startedAt);
  return Math.max(0, Math.ceil((elapsed + 0.008) / halfBeat) * halfBeat - elapsed);
}

function playBeamDropSound() {
  const offset = fallingSoundOffset();
  playEffectSweep(220, 196, 0.16, 0.11, "triangle", offset);
  playEffectSweep(440, 330, 0.12, 0.045, "sine", offset);
}

function playPinkBeamBounce() {
  playEffectSweep(520, 920, 0.1, 0.13, "square");
  playEffectSweep(860, 470, 0.15, 0.09, "triangle");
}

function playDumbbellFallSound() {
  const offset = fallingSoundOffset();
  playEffectSweep(164.81, 130.81, 0.17, 0.055, "triangle", offset);
  playEffectSweep(329.63, 261.63, 0.12, 0.02, "sine", offset);
}

function playVaseFallSound() {
  const offset = fallingSoundOffset();
  playEffectSweep(659.25, 523.25, 0.13, 0.085, "triangle", offset);
  playEffectSweep(392, 329.63, 0.11, 0.035, "sine", offset);
}

function playBirdFlightMelody() {
  playEffectTone(0, 988, 0.1, 0.13, "square");
  playEffectTone(0.13, 1319, 0.1, 0.12, "square");
  playEffectTone(0.26, 1568, 0.14, 0.11, "triangle");
}

function playPoopDropSound() {
  playEffectSweep(180, 48, 0.15, 0.2, "sawtooth");
  playEffectSweep(520, 170, 0.09, 0.07, "triangle");
}

function playNoise(time, duration, gainValue) {
  const context = state.music.context;
  if (!context || !state.music.master) return;

  const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "highpass";
  filter.frequency.value = 2400;
  gain.gain.setValueAtTime(gainValue, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  noise.buffer = buffer;
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(state.music.master);
  noise.start(time);
}

function playKick(time, strong = false) {
  const context = state.music.context;
  if (!context || !state.music.master) return;

  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(strong ? 154 : 132, time);
  osc.frequency.exponentialRampToValueAtTime(47, time + 0.12);
  gain.gain.setValueAtTime(strong ? 0.58 : 0.46, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
  osc.connect(gain);
  gain.connect(state.music.master);
  osc.start(time);
  osc.stop(time + 0.19);

  // A short beater attack makes every bass drum hit audible on small speakers.
  const attack = context.createOscillator();
  const attackGain = context.createGain();
  attack.type = "triangle";
  attack.frequency.setValueAtTime(strong ? 920 : 720, time);
  attack.frequency.exponentialRampToValueAtTime(130, time + 0.026);
  attackGain.gain.setValueAtTime(strong ? 0.16 : 0.11, time);
  attackGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.032);
  attack.connect(attackGain);
  attackGain.connect(state.music.master);
  attack.start(time);
  attack.stop(time + 0.04);
}

function playClick(time, strong = false) {
  playTone(time, strong ? 1760 : 1320, 0.018, strong ? 0.16 : 0.11, "square");
  playNoise(time, 0.014, strong ? 0.11 : 0.075);
}

function playTechnoBass(time, frequency, duration = 0.12) {
  const context = state.music.context;
  if (!context || !state.music.master) return;

  const osc = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(frequency, time);
  filter.type = "lowpass";
  filter.Q.value = 7;
  filter.frequency.setValueAtTime(680, time);
  filter.frequency.exponentialRampToValueAtTime(150, time + duration);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.075, time + 0.009);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(state.music.master);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function playHat(time, open = false) {
  const context = state.music.context;
  if (!context || !state.music.master) return;

  const duration = open ? 0.13 : 0.035;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = open ? 5200 : 6800;
  gain.gain.setValueAtTime(open ? 0.04 : 0.018, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(state.music.master);
  source.start(time);
}

function scheduleOpeningBeat(time, beatIndex) {
  const step = beatIndex % 16;
  const half = 30 / openingBpm;
  const bass = openingBass[Math.floor(step / 4)];
  playTone(time, openingMelody[step], 0.16, 0.11, "square");
  playTone(time + half, openingMelody[(step + 2) % 16] * 0.5, 0.09, 0.045, "square");
  playTone(time, bass, 0.26, 0.16, "triangle");
  if (step % 4 === 0) playTone(time, openingMelody[step] * 1.5, 0.2, 0.035, "triangle");
  playHat(time + half, false);
}

function scheduleStartFanfare(time) {
  startFanfareMelody.forEach((frequency, index) => {
    const at = time + index * 0.3;
    playTone(at, frequency, 0.24, 0.15, "square");
    playTone(at, frequency * 0.5, 0.34, 0.1, "triangle");
  });
  playTone(time + 1.5, 1046.5, 0.7, 0.18, "square");
  playTone(time + 1.5, 523.25, 0.85, 0.13, "triangle");
  playKick(time + 1.5, true);
  playClick(time + 1.5, true);
  playKick(time + 2.1, true);
  playClick(time + 2.1, true);
}

function scheduleGameOverMusic() {
  const context = state.music.context;
  if (!context || state.gameOverScheduled) return;
  state.gameOverScheduled = true;
  const start = context.currentTime + 0.05;
  gameOverMelody.forEach((frequency, index) => {
    playTone(start + index * 0.22, frequency, 0.2, 0.18, "square");
  });
  playTone(start + 0.95, 130.81, 0.5, 0.14, "triangle");
}

function scheduleBeat() {
  const music = state.music;
  const context = music.context;
  if (!context || !music.running) return;
  if (state.mode === "falling") return;
  if (state.mode === "briefing") return;

  while (music.nextBeat < context.currentTime + 0.14) {
    if (state.mode === "title") {
      scheduleOpeningBeat(music.nextBeat, music.beatIndex);
      music.nextBeat += 60 / openingBpm;
      music.beatIndex += 1;
      continue;
    }
    if (state.mode === "intro") {
      if (!state.intro.fanfareScheduled) {
        state.intro.fanfareScheduled = true;
        state.intro.startedAt = music.nextBeat;
        scheduleStartFanfare(music.nextBeat);
      }
      music.nextBeat += 60 / bpm;
      music.beatIndex += 1;
      continue;
    }
    const step = music.beatIndex % technoStab.length;
    const bassStep = music.beatIndex % technoBass.length;
    const strong = music.beatIndex % 4 === 0;
    const halfBeat = 30 / bpm;
    const offbeat = music.nextBeat + halfBeat;

    // Keep the scored beat prominent; accompaniment leaves space for the voice.
    playKick(music.nextBeat, strong);
    playClick(music.nextBeat, strong);
    playTechnoBass(music.nextBeat + 0.035, technoBass[bassStep], 0.12);
    playHat(offbeat, false);
    if (technoStab[step]) {
      playTone(music.nextBeat + 0.035, technoStab[step], 0.15, 0.09, "square");
      playTone(music.nextBeat + 0.035, technoStab[step] * 1.5, 0.12, 0.045, "triangle");
    }
    music.nextBeat += 60 / bpm;
    music.beatIndex += 1;
  }
}

function startMusic() {
  ensureMusic();
  const music = state.music;
  if (!music.context) return;

  Promise.all([music.context.resume(), prepareClimbVoice()]).then(() => {
    if (music.context.state !== "running") return;
    if (state.mode === "briefing") return;
    document.querySelector("#openingMusic").hidden = true;
    if (music.running) return;
    music.running = true;
    music.nextBeat = music.context.currentTime + 0.12;
    music.startedAt = music.nextBeat;
    music.beatIndex = 0;
    scheduleBeat();
    music.timer = window.setInterval(scheduleBeat, 45);
  }).catch(() => {});
}

function stopMusic() {
  cancelClimbVoices();
  if (state.music.timer) window.clearInterval(state.music.timer);
  state.music.timer = null;
  state.music.running = false;
}

function rhythmElapsedMs() {
  return (state.music.context.currentTime - state.music.startedAt) * 1000;
}

function rhythmMultiplier() {
  return Math.min(4, 1 + Math.floor(state.combo / 4));
}

let hiRecording = null;
let hiLoading = null;

function prepareClimbVoice() {
  const context = state.music.context;
  if (!context || hiRecording) return;
  if (hiLoading) return hiLoading;
  hiLoading = fetch("assets/audio/hi.wav")
    .then((response) => {
      if (!response.ok) throw new Error("Hi recording could not be loaded");
      return response.arrayBuffer();
    })
    .then((bytes) => context.decodeAudioData(bytes))
    .then((buffer) => { hiRecording = buffer; })
    .catch((error) => { console.warn(error); })
    .finally(() => { hiLoading = null; });
  return hiLoading;
}

function playBeatVoice(time) {
  if (!hiRecording || !state.music.context) return;
  const context = state.music.context;
  const voice = context.createBufferSource();
  voice.buffer = hiRecording;
  const gain = context.createGain();
  gain.gain.value = audioMix.voice;
  activeVoiceGains.add(gain);
  activeVoices.add(voice);
  voice.onended = () => {
    activeVoices.delete(voice);
    activeVoiceGains.delete(gain);
    voice.disconnect();
    gain.disconnect();
  };
  voice.connect(gain);
  gain.connect(context.destination);
  const startsAt = Math.max(context.currentTime, time - voiceAdvanceSeconds);
  voice.start(startsAt);
  successZoomTimes.push(startsAt);
  hiPopTimes.push(startsAt);
}

function cancelClimbVoices() {
  successZoomTimes = [];
  hiPopTimes = [];
  for (const voice of activeVoices) voice.stop();
  activeVoices.clear();
}

function playClimbVoice(beat) {
  if (beat && beat.bonus <= 0) return;
  if (![4, 6, 8].includes(state.combo) && state.combo < 9) return;
  const music = state.music;
  if (!music.context) return;
  if (!music.running) {
    playBeatVoice(music.context.currentTime + voiceAdvanceSeconds);
    return;
  }
  const beatSeconds = 60 / bpm;
  const inputBeat = Math.round((music.context.currentTime - music.startedAt) / beatSeconds);
  playBeatVoice(music.startedAt + (inputBeat + 1) * beatSeconds);
}

function judgeBeat() {
  if (!state.music.running) {
    state.combo = 0;
    state.beatJudge = "NO MUSIC";
    return { label: "NO MUSIC", bonus: 0 };
  }

  const elapsed = rhythmElapsedMs();
  const beatIndex = Math.round(elapsed / beatMs);
  const offset = Math.abs(elapsed - beatIndex * beatMs);
  if (beatIndex < 0 || elapsed < 0) return { label: "READY", bonus: 0 };
  if (offset <= 120 && beatIndex === state.lastRhythmBeat) return { label: "REPEAT", bonus: 0 };
  if (state.lastRhythmBeat !== null && beatIndex - state.lastRhythmBeat > 2) state.combo = 0;

  let label = "OFF BEAT";
  let bonus = 0;
  if (offset <= 45) {
    label = "PERFECT";
    state.combo += 1;
    bonus = 300 * rhythmMultiplier();
  } else if (offset <= 90) {
    label = "GOOD";
    state.combo += 1;
    bonus = 150 * rhythmMultiplier();
  } else {
    state.combo = 0;
    cancelClimbVoices();
  }

  if (bonus > 0) state.lastRhythmBeat = beatIndex;
  state.rhythmBonus = bonus;
  state.beatJudge = label;
  state.beatFlash = 0.65;
  state.judgementAge = 0;
  state.scorePop = { time: 0.5, value: bonus };
  state.feverPop.time = state.combo >= 9 ? 0.55 : 0;
  return { label, bonus };
}

function resetTemporaryEffects() {
  state.sluggishMoves = 0;
  state.inputBlockEvents = 0;
  state.climber.freezeTimer = 0;
  state.climber.hurtTimer = 0;
  state.slipTimer = 0;
  state.splatTimer = 0;
  state.shake = 0;
  state.message = "";
  state.wind = { timeUntil: 5, warning: 0, direction: 0, active: 0 };
  for (const hand of [state.hands.left, state.hands.right]) {
    hand.cooldown = 0;
    hand.upBuffer = 0;
  }
}

function beginStageBriefing() {
  state.mode = "briefing";
  state.briefing = { time: 0 };
  stopMusic();
}

function beginStageIntro() {
  state.mode = "intro";
  state.intro = { time: 0, fanfareScheduled: false, startedAt: 0, recovery: false };
  startMusic();
}

function skipStageBriefing() {
  if (state.mode !== "briefing") return;
  beginStageIntro();
}

function updateStageBriefing(dt) {
  if (state.mode !== "briefing") return;
  state.briefing.time = Math.min(stageBriefingDuration, state.briefing.time + dt);
  if (state.briefing.time >= stageBriefingDuration) beginStageIntro();
}

function resetGame(selectedStage = 1) {
  const stage = Math.max(1, Math.floor(Number(selectedStage) || 1));
  resetTemporaryEffects();
  state.stageDamaged = false;
  document.querySelector("#opening").hidden = true;
  state.descentLocked = true;
  state.neutralTime = 0;
  state.gameOverScheduled = false;
  state.score = 0;
  state.stagePenalty = 0;
  state.height = 5;
  state.stage = stage;
  state.stageStartHeight = 5;
  state.stageTarget = 25 + stage * 25;
  state.lives = 3;
  state.combo = 0;
  state.beatJudge = "---";
  state.beatFlash = 0;
  state.judgementAge = 0;
  state.scorePop = { time: 0, value: 0 };
  state.feverPop = { time: 0 };
  state.lastRhythmBeat = null;
  state.rhythmBonus = 0;
  state.camera = 0;
  state.shake = 0;
  state.slipTimer = 0;
  state.splatTimer = 0;
  state.message = "";
  state.climber = { col: 4, row: 5, hurtTimer: 0, freezeTimer: 0 };
  state.hands.left = { col: 4, row: 5, cooldown: 0, ready: true, upBuffer: 0, color: "#f0c64a" };
  state.hands.right = { col: 4, row: 5, cooldown: 0, ready: true, upBuffer: 0, color: "#7dc6ff" };
  state.obstacles = [];
  state.birds = [];
  state.residents = [];
  state.towels = [];
  state.snipers = [];
  state.tysons = [];
  state.shotMarks = [];
  if (state.stage >= tysonStartStage) state.tysons = [createTyson()];
  state.windows.clear();
  state.escapeWindow = null;
  state.spawnTimer = 8;
  beginStageBriefing();
}

function startSelectedStage() {
  const selector = document.querySelector("#stageSelect");
  resetGame(selector ? selector.value : 1);
}

function beginNextStage() {
  resetTemporaryEffects();
  state.stageDamaged = false;
  state.splatTimer = 0;
  state.stage += 1;
  state.stageTarget = 25 + state.stage * 25;
  state.height = 5;
  state.stageStartHeight = 5;
  state.stagePenalty = 0;
  state.descentLocked = true;
  state.neutralTime = 0;
  state.combo = 0;
  state.beatJudge = "---";
  state.beatFlash = 0;
  state.scorePop = { time: 0, value: 0 };
  state.feverPop = { time: 0 };
  state.lastRhythmBeat = null;
  state.rhythmBonus = 0;
  state.camera = 0;
  state.shake = 0;
  state.slipTimer = 0;
  state.message = "";
  state.climber = { col: 4, row: 5, hurtTimer: 0, freezeTimer: 0 };
  state.hands.left = { col: 4, row: 5, cooldown: 0, ready: true, upBuffer: 0, color: "#f0c64a" };
  state.hands.right = { col: 4, row: 5, cooldown: 0, ready: true, upBuffer: 0, color: "#7dc6ff" };
  state.obstacles = [];
  state.birds = [];
  state.residents = [];
  state.towels = [];
  state.snipers = [];
  state.tysons = [];
  state.shotMarks = [];
  if (state.stage >= tysonStartStage) state.tysons = [createTyson()];
  state.windows.clear();
  state.escapeWindow = null;
  state.spawnTimer = 8;
  beginStageBriefing();
}

function returnToTitle() {
  document.querySelector("#opening").hidden = false;
  state.mode = "title";
  state.message = "PRESS A / START / SPACE";
  state.gameOverScheduled = false;
  state.titleInputLock = 0.5;
  stopMusic();
  startMusic();
}

function dismissTeaser() {
  if (state.mode !== "teaser") return;
  teaser.hidden = true;
  state.mode = "title";
  state.titleInputLock = 0.5;
  startMusic();
}

function beginStageClear() {
  if (state.mode !== "play") return;
  beginRooftop();
}

function randomForWindow(col, row, salt) {
  const n = Math.sin((col + 1) * 31.73 + (row + 3) * 17.91 + salt * 11.37) * 10000;
  return n - Math.floor(n);
}

function openChanceForRow(row) {
  const stage = Math.max(1, state.stage || 1);
  const configured = windowBalance.stages[stage];
  const baseOpenChance = configured
    ? configured.baseOpenChance
    : Math.max(windowBalance.minimumBaseOpenChance,
      windowBalance.stages[6].baseOpenChance - (stage - 6) * windowBalance.laterStageDrop.baseOpenChance);
  const minimumOpenChance = configured
    ? configured.minimumOpenChance
    : Math.max(windowBalance.minimumOpenChance,
      windowBalance.stages[6].minimumOpenChance - (stage - 6) * windowBalance.laterStageDrop.minimumOpenChance);
  const progress = Math.min(1, Math.max(0, row) / windowBalance.difficultyRows);
  const eased = progress * progress * (3 - 2 * progress);
  return baseOpenChance - (baseOpenChance - minimumOpenChance) * eased;
}

function shouldWindowBeOpen(col, row, phase) {
  return randomForWindow(col, row, phase) < openChanceForRow(row);
}

function getWindow(col, row) {
  const key = `${col}:${row}`;
  let windowState = state.windows.get(key);
  if (!windowState) {
    const open = shouldWindowBeOpen(col, row, 0);
    windowState = {
      open,
      targetOpen: open,
      openness: open ? 1 : 0,
      phase: Math.floor(randomForWindow(col, row, 2) * 4),
      timer: randomForWindow(col, row, 1) * 2,
      interval: 4 + randomForWindow(col, row, 3) * 4,
    };
    state.windows.set(key, windowState);
  }
  return windowState;
}

function updateWindows(dt) {
  state.escapeWindow = null;
  const firstRow = Math.floor(state.camera) - 2;
  const lastRow = firstRow + rowsOnScreen + 6;

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const windowState = getWindow(col, row);
      windowState.timer += dt;
      if (windowState.timer >= windowState.interval) {
        windowState.timer -= windowState.interval;
        windowState.phase += 1;
        windowState.interval = 4 + randomForWindow(col, row, windowState.phase + 100) * 4;
        windowState.targetOpen = shouldWindowBeOpen(col, row, windowState.phase);
      }

      const target = windowState.targetOpen ? 1 : 0;
      const speed = dt / 2;
      if (windowState.openness < target) windowState.openness = Math.min(target, windowState.openness + speed);
      else if (windowState.openness > target) windowState.openness = Math.max(target, windowState.openness - speed);
      windowState.open = windowState.openness > 0.58;
    }
  }
}

function windowOpen(col, row) {
  if (col < 0 || col >= cols || row < 0) return false;
  if (isTysonShaftCell(col, row)) return false;
  return getWindow(col, row).openness > 0;
}

function tysonShaftRows() {
  const bottom = tysonBlockBottom();
  return { bottom, top: bottom + 7 };
}

function tysonBlockBottom(stage = state.stage) {
  return tysonBlockBottomByStage[stage] ?? 40;
}

function isTysonShaftCell(col, row) {
  if (state.stage < tysonStartStage) return false;
  const rows = tysonShaftRows();
  return Object.values(tysonLanes).some((lane) =>
    lane.columns.includes(col) && row >= rows.bottom && row <= rows.top);
}

function towelAt(col, row) {
  return state.towels.some((towel) => towel.col === col && towel.row === row);
}

function windowAvailable(col, row) {
  return windowOpen(col, row) && !towelAt(col, row);
}

function handOnOpenWindow(hand) {
  return windowOpen(hand.col, hand.row);
}

function updateHandSupport() {
  if (state.climber.hurtTimer > 0 || state.mode !== "play") return;
  const leftSupported = handOnOpenWindow(state.hands.left);
  const rightSupported = handOnOpenWindow(state.hands.right);
  if (!leftSupported && !rightSupported) fallToGround();
}

function gridToScreen(col, row) {
  const y = canvas.height - 118 - (row - state.camera) * cellH;
  return {
    x: buildingX + colW * col + colW / 2,
    y,
  };
}

function readGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = Array.from(pads).find(Boolean);
  if (!pad) {
    ui.pad.textContent = "WAIT";
    return null;
  }

  ui.pad.textContent = "READY";
  return {
    left: { x: pad.axes[0] || 0, y: pad.axes[1] || 0 },
    right: { x: pad.axes[2] || 0, y: pad.axes[3] || 0 },
    restart: Boolean(pad.buttons[0]?.pressed || pad.buttons[9]?.pressed),
  };
}

function axisFromKeys(neg, pos) {
  return (state.keys.has(pos) ? 1 : 0) - (state.keys.has(neg) ? 1 : 0);
}

function readInput() {
  const pad = readGamepad();
  const keyboard = {
    left: {
      x: axisFromKeys("KeyA", "KeyD"),
      y: axisFromKeys("KeyW", "KeyS"),
    },
    right: {
      x: axisFromKeys("ArrowLeft", "ArrowRight"),
      y: axisFromKeys("ArrowUp", "ArrowDown"),
    },
    restart: state.keys.has("Space"),
  };

  if (!pad) return keyboard;
  return {
    left: {
      x: Math.abs(pad.left.x) > Math.abs(keyboard.left.x) ? pad.left.x : keyboard.left.x,
      y: Math.abs(pad.left.y) > Math.abs(keyboard.left.y) ? pad.left.y : keyboard.left.y,
    },
    right: {
      x: Math.abs(pad.right.x) > Math.abs(keyboard.right.x) ? pad.right.x : keyboard.right.x,
      y: Math.abs(pad.right.y) > Math.abs(keyboard.right.y) ? pad.right.y : keyboard.right.y,
    },
    restart: pad.restart || keyboard.restart,
  };
}

function stickDirection(stick) {
  const vertical = Math.abs(stick.y) >= Math.abs(stick.x);
  return (
    vertical && stick.y < -dead ? "up" :
    vertical && stick.y > dead ? "down" :
    !vertical && stick.x < -dead ? "left" :
    !vertical && stick.x > dead ? "right" :
    "neutral"
  );
}

function canHandReach(side, col, row, body = state.climber) {
  const dc = col - body.col;
  const dr = row - body.row;
  if (dc === 0 && Math.abs(dr) <= 1) return true;
  if (side === "left" && dc === -1 && dr === 0) return true;
  if (side === "right" && dc === 1 && dr === 0) return true;
  return false;
}

function keepsHandsWithinTwoColumns(side, col, body = state.climber) {
  const otherSide = side === "left" ? "right" : "left";
  const otherHand = state.hands[otherSide];
  const leftmost = Math.min(body.col, col, otherHand.col);
  const rightmost = Math.max(body.col, col, otherHand.col);
  // A body and two outstretched hands would span three columns; keep the pose within two.
  return rightmost - leftmost < 2;
}

function moveHand(side, stick) {
  const hand = state.hands[side];
  if (hand.cooldown > 0) return "neutral";

  const direction = stickDirection(stick);

  if (direction === "neutral") {
    hand.ready = true;
    return "neutral";
  }

  if (!hand.ready) return "neutral";
  hand.ready = false;

  if (direction === "down") {
    hand.cooldown = 0.18 + (state.sluggishMoves > 0 ? 0.12 : 0);
    return direction;
  }

  const body = state.climber;
  let nextCol = body.col;
  let nextRow = body.row;

  if (direction === "up") nextRow += 1;
  else if (direction === "left" && side === "right") nextCol = body.col;
  else if (direction === "left" && side === "left") nextCol -= 1;
  else if (direction === "right" && side === "left") nextCol = body.col;
  else if (direction === "right" && side === "right") nextCol += 1;
  else {
    hand.cooldown = 0.11;
    state.shake = 0.08;
    return "blocked";
  }

  const otherSide = side === "left" ? "right" : "left";
  const trailingHand = state.hands[otherSide];
  if (
    nextCol !== body.col && nextCol !== hand.col &&
    canHandReach(side, nextCol, nextRow) && windowAvailable(nextCol, nextRow) &&
    !keepsHandsWithinTwoColumns(side, nextCol) &&
    trailingHand.row === body.row && windowAvailable(body.col, body.row)
  ) {
    trailingHand.col = body.col;
  }

  if (
    canHandReach(side, nextCol, nextRow) &&
    keepsHandsWithinTwoColumns(side, nextCol) &&
    windowAvailable(nextCol, nextRow)
  ) {
    const outwardReach = nextCol !== body.col &&
      (hand.col !== nextCol || hand.row !== nextRow);
    const upwardReach = direction === "up" &&
      (hand.col !== nextCol || hand.row !== nextRow);
    hand.col = nextCol;
    hand.row = nextRow;
    hand.cooldown = 0.18 + (state.sluggishMoves > 0 ? 0.12 : 0);
    if (direction === "up") hand.upBuffer = 0.24;
    if (outwardReach || upwardReach) {
      const beat = judgeBeat();
      playClimbVoice(beat);
      state.score += beat.bonus;
    }
    return direction;
  } else {
    hand.cooldown = 0.11;
    state.shake = 0.1;
    return "blocked";
  }
}

function handsSameHeight() {
  return state.hands.left.row === state.hands.right.row;
}

function registerSluggishMove() {
  if (state.sluggishMoves > 0) state.sluggishMoves -= 1;
  if (state.sluggishMoves === 0) state.inputBlockEvents = 0;
}

function hitByDropping() {
  state.stageDamaged = true;
  state.splatTimer = 1.2;
  state.sluggishMoves = 10;
  state.inputBlockEvents = 3 + Math.floor(Math.random() * 3);
  state.message = "COOLANT!";
}

function dropFiveFloors() {
  state.stageDamaged = true;
  const climber = state.climber;
  climber.row = Math.max(1, climber.row - 5);
  state.height = Math.max(state.stageStartHeight, state.height - 5);
  state.camera = Math.max(0, climber.row - 3);
  for (const side of ["left", "right"]) {
    state.hands[side].col = climber.col;
    state.hands[side].row = climber.row;
  }
  resetHandReadiness();
  state.slipTimer = 0.4;
  state.message = "SLIP!";
}

function handAtBody(hand, body = state.climber) {
  return hand.col === body.col && hand.row === body.row;
}

function handIsUpper(hand, body = state.climber) {
  return hand.col === body.col && hand.row === body.row + 1;
}

function handsAllowClimb(body = state.climber) {
  return state.hands.left.row >= body.row && state.hands.right.row >= body.row;
}

function handIsSideGrip(side, hand, body = state.climber) {
  if (hand.row !== body.row) return false;
  if (side === "left") return hand.col === body.col - 1;
  return hand.col === body.col + 1;
}

function resetHandReadiness() {
  state.hands.left.ready = false;
  state.hands.right.ready = false;
}

function climbOneBlock(moveContext, pullingSide, leadSide = null) {
  const climber = state.climber;
  const nextRow = climber.row + 1;
  if (!handsAllowClimb(climber)) {
    state.shake = 0.1;
    return true;
  }

  if (!windowAvailable(climber.col, nextRow)) {
    state.shake = 0.1;
    return true;
  }

  const oldHands = {
    left: { col: state.hands.left.col, row: state.hands.left.row },
    right: { col: state.hands.right.col, row: state.hands.right.row },
  };

  climber.row = nextRow;
  state.descentLocked = false;
  for (const side of ["left", "right"]) {
    state.hands[side].col = climber.col;
    state.hands[side].row = climber.row;
  }

  if (leadSide && windowAvailable(climber.col, climber.row + 1)) {
    state.hands[leadSide].row = climber.row + 1;
  }

  for (const side of ["left", "right"]) {
    if (side === pullingSide || side === leadSide) continue;
    if (
      canHandReach(side, oldHands[side].col, oldHands[side].row, climber) &&
      windowAvailable(oldHands[side].col, oldHands[side].row)
    ) {
      state.hands[side].col = oldHands[side].col;
      state.hands[side].row = oldHands[side].row;
    }
  }

  resetHandReadiness();
  const beat = judgeBeat();
  playClimbVoice(beat);
  state.height += 1;
  state.score += 120 + Math.max(0, state.height - 8) * 2 + beat.bonus;
  registerSluggishMove();
  state.camera += (climber.row - 2.6 - state.camera) * 0.08;
  return true;
}

function moveDownOneBlock(pullingSide) {
  if (state.descentLocked) return false;
  const climber = state.climber;
  const nextRow = climber.row - 1;
  if (nextRow < 0 || !windowAvailable(climber.col, nextRow)) {
    state.shake = 0.1;
    return true;
  }

  const sameSide = pullingSide === "left" ? "right" : "left";
  climber.row = nextRow;
  state.hands[pullingSide].col = climber.col;
  state.hands[pullingSide].row = climber.row;
  state.hands[sameSide].col = climber.col;
  state.hands[sameSide].row = climber.row + 1;
  resetHandReadiness();
  state.height = Math.max(0, state.height - 1);
  state.score = Math.max(0, state.score - 10);
  registerSluggishMove();
  state.camera += (climber.row - 2.6 - state.camera) * 0.12;
  return true;
}

function moveSideOneBlock(direction) {
  if (!handsSameHeight()) return false;
  const climber = state.climber;
  const dc = direction === "right" ? 1 : -1;
  const nextCol = climber.col + dc;
  if (nextCol < 0 || nextCol >= cols || !windowAvailable(nextCol, climber.row)) {
    state.shake = 0.1;
    return true;
  }

  climber.col = nextCol;
  state.descentLocked = false;
  if (direction === "right") {
    state.hands.left.col = climber.col - 1;
    state.hands.left.row = climber.row;
    state.hands.right.col = climber.col;
    state.hands.right.row = climber.row;
  } else {
    state.hands.left.col = climber.col;
    state.hands.left.row = climber.row;
    state.hands.right.col = climber.col + 1;
    state.hands.right.row = climber.row;
  }
  resetHandReadiness();
  const beat = judgeBeat();
  playClimbVoice(beat);
  state.score += 20 + beat.bonus;
  registerSluggishMove();
  state.camera += (climber.row - 2.6 - state.camera) * 0.08;
  return true;
}

function updateBodyMovement(moveContext) {
  const beforeLeftUpper = handIsUpper(moveContext.before.left);
  const beforeRightUpper = handIsUpper(moveContext.before.right);
  const bothUpper = beforeLeftUpper && beforeRightUpper;
  const leftWasSide = handIsSideGrip("left", moveContext.before.left);
  const rightWasSide = handIsSideGrip("right", moveContext.before.right);

  if (leftWasSide && handsSameHeight() && moveContext.moves.right === "left") {
    return moveSideOneBlock("left");
  }

  if (rightWasSide && handsSameHeight() && moveContext.moves.left === "right") {
    return moveSideOneBlock("right");
  }

  if (bothUpper && moveContext.moves.left === "down" && moveContext.moves.right === "down") {
    return climbOneBlock(moveContext, null, null);
  }

  if (beforeLeftUpper && moveContext.moves.left === "down") {
    return climbOneBlock(
      moveContext,
      "left",
      moveContext.moves.right === "up" || state.hands.right.upBuffer > 0 ? "right" : null,
    );
  }

  if (beforeRightUpper && moveContext.moves.right === "down") {
    return climbOneBlock(
      moveContext,
      "right",
      moveContext.moves.left === "up" || state.hands.left.upBuffer > 0 ? "left" : null,
    );
  }

  if (
    handAtBody(moveContext.before.left) && handAtBody(moveContext.before.right) &&
    moveContext.moves.left === "down" && moveContext.moves.right === "down"
  ) {
    return moveDownOneBlock("right");
  }

  state.camera += (state.climber.row - 2.6 - state.camera) * 0.08;
  return false;
}

function spawnObstacle() {
  const roll = Math.random();
  if (state.stage >= sniperStartStage && roll < sniperTestChance) {
    spawnSniper();
    return;
  }
  if (state.stage >= 3 && roll < 0.18) {
    const direction = Math.random() < 0.5 ? 1 : -1;
    state.birds.push({ x: direction === 1 ? buildingX - 60 : buildingX + buildingW + 60,
      y: 60, direction, age: 0, dropTimer: 0.8 + Math.random() });
    playBirdFlightMelody();
    return;
  }
  if (state.stage >= towelAndDumbbellStartStage && roll < 0.34) {
    spawnHangingTowel();
    return;
  }
  if (state.stage >= towelAndDumbbellStartStage && roll < 0.4) {
    spawnDumbbellThrower();
    return;
  }
  const type = state.stage >= 3 && roll < 0.52 ? "e" : roll > 0.55 ? "a" : "b";
  const row = state.camera + rowsOnScreen + 1;
  state.obstacles.push({
    type,
    col: Math.floor(Math.random() * cols),
    row,
    speed: type === "a" ? 2.7 : 2.15,
    sway: Math.random() * Math.PI * 2,
    drift: 0,
    driftTimer: 0,
    bounceEvery: type === "e" ? 5 : 0,
    bounceDistance: type === "e" ? 5 : 0,
    bounceDirection: type === "e" ? (Math.random() < 0.5 ? -1 : 1) : 0,
    bounceState: type === "e" ? "falling" : "none",
    bounceTime: 0,
    bounceFromRow: row,
    bounceFromCol: 0,
    bounceToCol: 0,
  });
}

function obstacleWindowCandidates({ open = null, minimumRow = 2 } = {}) {
  const candidates = [];
  const top = Math.min(state.stageTarget, Math.floor(state.camera + (canvas.height - 158) / cellH));
  for (let row = Math.max(minimumRow, Math.ceil(state.climber.row + 2)); row <= top; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (isTysonShaftCell(col, row)) continue;
      if (open !== null && getWindow(col, row).open !== open) continue;
      if (towelAt(col, row)) continue;
      if (state.climber.col === col && state.climber.row === row) continue;
      if (state.hands.left.col === col && state.hands.left.row === row) continue;
      if (state.hands.right.col === col && state.hands.right.row === row) continue;
      candidates.push({ col, row });
    }
  }
  return candidates;
}

function spawnHangingTowel() {
  const candidates = obstacleWindowCandidates();
  if (!candidates.length) return;
  const towel = candidates[Math.floor(Math.random() * candidates.length)];
  state.towels.push({ ...towel, dropTimer: 3 + Math.random() * 6 });
}

function releaseTowel(towel, windDirection = 0) {
  const index = state.towels.indexOf(towel);
  if (index !== -1) state.towels.splice(index, 1);
  const direction = windDirection || (Math.random() < 0.5 ? -1 : 1);
  state.obstacles.push({ type: "d", col: towel.col, row: towel.row,
    speed: 2.45, sway: 0, drift: direction * (windDirection ? 4.2 : 1.8), driftTimer: 0.2 });
}

function spawnDumbbellThrower() {
  const candidates = obstacleWindowCandidates({ open: true });
  if (!candidates.length) return;
  const position = candidates[Math.floor(Math.random() * candidates.length)];
  state.residents.push({ ...position, age: 0, dropped: false });
}

function spawnSniper() {
  const candidates = obstacleWindowCandidates({ open: false, minimumRow: 4 });
  const fallbackCandidates = candidates.length ? candidates : obstacleWindowCandidates({ minimumRow: 4 });
  if (!fallbackCandidates.length) return;
  const position = fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];
  closeSniperWindow(position);
  state.snipers.push({ ...position, age: 0, target: null, facing: null, fired: false,
    reticleVisible: false, reticleTimer: 0 });
}

function closeSniperWindow({ col, row }) {
  const windowState = getWindow(col, row);
  windowState.open = false;
  windowState.targetOpen = false;
  windowState.openness = 0;
  windowState.timer = 0;
}

function climberOccupiesCell(col, row) {
  return (state.climber.col === col && state.climber.row === row) ||
    (state.hands.left.col === col && state.hands.left.row === row) ||
    (state.hands.right.col === col && state.hands.right.row === row);
}

function updateSnipers(dt) {
  for (const mark of state.shotMarks) mark.time -= dt;
  state.shotMarks = state.shotMarks.filter((mark) => mark.time > 0);
  for (const sniper of state.snipers) {
    closeSniperWindow(sniper);
    sniper.age += dt;
    if (!sniper.target && sniper.age >= sniperAimAge) {
      sniper.target = { col: state.climber.col, row: state.climber.row };
      sniper.facing = sniper.target.col < sniper.col ? "left" : "right";
      sniper.reticleVisible = true;
      sniper.reticleTimer = sniperReticlePeriod(sniper);
      playSniperCharge();
    } else if (sniper.target && !sniper.fired) {
      sniper.reticleTimer = Number.isFinite(sniper.reticleTimer)
        ? sniper.reticleTimer - dt
        : sniperReticlePeriod(sniper) - dt;
      while (sniper.reticleTimer <= 0) {
        sniper.reticleVisible = !sniper.reticleVisible;
        sniper.reticleTimer += sniperReticlePeriod(sniper);
      }
    }
    if (!sniper.fired && sniper.age >= sniperFireAge) {
      sniper.fired = true;
      if (Math.random() < 0.65) playSniperShot();
      state.shotMarks.push({ col: sniper.target.col, row: sniper.target.row,
        fromCol: sniper.col, fromRow: sniper.row, time: 0.8 });
      if (climberOccupiesCell(sniper.target.col, sniper.target.row)) fallToGround();
    }
  }
  state.snipers = state.snipers.filter((sniper) => sniper.age < sniperFireAge + 0.8);
}

function sniperReticlePeriod(sniper) {
  const progress = Math.max(0, Math.min(1,
    (sniper.age - sniperAimAge) / (sniperFireAge - sniperAimAge)));
  return 0.42 - progress * 0.34;
}

function tysonPunchEndCol(tyson) {
  const lane = tysonLanes[tyson.lane];
  return Math.max(0, Math.min(cols - 1, lane.punchFromCol + lane.direction * tyson.reach));
}

function createTyson() {
  const tyson = { lane: "left", row: state.climber.row + 5, phase: "standby", phaseTime: 0,
    reach: 2, hit: false, moveTimer: 1.2 };
  positionTyson(tyson);
  tyson.phase = "standby";
  tyson.phaseTime = 0;
  tyson.moveTimer = 1.2;
  return tyson;
}

function positionTyson(tyson) {
  tyson.lane = Math.random() < 0.5 ? "left" : "right";
  tyson.row = tysonBlockBottom() + 3;
  tyson.phase = "standby";
  tyson.phaseTime = 0;
  tyson.reach = 0;
  tyson.hit = false;
  tyson.moveTimer = 2.6 + Math.random() * 1.8;
}

function tysonPunchHitsClimber(tyson) {
  const fromCol = tysonPunchStartCol(tyson);
  const endCol = tysonPunchEndCol(tyson);
  const minCol = Math.min(fromCol, endCol);
  const maxCol = Math.max(fromCol, endCol);
  return [state.climber, state.hands.left, state.hands.right].some((part) =>
    part.row === tyson.row && part.col >= minCol && part.col <= maxCol);
}

function tysonPunchStartCol(tyson) {
  const lane = tysonLanes[tyson.lane];
  return Math.max(0, Math.min(cols - 1, lane.punchFromCol + lane.direction));
}

function tysonJabFrameIndex(tyson) {
  return Math.min(2, Math.floor(tyson.phaseTime / tysonJabFrameDuration));
}

function tysonStraightFrameIndex(tyson) {
  return Math.min(2, Math.floor(tyson.phaseTime / tysonJabFrameDuration));
}

function tysonPunchCanHit(tyson) {
  return tyson.phase === "straight" || (tyson.phase === "jab" && tysonJabFrameIndex(tyson) >= 1);
}

function tysonPunchDuration(tyson) {
  return tysonJabFrameDuration * 3;
}

function updateTysons(dt) {
  if (state.stage < tysonStartStage) {
    state.tysons = [];
    return;
  }
  if (!state.tysons.length) {
    state.tysons.push(createTyson());
  }
  for (const tyson of state.tysons) {
    tyson.phaseTime += dt;
    if (tyson.phase === "standby") {
      tyson.moveTimer -= dt;
      if (tyson.moveTimer <= 0) {
        tyson.reach = Math.random() < 0.65 ? 2 : 6;
        tyson.phase = tyson.reach === 2 ? "jab" : "straight";
        tyson.phaseTime = 0;
        tyson.hit = false;
      }
      continue;
    }
    if (tyson.phase === "jab" || tyson.phase === "straight") {
      if (tysonPunchCanHit(tyson) && tysonPunchHitsClimber(tyson)) {
        fallToGround();
        return;
      }
      if (tyson.phaseTime >= tysonPunchDuration(tyson)) positionTyson(tyson);
    }
  }
}

function updateObstacleActors(dt) {
  for (const towel of [...state.towels]) {
    towel.dropTimer -= dt;
    if (towel.dropTimer <= 0) releaseTowel(towel);
  }
  for (const resident of state.residents) {
    resident.age += dt;
    if (!resident.dropped && resident.age >= 0.8) {
      resident.dropped = true;
      state.obstacles.push({ type: "f", col: resident.col, row: resident.row,
        speed: 2.8, sway: 0, drift: 0, driftTimer: 0 });
    }
  }
  state.residents = state.residents.filter((resident) => resident.age < 1.5);
  for (const bird of state.birds) {
    bird.age += dt;
    bird.x += bird.direction * 100 * dt;
    bird.dropTimer -= dt;
    if (bird.dropTimer <= 0) {
      if (bird.x >= buildingX && bird.x <= buildingX + buildingW) {
        const col = Math.max(0, Math.min(cols - 1, Math.round((bird.x - buildingX) / colW - 0.5)));
        state.obstacles.push({ type: "c", col,
          row: state.camera + (canvas.height - 118 - bird.y - 12) / cellH,
          speed: 2.15, sway: 0 });
        playPoopDropSound();
      }
      bird.dropTimer = 0.8 + Math.random();
    }
  }
  state.birds = state.birds.filter((bird) => bird.x > -80 && bird.x < canvas.width + 80);
  updateSnipers(dt);
  updateTysons(dt);
}

function freezeFromObstacle() {
  if (state.climber.hurtTimer > 0 || state.mode !== "play") return;
  state.stageDamaged = true;
  cancelClimbVoices();
  state.climber.freezeTimer = 1;
  state.shake = 0.3;
  state.combo = 0;
  state.beatJudge = "STUN";
  state.beatFlash = 0.35;
  state.message = "STUN!";
}

function fallToGround() {
  if (state.climber.hurtTimer > 0 || state.mode !== "play") return;
  state.stageDamaged = true;
  state.descentLocked = true;
  state.neutralTime = 0;
  cancelClimbVoices();
  state.lives -= 1;
  state.shake = 0.45;
  state.climber.hurtTimer = 0;
  state.climber.freezeTimer = 0;
  state.combo = 0;
  state.beatJudge = "BREAK";
  state.beatFlash = 0.35;
  state.message = "FALL!";
  state.mode = "falling";
  state.fall = { time: 0, recoveryHeight: Math.max(state.stageStartHeight, state.height - 10) };
  state.message = "";
  state.beatFlash = 0;
  state.scorePop.time = 0;
  state.feverPop.time = 0;
  stopMusic();
}

function fallScreenOffset() {
  const start = gridToScreen(state.climber.col, state.climber.row);
  const progress = Math.min(1, state.fall.time / 0.8);
  return (canvas.height - start.y + 130) * progress * progress;
}

function updateFalling(dt) {
  state.fall.time += dt;
  if (state.fall.time >= 1.25) finishFall();
}

function finishFall() {
  if (state.lives <= 0) {
    state.mode = "over";
    state.message = "GAME OVER";
    scheduleGameOverMusic();
    return;
  }
  const recoveryHeight = state.fall.recoveryHeight;
  state.height = recoveryHeight;
  state.camera = Math.max(0, recoveryHeight - 3);
  state.climber.col = 4;
  state.climber.row = recoveryHeight;
  state.hands.left.col = 4;
  state.hands.left.row = recoveryHeight;
  state.hands.right.col = 4;
  state.hands.right.row = recoveryHeight;
  resetHandReadiness();
  state.obstacles = [];
  state.birds = [];
  state.residents = [];
  state.towels = [];
  state.snipers = [];
  state.tysons = [];
  state.shotMarks = [];
  resetTemporaryEffects();
  state.spawnTimer = 8;
  state.windows.clear();
  for (let row = 0; row <= state.stageTarget; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const windowState = getWindow(col, row);
      windowState.open = true;
      windowState.targetOpen = true;
      windowState.openness = 1;
      windowState.timer = 0;
    }
  }
  state.mode = "intro";
  state.intro = { time: 0, fanfareScheduled: false, startedAt: 0, recovery: true };
  state.message = "";
  stopMusic();
  startMusic();
}

function obstacleInterval(height) {
  return Math.max(1.8, 6 - height * 0.09);
}

function updateWind(dt) {
  state.wind.active = Math.max(0, state.wind.active - dt);
  if (state.stage < 4) return;
  if (state.wind.warning > 0) {
    state.wind.warning -= dt;
    if (state.wind.warning <= 0) {
      applyWindHazards(state.wind.direction);
      state.wind.active = 0.45;
      state.wind.timeUntil = 4 + Math.random() * 4;
    }
    return;
  }
  state.wind.timeUntil -= dt;
  if (state.wind.timeUntil <= 0) {
    state.wind.direction = Math.random() < 0.5 ? -1 : 1;
    state.wind.warning = 1.5;
  }
}

function applyWindHazards(direction) {
  for (const item of state.obstacles) {
    item.col = Math.max(0, Math.min(cols - 1, item.col + direction));
  }
  for (const towel of [...state.towels]) {
    if (Math.random() < 0.86) releaseTowel(towel, direction);
  }
}

function updateFallingHazardSounds(dt) {
  const active = {
    beam: state.obstacles.some((item) => item.type === "b" ||
      (item.type === "e" && item.bounceState === "falling")),
    dumbbell: state.obstacles.some((item) => item.type === "f"),
    vase: state.obstacles.some((item) => item.type === "a"),
  };
  const sounds = {
    beam: playBeamDropSound,
    dumbbell: playDumbbellFallSound,
    vase: playVaseFallSound,
  };
  for (const [kind, play] of Object.entries(sounds)) {
    const timer = Math.max(0, state.fallingSoundTimers[kind] - dt);
    if (!active[kind]) {
      state.fallingSoundTimers[kind] = 0;
    } else if (timer <= 0) {
      play();
      state.fallingSoundTimers[kind] = 30 / bpm;
    } else {
      state.fallingSoundTimers[kind] = timer;
    }
  }
}

function updateObstacles(dt) {
  updateWind(dt);
  updateObstacleActors(dt);
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = obstacleInterval(state.height);
  }

  const body = gridToScreen(state.climber.col, state.climber.row);
  for (const item of state.obstacles) {
    if (item.type !== "e" || item.bounceState === "falling") item.row -= item.speed * dt;
    item.sway += dt * 4;
    if (item.type === "e") {
      if (item.bounceState === "falling") {
        item.bounceDistance -= item.speed * dt;
        if (item.bounceDistance <= 0) {
          item.bounceState = "rising";
          item.bounceTime = 0;
          item.bounceFromRow = item.row;
          item.bounceFromCol = item.col;
          item.bounceToCol = Math.max(0, Math.min(cols - 1,
            item.col + item.bounceDirection));
          playPinkBeamBounce();
        }
      } else {
        item.bounceTime += dt;
        if (item.bounceState === "rising") {
          const progress = Math.min(1, item.bounceTime / 0.18);
          item.row = item.bounceFromRow + progress;
          if (progress >= 1) {
            item.bounceState = "lane";
            item.bounceTime = 0;
          }
        } else {
          const progress = Math.min(1, item.bounceTime / 0.42);
          item.row = item.bounceFromRow + 1;
          item.col = item.bounceFromCol +
            (item.bounceToCol - item.bounceFromCol) * progress;
          if (progress >= 1) {
            item.bounceState = "falling";
            item.bounceDistance = item.bounceEvery;
            item.bounceDirection = item.col === 0 ? 1 : item.col === cols - 1 ? -1 :
              (Math.random() < 0.5 ? -1 : 1);
          }
        }
      }
    }
    if (item.type === "d") {
      item.driftTimer -= dt;
      item.col = Math.max(0, Math.min(cols - 1, item.col + item.drift * dt));
      if (item.driftTimer <= 0) {
        item.drift = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.8);
        item.driftTimer = 0.12 + Math.random() * 0.2;
      }
    }
    const pos = gridToScreen(item.col, item.row);
    if (item.type !== "c") pos.x += Math.sin(item.sway) * 18;
    const handTargets = [
      handGripPosition("left", state.hands.left),
      handGripPosition("right", state.hands.right),
    ];
    const hitsBody = Math.hypot(pos.x - body.x, pos.y - body.y) < 28;
    const hitsHand = handTargets.some((hand) => Math.hypot(pos.x - hand.x, pos.y - hand.y) < 18);
    if (hitsBody || hitsHand) {
      if (item.type === "c") {
        hitByDropping();
      } else if (item.type === "d") {
        if (Math.random() < 0.5) freezeFromObstacle();
        else dropFiveFloors();
      } else if (item.type === "e" || item.type === "f") {
        state.stagePenalty += 30000;
        fallToGround();
      } else {
        state.stagePenalty += item.type === "a" ? 10000 : 30000;
        if (item.type === "b") fallToGround();
        else if (handsSameHeight()) freezeFromObstacle();
        else fallToGround();
      }
      item.row = state.camera - 3;
      if (state.mode !== "play") break;
    }
  }

  updateFallingHazardSounds(dt);
  state.obstacles = state.obstacles.filter((item) => item.row > state.camera - 2);
}

function updateRestartProtection(input, dt) {
  const neutral = stickDirection(input.left) === "neutral" &&
    stickDirection(input.right) === "neutral";
  state.neutralTime = neutral ? state.neutralTime + dt : 0;
  if (state.neutralTime >= 0.3) state.descentLocked = true;
}

function update(dt) {
  const input = readInput();
  const restartHeld = input.restart;
  input.restart = (restartHeld && !state.restartHeld) || state.startKeyPressed;
  state.restartHeld = restartHeld;
  const menuKeyPressed = state.menuKeyPressed;
  state.startKeyPressed = false;
  state.menuKeyPressed = false;
  if (state.mode === "falling") {
    updateFalling(dt);
    return;
  }
  if (state.mode === "teaser") {
    if (input.restart) dismissTeaser();
    return;
  }
  state.titleInputLock = Math.max(0, state.titleInputLock - dt);
  if (state.mode === "title" && state.titleInputLock > 0) return;
  if (state.mode === "rooftop") {
    if (input.restart) state.rooftop.speed = 3;
    updateRooftop(dt);
    return;
  }
  if (state.mode === "clear") {
    if (input.restart || menuKeyPressed) beginNextStage();
    return;
  }
  if (state.mode === "briefing") {
    if (input.restart || menuKeyPressed) skipStageBriefing();
    else updateStageBriefing(dt);
    return;
  }
  if (state.mode === "intro") {
    state.intro.time = Math.min(startFanfareDuration, state.intro.time + dt);
    if (state.intro.time >= startFanfareDuration) {
      state.mode = "play";
      state.music.startedAt = state.music.context ? state.music.context.currentTime + 0.05 : 0;
      state.music.nextBeat = state.music.startedAt;
      state.music.beatIndex = 0;
      state.intro.fanfareScheduled = false;
    }
    return;
  }
  if (state.mode === "stageClear") {
    state.stageClear.time += dt;
    if (state.stageClear.time >= 1.5) beginNextStage();
    return;
  }
  if (state.mode === "over" && input.restart) {
    returnToTitle();
    return;
  }
  if (input.restart && state.mode !== "play") resetGame();
  if (state.mode !== "play") return;
  updateRestartProtection(input, dt);

  state.hands.left.cooldown = Math.max(0, state.hands.left.cooldown - dt);
  state.hands.right.cooldown = Math.max(0, state.hands.right.cooldown - dt);
  state.hands.left.upBuffer = Math.max(0, state.hands.left.upBuffer - dt);
  state.hands.right.upBuffer = Math.max(0, state.hands.right.upBuffer - dt);
  state.climber.hurtTimer = Math.max(0, state.climber.hurtTimer - dt);
  state.climber.freezeTimer = Math.max(0, state.climber.freezeTimer - dt);
  state.slipTimer = Math.max(0, state.slipTimer - dt);
  state.splatTimer = Math.max(0, state.splatTimer - dt);
  if (state.splatTimer <= 0 && state.message === "COOLANT!") state.message = "";
  state.shake = Math.max(0, state.shake - dt);
  state.beatFlash = Math.max(0, state.beatFlash - dt);
  state.judgementAge += dt;
  state.scorePop.time = Math.max(0, state.scorePop.time - dt);
  state.feverPop.time = Math.max(0, state.feverPop.time - dt);
  if (state.music.running && state.lastRhythmBeat !== null &&
      rhythmElapsedMs() > (state.lastRhythmBeat + 2) * beatMs + 120) {
    state.combo = 0;
  }
  if (state.climber.hurtTimer <= 0 && state.message === "FALL!") state.message = "";
  if (state.climber.freezeTimer <= 0 && state.message === "STUN!") state.message = "";
  if (state.slipTimer <= 0 && state.message === "SLIP!") state.message = "";
  updateWindows(dt);
  updateHandSupport();
  if (state.mode !== "play") return;

  if (state.climber.freezeTimer > 0) {
    updateObstacles(dt);
    return;
  }

  const moveContext = {
    before: {
      left: { col: state.hands.left.col, row: state.hands.left.row },
      right: { col: state.hands.right.col, row: state.hands.right.row },
    },
    directions: {
      left: stickDirection(input.left),
      right: stickDirection(input.right),
    },
  };

  moveContext.moves = {
    left: "neutral",
    right: "neutral",
  };
  const hasDirectionalInput = moveContext.directions.left !== "neutral" ||
    moveContext.directions.right !== "neutral";
  if (hasDirectionalInput && state.inputBlockEvents > 0) {
    state.inputBlockEvents -= 1;
  } else {
    moveContext.moves = {
      left: moveHand("left", input.left),
      right: moveHand("right", input.right),
    };
  }

  updateBodyMovement(moveContext);
  updateObstacles(dt);

  if (state.height >= state.stageTarget && state.mode === "play") beginStageClear();
}

function drawBuilding() {
  ctx.fillStyle = "#26383d";
  ctx.fillRect(buildingX, 0, buildingW, canvas.height);

  ctx.fillStyle = "#30454a";
  for (let col = 0; col < cols; col += 1) {
    ctx.fillRect(buildingX + col * colW + 6, 0, colW - 12, canvas.height);
  }

  if (state.stage >= tysonStartStage) {
    const rows = tysonShaftRows();
    for (const lane of Object.values(tysonLanes)) {
      const x = buildingX + lane.columns[0] * colW + 4;
      const width = colW * 2 - 8;
      const bottom = gridToScreen(lane.columns[0], rows.bottom).y + cellH / 2;
      const top = bottom - cellH * 8;
      ctx.fillStyle = "#111719";
      ctx.fillRect(x, top, width, cellH * 8);
      ctx.fillStyle = "#59402d";
      ctx.fillRect(x, top, 8, cellH * 8);
      ctx.fillRect(x + width - 8, top, 8, cellH * 8);
      ctx.fillStyle = "#26201c";
      for (let y = top; y < bottom; y += cellH * 2) {
        ctx.fillRect(x + 8, y + cellH - 4, width - 16, 4);
      }
    }
  }

  ctx.fillStyle = "#151d20";
  for (let i = 0; i <= cols; i += 1) {
    const x = buildingX + i * colW;
    ctx.fillRect(x - 3, 0, 6, canvas.height);
  }

  const firstRow = Math.floor(state.camera) - 1;
  const targetRow = state.climber.row + Math.max(0, state.stageTarget - state.height);
  const visibleTopRow = state.camera + (canvas.height - 118) / cellH;
  const visibleBottomRow = state.camera - 1;
  const targetIsVisible = targetRow <= visibleTopRow && targetRow >= visibleBottomRow;
  const showStageTop = state.mode === "stageClear" ||
    (state.mode === "play" && targetIsVisible);
  const roofRow = targetRow + 1;
  const lastRow = showStageTop ? roofRow - 1 : firstRow + rowsOnScreen + 4;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (isTysonShaftCell(col, row)) continue;
      const p = gridToScreen(col, row);
      drawSignalAnchor(p, getWindow(col, row).openness);
    }
  }
  if (showStageTop) {
    const roof = gridToScreen(state.climber.col, roofRow);
    // The building facade must end at the roof; clear the unused upper area.
    ctx.fillStyle = "#0a1012";
    ctx.fillRect(buildingX - 15, 0, buildingW + 30, Math.max(0, roof.y - 21));
    ctx.fillStyle = "#11181b";
    ctx.fillRect(buildingX - 12, roof.y - 18, buildingW + 24, 18);
    ctx.fillStyle = "#d7b45d";
    ctx.fillRect(buildingX - 12, roof.y - 21, buildingW + 24, 6);
    ctx.fillStyle = "#27383a";
    ctx.fillRect(buildingX + 24, roof.y - 48, 88, 26);
  }
}

function drawSignalAnchor(p, openness) {
  const active = openness > 0.58;
  const coreColor = active ? "#38d5ff" : "#4a1523";
  const energyColor = active ? "#b8f4ff" : "#7d2939";
  const frameX = p.x - windowW / 2;
  const frameY = p.y - windowH / 2;

  ctx.fillStyle = "#071c2a";
  ctx.fillRect(frameX, frameY, windowW, windowH);
  ctx.fillStyle = "#123548";
  ctx.fillRect(frameX + windowFrame, frameY + windowFrame, windowW - windowFrame * 2, windowH - windowFrame * 2);

  // A single vertical relay core makes each cell read as exterior hardware, not glass.
  ctx.fillStyle = "#071c2a";
  ctx.fillRect(p.x - 10, frameY + 4, 20, windowH - 8);
  ctx.fillStyle = coreColor;
  ctx.fillRect(p.x - 6, frameY + 7, 12, windowH - 14);
  ctx.fillStyle = energyColor;
  ctx.fillRect(p.x - 3, frameY + 9, 6, 8);

  ctx.fillStyle = coreColor;
  ctx.fillRect(frameX + 5, p.y - 3, 14, 6);
  ctx.fillRect(frameX + windowW - 19, p.y - 3, 14, 6);
  ctx.fillStyle = "#071c2a";
  ctx.fillRect(frameX + 8, p.y - 1, 8, 2);
  ctx.fillRect(frameX + windowW - 16, p.y - 1, 8, 2);
}

function strokeLimb(points, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function handGripPosition(side, hand, bodyRow = state.climber.row, outerReach = 18, restReach = 0) {
  const sign = side === "left" ? -1 : 1;
  const windowGrip = gridToScreen(hand.col, hand.row);
  // Drawing can place resting hands outside the torso without moving the support window.
  const raisedRows = Math.max(0, hand.row - bodyRow);
  const isAtOrBelowBody = hand.col === state.climber.col && hand.row <= bodyRow;
  const horizontalOffset = raisedRows > 0
    ? Math.min(outerReach, raisedRows * outerReach)
    : isAtOrBelowBody
      ? restReach
      : 0;
  return {
    x: windowGrip.x + sign * horizontalOffset,
    y: windowGrip.y,
  };
}

function climberLegPose(side, hands, bodyCol, bodyRow) {
  const ownHand = hands[side];
  const otherHand = hands[side === "left" ? "right" : "left"];
  const handState = (hand) => {
    if (hand.row > bodyRow) return "up";
    if (hand.col !== bodyCol) return "side";
    return "middle";
  };
  const ownState = handState(ownHand);
  return handState(otherHand) === "middle" && (ownState === "up" || ownState === "side")
    ? ownState
    : "down";
}

function drawPixelSegment(from, to, width, color) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 6));
  ctx.fillStyle = color;
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    ctx.fillRect(
      from.x + (to.x - from.x) * progress - width / 2,
      from.y + (to.y - from.y) * progress - width / 2,
      width,
      width,
    );
  }
}

function drawSpriteSegment(from, to, width, color, highlight = null) {
  const unit = 2;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / unit));
  const snap = (value) => Math.round(value / unit) * unit;
  const half = Math.floor(width / 2 / unit) * unit;
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const x = snap(from.x + (to.x - from.x) * progress);
    const y = snap(from.y + (to.y - from.y) * progress);
    ctx.fillStyle = "#17242a";
    ctx.fillRect(x - half - 2, y - half - 2, width + 4, width + 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - half, y - half, width, width);
    if (highlight && step % 2 === 0) {
      ctx.fillStyle = highlight;
      ctx.fillRect(x - half + 2, y - half + 2, Math.max(2, width - 6), 2);
    }
  }
}

function drawHand(side, hand, body, bodyRow, spread = 0) {
  const grip = handGripPosition(side, hand, bodyRow, 27, 18);
  const sign = side === "left" ? -1 : 1;
  if (spread > 0) grip.x = body.x + sign * spread;
  const shoulder = { x: body.x + sign * 10, y: body.y - 2 };
  const dx = grip.x - shoulder.x;
  const dy = grip.y - shoulder.y;
  const elbow = {
    x: shoulder.x + dx * 0.5,
    y: shoulder.y + dy * 0.5,
  };

  drawSpriteSegment(shoulder, elbow, 10, side === "left" ? "#c82335" : "#d82b39", "#f04d4d");
  drawSpriteSegment(elbow, grip, 8, "#d7966f");
  ctx.fillStyle = "#633d30";
  ctx.fillRect(grip.x - 8, grip.y - 8, 16, 16);
  ctx.fillStyle = "#efb286";
  ctx.fillRect(grip.x - 6, grip.y - 6, 12, 12);
  ctx.fillStyle = "#ffe0bb";
  ctx.fillRect(grip.x - 4, grip.y - 6, 8, 2);
}

function drawLeg(side, pose, body) {
  const sign = side === "left" ? -1 : 1;
  const hip = { x: body.x + sign * 8, y: body.y + 20 };
  let knee;
  let ankle;
  if (pose === "up") {
    knee = { x: body.x + sign * 18, y: body.y + 6 };
    ankle = { x: body.x + sign * 21, y: body.y - 6 };
  } else if (pose === "side") {
    knee = { x: body.x + sign * 24, y: body.y + 24 };
    ankle = { x: body.x + sign * 36, y: body.y + 24 };
  } else {
    knee = { x: body.x + sign * 18, y: body.y + 36 };
    ankle = { x: body.x + sign * 18, y: body.y + 45 };
  }

  drawSpriteSegment(hip, knee, 10, "#1244cb", "#2d67ef");
  drawSpriteSegment(knee, ankle, 10, "#1244cb");

  const shoeWidth = pose === "side" ? 24 : 20;
  const shoeX = sign < 0 ? ankle.x - shoeWidth + 6 : ankle.x - 6;
  const shoeY = ankle.y + 4;
  ctx.fillStyle = "#101719";
  ctx.fillRect(shoeX, shoeY, shoeWidth, 10);
  ctx.fillStyle = "#f4f1df";
  ctx.fillRect(shoeX + 3, shoeY, shoeWidth - 6, 6);
  ctx.fillStyle = "#d82b39";
  ctx.fillRect(shoeX + 6, shoeY + 3, shoeWidth - 12, 3);
}

function drawClimber() {
  let bodyCol = state.climber.col;
  let bodyRow = state.climber.row;
  let leftHand = state.hands.left;
  let rightHand = state.hands.right;
  if (state.mode === "intro") {
    const arrival = Math.min(1, state.intro.time / startFanfareDuration);
    if (state.intro.recovery) {
      bodyRow = state.climber.row - (1 - arrival) * 2;
    }
    const climbProgress = arrival * 7;
    const completed = Math.min(7, Math.floor(climbProgress));
    const phase = climbProgress - completed;
    if (!state.intro.recovery) bodyRow = -2 + completed;
    const leadingSide = completed % 2 === 0 ? "left" : "right";
    const leadingHand = { col: bodyCol, row: bodyRow + (phase < 0.7 ? 1 : 0) };
    const trailingHand = { col: bodyCol, row: bodyRow };
    leftHand = leadingSide === "left" ? leadingHand : trailingHand;
    rightHand = leadingSide === "right" ? leadingHand : trailingHand;
  }
  const body = gridToScreen(bodyCol, bodyRow);
  const blink = state.climber.hurtTimer > 0 && Math.floor(state.climber.hurtTimer * 16) % 2 === 0;
  if (blink) return;

  ctx.save();
  if (state.mode === "falling") ctx.translate(0, fallScreenOffset());

  // Draw arms first so shoulders and torso naturally overlap their attachment points.
  const handSpread = state.mode === "intro" && state.intro.recovery ? 27 : 0;
  drawHand("left", leftHand, body, bodyRow, handSpread);
  drawHand("right", rightHand, body, bodyRow, handSpread);

  const visualHands = { left: leftHand, right: rightHand };
  drawLeg("left", climberLegPose("left", visualHands, bodyCol, bodyRow), body);
  drawLeg("right", climberLegPose("right", visualHands, bodyCol, bodyRow), body);

  ctx.fillStyle = "#17242a";
  ctx.fillRect(body.x - 16, body.y - 8, 32, 38);
  ctx.fillRect(body.x - 20, body.y, 40, 22);
  ctx.fillStyle = "#d82b39";
  ctx.fillRect(body.x - 12, body.y - 4, 24, 30);
  ctx.fillRect(body.x - 16, body.y + 2, 32, 18);
  ctx.fillStyle = "#f04d4d";
  ctx.fillRect(body.x - 10, body.y, 6, 18);
  ctx.fillRect(body.x - 6, body.y - 2, 4, 6);
  ctx.fillStyle = "#9b1f2c";
  ctx.fillRect(body.x - 14, body.y + 18, 28, 4);
  ctx.fillStyle = "#f4f1df";
  ctx.fillRect(body.x - 12, body.y + 22, 24, 4);

  // The climber faces the building: the headband reads from behind without a front-facing face.
  ctx.fillStyle = "#d7966f";
  ctx.fillRect(body.x - 6, body.y - 16, 12, 8);
  ctx.fillStyle = "#efb286";
  ctx.fillRect(body.x - 16, body.y - 48, 32, 32);
  ctx.fillRect(body.x - 20, body.y - 42, 40, 20);
  // Continuous black hair mass: this is a rear view, not a front-facing head.
  ctx.fillStyle = "#111418";
  ctx.fillRect(body.x - 20, body.y - 52, 40, 18);
  ctx.fillRect(body.x - 24, body.y - 42, 8, 20);
  ctx.fillRect(body.x + 16, body.y - 42, 8, 20);
  ctx.fillRect(body.x - 16, body.y - 34, 32, 20);
  ctx.fillRect(body.x - 12, body.y - 18, 24, 8);
  ctx.fillStyle = "#202226";
  ctx.fillRect(body.x - 18, body.y - 58, 36, 6);
  ctx.fillRect(body.x - 22, body.y - 54, 44, 4);
  ctx.fillStyle = "#f4f1df";
  ctx.fillRect(body.x - 24, body.y - 46, 48, 6);
  ctx.fillRect(body.x - 30, body.y - 42, 6, 16);
  ctx.fillStyle = "#d8dde0";
  ctx.fillRect(body.x - 19, body.y - 42, 14, 3);
  ctx.restore();
}

function drawOnlookers() {
  if (state.mode !== "intro" || state.intro.recovery) return;
  const crowd = [120, 155, 190, 225, 265, 305, 665, 705, 745, 785, 825, 860];
  const player = gridToScreen(state.climber.col, state.climber.row);
  const groundTop = canvas.height - 180;
  crowd.forEach((x, index) => {
    const facing = player.x < x ? -1 : 1;
    const feet = groundTop + 102;
    const height = 34 + (index % 4) * 9;
    const shirtColors = ["#20282d", "#7d493d", "#365f73", "#6b6338"];
    ctx.fillStyle = shirtColors[index % shirtColors.length];
    ctx.fillRect(x - 10, feet - height, 20, height - 10);
    ctx.fillStyle = "#d7966f";
    ctx.beginPath(); ctx.arc(x, feet - height - 7, 8 + (index % 3), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#182126";
    ctx.fillRect(x - 10, feet - height - 16, 20, 7);
    ctx.fillStyle = "#10181b";
    ctx.fillRect(x + facing * 5, feet - height - 8, 3, 3);
  });
  const arrival = Math.min(1, state.intro.time / startFanfareDuration);
  const carX = -170 + arrival * 330;
  const carY = groundTop + 145;
  ctx.fillStyle = "#2d5c83";
  ctx.fillRect(carX, carY - 24, 132, 24);
  ctx.fillStyle = "#477da5";
  ctx.fillRect(carX + 30, carY - 44, 66, 22);
  ctx.fillStyle = "#a8d5e8";
  ctx.fillRect(carX + 40, carY - 40, 23, 15);
  ctx.fillRect(carX + 67, carY - 40, 23, 15);
  ctx.fillStyle = "#f1d34f";
  ctx.fillRect(carX + 105, carY - 18, 18, 7);
  ctx.fillStyle = "#df4050";
  ctx.fillRect(carX + 9, carY - 18, 18, 7);
  ctx.fillStyle = "#20282d";
  ctx.beginPath(); ctx.arc(carX + 28, carY, 13, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(carX + 103, carY, 13, 0, Math.PI * 2); ctx.fill();
  const lampPhase = Math.floor(state.intro.time * 8) % 2;
  ctx.fillStyle = lampPhase === 0 ? "#ff5265" : "#6c2834";
  ctx.fillRect(carX + 61, carY - 51, 12, 7);
  ctx.fillStyle = lampPhase === 1 ? "#4fa8ff" : "#254c69";
  ctx.fillRect(carX + 75, carY - 51, 12, 7);

  // The officer jumps down only in the opening sequence, never during a life recovery.
  const jump = Math.min(1, Math.max(0, (arrival - 0.32) / 0.42));
  if (jump > 0) {
    const officerX = carX + 74 + jump * 56;
    const startFeet = carY - 42;
    const landingFeet = groundTop + 102;
    const officerFeet = startFeet + (landingFeet - startFeet) * jump - Math.sin(jump * Math.PI) * 54;
    rooftopPerson(officerX, officerFeet, true, jump < 0.92 ? "walk" : "arrival", state.intro.time);
  }
}

function drawGroundEntrance() {
  if (state.mode !== "intro" || state.intro.recovery) return;
  const groundTop = canvas.height - 180;
  ctx.fillStyle = "#11191d";
  ctx.fillRect(0, groundTop, canvas.width, canvas.height - groundTop);
  ctx.fillStyle = "#27383d";
  ctx.fillRect(buildingX - 18, groundTop - 8, buildingW + 36, 8);
  ctx.fillStyle = "#4b5d60";
  ctx.fillRect(buildingX, groundTop, buildingW, canvas.height - groundTop);
  ctx.fillStyle = "#6caec1";
  for (let col = 2; col < cols; col += 2) {
    const center = buildingX + colW * col + colW / 2;
    const width = colW * 1.5;
    ctx.fillRect(center - width / 2, groundTop + 34, width, 56);
  }
  ctx.fillStyle = "#17262c";
  for (let col = 2; col < cols; col += 2) {
    const center = buildingX + colW * col + colW / 2;
    const width = colW * 1.5 + 10;
    ctx.fillRect(center - width / 2, groundTop + 29, width, 5);
    ctx.fillRect(center - width / 2, groundTop + 90, width, 5);
  }
  ctx.fillStyle = "#182226";
  ctx.fillRect(buildingX + colW * 0.55, groundTop + 34, colW * 1.25, 56);
  ctx.fillStyle = "#85b8c8";
  ctx.fillRect(buildingX + colW * 0.7, groundTop + 44, colW * 0.95, 8);
  ctx.fillStyle = "#d7b45d";
  ctx.fillRect(buildingX + colW * 0.15, groundTop + 10, colW * 2.3, 6);
  ctx.fillStyle = "#36494d";
  ctx.fillRect(buildingX + colW * 0.35, groundTop + 90, colW * 1.65, 8);
  // Draw the road last so it sits in front of the ground-floor facade.
  ctx.fillStyle = "#0b222c";
  ctx.fillRect(0, groundTop + 96, canvas.width, canvas.height - groundTop - 96);
  ctx.fillStyle = "#d7b45d";
  ctx.fillRect(0, groundTop + 125, canvas.width, 4);
}

function drawTrussBeam(x, y, palette) {
  ctx.fillStyle = palette.outline;
  ctx.fillRect(x - 36, y - 17, 72, 34);
  ctx.fillStyle = palette.body;
  ctx.fillRect(x - 32, y - 13, 64, 26);
  ctx.fillStyle = palette.highlight;
  ctx.fillRect(x - 29, y - 10, 58, 4);
  ctx.fillStyle = palette.outline;
  ctx.fillRect(x - 32, y - 12, 64, 4);
  ctx.fillRect(x - 32, y + 8, 64, 4);
  ctx.strokeStyle = palette.brace;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let brace = -28; brace <= 20; brace += 16) {
    ctx.moveTo(x + brace, y + 8);
    ctx.lineTo(x + brace + 16, y - 8);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let brace = -28; brace <= 20; brace += 16) {
    ctx.moveTo(x + brace, y - 8);
    ctx.lineTo(x + brace + 16, y + 8);
  }
  ctx.stroke();
}

function drawTransformerUnit(x, y) {
  ctx.fillStyle = "#14272f";
  ctx.fillRect(x - 21, y - 19, 42, 38);
  ctx.fillStyle = "#31515b";
  ctx.fillRect(x - 17, y - 15, 34, 30);
  ctx.fillStyle = "#6f97a3";
  ctx.fillRect(x - 13, y - 11, 26, 22);
  ctx.fillStyle = "#3faee0";
  ctx.fillRect(x - 7, y - 8, 14, 16);
  ctx.fillStyle = "#c8f4ff";
  ctx.fillRect(x - 3, y - 6, 6, 8);
  ctx.fillStyle = "#f0c64a";
  ctx.fillRect(x - 17, y - 18, 34, 4);
  ctx.fillRect(x - 17, y + 14, 34, 4);
  ctx.fillStyle = "#14272f";
  ctx.fillRect(x - 11, y - 18, 6, 4);
  ctx.fillRect(x + 5, y - 18, 6, 4);
  ctx.fillRect(x - 11, y + 14, 6, 4);
  ctx.fillRect(x + 5, y + 14, 6, 4);
  ctx.fillStyle = "#a9d4de";
  ctx.fillRect(x - 27, y - 10, 6, 20);
  ctx.fillRect(x + 21, y - 10, 6, 20);
}

function drawToolModule(x, y) {
  ctx.fillStyle = "#18252c";
  ctx.fillRect(x - 24, y - 16, 48, 32);
  ctx.fillStyle = "#ff8d3a";
  ctx.fillRect(x - 20, y - 12, 40, 24);
  ctx.fillStyle = "#cf542f";
  ctx.fillRect(x - 16, y - 8, 32, 16);
  ctx.fillStyle = "#b9d4d8";
  ctx.fillRect(x - 28, y - 9, 8, 18);
  ctx.fillRect(x + 20, y - 9, 8, 18);
  ctx.fillStyle = "#47c0e6";
  ctx.fillRect(x - 5, y - 5, 10, 10);
  ctx.fillStyle = "#d9fbff";
  ctx.fillRect(x - 2, y - 4, 4, 4);
}

function drawCableBundle(cable) {
  const p = gridToScreen(cable.col, cable.row);
  ctx.save();
  ctx.translate(p.x - 18, p.y - 12);
  ctx.rotate(-0.18);
  ctx.fillStyle = "#0c1920";
  ctx.fillRect(-36, -26, 96, 8);
  ctx.fillStyle = "#6f97a3";
  ctx.fillRect(-31, -23, 86, 3);
  ctx.fillStyle = "#172f3b";
  ctx.fillRect(-19, -15, 8, 47); ctx.fillRect(3, -15, 8, 47); ctx.fillRect(25, -15, 8, 47);
  ctx.fillStyle = "#3faee0";
  ctx.fillRect(-16, -15, 3, 43); ctx.fillRect(6, -15, 3, 43); ctx.fillRect(28, -15, 3, 43);
  ctx.fillStyle = "#f0c64a";
  ctx.fillRect(-23, 25, 16, 11); ctx.fillRect(-1, 25, 16, 11); ctx.fillRect(21, 25, 16, 11);
  ctx.restore();
}

function drawFallingCableBundle(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.22);
  ctx.fillStyle = "#0c1920";
  ctx.fillRect(-29, -20, 58, 8);
  ctx.fillStyle = "#172f3b";
  ctx.fillRect(-20, -12, 9, 43); ctx.fillRect(-3, -12, 9, 43); ctx.fillRect(14, -12, 9, 43);
  ctx.fillStyle = "#3faee0";
  ctx.fillRect(-17, -12, 3, 38); ctx.fillRect(0, -12, 3, 38); ctx.fillRect(17, -12, 3, 38);
  ctx.fillStyle = "#f0c64a";
  ctx.fillRect(-24, 25, 17, 11); ctx.fillRect(-7, 25, 17, 11); ctx.fillRect(10, 25, 17, 11);
  ctx.restore();
}

function drawToolDropper(resident) {
  const p = gridToScreen(resident.col, resident.row);
  const reveal = Math.min(1, resident.age / 0.2, (1.5 - resident.age) / 0.2);
  ctx.save();
  ctx.translate(p.x, p.y + 18 * (1 - reveal));
  ctx.fillStyle = "#172126";
  ctx.fillRect(-27, -36, 54, 58);
  ctx.fillStyle = "#2b5f78";
  ctx.fillRect(-21, -1, 42, 27);
  ctx.fillStyle = "#1a3441";
  ctx.fillRect(-21, 19, 42, 7);
  ctx.fillStyle = "#35515d";
  ctx.fillRect(-18, -31, 36, 30);
  ctx.fillStyle = "#172126";
  ctx.fillRect(-21, -36, 42, 10);
  ctx.fillRect(-21, -27, 7, 11);
  ctx.fillRect(14, -27, 7, 11);
  ctx.fillStyle = "#47c0e6";
  ctx.fillRect(-7, -22, 14, 10);
  ctx.fillStyle = "#d9fbff";
  ctx.fillRect(-3, -20, 6, 4);
  const handY = resident.dropped ? 18 : 2;
  ctx.fillStyle = "#ff8d3a";
  ctx.fillRect(17, handY, 21, 8);
  ctx.fillRect(31, handY + 8, 8, 14);
  ctx.fillRect(-38, handY + 9, 21, 8);
  ctx.fillRect(-39, handY + 17, 8, 12);
  if (!resident.dropped) drawToolModule(48, 4);
  ctx.restore();
}

function drawObstacles() {
  const targetRow = state.climber.row + Math.max(0, state.stageTarget - state.height);
  const visibleTopRow = state.camera + (canvas.height - 118) / cellH;
  const visibleBottomRow = state.camera - 1;
  const roofVisible = state.mode === "play" &&
    targetRow <= visibleTopRow && targetRow >= visibleBottomRow;
  for (const item of state.obstacles) {
    if (roofVisible && item.row > targetRow) continue;
    const p = gridToScreen(item.col, item.row);
    if (item.type !== "c") p.x += Math.sin(item.sway) * 18;
    if (item.type === "a") {
      drawTransformerUnit(p.x, p.y);
    } else if (item.type === "b") {
      drawTrussBeam(p.x, p.y, {
        outline: "#2a3540", body: "#6f97a3", highlight: "#b9e4ec", brace: "#334a55",
      });
    } else if (item.type === "d") {
      drawFallingCableBundle(p.x, p.y);
    } else if (item.type === "f") {
      drawToolModule(p.x, p.y);
    } else if (item.type === "e") {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (item.bounceState !== "falling") ctx.rotate(item.bounceTime * 18);
      drawTrussBeam(0, 0, {
        outline: "#25304b", body: "#5369b4", highlight: "#91d1ff", brace: "#2c396c",
      });
      ctx.restore();
    } else {
      ctx.fillStyle = "#14232c";
      ctx.fillRect(p.x - 10, p.y - 14, 20, 28);
      ctx.fillStyle = "#317b99";
      ctx.fillRect(p.x - 7, p.y - 10, 14, 20);
      ctx.fillStyle = "#66ddff";
      ctx.fillRect(p.x - 4, p.y - 8, 8, 12);
      ctx.fillStyle = "#d9fbff";
      ctx.fillRect(p.x - 2, p.y - 6, 4, 5);
      ctx.fillStyle = "#e85d91";
      ctx.fillRect(p.x - 7, p.y + 9, 14, 4);
    }
  }
}

function drawObstacleActors() {
  for (const towel of state.towels) drawCableBundle(towel);
  for (const resident of state.residents) drawToolDropper(resident);
  for (const bird of state.birds) {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.scale(bird.direction, 1);
    const rotorOffset = Math.sin(bird.age * 24) > 0 ? -4 : 4;
    ctx.fillStyle = "#111d25";
    ctx.fillRect(-49, -6, 98, 12);
    ctx.fillRect(-34, -19, 68, 38);
    ctx.fillStyle = "#526976";
    ctx.fillRect(-54, -14 + rotorOffset, 26, 5);
    ctx.fillRect(28, -14 - rotorOffset, 26, 5);
    ctx.fillRect(-45, -18 + rotorOffset, 8, 14);
    ctx.fillRect(37, -18 - rotorOffset, 8, 14);
    ctx.fillStyle = "#263b47";
    ctx.fillRect(-28, -14, 56, 28);
    ctx.fillStyle = "#47c0e6";
    ctx.fillRect(-20, -8, 15, 12);
    ctx.fillRect(7, -8, 15, 12);
    ctx.fillStyle = "#d9fbff";
    ctx.fillRect(-16, -6, 7, 4);
    ctx.fillRect(11, -6, 7, 4);
    ctx.fillStyle = "#e85d91";
    ctx.fillRect(-5, 9, 10, 7);
    ctx.fillStyle = "#91d1ff";
    ctx.fillRect(-2, 16, 4, 9);
    ctx.restore();
  }
  for (const arm of state.tysons) drawHydraulicArm(arm);
  for (const sniper of state.snipers) {
    drawSentinelTurret(sniper);
    if (sniper.target && !sniper.fired && sniper.reticleVisible) {
      const target = gridToScreen(sniper.target.col, sniper.target.row);
      ctx.strokeStyle = "#f6e15f";
      ctx.lineWidth = 3;
      ctx.strokeRect(target.x - 20, target.y - 20, 40, 40);
    }
  }
  for (const mark of state.shotMarks) {
    const from = gridToScreen(mark.fromCol, mark.fromRow);
    const hit = gridToScreen(mark.col, mark.row);
    drawPixelSegment(from, hit, 4, "#f7cf4c");
    ctx.fillStyle = "#f6f1df";
    ctx.fillRect(hit.x - 18, hit.y - 3, 36, 6);
    ctx.fillRect(hit.x - 3, hit.y - 18, 6, 36);
    ctx.fillStyle = "#d82b39";
    ctx.fillRect(hit.x - 8, hit.y - 8, 16, 16);
  }
}

function drawSentinelTurret(turret) {
  const p = gridToScreen(turret.col, turret.row);
  const facing = turret.facing || (state.climber.col < turret.col ? "left" : "right");
  const reveal = Math.min(1, turret.age / 0.2, (sniperFireAge + 0.8 - turret.age) / 0.2);
  ctx.save();
  ctx.translate(p.x, p.y + 16 * (1 - reveal));
  ctx.scale(facing === "left" ? -1 : 1, 1);
  ctx.fillStyle = "#0c1820";
  ctx.fillRect(-32, -26, 64, 52);
  ctx.fillStyle = "#263d49";
  ctx.fillRect(-26, -20, 52, 40);
  ctx.fillStyle = "#4a6370";
  ctx.fillRect(-20, -16, 30, 32);
  ctx.fillStyle = "#10191f";
  ctx.fillRect(4, -11, 46, 22);
  ctx.fillStyle = "#66ddff";
  ctx.fillRect(11, -7, 32, 14);
  ctx.fillStyle = "#d9fbff";
  ctx.fillRect(15, -4, 14, 6);
  ctx.fillStyle = "#e85d91";
  ctx.fillRect(-13, -7, 13, 14);
  ctx.fillStyle = "#f7cf4c";
  ctx.fillRect(-9, -3, 5, 6);
  ctx.fillStyle = "#172a34";
  ctx.fillRect(-23, 20, 46, 7);
  ctx.restore();
}

function drawHydraulicArm(arm) {
  const lane = tysonLanes[arm.lane];
  const p = gridToScreen(lane.punchFromCol, arm.row);
  const phaseFrame = arm.phase === "jab" ? tysonJabFrameIndex(arm) : tysonStraightFrameIndex(arm);
  const reach = arm.phase === "standby" ? 0 : arm.phase === "jab" ? (phaseFrame + 1) * 0.8 : arm.reach;
  const baseX = arm.lane === "left" ? buildingX + (lane.columns[1] + 1) * colW : buildingX + lane.columns[0] * colW;
  const armLength = Math.max(0, reach * colW - 10);
  const blink = arm.phase !== "standby" && phaseFrame % 2 === 0;
  ctx.save();
  ctx.translate(baseX, p.y);
  ctx.scale(lane.direction, 1);
  ctx.fillStyle = "#0d1720";
  ctx.fillRect(-44, -34, 48, 68);
  ctx.fillStyle = "#263d49";
  ctx.fillRect(-38, -28, 36, 56);
  ctx.fillStyle = "#526976";
  ctx.fillRect(-31, -22, 22, 44);
  ctx.fillStyle = "#10191f";
  ctx.fillRect(-4, -13, 25, 26);
  ctx.fillStyle = "#4a6370";
  ctx.fillRect(12, -9, armLength, 18);
  ctx.fillStyle = "#d9fbff";
  ctx.fillRect(16, -5, Math.max(0, armLength - 12), 5);
  ctx.fillStyle = "#172a34";
  for (let x = 34; x < armLength; x += 28) ctx.fillRect(x, -12, 6, 24);
  if (armLength > 0) {
    ctx.fillStyle = "#10191f";
    ctx.fillRect(14 + armLength, -18, 17, 36);
    ctx.fillStyle = "#f7cf4c";
    ctx.fillRect(18 + armLength, -14, 9, 28);
  }
  ctx.fillStyle = blink ? "#f7cf4c" : "#66ddff";
  ctx.fillRect(-26, -17, 11, 11);
  ctx.fillStyle = "#e85d91";
  ctx.fillRect(-38, 25, 36, 7);
  ctx.restore();
}

function drawWindWarning() {
  if (state.stage < 4 || state.wind.warning <= 0) return;
  const player = gridToScreen(state.climber.col, state.climber.row);
  const progress = 1 - state.wind.warning / 1.5;
  const travel = canvas.width + 180;
  const arrowRows = [92, 168, 244, 320, 396, 472, 548];
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#66ddff";
  ctx.font = "28px 'Press Start 2P', monospace";
  const labelY = Math.min(canvas.height - 105, player.y + 82);
  ctx.fillText("DRAFT!", player.x, labelY);
  ctx.font = "34px 'Press Start 2P', monospace";
  arrowRows.forEach((row, index) => {
    const offset = (index / arrowRows.length) * travel;
    const x = state.wind.direction < 0
      ? canvas.width + 90 - ((progress * travel + offset) % travel)
      : -90 + ((progress * travel + offset) % travel);
    ctx.fillText(state.wind.direction < 0 ? "≪" : "≫", x, row);
  });
  ctx.restore();
}

function drawSkyline() {
  ctx.fillStyle = "#0a1012";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#121b1f";
  for (let i = 0; i < 9; i += 1) {
    const x = i * 112 - 20;
    const h = 130 + (i % 4) * 38;
    ctx.fillRect(x, canvas.height - h, 90, h);
  }
}

function drawOverlay() {
  if (state.mode === "falling") {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, (state.fall.time - 0.8) / 0.25))})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (state.mode === "play" && !state.message) return;
  if (state.mode === "play" && state.message === "COOLANT!") {
    const opacity = state.splatTimer / 1.2;
    ctx.fillStyle = `rgba(5, 9, 10, ${0.55 * opacity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgba(246, 241, 223, ${opacity})`;
    ctx.textAlign = "center";
    ctx.font = "32px 'Press Start 2P', monospace";
    ctx.fillText("COOLANT!", canvas.width / 2, 238);
    return;
  }
  if (state.mode === "over") {
    ctx.fillStyle = "rgba(5, 9, 10, 0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f6f1df";
    ctx.textAlign = "center";
    ctx.font = "56px 'Press Start 2P', monospace";
    ctx.fillText("GAMEOVER", canvas.width / 2, canvas.height / 2);
    ctx.font = "26px 'Press Start 2P', monospace";
    ctx.fillText(`SCORE ${String(state.score).padStart(6, "0")}`, canvas.width / 2, canvas.height / 2 + 72);
    ctx.font = "16px 'Press Start 2P', monospace";
    ctx.fillText("A / START / SPACE", canvas.width / 2, canvas.height / 2 + 126);
    return;
  }
  if (state.mode === "intro") return;
  if (state.mode === "briefing") {
    ctx.fillStyle = "rgba(5, 9, 10, 0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  ctx.fillStyle = "rgba(5, 9, 10, 0.55)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f6f1df";
  ctx.textAlign = "center";
  ctx.font = "700 48px Consolas, monospace";
  const title = state.mode === "title" ? "STICK CLIMBER 86" :
    state.mode === "stageClear" ? `BUILDING${state.stage} CLEAR!` :
    state.mode === "intro" ? `BUILDING ${state.stage}` : state.message;
  ctx.fillText(title, canvas.width / 2, 238);
  ctx.font = "20px Segoe UI, sans-serif";
  const sub = state.mode === "title"
    ? `Two sticks, two hands. Climb on the ${bpm} BPM beat.`
    : state.mode === "stageClear"
      ? `${state.stageTarget} FLOOR - ROOFTOP`
    : state.mode === "intro"
      ? `${state.stageTarget} FLOOR`
    : "A / Start / Space";
  if (sub) ctx.fillText(sub, canvas.width / 2, 286);
}

function drawSharpText(text, x, y, font, color, alpha = 1) {
  screenCtx.globalAlpha = alpha;
  screenCtx.fillStyle = color;
  screenCtx.font = font;
  screenCtx.fillText(text, x, y);
}

function drawStageHazardIcon(id, x, y) {
  const context = screenCtx;
  if (id === "vase") {
    context.fillStyle = "#14272f"; context.fillRect(x - 23, y - 25, 46, 50);
    context.fillStyle = "#6f97a3"; context.fillRect(x - 18, y - 20, 36, 40);
    context.fillStyle = "#3faee0"; context.fillRect(x - 8, y - 14, 16, 28);
    context.fillStyle = "#c8f4ff"; context.fillRect(x - 3, y - 10, 6, 13);
    context.fillStyle = "#f0c64a"; context.fillRect(x - 18, y - 20, 36, 5); context.fillRect(x - 18, y + 15, 36, 5);
  } else if (id === "beam" || id === "pinkBeam") {
    const beam = id === "pinkBeam" ? "#5369b4" : "#6f97a3";
    context.fillStyle = "#182126"; context.fillRect(x - 48, y - 12, 96, 24);
    context.fillStyle = beam; context.fillRect(x - 44, y - 8, 88, 5); context.fillRect(x - 44, y + 4, 88, 5);
    for (let brace = -34; brace <= 26; brace += 20) {
      context.fillRect(x + brace, y - 4, 16, 5); context.fillRect(x + brace + 8, y, 5, 12);
    }
  } else if (id === "shirt") {
    context.fillStyle = "#0c1920"; context.fillRect(x - 40, y - 26, 80, 8);
    context.fillStyle = "#172f3b";
    context.fillRect(x - 27, y - 18, 10, 48); context.fillRect(x - 5, y - 18, 10, 48); context.fillRect(x + 17, y - 18, 10, 48);
    context.fillStyle = "#3faee0";
    context.fillRect(x - 24, y - 18, 4, 42); context.fillRect(x - 2, y - 18, 4, 42); context.fillRect(x + 20, y - 18, 4, 42);
    context.fillStyle = "#f0c64a";
    context.fillRect(x - 32, y + 23, 18, 11); context.fillRect(x - 10, y + 23, 18, 11); context.fillRect(x + 12, y + 23, 18, 11);
  } else if (id === "dumbbell") {
    context.fillStyle = "#18252c"; context.fillRect(x - 29, y - 20, 58, 40);
    context.fillStyle = "#ff8d3a"; context.fillRect(x - 24, y - 16, 48, 32);
    context.fillStyle = "#cf542f"; context.fillRect(x - 18, y - 11, 36, 22);
    context.fillStyle = "#b9d4d8"; context.fillRect(x - 34, y - 11, 10, 22); context.fillRect(x + 24, y - 11, 10, 22);
    context.fillStyle = "#47c0e6"; context.fillRect(x - 6, y - 6, 12, 12);
  } else if (id === "bird") {
    context.fillStyle = "#111d25"; context.fillRect(x - 40, y - 8, 80, 16); context.fillRect(x - 24, y - 19, 48, 36);
    context.fillStyle = "#526976"; context.fillRect(x - 45, y - 18, 22, 5); context.fillRect(x + 23, y - 18, 22, 5); context.fillRect(x - 37, y - 23, 6, 14); context.fillRect(x + 31, y - 23, 6, 14);
    context.fillStyle = "#47c0e6"; context.fillRect(x - 15, y - 7, 12, 11); context.fillRect(x + 4, y - 7, 12, 11);
    context.fillStyle = "#e85d91"; context.fillRect(x - 5, y + 11, 10, 8);
    context.fillStyle = "#66ddff"; context.fillRect(x - 2, y + 20, 4, 20);
  } else if (id === "wind") {
    context.fillStyle = "#172a34"; context.fillRect(x - 44, y - 28, 30, 56);
    context.fillStyle = "#526976"; context.fillRect(x - 39, y - 22, 20, 44);
    context.fillStyle = "#10191f"; context.fillRect(x - 34, y - 17, 10, 34);
    context.fillStyle = "#66ddff";
    for (const offset of [-18, 0, 18]) {
      context.fillRect(x - 11, y + offset - 3, 50, 6);
      context.fillRect(x + 30, y + offset - 9, 12, 18);
    }
  } else if (id === "sniper") {
    context.fillStyle = "#0c1820"; context.fillRect(x - 38, y - 26, 58, 52);
    context.fillStyle = "#263d49"; context.fillRect(x - 32, y - 20, 46, 40);
    context.fillStyle = "#4a6370"; context.fillRect(x - 25, y - 16, 25, 32);
    context.fillStyle = "#10191f"; context.fillRect(x - 1, y - 10, 49, 20);
    context.fillStyle = "#66ddff"; context.fillRect(x + 8, y - 6, 34, 12);
    context.fillStyle = "#d9fbff"; context.fillRect(x + 14, y - 3, 13, 5);
    context.fillStyle = "#e85d91"; context.fillRect(x - 18, y - 6, 12, 12);
    context.fillStyle = "#f7cf4c"; context.fillRect(x - 14, y - 2, 5, 5);
  } else if (id === "tyson") {
    context.fillStyle = "#0d1720"; context.fillRect(x - 48, y - 31, 42, 62);
    context.fillStyle = "#263d49"; context.fillRect(x - 42, y - 25, 30, 50);
    context.fillStyle = "#526976"; context.fillRect(x - 35, y - 19, 17, 38);
    context.fillStyle = "#10191f"; context.fillRect(x - 10, y - 12, 22, 24);
    context.fillStyle = "#4a6370"; context.fillRect(x + 8, y - 8, 51, 16);
    context.fillStyle = "#d9fbff"; context.fillRect(x + 14, y - 4, 32, 5);
    context.fillStyle = "#172a34"; context.fillRect(x + 30, y - 11, 5, 22);
    context.fillStyle = "#f7cf4c"; context.fillRect(x + 56, y - 15, 9, 30);
    context.fillStyle = "#66ddff"; context.fillRect(x - 32, y - 16, 10, 10);
    context.fillStyle = "#e85d91"; context.fillRect(x - 42, y + 24, 34, 7);
  }
}

function drawStageHazardBriefing() {
  if (state.mode !== "briefing") return;
  const hazards = stageHazardBriefings(state.stage);
  if (!hazards.length) return;
  const cardW = 148;
  const cardH = 104;
  const gap = 16;
  const total = hazards.length * cardW + (hazards.length - 1) * gap;
  const startX = (canvas.width - total) / 2;
  const y = 270;
  screenCtx.save();
  screenCtx.imageSmoothingEnabled = false;
  hazards.forEach((hazard, index) => {
    const x = startX + index * (cardW + gap);
    screenCtx.fillStyle = "#10191dcc"; screenCtx.fillRect(x, y, cardW, cardH);
    screenCtx.strokeStyle = "#f7cf4c"; screenCtx.lineWidth = 2; screenCtx.strokeRect(x, y, cardW, cardH);
    drawStageHazardIcon(hazard.id, x + cardW / 2, y + 45);
    drawSharpText(hazard.label, x + cardW / 2, y + cardH - 14, "10px 'Press Start 2P', monospace", "#f6f1df");
  });
  screenCtx.restore();
}

function drawSharpWindText() {
  if (state.stage < 4 || state.wind.warning <= 0) return;
  const player = gridToScreen(state.climber.col, state.climber.row);
  const progress = 1 - state.wind.warning / 1.5;
  const travel = canvas.width + 180;
  const arrowRows = [92, 168, 244, 320, 396, 472, 548];
  screenCtx.save();
  screenCtx.textAlign = "center";
  const labelY = Math.min(canvas.height - 105, player.y + 82);
  drawSharpText("DRAFT!", player.x, labelY, "28px 'Press Start 2P', monospace", "#66ddff");
  for (let index = 0; index < arrowRows.length; index += 1) {
    const offset = (index / arrowRows.length) * travel;
    const x = state.wind.direction < 0
      ? canvas.width + 90 - ((progress * travel + offset) % travel)
      : -90 + ((progress * travel + offset) % travel);
    drawSharpText(state.wind.direction < 0 ? "≪" : "≫", x, arrowRows[index], "34px 'Press Start 2P', monospace", "#66ddff");
  }
  screenCtx.restore();
}

function drawSharpOverlayText() {
  if (state.mode === "falling" || (state.mode === "play" && !state.message)) return;
  screenCtx.save();
  screenCtx.textAlign = "center";
  if (state.mode === "play" && state.message === "COOLANT!") {
    drawSharpText("COOLANT!", canvas.width / 2, 238, "32px 'Press Start 2P', monospace", "#f6f1df", state.splatTimer / 1.2);
    screenCtx.restore();
    return;
  }
  if (state.mode === "over") {
    drawSharpText("GAMEOVER", canvas.width / 2, canvas.height / 2, "56px 'Press Start 2P', monospace", "#f6f1df");
    drawSharpText(`SCORE ${String(state.score).padStart(6, "0")}`, canvas.width / 2, canvas.height / 2 + 72, "26px 'Press Start 2P', monospace", "#f6f1df");
    drawSharpText("A / START / SPACE", canvas.width / 2, canvas.height / 2 + 126, "16px 'Press Start 2P', monospace", "#f6f1df");
    screenCtx.restore();
    return;
  }
  if (state.mode === "intro") {
    screenCtx.restore();
    return;
  }
  if (state.mode === "briefing") {
    drawSharpText(`STAGE ${state.stage}`, canvas.width / 2, 154, "42px 'Press Start 2P', monospace", "#f7cf4c");
    drawSharpText("NEW OBSTACLES", canvas.width / 2, 216, "18px 'Press Start 2P', monospace", "#f6f1df");
    drawStageHazardBriefing();
    screenCtx.restore();
    return;
  }
  const title = state.mode === "title" ? "STICK CLIMBER 86" :
    state.mode === "stageClear" ? `BUILDING${state.stage} CLEAR!` :
    state.message;
  const titleY = 238;
  drawSharpText(title, canvas.width / 2, titleY, "48px 'Press Start 2P', monospace", "#f6f1df");
  const sub = state.mode === "title"
    ? `Two sticks, two hands. Climb on the ${bpm} BPM beat.`
    : state.mode === "stageClear"
      ? `${state.stageTarget} FLOOR - ROOFTOP`
      : "A / Start / Space";
  if (sub) drawSharpText(sub, canvas.width / 2, 286, "20px 'Press Start 2P', monospace", "#f6f1df");
  screenCtx.restore();
}

function drawSharpBeatText() {
  if (!state.music.running) return;
  const audioNow = state.music.context ? state.music.context.currentTime : 0;
  const hiTime = hiPopTimes.find((time) => audioNow >= time && audioNow - time < 0.55);
  screenCtx.save();
  screenCtx.textAlign = "center";
  drawSharpText(`${bpm}`, canvas.width - 138, 88, "18px 'Press Start 2P', monospace", state.beatFlash > 0 ? "#f0c64a" : "#f6f1df");
  if (state.beatFlash > 0 && state.judgementAge >= 0.05) {
    const multiplier = Math.min(8, state.combo);
    const judgement = state.beatJudge === "PERFECT" ? "Perfect!" :
      state.beatJudge === "GOOD" ? "Good!" :
      state.beatJudge === "OFF BEAT" ? "Out of rhythm" : state.beatJudge;
    if (state.combo < 9) {
      const scaleRate = 1 + multiplier * 0.1;
      const size = (state.beatJudge === "PERFECT" ? 32 : 24) * scaleRate * successZoomScale();
      drawSharpText(state.combo > 0 ? `${judgement} x${multiplier}` : judgement, canvas.width / 2, canvas.height / 2 - 40,
        `${size}px 'Press Start 2P', monospace`, state.beatJudge === "PERFECT" ? "#f7cf4c" : "#f6f1df", 0.6);
    }
  }
  if (state.feverPop.time > 0) {
    const progress = 1 - state.feverPop.time / 0.55;
    const eased = 1 - Math.pow(1 - progress, 3);
    drawSharpText("FEVER!", canvas.width / 2, canvas.height / 2 - 40,
      `${64 * (1 + eased * 0.1)}px 'Press Start 2P', monospace`, "#f7cf4c", 0.6 * (1 - eased));
  }
  if (state.scorePop.time > 0 && state.scorePop.value > 0) {
    const progress = 1 - state.scorePop.time / 0.5;
    drawSharpText(`+${state.scorePop.value}`, canvas.width / 2 + progress * 300, 132 - progress * 24,
      "18px 'Press Start 2P', monospace", "#f7cf4c", Math.max(0, 1 - progress));
  }
  if (hiTime !== undefined) {
    const age = audioNow - hiTime;
    drawSharpText("HI!", canvas.width / 2, 188, "42px 'Press Start 2P', monospace", "#f7cf4c", Math.max(0, 1 - age / 0.55));
  }
  screenCtx.restore();
}

function drawSharpRooftopText() {
  const time = state.rooftop.time;
  screenCtx.save();
  screenCtx.textAlign = "center";
  drawSharpText("MAINTENANCE", 168, 361, "16px sans-serif", "#eef0dd");
  if (time >= rooftopScoreStart) {
    const centerX = canvas.width / 2;
    drawSharpText(`BUILDING${state.stage} CLEAR!`, centerX, 200, "24px 'Press Start 2P', monospace", "#f7cf4c");
    const countProgress = Math.min(1, Math.max(0, (time - rooftopScoreStart) / rooftopScoreDuration));
    const eased = countProgress * countProgress * (3 - 2 * countProgress);
    const shownScore = Math.floor((state.rooftop.scoreTarget || state.score) * eased);
    drawSharpText(`SCORE ${String(shownScore).padStart(6, "0")}`, centerX, 270, "32px 'Press Start 2P', monospace", "#f7cf4c");
    const scoreNote = state.rooftop.penalty
      ? `PENALTY -${String(state.rooftop.penalty).padStart(6, "0")}`
      : state.rooftop.noPenaltyBonus
        ? `NO PENALTY BONUS +${state.rooftop.noPenaltyBonus}`
        : "NO BONUS";
    drawSharpText(scoreNote, centerX, 302, "14px 'Press Start 2P', monospace", state.rooftop.noPenaltyBonus ? "#8fe0a0" : "#f08a72");
    if (state.mode === "clear") drawSharpText("Press Any Key to Next Stage", centerX, 340, "14px 'Press Start 2P', monospace", state.rooftop.noPenaltyBonus ? "#8fe0a0" : "#f08a72");
  }
  screenCtx.restore();
}

function drawSharpTextLayer() {
  if (state.mode === "rooftop" || state.mode === "clear") {
    drawSharpRooftopText();
    return;
  }
  drawSharpWindText();
  drawSharpBeatText();
  drawSharpOverlayText();
}

function drawBeatMeter() {
  if (!state.music.running) return;
  const audioNow = state.music.context ? state.music.context.currentTime : 0;
  hiPopTimes = hiPopTimes.filter((time) => audioNow - time < 0.55);
  const hiTime = hiPopTimes.find((time) => audioNow >= time && audioNow - time < 0.55);
  const elapsed = rhythmElapsedMs();
  const beatPhase = ((elapsed % beatMs) + beatMs) % beatMs;
  const pulse = Math.max(0, 1 - beatPhase / 150);
  const x = canvas.width - 138;
  const y = 82;
  const r = 24 + pulse * 13;

  ctx.strokeStyle = state.beatFlash > 0 ? "#f0c64a" : "rgba(246,241,223,0.55)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = state.beatFlash > 0 ? "#f0c64a" : "#f6f1df";
  ctx.textAlign = "center";
  ctx.font = "700 18px Consolas, monospace";
  ctx.fillText(`${bpm}`, x, y + 6);
  if (state.beatFlash > 0 && state.judgementAge >= 0.05) {
    const displayZoom = successZoomScale();
    const multiplier = Math.min(8, state.combo);
    const judgement = state.beatJudge === "PERFECT" ? "Perfect!" :
      state.beatJudge === "GOOD" ? "Good!" :
      state.beatJudge === "OFF BEAT" ? "Out of rhythm" : state.beatJudge;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 - 40);
    ctx.textBaseline = "middle";
    ctx.scale(displayZoom, displayZoom);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = state.beatJudge === "PERFECT" ? "#f7cf4c" : "#f6f1df";
    const scaleRate = state.combo >= 9 ? 2 : 1 + multiplier * 0.1;
    const judgementSize = state.beatJudge === "PERFECT" ? 32 : 24;
    ctx.font = `${judgementSize * scaleRate}px 'Press Start 2P', monospace`;
    if (state.combo < 9) ctx.fillText(state.combo > 0 ? `${judgement} x${multiplier}` : judgement, 0, 0);
    ctx.restore();
  }
  if (state.feverPop.time > 0) {
    const progress = 1 - state.feverPop.time / 0.55;
    const eased = 1 - Math.pow(1 - progress, 3);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 - 40);
    ctx.textBaseline = "middle";
    ctx.scale(1 + eased * 0.1, 1 + eased * 0.1);
    ctx.globalAlpha = 0.6 * (1 - eased);
    ctx.fillStyle = "#f7cf4c";
    ctx.font = "64px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText("FEVER!", 0, 0);
    ctx.restore();
  }
  if (state.scorePop.time > 0 && state.scorePop.value > 0) {
    const progress = 1 - state.scorePop.time / 0.5;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.fillStyle = "#f7cf4c";
    ctx.font = "18px 'Press Start 2P', monospace";
    ctx.fillText(`+${state.scorePop.value}`, canvas.width / 2 + progress * 300, 132 - progress * 24);
    ctx.restore();
  }
  if (hiTime !== undefined) {
    const age = audioNow - hiTime;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age / 0.55);
    ctx.fillStyle = "#f7cf4c";
    ctx.font = "42px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText("HI!", canvas.width / 2, 188);
    ctx.restore();
  }
}

function draw() {
  suppressPixelText = true;
  if (state.mode === "rooftop" || state.mode === "clear") {
    drawRooftop();
    presentPixelFrame();
    suppressPixelText = false;
    drawSharpTextLayer();
    ui.score.textContent = String(state.score).padStart(6, "0");
    ui.height.textContent = stageHeightLabel();
    return;
  }
  const wobble = state.shake > 0 ? Math.sin(performance.now() * 0.09) * state.shake * 16 : 0;
  ctx.save();
  const zoom = successZoomScale();
  const pivot = gridToScreen(state.climber.col, state.climber.row);
  ctx.translate(pivot.x, pivot.y);
  ctx.scale(zoom, zoom);
  ctx.translate(-pivot.x, -pivot.y);
  ctx.translate(wobble, 0);
  drawSkyline();
  drawBuilding();
  drawGroundEntrance();
  drawWindWarning();
  drawObstacles();
  drawObstacleActors();
  drawOnlookers();
  if (state.mode !== "over") drawClimber();
  ctx.restore();
  drawBeatMeter();
  drawOverlay();
  presentPixelFrame();
  suppressPixelText = false;
  drawSharpTextLayer();

  ui.height.textContent = stageHeightLabel();
  ui.score.textContent = String(state.score).padStart(6, "0");
  ui.lives.textContent = String(state.lives);
  ui.combo.textContent = `${state.combo} / x${rhythmMultiplier()}`;
  ui.beatJudge.textContent = state.beatJudge;
}

function rooftopPhase(time) {
  if (time < 2) return "arrival";
  if (time < 6) return "victory";
  if (time < 9) return "arrest";
  if (time < 14) return "escort";
  return "complete";
}

function beginRooftop() {
  if (state.mode === "rooftop" || state.mode === "clear") return;
  cancelClimbVoices();
  state.mode = "rooftop";
  state.message = "";
  const penalty = state.stagePenalty;
  state.score = Math.max(0, state.score - penalty);
  const noPenaltyBonus = penalty === 0 && !state.stageDamaged ? 30000 : 0;
  state.rooftop = {
    time: 0,
    speed: 1,
    penalty,
    noPenaltyBonus,
    scoreTarget: state.score + 5000 + noPenaltyBonus,
  };
  state.score += 5000 + noPenaltyBonus;
}

function rooftopCheers() {
  const context = state.music.context;
  if (!context || context.state !== "running") return;
  const now = context.currentTime;
  // Detuned rising vowels, noise applause and whistles form a synthetic crowd.
  for (let i = 0; i < 12; i++) {
    const time = now + i * 0.07;
    playTone(time, 230 + (i % 5) * 55, 0.65, 0.035, "sawtooth");
    playTone(time + 0.1, 310 + (i % 5) * 65, 0.5, 0.025, "triangle");
    playNoise(time, 0.11, 0.07);
  }
  playTone(now + 0.3, 1568, 0.35, 0.035, "sine");
}

function updateRooftop(dt) {
  const previous = state.rooftop.time;
  state.rooftop.time += dt * (state.rooftop.speed || 1);
  const time = state.rooftop.time;
  if (previous < 2 && time >= 2) rooftopCheers();
  if (time >= 2 && time < 6 && Math.floor(time * 2) !== Math.floor(previous * 2)) {
    if (state.music.context) playNoise(state.music.context.currentTime, 0.18, 0.12);
  }
  if (previous < 8 && time >= 8 && state.music.context) {
    playClick(state.music.context.currentTime, true);
  }
  if (time >= rooftopScoreStart + rooftopScoreDuration) state.mode = "clear";
}

function drawRooftopHandcuffs(x, y) {
  ctx.fillStyle = "#26323a";
  ctx.fillRect(x - 21, y - 9, 18, 18);
  ctx.fillRect(x + 3, y - 9, 18, 18);
  ctx.fillStyle = "#d8e6ea";
  for (const center of [x - 12, x + 12]) {
    ctx.fillRect(center - 6, y - 6, 12, 3);
    ctx.fillRect(center - 6, y + 3, 12, 3);
    ctx.fillRect(center - 6, y - 3, 3, 6);
    ctx.fillRect(center + 3, y - 3, 3, 6);
  }
  ctx.fillRect(x - 3, y - 3, 6, 6);
  ctx.fillStyle = "#71848b";
  ctx.fillRect(x - 6, y - 3, 12, 3);
}

function rooftopDanceOffset(time) {
  return Math.round(Math.sin(time * 10) * 3) * 3;
}

function rooftopLegOffsets(pose, time) {
  if (pose === "dance") {
    const wiggle = Math.round(Math.sin(time * 16) * 2) * 3;
    return [-wiggle, wiggle];
  }
  return [0, 0];
}

function rooftopPerson(x, feet, police, pose, time) {
  const dancing = pose === "dance";
  const frontFacing = !police && dancing;
  const danceX = dancing ? rooftopDanceOffset(time) : 0;
  const danceY = dancing ? Math.abs(Math.round(Math.sin(time * 20) * 2)) * 3 : 0;
  const shirt = police ? "#2c5b9a" : "#d82b39";
  const pants = police ? "#1f355a" : "#1244cb";
  const skin = police ? "#c98562" : "#efb286";
  const legOffsets = rooftopLegOffsets(pose, time);
  const torsoY = feet - 78;

  ctx.save();
  if (dancing) ctx.translate(danceX, danceY);

  for (const [index, sign] of [-1, 1].entries()) {
    const hip = { x: x + sign * 9, y: feet - 36 };
    const knee = { x: x + sign * 15 + legOffsets[index], y: feet - 18 };
    const ankle = { x: x + sign * 18 - legOffsets[index], y: feet - 6 };
    drawSpriteSegment(hip, knee, 10, pants, police ? "#4778b9" : "#2d67ef");
    drawSpriteSegment(knee, ankle, 10, pants);
    const shoeX = sign < 0 ? ankle.x - 18 : ankle.x - 3;
    ctx.fillStyle = "#101719";
    ctx.fillRect(shoeX, feet - 6, 21, 9);
    ctx.fillStyle = police ? "#20262e" : "#f4f1df";
    ctx.fillRect(shoeX + 3, feet - 6, 15, 6);
    if (!police) {
      ctx.fillStyle = "#d82b39";
      ctx.fillRect(shoeX + 6, feet - 3, 9, 3);
    }
  }

  ctx.fillStyle = "#152127";
  ctx.fillRect(x - 16, torsoY, 32, 38);
  ctx.fillRect(x - 20, torsoY + 8, 40, 22);
  ctx.fillStyle = shirt;
  ctx.fillRect(x - 12, torsoY + 4, 24, 30);
  ctx.fillRect(x - 16, torsoY + 10, 32, 18);
  ctx.fillStyle = police ? "#4778b9" : "#f04d4d";
  ctx.fillRect(x - 10, torsoY + 8, 6, 18);
  ctx.fillRect(x - 6, torsoY + 6, 4, 6);
  ctx.fillStyle = police ? "#172944" : "#f4f1df";
  ctx.fillRect(x - 14, torsoY + 26, 28, 4);
  ctx.fillRect(x - 12, torsoY + 30, 24, 4);

  const raised = pose === "victory" || dancing;
  for (const sign of [-1, 1]) {
    const hand = {
      x: pose === "cuffed" ? x + sign * 12 : x + sign * (raised ? 39 : 30),
      y: raised ? feet - 129 : feet - 54,
    };
    const shoulder = { x: x + sign * 15, y: feet - 66 };
    const elbow = { x: (shoulder.x + hand.x) / 2, y: (shoulder.y + hand.y) / 2 };
    drawSpriteSegment(shoulder, elbow, 10, shirt, police ? "#4778b9" : "#f04d4d");
    drawSpriteSegment(elbow, hand, 8, skin);
    ctx.fillStyle = "#633d30";
    ctx.fillRect(hand.x - 8, hand.y - 8, 16, 16);
    ctx.fillStyle = skin;
    ctx.fillRect(hand.x - 6, hand.y - 6, 12, 12);
  }

  ctx.fillStyle = skin;
  ctx.fillRect(x - 6, feet - 87, 12, 8);
  ctx.fillRect(x - 16, feet - 119, 32, 32);
  ctx.fillRect(x - 20, feet - 113, 40, 20);
  if (police) {
    ctx.fillStyle = "#172944";
    ctx.fillRect(x - 20, feet - 123, 40, 16);
    ctx.fillRect(x - 24, feet - 115, 8, 14);
    ctx.fillRect(x + 16, feet - 115, 8, 14);
    ctx.fillRect(x - 14, feet - 105, 28, 8);
    ctx.fillRect(x - 18, feet - 129, 36, 6);
    ctx.fillRect(x - 22, feet - 125, 44, 4);
    ctx.fillStyle = "#f0cf53";
    ctx.fillRect(x - 3, feet - 120, 6, 6);
    ctx.fillRect(x - 9, torsoY + 16, 6, 9);
  } else if (frontFacing) {
    ctx.fillStyle = "#111418";
    ctx.fillRect(x - 20, feet - 123, 40, 14);
    ctx.fillRect(x - 20, feet - 115, 6, 12);
    ctx.fillRect(x + 14, feet - 115, 6, 12);
    ctx.fillRect(x - 14, feet - 111, 28, 6);
    ctx.fillStyle = "#202226";
    ctx.fillRect(x - 18, feet - 129, 36, 6);
    ctx.fillRect(x - 22, feet - 125, 44, 4);
    ctx.fillStyle = "#f4f1df";
    ctx.fillRect(x - 24, feet - 117, 48, 6);
    ctx.fillRect(x - 30, feet - 113, 6, 16);
    ctx.fillRect(x - 36, feet - 101, 6, 10);
    ctx.fillStyle = "#111418";
    ctx.fillRect(x - 10, feet - 105, 6, 6);
    ctx.fillRect(x + 4, feet - 105, 6, 6);
    ctx.fillRect(x - 2, feet - 100, 4, 5);
    ctx.fillStyle = "#9b1f2c";
    ctx.fillRect(x - 6, feet - 92, 12, 3);
    ctx.fillStyle = "#f3a3a0";
    ctx.fillRect(x - 15, feet - 97, 4, 3);
    ctx.fillRect(x + 11, feet - 97, 4, 3);
  } else {
    ctx.fillStyle = "#111418";
    ctx.fillRect(x - 20, feet - 123, 40, 18);
    ctx.fillRect(x - 24, feet - 113, 8, 20);
    ctx.fillRect(x + 16, feet - 113, 8, 20);
    ctx.fillRect(x - 16, feet - 105, 32, 20);
    ctx.fillRect(x - 12, feet - 89, 24, 8);
    ctx.fillStyle = "#202226";
    ctx.fillRect(x - 18, feet - 129, 36, 6);
    ctx.fillRect(x - 22, feet - 125, 44, 4);
    ctx.fillStyle = "#f4f1df";
    ctx.fillRect(x - 24, feet - 117, 48, 6);
    ctx.fillRect(x - 30, feet - 113, 6, 16);
    ctx.fillRect(x - 36, feet - 101, 6, 10);
  }

  if (pose === "cuffed") drawRooftopHandcuffs(x, feet - 54);
  ctx.restore();
}

function drawRooftop() {
  const time = state.rooftop.time;
  const phase = rooftopPhase(time);
  ctx.fillStyle = "#111424"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = i % 3 ? "#8bacc5" : "#ffffff";
    ctx.fillRect((i * 139) % 960, (i * 67) % 320, 2, 2);
  }
  if (time >= 2 && time < 7) {
    const colors = ["#f7cf4c", "#f7779d", "#59dfb2", "#80baff"];
    for (let burst = 0; burst < 5; burst++) {
      const age = ((time - 2 + burst * 0.31) % 1.6);
      const x = 290 + burst * 135;
      const y = 100 + (burst % 3) * 55;
      ctx.globalAlpha = Math.max(0, 1 - age / 1.6);
      ctx.fillStyle = colors[burst % colors.length];
      for (let ray = 0; ray < 28; ray++) {
        const angle = ray * Math.PI * 2 / 28;
        const radius = age * 65;
        ctx.fillRect(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius + age * age * 20, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = "#36464a"; ctx.fillRect(64, 440, 832, 200);
  ctx.fillStyle = "#95a5a7"; ctx.fillRect(64, 420, 832, 22);
  ctx.fillStyle = "#56686b"; ctx.fillRect(64, 520, 832, 18);
  ctx.fillStyle = "#809496"; ctx.fillRect(90, 320, 155, 200);
  ctx.fillStyle = "#c0cbca"; ctx.fillRect(80, 307, 175, 16);
  ctx.fillStyle = "#202b30"; ctx.fillRect(136, 396, 65, 124);
  ctx.fillStyle = "#eef0dd"; ctx.font = "16px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("MAINTENANCE", 168, 361);
  const travel = Math.min(1, Math.max(0, (time - 9) / 5));
  const playerX = 530 + (166 - 530) * travel;
  const feet = time < 2 ? 600 - Math.min(1, time / 2) * 90 : 510;
  if (time < 14) {
    rooftopPerson(playerX, feet, false, phase === "victory" ? "dance" : time >= 8 ? "cuffed" : "walk", time);
    if (time >= 6) {
      const officerX = time < 9 ? 960 - Math.min(1, (time - 6) / 2) * 375 : playerX + 55;
      rooftopPerson(officerX, 510, true, "walk", time);
    }
  }
  // Door overlays the actors as they enter the hut.
  if (travel > 0.88 || time >= 14) {
    ctx.fillStyle = "#687d80";
    const closing = Math.min(1, Math.max(0, time - 14));
    ctx.fillRect(136, 396, 65 * closing, 124);
  }
  if (time >= rooftopScoreStart) {
    const centerX = canvas.width / 2;
    ctx.fillStyle = "#f7cf4c"; ctx.font = "24px 'Press Start 2P', monospace";
    ctx.fillText(`BUILDING${state.stage} CLEAR!`, centerX, 300);
    const countProgress = Math.min(1, Math.max(0, (time - rooftopScoreStart) / rooftopScoreDuration));
    const eased = countProgress * countProgress * (3 - 2 * countProgress);
    const shownScore = Math.floor((state.rooftop.scoreTarget || state.score) * eased);
    ctx.font = "32px 'Press Start 2P', monospace";
    ctx.fillText(`SCORE ${String(shownScore).padStart(6, "0")}`, centerX, 370);
    ctx.font = "14px 'Press Start 2P', monospace";
    ctx.fillStyle = state.rooftop.noPenaltyBonus ? "#8fe0a0" : "#f08a72";
    const scoreNote = state.rooftop.penalty
      ? `PENALTY -${String(state.rooftop.penalty).padStart(6, "0")}`
      : state.rooftop.noPenaltyBonus
        ? `NO PENALTY BONUS +${state.rooftop.noPenaltyBonus}`
        : "NO BONUS";
    ctx.fillText(scoreNote, centerX, 402);
    if (state.mode === "clear") {
      ctx.font = "14px 'Press Start 2P', monospace";
      ctx.fillText("Press Any Key to Next Stage", centerX, 440);
    }
  }
}

function loop(time) {
  const dt = Math.min(0.033, (time - state.lastTime) / 1000 || 0);
  state.lastTime = time;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const fresh = !event.repeat && !state.keys.has(event.code);
  state.keys.add(event.code);
  if (state.mode === "teaser") {
    if (!fresh) return;
    if (event.code === "Space") state.restartHeld = true;
    dismissTeaser();
    return;
  }
  if (!state.music.context || state.music.context.state !== "running") startMusic();
  if (fresh) {
    state.menuKeyPressed = true;
    if (event.code === "Space") state.startKeyPressed = true;
  }
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }
});

window.addEventListener("pointerdown", () => {
  if (state.mode === "teaser") dismissTeaser();
  else startMusic();
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.code);
});

window.addEventListener("gamepadconnected", () => {
  ui.pad.textContent = "READY";
});

window.addEventListener("gamepaddisconnected", () => {
  ui.pad.textContent = "WAIT";
});

requestAnimationFrame(loop);
