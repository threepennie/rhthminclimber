const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('game renderer keeps high resolution with a coarse grid and thick pixel-like outlines', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');
  const styles = fs.readFileSync('src/styles.css', 'utf8');
  assert.match(source, /const pixelScale = 1;/);
  assert.match(source, /const pixelGrid = 2;/);
  assert.match(source, /const pixelOutlineWidth = 3;/);
  assert.match(source, /const buildingX = 96;/);
  assert.match(source, /const buildingW = 768;/);
  assert.match(source, /const windowH = 36;/);
  assert.match(source, /imageSmoothingEnabled = false/);
  assert.match(source, /function drawSharpTextLayer\(\)/);
  assert.match(source, /screenCtx\.fillText/);
  assert.match(styles, /width: min\(100%, 960px\)/);
  assert.match(index, /id="birdBriefing" src="assets\/images\/bird-briefing\.png"/);
  assert.match(index, /rhythmic-climber-title-v3\.png/);
  assert.match(index, /id="sniperLeft" src="assets\/images\/sniper-left\.png"/);
  assert.match(index, /id="sniperRight" src="assets\/images\/sniper-right\.png"/);
  assert.match(index, /id="tysonL01" src="assets\/images\/tyson-l01\.png"/);
  assert.match(index, /id="tysonStraight03" src="assets\/images\/tyson-straight-03\.png"/);
  assert.match(source, /function drawSharpSniperSprites\(/);
  assert.match(source, /function drawSharpTysonSprites\(/);
  assert.match(source, /const briefingShirtRed = "#c83f3a"/);
  assert.match(source, /const birdBriefingSprite = document\.querySelector\("#birdBriefing"\)/);
  assert.match(source, /function tysonJabFrameIndex\(/);
  assert.match(source, /function tysonStraightFrameIndex\(/);
  assert.doesNotMatch(source, /function drawSentinelTurret\(/);
  assert.match(index, /id="sfxVolume"/);
  assert.match(index, /setAudioVolume\('sfx', this\.value \/ 100\)/);
  assert.match(styles, /\[aria-label="Audio mix"\]/);
  assert.match(source, /screenCtx\.drawImage\(sprite/);
  assert.match(fs.readFileSync('server.js', 'utf8'), /"\.png": "image\/png"/);
});

test('tower facade uses blue open and dark brown closed windows', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const run = game();
  assert.match(source, /function drawWindow\(/);
  run(`window.windowColors = [];
    Object.defineProperty(ctx, 'fillStyle', { set(value) { window.windowColors.push(value); }, get() { return ''; } });
    ctx.fillRect = () => {};
    drawWindow({ x: 480, y: 320 }, 1);
    drawWindow({ x: 480, y: 320 }, 0);`);
  assert.equal(run("window.windowColors.includes('#57b9dd')"), true);
  assert.equal(run("window.windowColors.includes('#57321e')"), true);
  assert.equal(run("window.windowColors.includes('#111719')"), true);
});

function game() {
  const sandbox = {
    document: { querySelector: () => ({ getContext: () => ({}), width: 960, height: 640 }) },
    window: { listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } }, requestAnimationFrame() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('src/main.js', 'utf8'), sandbox);
  vm.runInContext('state.music.running = true; state.music.context = { currentTime: 10, createGain: () => ({ gain: { value: 1 }, connect() {} }) }; state.music.startedAt = 10;', sandbox);
  return (code) => vm.runInContext(code, sandbox);
}

test('audio beat awards PERFECT and early/late GOOD symmetrically', () => {
  for (const delta of [0, -0.04, 0.04, -0.08, 0.08]) {
    const run = game();
    run(`state.music.context.currentTime = 10 + 60 / bpm + ${delta}`);
    assert.equal(run('judgeBeat().label'), Math.abs(delta) <= 0.045 ? 'PERFECT' : 'GOOD');
  }
});

test('effects volume has an independent runtime control', () => {
  const run = game();
  run('state.music.sfx = { gain: { value: 0 } }; setAudioVolume("sfx", 0.64)');
  assert.equal(run('audioMix.sfx'), 0.64);
  assert.equal(run('state.music.sfx.gain.value'), 0.64);
});

test('beat judgement becomes OFF BEAT beyond the tightened GOOD window', () => {
  const run = game();
  run('state.music.context.currentTime = 10 + 60 / bpm + 0.091');
  assert.equal(run('judgeBeat().label'), 'OFF BEAT');
});
test('same beat cannot farm combo or bonus', () => {
  const run = game();
  assert.equal(run('judgeBeat().bonus'), 300);
  assert.equal(run('judgeBeat().bonus'), 0);
  assert.equal(run('state.combo'), 1);
});
test('consecutive beats grow multiplier; long breaks reset it', () => {
  const run = game();
  for (let i = 0; i < 8; i++) run(`state.music.context.currentTime = 10 + ${i} * 60 / bpm; judgeBeat()`);
  assert.equal(run('state.combo'), 8);
  assert.equal(run('rhythmMultiplier()'), 3);
  run('state.music.context.currentTime += 4 * 60 / bpm; judgeBeat()');
  assert.equal(run('state.combo'), 1);
});
test('offbeat breaks combo and gives no bonus', () => {
  const run = game();
  run('judgeBeat(); state.music.context.currentTime += 0.24');
  assert.equal(run('judgeBeat().bonus'), 0);
  assert.equal(run('state.combo'), 0);
});

test('offbeat cancels the previous call and does not schedule a new one', () => {
  const run = game();
  run(`hiRecording = {}; window.starts = 0; window.stops = 0;
    state.music.context.createBufferSource = () => ({ connect() {}, disconnect() {},
      start() { window.starts++; }, stop() { window.stops++; }
    });
    state.combo = 3; playClimbVoice(judgeBeat());
    state.music.context.currentTime += 0.24;
    playClimbVoice(judgeBeat());`);
  assert.equal(run('window.starts'), 1);
  assert.equal(run('window.stops'), 1);
});

test('repeated-beat climb does not add an extra Hi', () => {
  const run = game();
  run(`hiRecording = {}; window.starts = 0;
    state.music.context.createBufferSource = () => ({ connect() {}, start() { window.starts++; } });
    state.combo = 3; playClimbVoice(judgeBeat()); playClimbVoice(judgeBeat());`);
  assert.equal(run('window.starts'), 1);
});

test('idle BGM no longer triggers Hi', () => {
  const run = game();
  run(`window.calls = []; hiRecording = {}; state.music.context.createBufferSource = () => ({
    connect() {}, start(time) { window.calls.push('Hi!'); }
  }); window.speechSynthesis = {
    cancel() {}, getVoices() { return []; }, speak(call) { window.calls.push(call.text); }
  }; window.SpeechSynthesisUtterance = function(text) { this.text = text; };`);
  run(`playKick = () => {}; playClick = () => {}; playTechnoBass = () => {};
    playHat = () => {}; playTone = () => {};
    state.music.nextBeat = 10; state.music.beatIndex = 0;
    scheduleBeat(); state.music.context.currentTime += 60 / bpm; scheduleBeat();`);
  assert.equal(run('window.calls.join(",")'),
    '');
});

test('recorded Hi starts 40ms ahead of the supplied beat', () => {
  const run = game();
  run(`hiRecording = {}; window.starts = [];
    state.music.context.createBufferSource = () => ({
      connect() {}, start(time) { window.starts.push(time); }
    }); playBeatVoice(10.12); playBeatVoice(10.12 + 60 / bpm);`);
  assert.ok(run('Math.abs(window.starts[0] - 10.08) < 0.00001'));
  assert.ok(run('Math.abs(window.starts[1] - (10.12 + 60 / bpm - 0.04)) < 0.00001'));
});

test('successful climb schedules Hi on the next beat with calibrated advance', () => {
  const run = game();
  run(`window.starts = [];
    hiRecording = {}; state.music.context.createBufferSource = () => ({
      connect() {}, start(time) { window.starts.push(time); }
    });
    windowOpen = () => true; state.hands.left.row = 2; state.combo = 3;
    climbOneBlock({}, 'left');`);
  assert.equal(run('window.starts.length'), 1);
  assert.ok(run('Math.abs(window.starts[0] - (10 + 60 / bpm - 0.04)) < 0.00001'));
});

test('Hi and zoom trigger at combo 4, 6, 8 and every FEVER combo', () => {
  const run = game();
  run(`window.calls = []; playBeatVoice = () => window.calls.push(state.combo);
    for (let combo = 1; combo <= 12; combo++) {
      state.combo = combo; playClimbVoice({ bonus: 300 });
    }`);
  assert.equal(run('window.calls.join(",")'), '4,6,8,9,10,11,12');
});

test('FEVER starts at combo 9 and uses the capped display count', () => {
  const run = game();
  run('state.music.context.currentTime = 10; state.music.running = true; state.combo = 8; judgeBeat()');
  assert.equal(run('state.feverPop.time > 0'), true);
  assert.equal(run('Math.min(8, state.combo)'), 8);
});

test('blocked climb does not trigger Hi', () => {
  const run = game();
  run(`window.starts = []; hiRecording = {};
    state.music.context.createBufferSource = () => ({ connect() {}, start(time) { window.starts.push(time); } });
    windowOpen = () => false; climbOneBlock({}, 'left');`);
  assert.equal(run('window.starts.length'), 0);
});

test('success zoom follows scheduled voice and returns to normal', () => {
  const run = game();
  run(`hiRecording = {}; state.music.context.createBufferSource = () => ({
    connect() {}, start() {}, stop() {}
  }); playBeatVoice(10.12);`);
  assert.equal(run('successZoomScale()'), 1);
  run('state.music.context.currentTime = 10.08');
  assert.ok(run('Math.abs(successZoomScale() - 1.05) < 0.00001'));
  run('state.music.context.currentTime = 10.4');
  assert.equal(run('successZoomScale()'), 1);
});

test('cancelled Hi also cancels its zoom', () => {
  const run = game();
  run(`hiRecording = {}; state.music.context.createBufferSource = () => ({
    connect() {}, start() {}, stop() {}
  }); playBeatVoice(10.12); cancelClimbVoices();
  state.music.context.currentTime = 10.08;`);
  assert.equal(run('successZoomScale()'), 1);
});

test('on-beat sideways movement builds rhythm combo', () => {
  const run = game();
  run(`windowOpen = () => true; moveSideOneBlock('right');`);
  assert.equal(run('state.combo'), 1);
  assert.equal(run('state.score'), 320);
});

test('outward reach and sideways movement keep combo on successive beats', () => {
  for (const side of ['left', 'right']) {
    const run = game();
    const x = side === 'left' ? -1 : 1;
    run(`windowOpen = () => true;
      moveHand('${side}', { x: ${x}, y: 0 });`);
    assert.equal(run('state.combo'), 1);
    run(`state.music.context.currentTime += 60 / bpm; moveSideOneBlock('${side}');`);
    assert.equal(run('state.combo'), 2);
    run(`state.music.context.currentTime += 60 / bpm;
      state.hands.${side}.ready = true; state.hands.${side}.cooldown = 0;
      moveHand('${side}', { x: ${x}, y: 0 });`);
    assert.equal(run('state.combo'), 3);
  }
});

test('upward hand reach from a sideways pose is a rhythm action', () => {
  const run = game();
  run(`windowOpen = () => true;
    state.hands.right.col = state.climber.col + 1;
    state.hands.right.row = state.climber.row;
    moveHand('right', { x: 0, y: -1 });`);
  assert.equal(run('state.combo'), 1);
  assert.equal(run('state.hands.right.row'), run('state.climber.row + 1'));
});

test('reaching the same window again does not earn rhythm points', () => {
  const run = game();
  run(`windowOpen = () => true; moveHand('right', { x: 1, y: 0 });
    state.music.context.currentTime += 60 / bpm;
    state.hands.right.ready = true; state.hands.right.cooldown = 0;
    moveHand('right', { x: 1, y: 0 });`);
  assert.equal(run('state.combo'), 1);
});

test('single down does not descend; deliberate double down does', () => {
  const run = game();
  run(`state.descentLocked = false; windowOpen = () => true;
    window.contextFor = (left, right) => ({ before: {
      left: { col: 4, row: 1 }, right: { col: 4, row: 1 }
    }, moves: { left, right } });
    updateBodyMovement(window.contextFor('down', 'neutral'));`);
  assert.equal(run('state.climber.row'), 1);
  run("updateBodyMovement(window.contextFor('down', 'down'))");
  assert.equal(run('state.climber.row'), 0);
});

test('after stopping descent stays locked until a successful sideways or upward move', () => {
  const run = game();
  run(`windowOpen = () => true; state.descentLocked = false;
    updateRestartProtection({ left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }, 0.31);
    moveDownOneBlock('right');`);
  assert.equal(run('state.climber.row'), 1);
  assert.equal(run('state.descentLocked'), true);
  run("moveSideOneBlock('right')");
  assert.equal(run('state.descentLocked'), false);
});

test('climbing remains available without speech synthesis', () => {
  const run = game();
  run('state.music.context = null');
  assert.doesNotThrow(() => run('playBeatVoice(10)'));
});

test('intro is gentle and difficulty grows with height', () => {
  const run = game();
  assert.equal(run('rowsOnScreen'), 15);
  assert.ok(run('cellH * rowsOnScreen <= canvas.height'));
  assert.ok(run('openChanceForRow(1) >= 0.95'));
  assert.ok(run('obstacleInterval(0) >= 6'));
  assert.ok(run('obstacleInterval(40) < obstacleInterval(0)'));
});

test('window closures increase by stage while stage one stays accessible', () => {
  const run = game();
  run('state.stage = 1;');
  const stageOne = run('openChanceForRow(24)');
  run('state.stage = 3;');
  const stageThree = run('openChanceForRow(24)');
  assert.ok(stageOne > stageThree);
  run('state.stage = 1;');
  assert.ok(run('openChanceForRow(1) >= 0.99'));
});

test('stage window difficulty uses individual stage settings', () => {
  const run = game();
  run('state.stage = 1;');
  const stageOne = run('openChanceForRow(24)');
  run('state.stage = 2;');
  const stageTwo = run('openChanceForRow(24)');
  run('state.stage = 3;');
  const stageThree = run('openChanceForRow(24)');
  assert.ok(stageOne > stageTwo);
  assert.ok(stageTwo > stageThree);
  run('state.stage = 4;');
  const stageFour = run('openChanceForRow(24)');
  run('state.stage = 6;');
  const stageSix = run('openChanceForRow(24)');
  assert.ok(stageThree > stageFour);
  assert.ok(stageFour > stageSix);
  assert.ok(stageOne - stageTwo < 0.04);
  assert.ok(stageTwo - stageThree < 0.04);
});

test('stage four exhaust draft warns before shifting obstacles by one column', () => {
  const run = game();
  run('state.stage = 4; state.wind.timeUntil = 0; Math.random = () => 0.9; updateWind(0.01)');
  assert.equal(run('state.wind.warning'), 1.5);
  assert.equal(run('state.wind.direction'), 1);
  run('state.obstacles = [{ col: 2, row: 8 }, { col: 7, row: 8 }]; state.wind.warning = 0.01; updateWind(0.02)');
  assert.equal(run('state.obstacles[0].col'), 3);
  assert.equal(run('state.obstacles[1].col'), 7);
});

test('exhaust draft starts at stage four', () => {
  const run = game();
  run('state.stage = 4; state.wind.timeUntil = 0; Math.random = () => 0.1; updateWind(0.01)');
  assert.equal(run('state.wind.warning'), 1.5);
});

test('coolant drops start at stage three', () => {
  const run = game();
  run('state.stage = 3; Math.random = () => 0.17; spawnObstacle()');
  assert.equal(run('state.birds.length'), 1);
  assert.equal(run('state.obstacles.length'), 0);
  run('state.birds[0].x = buildingX + 100; state.birds[0].dropTimer = 0; updateObstacleActors(0.01)');
  assert.equal(run('state.obstacles[0].type'), 'c');
});

test('bouncing beams start at stage three and bounce to an adjacent column every five floors', () => {
  const run = game();
  run('state.stage = 2; Math.random = () => 0.4; spawnObstacle()');
  assert.notEqual(run('state.obstacles[0].type'), 'e');
  run('state.obstacles = []; state.stage = 3; Math.random = () => 0.4; spawnObstacle()');
  assert.equal(run('state.obstacles[0].type'), 'e');
  assert.equal(run('state.obstacles[0].bounceEvery'), 5);
  assert.ok(run('state.obstacles[0].bounceDirection === -1 || state.obstacles[0].bounceDirection === 1'));
  run('state.spawnTimer = 99; state.obstacles[0].row = 20; state.obstacles[0].col = 3; state.obstacles[0].speed = 1; state.obstacles[0].bounceDistance = 5; updateObstacles(5.1)');
  assert.ok(run('state.obstacles[0].row > 14.8'));
  run('updateObstacles(0.6)');
  run('updateObstacles(0.5)');
  assert.ok(run('state.obstacles[0].col === 2 || state.obstacles[0].col === 4'));
});

test('bouncing beam uses a visible pause, rise and lane-change sequence', () => {
  const run = game();
  run('state.stage = 3; state.camera = 0; state.spawnTimer = 99; state.obstacles = [{ type: "e", col: 3, row: 10, speed: 1, sway: 0, bounceEvery: 5, bounceDistance: 0, bounceDirection: 1, bounceState: "falling", bounceTime: 0 }]');
  run('updateObstacles(0.01)');
  assert.equal(run('state.obstacles[0].bounceState'), 'rising');
  assert.ok(run('state.obstacles[0].row < 10 && state.obstacles[0].row > 9.98'));
  run('updateObstacles(0.2)');
  assert.ok(run('state.obstacles[0].row > 10'));
  assert.equal(run('state.obstacles[0].bounceState'), 'lane');
  run('updateObstacles(0.5)');
  assert.equal(run('state.obstacles[0].bounceState'), 'falling');
  assert.equal(run('state.obstacles[0].col'), 4);
});

test('falling hazards sustain their sounds while bounce and dropping events stay one-shot', () => {
  const run = game();
  run(`window.beamDrops = 0; window.vaseFalls = 0; window.pinkBounces = 0; window.dumbbellFalls = 0; window.birdMelodies = 0; window.poops = 0; window.charges = 0; window.shots = 0;
    playBeamDropSound = () => { window.beamDrops += 1; };
    playVaseFallSound = () => { window.vaseFalls += 1; };
    playPinkBeamBounce = () => { window.pinkBounces += 1; };
    playDumbbellFallSound = () => { window.dumbbellFalls += 1; };
    playBirdFlightMelody = () => { window.birdMelodies += 1; };
    playPoopDropSound = () => { window.poops += 1; };
    playSniperCharge = () => { window.charges += 1; };
    playSniperShot = () => { window.shots += 1; };
    state.spawnTimer = 99; state.obstacles = [{ type: 'b', col: 3, row: 10, speed: 1, sway: 0 }]; updateObstacles(0.01);
    state.obstacles = [{ type: 'e', col: 3, row: 10, speed: 1, sway: 0, bounceEvery: 5, bounceDistance: 0, bounceDirection: 1, bounceState: 'falling', bounceTime: 0 }]; updateObstacles(0.01);
    state.obstacles = [{ type: 'a' }]; updateFallingHazardSounds(0.3);
    state.obstacles = [{ type: 'f' }]; updateFallingHazardSounds(0.3); state.residents = [{ col: 2, row: 8, age: 0.79, dropped: false }];
    state.birds = [{ x: buildingX + 100, y: 60, direction: 1, age: 0, dropTimer: 0 }];
    updateObstacleActors(0.02); state.stage = 3; Math.random = () => 0.17; spawnObstacle();
    state.snipers = [{ col: 1, row: 12, age: 0.99, target: null, fired: false }, { col: 6, row: 12, age: 0.99, target: null, fired: false }];
    updateSnipers(0.02); updateSnipers(1.5);`);
  assert.equal(run('window.beamDrops'), 1);
  assert.equal(run('window.vaseFalls'), 1);
  assert.equal(run('window.pinkBounces'), 1);
  assert.equal(run('window.dumbbellFalls'), 1);
  assert.equal(run('window.birdMelodies'), 1);
  assert.equal(run('window.poops'), 1);
  assert.equal(run('window.charges'), 2);
  assert.equal(run('window.shots'), 2);
});

test('sniper preparation uses a sustained independent effects bus', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  assert.match(source, /audioMix = \{ bgm: 0\.9, voice: 0\.18, sfx: 1 \}/);
  assert.match(source, /sfx\.connect\(context\.destination\)/);
  assert.match(source, /gain\.connect\(state\.music\.sfx \|\| state\.music\.master\)/);
  assert.match(source, /gain\.gain\.setValueAtTime\(gainValue, time \+ duration \* 0\.82\)/);
  assert.match(source, /playEffectSweep\(420, 1380/);
  assert.match(source, /playEffectSweep\(680, 1680/);
});

test('continuous beam and vase sounds are quiet and quantized to the half beat', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  assert.match(source, /function fallingSoundOffset\(\)/);
  assert.match(source, /const halfBeat = 30 \/ bpm/);
  assert.match(source, /playEffectSweep\(220, 196, 0\.16, 0\.11, "triangle", offset\)/);
  assert.match(source, /playEffectSweep\(659\.25, 523\.25, 0\.13, 0\.085, "triangle", offset\)/);
});

test('bouncing beam contact always applies the iron penalty', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.mode = "play"; state.music.context = null; state.stage = 3; state.camera = 0; state.climber.col = 3; state.climber.row = 8; state.hands.left.row = 2; state.hands.right.row = 14; state.obstacles = [{ type: "e", col: 3, row: 8, speed: 0, sway: 0, bounceEvery: 5, bounceDistance: 5, bounceDirection: 1, bounceState: "falling", bounceTime: 0 }]; state.spawnTimer = 99; updateObstacles(0.01)');
  assert.equal(run('state.stagePenalty'), 30000);
});

test('closed hand windows cause a fall and lose one life', () => {
  const run = game();
  run('state.mode = "play"; state.music.context = null; state.climber.hurtTimer = 0; state.hands.left.col = 4; state.hands.left.row = 5; state.hands.right.col = 4; state.hands.right.row = 5; state.windows.set("4:5", { open: false, openness: 0, targetOpen: false }); updateHandSupport()');
  assert.equal(run('state.lives'), 2);
  assert.equal(run('state.mode'), 'falling');
});

test('a closing window stays usable until its opacity reaches zero', () => {
  const run = game();
  run('state.windows.set("4:5", { open: false, openness: 0.01, targetOpen: false });');
  assert.equal(run('windowOpen(4, 5)'), true);
  run('getWindow(4, 5).openness = 0;');
  assert.equal(run('windowOpen(4, 5)'), false);
});

test('vase stuns at matching hand heights and causes a fall otherwise', () => {
  const run = game();
  run('state.mode = "play"; state.music.context = null; state.climber.col = 3; state.climber.row = 8; state.hands.left.row = 8; state.hands.right.row = 8; state.obstacles = [{ type: "a", col: 3, row: 8, speed: 0, sway: 0 }]; state.spawnTimer = 99; updateObstacles(0.01)');
  assert.equal(run('state.climber.freezeTimer'), 1);
  run('state.climber.freezeTimer = 0; state.message = ""; state.hands.right.row = 9; state.obstacles = [{ type: "a", col: 3, row: 8, speed: 0, sway: 0 }]; updateObstacles(0.01)');
  assert.equal(run('state.lives'), 2);
});

test('losing a life resumes ten floors below with the entry fanfare lock', () => {
  const run = game();
  run('state.mode = "play"; state.stageStartHeight = 5; state.height = 30; state.climber.row = 30; state.lives = 3; state.music.context = null; fallToGround()');
  assert.equal(run('state.lives'), 2);
  assert.equal(run('state.mode'), 'falling');
  assert.equal(run('state.height'), 30);
  run('updateFalling(0.8)');
  assert.equal(run('state.mode'), 'falling');
  assert.ok(run('fallScreenOffset() > canvas.height - gridToScreen(state.climber.col, state.climber.row).y'));
  run('updateFalling(0.46)');
  assert.equal(run('state.height'), 20);
  assert.equal(run('state.climber.row'), 20);
  assert.equal(run('state.mode'), 'intro');
  assert.equal(run('state.intro.recovery'), true);
});

test('falling freezes inputs and obstacles and defers game over until blackout', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.music.context = null; state.mode = "play"; state.lives = 1; state.height = 30; state.climber.row = 30; fallToGround(); state.keys.add("Space"); updateObstacles = () => { throw new Error("obstacles advanced during fall"); }; update(0.4)');
  assert.equal(run('state.mode'), 'falling');
  assert.equal(run('state.climber.row'), 30);
  assert.equal(run('state.lives'), 0);
  run('update(0.86)');
  assert.equal(run('state.mode'), 'over');
});

test('support loss stops the frame before input or obstacle handling', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.music.context = null; state.mode = "play"; windowOpen = () => false; moveHand = () => { throw new Error("input after fall"); }; updateObstacles = () => { throw new Error("obstacles after fall"); }; update(0.01)');
  assert.equal(run('state.mode'), 'falling');
  assert.equal(run('state.lives'), 2);
});

test('fall blackout reaches full black before a safe recovery and 2.4-second lock', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.music.context = null; state.mode = "play"; state.stageStartHeight = 5; state.height = 30; state.climber.row = 30; state.obstacles = [{ type: "b" }]; state.sluggishMoves = 10; fallToGround(); updateFalling(1.1); ctx.fillRect = () => {}; drawOverlay()');
  assert.equal(run('ctx.fillStyle'), 'rgba(0, 0, 0, 1)');
  run('updateFalling(0.16)');
  assert.equal(run('state.obstacles.length'), 0);
  assert.equal(run('state.sluggishMoves'), 0);
  assert.equal(run('windowOpen(4, 20)'), true);
  run('update(2.39)');
  assert.equal(run('state.mode'), 'intro');
  run('update(0.02)');
  assert.equal(run('state.mode'), 'play');
});

test('recovery opens every stage window and restarts closure timers', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.music.context = null; state.mode = "play"; state.stage = 3; state.stageTarget = 100; state.stageStartHeight = 5; state.height = 60; state.climber.row = 60; shouldWindowBeOpen = () => false; getWindow(0, 10); fallToGround(); updateFalling(1.26)');
  assert.equal(run('state.mode'), 'intro');
  assert.equal(run('Array.from({length: 101}, (_, row) => Array.from({length: cols}, (_, col) => { const w = getWindow(col, row); return w.open && w.targetOpen && w.openness === 1 && w.timer === 0; }).every(Boolean)).every(Boolean)'), true);
  run('update(2.4); updateWindows(0.01)');
  assert.equal(run('windowOpen(0, 10)'), true);
  run('updateWindows(8)');
  assert.equal(run('getWindow(0, 50).targetOpen'), false);
});

test('recovery never renders the ground entrance or crowd and police car', () => {
  const run = game();
  run('state.mode = "intro"; state.intro.recovery = true; ctx.fillRect = () => { throw new Error("ground rendered during recovery"); }; drawGroundEntrance(); drawOnlookers()');
});

test('hanging towels start at stage two, block a hand grip, and can fall', () => {
  const run = game();
  run('state.stage = 2; state.climber.col = 4; state.climber.row = 8; state.hands.left = { col: 4, row: 8, cooldown: 0, ready: true, upBuffer: 0 }; state.hands.right = { col: 4, row: 8, cooldown: 0, ready: true, upBuffer: 0 }; windowOpen = () => true; state.towels = [{ col: 4, row: 9, dropTimer: 9 }]; moveHand("left", { x: 0, y: -1 })');
  assert.equal(run('state.hands.left.row'), 8);
  run('releaseTowel(state.towels[0])');
  assert.equal(run('state.obstacles[0].type'), 'd');
  assert.equal(run('state.towels.length'), 0);
  run('state.climber.row = 12; state.height = 12; state.stageStartHeight = 5; dropFiveFloors()');
  assert.equal(run('state.climber.row'), 7);
  assert.equal(run('state.height'), 7);
});

test('stage two iron-dumbbell throwers use an open window and drop vertically', () => {
  const run = game();
  run('state.stage = 2; state.climber.row = 5; getWindow(2, 8).open = true; getWindow(2, 8).openness = 1; Math.random = () => 0.2; spawnDumbbellThrower(); window.thrower = { ...state.residents[0] }');
  assert.equal(run('state.residents.length'), 1);
  run('updateObstacleActors(0.4)');
  assert.equal(run('state.obstacles.length'), 0);
  run('updateObstacleActors(0.41)');
  assert.equal(run('state.obstacles.length'), 1);
  assert.equal(run('state.obstacles[0].type'), 'f');
  assert.equal(run('state.obstacles[0].col'), run('window.thrower.col'));
  assert.equal(run('state.obstacles[0].row'), run('window.thrower.row'));
  assert.equal(run('state.obstacles[0].drift'), 0);
});

test('stage four wind releases most towels and shifts iron dumbbells', () => {
  const run = game();
  run('state.stage = 4; Math.random = () => 0.1; state.towels = [{ col: 2, row: 9, dropTimer: 9 }]; state.obstacles = [{ type: "f", col: 2, row: 8, speed: 2.8, sway: 0, drift: 0 }]; applyWindHazards(1)');
  assert.equal(run('state.towels.length'), 0);
  assert.equal(run('state.obstacles.some((item) => item.type === "d")'), true);
  assert.equal(run('state.obstacles.find((item) => item.type === "f").col'), 3);
});

test('birds move independently and snap droppings to the nearest window column', () => {
  const run = game();
  run('state.stage = 3; Math.random = () => 0.17; spawnObstacle(); state.birds[0].x = buildingX + 100; state.birds[0].dropTimer = 0; updateObstacleActors(0.1)');
  assert.ok(run('state.birds[0].x > buildingX + 100'));
  assert.equal(run('Number.isInteger(state.obstacles[0].col)'), true);
  assert.equal(run('state.obstacles[0].col'), run('Math.max(0, Math.min(cols - 1, Math.round((state.birds[0].x - buildingX) / colW - 0.5)))'));
  run('state.birds[0].x = canvas.width + 90; updateObstacleActors(0.01)');
  assert.equal(run('state.birds.length'), 0);
});

test('dumbbell thrower and bird sequences render and reset on the next stage', () => {
  const run = game();
  run(`state.stage = 3; state.birds = [{ x: 350, y: 60, direction: -1, age: 0.3, dropTimer: 1 }];
    state.residents = [{ col: 2, row: 8, age: 0.4, dropped: false }];
    for (const method of ['save', 'restore', 'translate', 'scale', 'fillRect']) ctx[method] = () => {};
    drawObstacleActors(); state.residents[0].dropped = true; drawObstacleActors();
    startMusic = () => {}; beginNextStage();`);
  assert.equal(run('state.birds.length'), 0);
  assert.equal(run('state.residents.length'), 0);
});

test('T-shirts, dumbbells and birds use distinct silhouettes', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const transformer = source.slice(source.indexOf('function drawTransformerUnit'), source.indexOf('function drawDumbbell'));
  const toolModule = source.slice(source.indexOf('function drawToolModule'), source.indexOf('function drawCableBundle'));
  assert.match(source, /function drawCableBundle\(/);
  assert.match(source, /function drawFallingCableBundle\(/);
  assert.match(source, /function drawTshirtSprite\(/);
  assert.match(source, /function drawToolDropper\(/);
  assert.match(source, /drawDumbbellSprite\(ctx, 48, 4, 1\)/);
  assert.match(source, /const wingUp = Math\.sin\(bird\.age \* 20\) > 0/);
  assert.match(source, /ctx\.fillRect\(-23, -10, 42, 22\)/);
  assert.match(transformer, /#c96e3b/);
  assert.match(toolModule, /#6e7782/);
});

test('stage 1 vase and steel beam use transparent readable silhouettes', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const beam = source.slice(source.indexOf('function drawTrussBeam'), source.indexOf('function drawTransformerUnit'));
  const vase = source.slice(source.indexOf('function drawTransformerUnit'), source.indexOf('function drawToolModule'));
  const briefingIcons = source.slice(source.indexOf('function drawStageHazardIcon'), source.indexOf('function drawStageHazardBriefing'));
  assert.match(beam, /palette\.brace/);
  assert.match(beam, /ctx\.lineTo\(x \+ brace \+ 16, y - 8\)/);
  assert.match(beam, /ctx\.lineTo\(x \+ brace \+ 16, y \+ 8\)/);
  assert.doesNotMatch(beam, /fillRect\(x - 36, y - 17, 72, 34\)/);
  assert.match(vase, /#c96e3b/);
  assert.match(vase, /#63b96d/);
  assert.doesNotMatch(vase, /#172126/);
  assert.match(briefingIcons, /context\.lineTo\(x \+ brace \+ 16, y - 9\)/);
  assert.match(briefingIcons, /#c96e3b/);
  assert.doesNotMatch(briefingIcons, /#14272f/);
});

test('stage 2 briefing and actors share the white and red T-shirt and readable thrower design', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const shirt = source.slice(source.indexOf('function drawTshirtSprite'), source.indexOf('function drawToolDropper'));
  const thrower = source.slice(source.indexOf('function drawToolDropper'), source.indexOf('function drawObstacles'));
  const briefingIcons = source.slice(source.indexOf('function drawStageHazardIcon'), source.indexOf('function drawStageHazardBriefing'));
  assert.match(shirt, /#f4f1e7/);
  assert.match(shirt, /#ce3f39/);
  assert.match(shirt, /rect\(-34, -12, 16, 17\)/);
  assert.match(thrower, /#c9825c/);
  assert.match(thrower, /#496575/);
  assert.match(briefingIcons, /drawTshirtSprite\(context, x, y - 2, 0\.78\)/);
});

test('stage 2 briefing dumbbell matches the in-game dumbbell palette and T-shirt has detailed trim', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const shirt = source.slice(source.indexOf('function drawTshirtSprite'), source.indexOf('function drawToolDropper'));
  const briefingIcons = source.slice(source.indexOf('function drawStageHazardIcon'), source.indexOf('function drawStageHazardBriefing'));
  assert.match(shirt, /#ce3f39.*rect\(-34, -12, 6, 14\)/s);
  assert.match(shirt, /#ce3f39.*rect\(28, -12, 6, 14\)/s);
  assert.match(source, /function drawDumbbellSprite\(context, x, y, scale = 1\)/);
  assert.match(source, /#d6a83a/);
  assert.match(briefingIcons, /drawDumbbellSprite\(context, x, y, 1\.1\)/);
});

test('stage 2 briefing and in-game T-shirts share one sprite renderer', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const briefingIcons = source.slice(source.indexOf('function drawStageHazardIcon'), source.indexOf('function drawStageHazardBriefing'));
  assert.match(source, /function drawTshirtSprite\(context, x, y, scale = 1, rotation = 0\)/);
  assert.match(source, /drawTshirtSprite\(ctx, p\.x, p\.y - 13, 1, -0\.14\)/);
  assert.match(source, /drawTshirtSprite\(ctx, x, y, 1, 0\.17\)/);
  assert.match(briefingIcons, /drawTshirtSprite\(context, x, y - 2, 0\.78\)/);
});

test('shared T-shirt sprite prioritizes a readable sleeve, body and neckline silhouette', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const shirt = source.slice(source.indexOf('function drawTshirtSprite'), source.indexOf('function drawCableBundle'));
  assert.match(shirt, /rect\(-18, -13, 36, 36\)/);
  assert.match(shirt, /rect\(-34, -12, 16, 17\)/);
  assert.match(shirt, /rect\(18, -12, 16, 17\)/);
  assert.match(shirt, /rect\(-5, -15, 10, 6\)/);
});

test('T-shirts and birds do not appear before their configured stages', () => {
  const run = game();
  run('state.stage = 1; Math.random = () => 0.2; spawnObstacle()');
  assert.equal(run('state.residents.length'), 0);
  run('state.stage = 2; Math.random = () => 0.1; spawnObstacle()');
  assert.equal(run('state.birds.length'), 0);
});

test('hazards unlock on their planned stages', () => {
  const run = game();
  run('state.stage = 1; Math.random = () => 0.01; spawnObstacle()');
  assert.equal(run('state.towels.length'), 0);
  assert.equal(run('state.residents.length'), 0);
  assert.equal(run('state.snipers.length'), 0);
  run('state.obstacles = []; state.stage = 2; Math.random = () => 0.2; spawnObstacle()');
  assert.equal(run('state.towels.length'), 1);
  run('state.towels = []; Math.random = () => 0.36; spawnObstacle()');
  assert.equal(run('state.residents.length'), 1);
  run('state.residents = []; state.stage = 3; Math.random = () => 0.17; spawnObstacle()');
  assert.equal(run('state.birds.length'), 1);
  run('state.birds = []; Math.random = () => 0.4; spawnObstacle()');
  assert.equal(run('state.obstacles[0].type'), 'e');
  run('state.obstacles = []; state.stage = 5; Math.random = () => 0.01; spawnObstacle()');
  assert.equal(run('state.snipers.length'), 1);
});

test('snipers occupy a closed window without an orange backdrop', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const run = game();
  run('state.stage = 5; state.camera = 0; state.climber.row = 5; Math.random = () => 0.01; spawnSniper()');
  assert.equal(run('state.snipers.length'), 1);
  assert.equal(run('getWindow(state.snipers[0].col, state.snipers[0].row).openness'), 0);
  assert.doesNotMatch(source, /fillStyle = "#e47c2c"/);
});

test('stage five sniper fixes its target before firing and only tests impact once', () => {
  const run = game();
  run('state.mode = "play"; state.stage = 5; state.climber.col = 4; state.climber.row = 9; state.hands.left = { col: 4, row: 9 }; state.hands.right = { col: 4, row: 9 }; state.snipers = [{ col: 2, row: 13, age: 0, target: null, fired: false }]; window.falls = 0; fallToGround = () => { window.falls += 1; }; updateSnipers(1.01)');
  assert.equal(run('state.snipers[0].target.col'), 4);
  assert.equal(run('state.snipers[0].target.row'), 9);
  assert.equal(run('state.snipers[0].facing'), 'right');
  run('state.climber.col = 5; state.hands.left.col = 5; state.hands.right.col = 5; updateSnipers(1.51)');
  assert.equal(run('window.falls'), 0);
  assert.equal(run('state.shotMarks.length'), 1);
  run('state.climber.col = 4; state.hands.left.col = 4; state.hands.right.col = 4; updateSnipers(0.2)');
  assert.equal(run('window.falls'), 0);
});

test('stage six creates eight-floor Tyson shafts and punches across the expected reach', () => {
  const run = game();
  run('state.stage = 5;');
  assert.equal(run('isTysonShaftCell(1, 10)'), false);
  run('state.stage = 6; state.tysons = [];');
  assert.equal(run('isTysonShaftCell(1, 40) && isTysonShaftCell(2, 47)'), true);
  assert.equal(run('isTysonShaftCell(5, 40) && isTysonShaftCell(6, 47)'), true);
  assert.equal(run('isTysonShaftCell(1, 39)'), false);
  assert.equal(run('windowOpen(1, 40)'), false);
  run('getWindow(4, 10).openness = 1;');
  assert.equal(run('windowOpen(4, 10)'), true);
  run(`state.mode = 'play'; state.lives = 3; state.climber = { col: 4, row: 44, hurtTimer: 0, freezeTimer: 0 };
    state.hands.left = { col: 4, row: 44 }; state.hands.right = { col: 4, row: 44 };
    state.tysons = [{ lane: 'left', row: 43, blockBottom: 40, phase: 'jab', reach: 2, phaseTime: 0, moveTimer: 1, hit: false }];
    updateTysons(0.13);`);
  assert.equal(run('state.mode'), 'falling');
  assert.equal(run('state.lives'), 2);
  assert.equal(run("tysonPunchEndCol({ lane: 'right', reach: 6 })"), 0);
});

test('stage six fixes Tyson shafts at 40F, 100F and 160F', () => {
  const run = game();
  run('state.stage = 6;');
  for (const bottom of [40, 100, 160]) {
    assert.equal(run(`isTysonShaftCell(1, ${bottom}) && isTysonShaftCell(2, ${bottom + 7})`), true);
    assert.equal(run(`isTysonShaftCell(5, ${bottom}) && isTysonShaftCell(6, ${bottom + 7})`), true);
    assert.equal(run(`isTysonShaftCell(1, ${bottom - 1})`), false);
  }
});

test('Tyson enters when its block reaches the screen top, before the climber reaches it', () => {
  const run = game();
  run('state.stage = 6; state.climber.row = 28; state.camera = 27.4; state.tysons = []; updateTysons(0.01);');
  assert.equal(run('state.tysons.length'), 0);
  run('state.camera = 27.6; updateTysons(0.01);');
  assert.equal(run('state.tysons.length'), 1);
  assert.equal(run('state.tysons[0].blockBottom'), 40);
});

test('Tyson blocks pause the specified obstacle families while active', () => {
  const run = game();
  run(`state.stage = 6; state.camera = 0; state.stageTarget = 175;
    state.climber.row = 40; state.birds = [{ x: 300, y: 60, direction: 1, age: 0, dropTimer: 1 }];
    state.residents = [{ col: 3, row: 44, age: 0, dropped: false }];
    state.snipers = [{ col: 1, row: 44, age: 0, target: null, fired: false }];
    state.wind = { timeUntil: 2, warning: 0, direction: 0, active: 0 }; updateWind(1); updateObstacleActors(1);`);
  assert.equal(run('tysonHazardPause().wind'), true);
  assert.equal(run('tysonHazardPause().snipers'), true);
  assert.equal(run('state.wind.timeUntil'), 2);
  assert.equal(run('state.birds[0].age'), 0);
  assert.equal(run('state.residents[0].age'), 0);
  assert.equal(run('state.snipers[0].age'), 0);
  run('state.climber.row = 100; state.camera = 95; state.snipers = []; Math.random = () => 0.01; spawnObstacle();');
  assert.equal(run('tysonHazardPause().birds && tysonHazardPause().dumbbells'), true);
  assert.equal(run('tysonHazardPause().snipers'), false);
  assert.equal(run('state.snipers.length'), 1);
  run('state.climber.row = 160;');
  assert.equal(run('tysonHazardPause().birds || tysonHazardPause().dumbbells || tysonHazardPause().snipers || tysonHazardPause().wind'), false);
});

test('Tyson standby is safe and only jab or straight applies a punch hit', () => {
  const run = game();
  run(`state.mode = 'play'; state.stage = 6; state.lives = 3;
    state.climber = { col: 4, row: 44, hurtTimer: 0, freezeTimer: 0 };
    state.hands.left = { col: 4, row: 44 }; state.hands.right = { col: 4, row: 44 };
    state.tysons = [{ lane: 'left', row: 43, blockBottom: 40, phase: 'standby', reach: 2, phaseTime: 0, moveTimer: 1, hit: false }];
    updateTysons(0.01);`);
  assert.equal(run('state.mode'), 'play');
  assert.equal(run('state.lives'), 3);
  run("state.tysons[0].phase = 'straight'; state.tysons[0].reach = 6; updateTysons(0.01);");
  assert.equal(run('state.mode'), 'falling');
  assert.equal(run('state.lives'), 2);
});

test('Tyson jab only hits on its second and third animation frames', () => {
  const run = game();
  assert.equal(run("tysonJabFrameIndex({ phaseTime: 0.01 })"), 0);
  assert.equal(run("tysonJabFrameIndex({ phaseTime: 0.13 })"), 1);
  assert.equal(run("tysonJabFrameIndex({ phaseTime: 0.25 })"), 2);
  assert.equal(run("tysonPunchCanHit({ phase: 'jab', phaseTime: 0.01 })"), false);
  assert.equal(run("tysonPunchCanHit({ phase: 'jab', phaseTime: 0.13 })"), true);
  assert.equal(run("tysonPunchCanHit({ phase: 'jab', phaseTime: 0.25 })"), true);
});

test('Tyson punch collision is one window above the boxer row', () => {
  const run = game();
  run(`state.climber = { col: 4, row: 43 }; state.hands.left = { col: 4, row: 43 };
    state.hands.right = { col: 4, row: 43 };`);
  assert.equal(run("tysonPunchHitsClimber({ lane: 'left', row: 43, reach: 2 })"), false);
  run('state.climber.row = 44; state.hands.left.row = 44; state.hands.right.row = 44;');
  assert.equal(run("tysonPunchHitsClimber({ lane: 'left', row: 43, reach: 2 })"), true);
});

test('Tyson jab leaves the far safety lane open while straight reaches it', () => {
  const run = game();
  run(`state.mode = 'play'; state.stage = 6; state.lives = 3;
    state.climber = { col: 7, row: 44, hurtTimer: 0, freezeTimer: 0 };
    state.hands.left = { col: 7, row: 44 }; state.hands.right = { col: 7, row: 44 };
    state.tysons = [{ lane: 'left', row: 43, blockBottom: 40, phase: 'jab', reach: 2, phaseTime: 0.12, moveTimer: 1 }];
    updateTysons(0.01);`);
  assert.equal(run('state.mode'), 'play');
  run("state.tysons[0].phase = 'straight'; state.tysons[0].reach = 6; state.tysons[0].phaseTime = 0; updateTysons(0.01);");
  assert.equal(run('state.mode'), 'falling');
});

test('Tyson straight is dangerous across six cells during all three animation frames', () => {
  const run = game();
  assert.equal(run("tysonStraightFrameIndex({ phaseTime: 0.01 })"), 0);
  assert.equal(run("tysonStraightFrameIndex({ phaseTime: 0.13 })"), 1);
  assert.equal(run("tysonStraightFrameIndex({ phaseTime: 0.25 })"), 2);
  assert.equal(run("tysonPunchCanHit({ phase: 'straight', phaseTime: 0.01 })"), true);
  assert.equal(run("tysonPunchCanHit({ phase: 'straight', phaseTime: 0.25 })"), true);
  assert.equal(run("tysonPunchEndCol({ lane: 'left', reach: 6 })"), 7);
  assert.equal(run("tysonPunchStartCol({ lane: 'left', reach: 6 })"), 3);
  assert.equal(run("tysonPunchStartCol({ lane: 'right', reach: 6 })"), 4);
  for (const col of [4, 7]) {
    const hitRun = game();
    hitRun(`state.mode = 'play'; state.stage = 6; state.lives = 3;
      state.climber = { col: ${col}, row: 44, hurtTimer: 0, freezeTimer: 0 };
      state.hands.left = { col: ${col}, row: 44 }; state.hands.right = { col: ${col}, row: 44 };
      state.tysons = [{ lane: 'left', row: 43, blockBottom: 40, phase: 'straight', reach: 6, phaseTime: 0, moveTimer: 1 }];
      updateTysons(0.01);`);
    assert.equal(hitRun('state.mode'), 'falling');
  }
});

test('stage six fixes the Tyson block at floors 40 through 47', () => {
  const run = game();
  run("state.stage = 6; window.tyson = { lane: 'left' }; positionTyson(window.tyson);");
  assert.equal(run('window.tyson.row'), 43);
  assert.equal(run('tysonShaftRows(window.tyson).bottom'), 40);
  assert.equal(run('tysonShaftRows(window.tyson).top'), 47);
});

test('stage five sniper kills only when the fixed impact cell is occupied at firing', () => {
  const run = game();
  run('state.mode = "play"; state.stage = 5; state.climber.col = 4; state.climber.row = 9; state.hands.left = { col: 4, row: 9 }; state.hands.right = { col: 4, row: 9 }; state.snipers = [{ col: 2, row: 13, age: 1, target: { col: 4, row: 9 }, fired: false }]; window.falls = 0; fallToGround = () => { window.falls += 1; }; updateSnipers(1.51)');
  assert.equal(run('window.falls'), 1);
});

test('sniper reticle blink interval accelerates during the 1.5-second countdown', () => {
  const run = game();
  run('window.slow = sniperReticlePeriod({ age: 1, target: { col: 4, row: 9 }, fired: false }); window.fast = sniperReticlePeriod({ age: 2.45, target: { col: 4, row: 9 }, fired: false }); state.snipers = [{ col: 2, row: 13, age: 1, target: { col: 4, row: 9 }, fired: false, reticleVisible: true, reticleTimer: 0.01 }]; updateSnipers(0.02); window.afterFirstBlink = state.snipers[0].reticleVisible; updateSnipers(0.2); window.stillAiming = Boolean(state.snipers[0].target) && !state.snipers[0].fired');
  assert.ok(run('window.fast < window.slow'));
  assert.ok(run('Math.abs(sniperFireAge - 2.5) < 0.0001'));
  assert.equal(run('window.afterFirstBlink'), false);
  assert.equal(run('window.stillAiming'), true);
});

test('laundry slip overlay clears after its recovery timer', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.mode = "play"; state.climber.row = 12; state.height = 12; state.stageStartHeight = 5; dropFiveFloors()');
  assert.equal(run('state.message'), 'SLIP!');
  assert.ok(run('state.slipTimer > 0'));
  run('update(0.39)');
  assert.equal(run('state.message'), 'SLIP!');
  run('update(0.02)');
  assert.equal(run('state.message'), '');
});

test('vase hand contact stuns and droppings cause ten sluggish moves', () => {
  const run = game();
  run('state.mode = "play"; state.stage = 4; hitByDropping()');
  assert.equal(run('state.sluggishMoves'), 10);
  assert.ok(run('state.inputBlockEvents >= 3 && state.inputBlockEvents <= 5'));
  run('windowOpen = () => true; state.sluggishMoves = 1; moveSideOneBlock("right")');
  assert.equal(run('state.sluggishMoves'), 0);
});

test('droppings duration counts only successful body movement', () => {
  const run = game();
  run('state.mode = "play"; hitByDropping(); windowOpen = () => true; moveHand("left", {x: 0, y: -1})');
  assert.equal(run('state.sluggishMoves'), 10);
  run('state.descentLocked = false; moveDownOneBlock("left")');
  assert.equal(run('state.sluggishMoves'), 9);
  run('windowOpen = () => false; moveDownOneBlock("left")');
  assert.equal(run('state.sluggishMoves'), 9);
  run('state.sluggishMoves = 1; state.inputBlockEvents = 3; registerSluggishMove()');
  assert.equal(run('state.inputBlockEvents'), 0);
});

test('SPLAT overlay fades with time and clears without movement', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; state.mode = "play"; windowOpen = () => true; state.spawnTimer = 99; hitByDropping(); ctx.fillRect = () => {}; ctx.fillText = () => {}; update(0.6); drawOverlay()');
  assert.equal(run('state.message'), 'SPLAT!');
  assert.equal(run('ctx.fillStyle'), 'rgba(246, 241, 223, 0.5)');
  run('update(0.61)');
  assert.equal(run('state.message'), '');
  assert.equal(run('state.sluggishMoves'), 10);
});

test('rooftop ending follows victory, arrest and hut sequence', () => {
  const run = game();
  assert.equal(run('rooftopPhase(1)'), 'arrival');
  assert.equal(run('rooftopPhase(3)'), 'victory');
  assert.equal(run('rooftopPhase(7)'), 'arrest');
  assert.equal(run('rooftopPhase(11)'), 'escort');
  assert.equal(run('rooftopPhase(15)'), 'complete');
  run('state.music.context = null; beginRooftop(); beginRooftop();');
  assert.equal(run('state.score'), 35000);
  assert.equal(run('state.mode'), 'rooftop');
});

test('rooftop sprites use the climber workwear, police uniform and visible handcuffs', () => {
  const run = game();
  run(`window.colors = []; window.rects = []; window.curves = 0; window.activeColor = '';
    Object.defineProperty(ctx, 'fillStyle', { set(value) { window.activeColor = value; window.colors.push(value); }, get() { return window.activeColor; } });
    ctx.save = ctx.restore = ctx.translate = ctx.rotate = ctx.beginPath = ctx.closePath = ctx.fill = ctx.stroke = () => {};
    ctx.fillRect = (x, y, width, height) => window.rects.push([window.activeColor, x, y, width, height]);
    ctx.arc = ctx.ellipse = ctx.quadraticCurveTo = () => { window.curves += 1; };
    rooftopPerson(480, 510, false, 'cuffed', 0);
    rooftopPerson(560, 510, true, 'walk', 0);`);
  assert.equal(run("window.colors.includes('#d82b39')"), true);
  assert.equal(run("window.colors.includes('#1244cb')"), true);
  assert.equal(run("window.colors.includes('#111418')"), true);
  assert.equal(run("window.colors.includes('#2c5b9a')"), true);
  assert.equal(run("window.colors.includes('#d8e6ea')"), true);
  assert.ok(run("window.rects.filter(([color]) => color === '#d8e6ea').length >= 5"));
  assert.equal(run('window.curves'), 0);
  run(`window.spriteSegments = 0; drawSpriteSegment = () => { window.spriteSegments += 1; };
    rooftopPerson(480, 510, false, 'dance', 2.25);
    rooftopPerson(560, 510, true, 'walk', 2.25);`);
  assert.ok(run('window.spriteSegments >= 12'));
});

test('rooftop victory uses a raised-arm dance pose', () => {
  const run = game();
  assert.notEqual(run('rooftopDanceOffset(2.1)'), run('rooftopDanceOffset(2.35)'));
  assert.notEqual(run("JSON.stringify(rooftopLegOffsets('dance', 2.1))"), run("JSON.stringify(rooftopLegOffsets('dance', 2.35))"));
  assert.equal(run("JSON.stringify(rooftopLegOffsets('walk', 2.25))"), '[0,0]');
  assert.equal(run("JSON.stringify(rooftopLegOffsets('cuffed', 2.25))"), '[0,0]');
  assert.match(fs.readFileSync('src/main.js', 'utf8'), /const frontFacing = !police && dancing/);
  run(`window.translateCalls = []; ctx.save = ctx.restore = () => {};
    ctx.translate = (x, y) => window.translateCalls.push([x, y]);
    ctx.fillRect = ctx.beginPath = ctx.moveTo = ctx.lineTo = ctx.stroke = () => {};
    rooftopPerson(480, 510, false, 'dance', 2.25);`);
  assert.ok(run('window.translateCalls.some(([x]) => x !== 0)'));
});

test('every rooftop phase renders and ends without accepting early restart', () => {
  const run = game();
  run(`Object.assign(ctx, new Proxy({}, { get: () => () => {} }));
    for (const method of ['fillRect','beginPath','arc','fill','stroke','moveTo','lineTo','fillText','save','restore','translate']) {
      ctx[method] = () => {};
    }
    state.music.context = null; beginRooftop();
    for (const time of [0, 2.5, 6.5, 8.5, 11, 14.5, 15]) {
      state.rooftop.time = time; drawRooftop();
    }
    state.rooftop.time = 15.49; updateRooftop(0.02);`);
  assert.equal(run('state.mode'), 'clear');
});

test('clear text is centered and next stage waits for the completed score count', () => {
  const run = game();
  run(`navigator = { getGamepads: () => [] }; state.music.context = null; beginRooftop();
    for (const method of ['fillRect','beginPath','arc','fill','stroke','moveTo','lineTo']) ctx[method] = () => {};
    window.texts = []; ctx.fillText = (text, x) => window.texts.push({text, x});
    state.rooftop.time = 15; state.keys.add('Space'); update(0.01); drawRooftop();`);
  assert.equal(run('state.mode'), 'rooftop');
  assert.equal(run('window.texts.some(t => t.text.includes("Next Stage"))'), false);
  run('state.rooftop.time = 15.49; update(0.01); window.texts = []; drawRooftop()');
  assert.equal(run('state.mode'), 'clear');
  assert.equal(run('window.texts.filter(t => t.text !== "MAINTENANCE").every(t => t.x === canvas.width / 2)'), true);
  assert.equal(run('window.texts.some(t => t.text === "BUILDING1 CLEAR!")'), true);
  assert.equal(run('window.texts.some(t => t.text === "SCORE " + String(state.rooftop.scoreTarget).padStart(6, "0"))'), true);
  assert.equal(run('window.texts.some(t => t.text.includes("Next Stage"))'), true);
});

test('rooftop clear score group sits 100 pixels above its original layout', () => {
  const run = game();
  run(`window.sharpTexts = [];
    screenCtx.save = screenCtx.restore = () => {};
    screenCtx.fillText = (text, x, y) => window.sharpTexts.push({ text, x, y });
    state.mode = 'clear'; state.rooftop = { time: 15.5, scoreTarget: 42000, penalty: 0, noPenaltyBonus: 30000 };
    drawSharpRooftopText();`);
  assert.equal(run("window.sharpTexts.find((item) => item.text === 'BUILDING1 CLEAR!').y"), 200);
  assert.equal(run("window.sharpTexts.find((item) => item.text.startsWith('SCORE ')).y"), 270);
  assert.equal(run("window.sharpTexts.find((item) => item.text.includes('NO PENALTY BONUS')).y"), 302);
  assert.equal(run("window.sharpTexts.find((item) => item.text.includes('Next Stage')).y"), 340);
});

test('rooftop clear subtracts obstacle penalties and displays the negative total', () => {
  const run = game();
  run('state.score = 100000; state.stagePenalty = 40000; state.music.context = null; beginRooftop()');
  assert.equal(run('state.score'), 65000);
  assert.equal(run('state.rooftop.penalty'), 40000);
  assert.equal(run('state.rooftop.scoreTarget'), 65000);
});

test('clear without penalties awards the no-penalty bonus and rooftop input fast-forwards', () => {
  const run = game();
  run('state.score = 100000; state.stagePenalty = 0; state.music.context = null; beginRooftop()');
  assert.equal(run('state.rooftop.noPenaltyBonus'), 30000);
  assert.equal(run('state.score'), 135000);
  run('navigator = { getGamepads: () => [] }; state.keys.add("Space"); state.rooftop.time = 5; update(0.01)');
  assert.equal(run('state.rooftop.speed'), 3);
  run('updateRooftop(1)');
  assert.ok(Math.abs(run('state.rooftop.time') - 8.03) < 0.00001);
});

test('no-penalty bonus text is not zero-padded and patrol lamps alternate', () => {
  const run = game();
  run(`window.texts = []; ctx.fillText = (text) => window.texts.push(text);
    ctx.fillRect = () => {}; state.music.context = null; beginRooftop(); state.rooftop.time = 14.5; drawRooftop();
    window.lampColors = []; Object.defineProperty(ctx, 'fillStyle', { set(value) { window.lampColors.push(value); }, get() { return ''; } });
    ctx.fillRect = ctx.beginPath = ctx.arc = ctx.fill = ctx.save = ctx.restore = ctx.translate = () => {}; state.mode = 'intro'; state.intro = { time: 1, recovery: false }; drawOnlookers();
    state.intro.time = 1.13; drawOnlookers();`);
  assert.equal(run('window.texts.some((text) => text === "NO PENALTY BONUS +30000")'), true);
  assert.equal(run('window.lampColors.includes("#ff5265") && window.lampColors.includes("#4fa8ff")'), true);
});

test('windows, droppings and both laundry outcomes disqualify the no-penalty bonus', () => {
  for (const damage of [
    'windowOpen = () => false; updateHandSupport()',
    'hitByDropping()',
    'dropFiveFloors()',
    'freezeFromObstacle()',
  ]) {
    const run = game();
    run(`state.mode = 'play'; state.music.context = null; state.score = 100000; ${damage}; beginRooftop()`);
    assert.equal(run('state.stagePenalty'), 0);
    assert.equal(run('state.rooftop.noPenaltyBonus'), 0);
    assert.equal(run('state.score'), 105000);
  }
});

test('bonus disqualification survives life recovery and resets for the next stage', () => {
  const run = game();
  run('state.mode = "play"; state.music.context = null; fallToGround(); updateFalling(1.26)');
  assert.equal(run('state.stageDamaged'), true);
  run('beginNextStage()');
  assert.equal(run('state.stageDamaged'), false);
  run('beginRooftop()');
  assert.equal(run('state.rooftop.noPenaltyBonus'), 30000);
});

test('recovery and next stage clear temporary penalties without erasing earned score', () => {
  for (const nextStage of [false, true]) {
    const run = game();
    run(`state.mode = 'play'; state.music.context = null; state.score = 12345; state.stagePenalty = 30000;
      fallToGround(); state.sluggishMoves = 8; state.inputBlockEvents = 4;
      state.climber.freezeTimer = 1; state.climber.hurtTimer = 1;
      state.slipTimer = 0.4; state.splatTimer = 1; state.message = 'SPLAT!';
      state.wind = { timeUntil: 0, warning: 1, active: 0.4, direction: -1 };
      state.hands.left.cooldown = 0.3; state.hands.right.upBuffer = 0.24;
      ${nextStage ? 'beginNextStage()' : 'updateFalling(1.26)'};`);
    for (const expr of ['state.sluggishMoves', 'state.inputBlockEvents', 'state.climber.freezeTimer',
      'state.climber.hurtTimer', 'state.slipTimer', 'state.splatTimer', 'state.wind.warning',
      'state.wind.active', 'state.wind.direction', 'state.hands.left.cooldown', 'state.hands.right.upBuffer']) {
      assert.equal(run(expr), 0, expr);
    }
    assert.equal(run('state.wind.timeUntil'), 5);
    assert.equal(run('state.message'), '');
    assert.equal(run('state.score'), 12345);
    assert.equal(run('state.stagePenalty'), nextStage ? 0 : 30000);
    assert.equal(run('state.stageDamaged'), !nextStage);
  }
});

test('game over restart returns to the title screen', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; startMusic = () => {}; state.mode = "over"; state.message = "GAME OVER"; state.keys.add("Space"); update(0.01)');
  assert.equal(run('state.mode'), 'title');
});

test('game over keeps the building visible behind a dark overlay and shows the final score', () => {
  const run = game();
  run(`window.drawCalls = [];
    ctx.fillRect = (...args) => window.drawCalls.push(['rect', ctx.fillStyle, ...args]);
    ctx.fillText = (...args) => window.drawCalls.push(['text', args[0], args[1], args[2]]);
    state.mode = 'over'; state.score = 4242; state.message = 'GAME OVER'; drawOverlay();`);
  assert.equal(run("window.drawCalls.some((call) => call[0] === 'rect' && call[1] === 'rgba(5, 9, 10, 0.4)')"), true);
  assert.equal(run("window.drawCalls.some((call) => call[0] === 'text' && call[1] === 'GAMEOVER' && call[2] === canvas.width / 2 && call[3] === snapToPixelGrid(canvas.height / 2))"), true);
  assert.equal(run("window.drawCalls.some((call) => call[0] === 'text' && call[1] === 'SCORE 004242' && call[2] === canvas.width / 2)"), true);
  assert.equal(run("window.drawCalls.some((call) => call[0] === 'text' && call[1] === 'A / START / SPACE' && call[2] === canvas.width / 2)"), true);
});

test('climber uses the opening-art workwear palette without a visible front face', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const run = game();
  run(`window.colors = [];
    window.blocks = [];
    window.activeColor = '';
    window.curves = 0;
    window.spriteScales = 0;
    Object.defineProperty(ctx, 'fillStyle', { set(value) { window.activeColor = value; window.colors.push(value); }, get() { return window.activeColor; } });
    Object.defineProperty(ctx, 'strokeStyle', { set(value) { window.activeColor = value; window.colors.push(value); }, get() { return window.activeColor; } });
    ctx.save = ctx.restore = ctx.translate = ctx.beginPath = ctx.closePath = ctx.fill = ctx.stroke = () => {};
    ctx.scale = () => { window.spriteScales += 1; };
    ctx.moveTo = ctx.lineTo = () => {};
    ctx.fillRect = (x, y, width, height) => window.blocks.push([window.activeColor, x, y, width, height]);
    ctx.quadraticCurveTo = ctx.arc = ctx.ellipse = () => { window.curves += 1; };
    state.mode = 'play'; drawClimber();`);
  assert.equal(run("window.colors.includes('#2b1c16')"), false);
  assert.equal(run("window.colors.includes('#f4f1df')"), true);
  assert.equal(run("window.colors.includes('#d82b39')"), true);
  assert.equal(run("window.colors.includes('#1244cb')"), true);
  assert.match(source, /function drawSpriteSegment\(/);
  assert.doesNotMatch(source, /function drawSoftSegment\(/);
  assert.match(source, /body\.x - 30, body\.y - 42, 6, 16/);
  assert.doesNotMatch(source, /body\.x \+ 24, body\.y - 42, 6, 12/);
  assert.equal(run('window.curves'), 0);
  assert.equal(run('window.spriteScales'), 0);
});

test('climber leg poses follow a single raised or sideways hand', () => {
  const run = game();
  run(`window.middleHands = { left: { col: 4, row: 10 }, right: { col: 4, row: 10 } };
    window.leftUp = { left: { col: 4, row: 11 }, right: { col: 4, row: 10 } };
    window.rightUp = { left: { col: 4, row: 10 }, right: { col: 4, row: 11 } };
    window.leftSide = { left: { col: 3, row: 10 }, right: { col: 4, row: 10 } };
    window.rightSide = { left: { col: 4, row: 10 }, right: { col: 5, row: 10 } };
    window.bothUp = { left: { col: 4, row: 11 }, right: { col: 4, row: 11 } };`);
  assert.equal(run("climberLegPose('left', window.middleHands, 4, 10)"), 'down');
  assert.equal(run("climberLegPose('left', window.leftUp, 4, 10)"), 'up');
  assert.equal(run("climberLegPose('right', window.rightUp, 4, 10)"), 'up');
  assert.equal(run("climberLegPose('left', window.leftSide, 4, 10)"), 'side');
  assert.equal(run("climberLegPose('right', window.rightSide, 4, 10)"), 'side');
  assert.equal(run("climberLegPose('left', window.bothUp, 4, 10)"), 'down');
  assert.equal(run("handGripPosition('left', { col: 4, row: state.climber.row + 1 }, state.climber.row, 27).x < gridToScreen(4, state.climber.row + 1).x - 24"), true);
  assert.equal(run("handGripPosition('left', { col: 4, row: state.climber.row - 1 }, state.climber.row, 27, 18).x < gridToScreen(4, state.climber.row - 1).x - 16"), true);
  assert.equal(run("handGripPosition('right', { col: 4, row: state.climber.row }, state.climber.row, 27, 18).x > gridToScreen(4, state.climber.row).x + 16"), true);
});

test('steel frames render repeated truss braces and vases use plant colors', () => {
  const run = game();
  run(`window.braceStrokes = 0; window.colors = [];
    Object.defineProperty(ctx, 'fillStyle', { set(value) { window.colors.push(value); }, get() { return ''; } });
    ctx.save = ctx.restore = ctx.translate = ctx.rotate = ctx.fillRect = ctx.strokeRect = ctx.beginPath = ctx.moveTo = ctx.lineTo = ctx.closePath = ctx.fill = () => {};
    ctx.stroke = () => { window.braceStrokes += 1; };
    state.camera = 0; state.climber.row = 5;
    state.obstacles = [{ type: 'b', col: 4, row: 8, sway: 0 }]; drawObstacles();
    window.trussStrokes = window.braceStrokes;
    state.obstacles = [{ type: 'd', col: 4, row: 8, sway: 0 }]; drawObstacles();
    state.obstacles = [{ type: 'a', col: 4, row: 8, sway: 0 }]; drawObstacles();`);
  assert.ok(run('window.braceStrokes >= 2'));
  assert.equal(run('window.braceStrokes'), run('window.trussStrokes'));
  assert.equal(run("window.colors.includes('#63b96d')"), true);
  assert.equal(run("window.colors.includes('#d8aa38')"), true);
});

test('dumbbell thrower uses a readable person and equipment palette', () => {
  const run = game();
  run(`window.colors = [];
    Object.defineProperty(ctx, 'fillStyle', { set(value) { window.colors.push(value); }, get() { return ''; } });
    ctx.save = ctx.restore = ctx.translate = ctx.fillRect = () => {};
    state.camera = 0;
    state.residents = [{ col: 4, row: 8, age: 0.8, dropped: false }];
    state.birds = [];
    drawObstacleActors();`);
  assert.equal(run("window.colors.includes('#c9825c')"), true);
  assert.equal(run("window.colors.includes('#6e7782')"), true);
});

test('dumbbell and thrower show distinct grips, weights, face and hands', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const dumbbell = source.slice(source.indexOf('function drawToolModule'), source.indexOf('function drawTshirtSprite'));
  const thrower = source.slice(source.indexOf('function drawToolDropper'), source.indexOf('function drawObstacles'));
  assert.match(dumbbell, /drawDumbbellSprite\(ctx, x, y, 1\)/);
  assert.match(source, /function drawDumbbellSprite\(context, x, y, scale = 1\)/);
  assert.match(source, /rect\(-16, -6, 32, 12\)/);
  assert.match(source, /rect\(-39, -9, 13, 18\)/);
  assert.match(source, /rect\(26, -9, 13, 18\)/);
  assert.match(thrower, /ctx\.fillRect\(-12, -34, 24, 24\)/);
  assert.match(thrower, /ctx\.fillRect\(19, handY, 14, 9\)/);
  assert.match(thrower, /ctx\.fillRect\(-33, handY \+ 1, 14, 9\)/);
});

test('title input stays locked for half a second after game over return', () => {
  const run = game();
  run('startMusic = () => {}; state.mode = "title"; state.titleInputLock = 0.5; navigator = { getGamepads: () => [] }; state.keys.add("Space"); update(0.1)');
  assert.equal(run('state.mode'), 'title');
  run('update(0.3)');
  assert.equal(run('state.mode'), 'title');
  run('update(0.11)');
  assert.equal(run('state.mode'), 'title');
  run('state.keys.delete("Space"); update(0.01); state.keys.add("Space"); update(0.01)');
  assert.equal(run('state.mode'), 'briefing');
});

test('held controller start cannot advance again when rooftop becomes clear', () => {
  const run = game();
  run('startMusic = () => {}; state.music.context = null; window.held = true; navigator = { getGamepads: () => [{axes: [], buttons: [{pressed: window.held}]}] }; beginRooftop(); state.rooftop.time = 15.49; update(0.01); update(0.01)');
  assert.equal(run('state.mode'), 'clear');
  run('window.held = false; update(0.01); window.held = true; update(0.01)');
  assert.equal(run('state.mode'), 'briefing');
});

test('clear ignores keyboard repeat and accepts a fresh arbitrary key', () => {
  const run = game();
  run('navigator = { getGamepads: () => [] }; startMusic = () => {}; state.mode = "clear"; state.keys.add("KeyW"); window.listeners.keydown({code: "KeyW", repeat: true, preventDefault() {}}); update(0.01)');
  assert.equal(run('state.mode'), 'clear');
  run('window.listeners.keyup({code: "KeyW"}); window.listeners.keydown({code: "KeyW", repeat: false, preventDefault() {}}); update(0.01)');
  assert.equal(run('state.mode'), 'briefing');
});

test('teaser dismissal starts the title lock', () => {
  const run = game();
  run('startMusic = () => {}; state.mode = "teaser"; dismissTeaser()');
  assert.equal(run('state.mode'), 'title');
  assert.equal(run('state.titleInputLock'), 0.5);
});

test('game over return and teaser dismissal require a released start before playing', () => {
  for (const initialMode of ['over', 'teaser']) {
    const run = game();
    run(`navigator = { getGamepads: () => [] }; startMusic = () => {}; state.mode = '${initialMode}';
      window.listeners.keydown({code: 'Space', repeat: false, preventDefault() {}}); update(0.01); update(0.6);
      window.listeners.keydown({code: 'Space', repeat: true, preventDefault() {}}); update(0.01);`);
    assert.equal(run('state.mode'), 'title');
    run('window.listeners.keyup({code: "Space"}); update(0.01); window.listeners.keydown({code: "Space", repeat: false, preventDefault() {}}); update(0.01)');
    assert.equal(run('state.mode'), 'briefing');
  }
});

test('random windows may close the body and both held windows', () => {
  for (const col of [0, 4, 7]) {
    const run = game();
  run(`state.mode = 'play'; state.music.context = null; state.climber.col = ${col}; state.climber.row = 20;
      state.camera = 18;
      state.hands.left.col = ${col}; state.hands.left.row = 19;
      state.hands.right.col = ${col}; state.hands.right.row = 20;
      shouldWindowBeOpen = () => false;
      for (let i = 0; i < 400; i++) { updateWindows(0.033); updateHandSupport(); }`);
    assert.equal(run('state.lives'), 2);
    assert.equal(run('state.mode'), 'falling');
  }
});

test('window updates no longer reserve an escape window', () => {
  const run = game();
  run('state.mode = "play"; updateWindows(0.01)');
  assert.equal(run('state.escapeWindow'), null);
});

test('every scoring beat has a kick and click on the same timestamp', () => {
  const run = game();
  run(`state.mode = 'play'; window.hits = []; playKick = (time) => window.hits.push(['kick', time]);
    playClick = (time) => window.hits.push(['click', time]);
    playTechnoBass = () => {}; playHat = () => {}; playTone = () => {};
    state.music.nextBeat = 10; state.music.beatIndex = 0;
    scheduleBeat(); state.music.context.currentTime += 60 / bpm; scheduleBeat();`);
  assert.equal(run('window.hits.length'), 4);
  assert.equal(run('window.hits[0][1] === window.hits[1][1]'), true);
  assert.equal(run('window.hits[2][1] === window.hits[3][1]'), true);
});

test('opening music loops within eight seconds and switches to gameplay tempo', () => {
  const run = game();
  run(`state.mode = 'title'; window.notes = []; playTone = (time, frequency) => window.notes.push(frequency);
    playHat = () => {}; playKick = () => {}; playClick = () => {}; playTechnoBass = () => {};
    state.music.nextBeat = 10; state.music.beatIndex = 0; scheduleBeat();`);
  assert.ok(run('16 * 60 / openingBpm <= 8'));
  assert.ok(run('Math.abs(state.music.nextBeat - (10 + 60 / openingBpm)) < 0.00001'));
  assert.ok(run('window.notes.length >= 2'));
  run(`state.mode = 'play'; state.music.nextBeat = 10; scheduleBeat();`);
  assert.ok(run('Math.abs(state.music.nextBeat - (10 + 60 / bpm)) < 0.00001'));
});

test('start sequence schedules a fanfare and does not schedule gameplay beats', () => {
  const run = game();
  run(`state.mode = 'intro'; state.intro = { time: 0, fanfareScheduled: false };
    state.music.nextBeat = 10; state.music.context.currentTime = 10;
    window.fanfare = 0; window.kicks = 0;
    scheduleStartFanfare = () => { window.fanfare++; };
    playKick = () => { window.kicks++; }; scheduleBeat();`);
  assert.equal(run('window.fanfare'), 1);
  assert.equal(run('window.kicks'), 0);
  assert.equal(run('state.intro.fanfareScheduled'), true);
});

test('stage targets increase by 25 floors and begin with an obstacle briefing', () => {
  const run = game();
  assert.equal(run('state.stage'), 1);
  assert.equal(run('state.stageTarget'), 50);
  run('state.music.context = null; state.mode = "play"; state.height = 50; beginNextStage();');
  assert.equal(run('state.stage'), 2);
  assert.equal(run('state.stageTarget'), 75);
  assert.equal(run('state.stageStartHeight'), 5);
  assert.equal(run('state.height'), 5);
  assert.equal(run('state.mode'), 'briefing');
  assert.equal(run('state.briefing.time'), 0);
  run('beginNextStage();');
  assert.equal(run('state.stageTarget'), 100);
});

test('title screen has no test-stage selection controls or start entry point', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const source = fs.readFileSync('src/main.js', 'utf8');
  const styles = fs.readFileSync('src/styles.css', 'utf8');
  assert.doesNotMatch(html, /stageSelect|TEST BUILDING|START TEST/);
  assert.doesNotMatch(source, /function startSelectedStage\s*\(/);
  assert.doesNotMatch(styles, /\.stage-select/);
});

test('GitHub Pages deployment keeps game assets relative to the repository path', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/deploy-pages.yml', 'utf8');
  assert.doesNotMatch(html, /src="\/assets\//);
  assert.match(workflow, /codex\/restore-stage5-sniper-era/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});

test('stage briefing lasts 1.5 seconds and can be skipped into the entry sequence', () => {
  const run = game();
  run(`state.music.context = null; state.mode = 'briefing'; state.briefing = { time: 0 };
    updateStageBriefing(1.49);`);
  assert.equal(run('state.mode'), 'briefing');
  assert.equal(run('state.briefing.time'), 1.49);
  run('updateStageBriefing(0.02);');
  assert.equal(run('state.mode'), 'intro');
  assert.equal(run('state.intro.time'), 0);

  run(`state.mode = 'briefing'; state.briefing = { time: 0 }; beginStageIntro = () => {
    state.mode = 'intro'; window.briefingSkipped = (window.briefingSkipped || 0) + 1;
  }; skipStageBriefing();`);
  assert.equal(run('state.mode'), 'intro');
  assert.equal(run('window.briefingSkipped'), 1);
});

test('stage briefings show only the hazards introduced by that building', () => {
  const run = game();
  assert.equal(run("stageHazardBriefings(1).map((hazard) => hazard.id).join(',')"), 'vase,beam');
  assert.equal(run("stageHazardBriefings(2).map((hazard) => hazard.id).join(',')"), 'shirt,dumbbell');
  assert.equal(run("stageHazardBriefings(3).map((hazard) => hazard.id).join(',')"), 'bird,pinkBeam');
  assert.equal(run("stageHazardBriefings(3).map((hazard) => hazard.label).join(',')"), 'BIRD,PINK BEAM');
  assert.equal(run("stageHazardBriefings(4).map((hazard) => hazard.id).join(',')"), 'wind');
  assert.equal(run("stageHazardBriefings(4)[0].label"), 'WIND');
  assert.equal(run("stageHazardBriefings(5).map((hazard) => hazard.id).join(',')"), 'sniper');
  assert.equal(run("stageHazardBriefings(5)[0].label"), 'SNIPER');
  assert.equal(run("stageHazardBriefings(6).map((hazard) => hazard.id).join(',')"), 'tyson');
  assert.equal(run('stageHazardBriefings(6)[0].label'), 'TIKE MYSON');
  assert.equal(run('stageHazardBriefings(7).length'), 0);
});

test('height display uses the current stage floor and target', () => {
  const run = game();
  run('state.stage = 1; state.stageTarget = 50; state.height = 7;');
  assert.equal(run('stageHeightLabel()'), '7/50F');
  run('state.stage = 2; state.stageStartHeight = 50; state.stageTarget = 75; state.height = 58;');
  assert.equal(run('stageHeightLabel()'), '58/75F');
});

test('reaching the target shows the building top before the next stage', () => {
  const run = game();
  run('state.mode = "play"; state.height = state.stageTarget; beginStageClear();');
  assert.equal(run('state.mode'), 'rooftop');
  assert.equal(run('state.rooftop.time'), 0);
  run('state.rooftop.time = 15.5; updateRooftop(0);');
  assert.equal(run('state.mode'), 'clear');
  run('state.music.context = null; state.keys.add("Space"); beginNextStage();');
  assert.equal(run('state.mode'), 'briefing');
  assert.equal(run('state.stage'), 2);
});

test('stage one roof is placed above floor 50 with no higher window rows', () => {
  const run = game();
  run('state.mode = "play"; state.stageTarget = 50; state.height = 49; state.climber.row = 50;');
  assert.equal(run('state.climber.row + (state.stageTarget - state.height)'), 51);
  assert.equal(run('state.stageTarget - state.height'), 1);
});
