import * as THREE from 'three';

// ---------- Constants ----------
const FIELD_W = 20; // play area width  (x)
const FIELD_H = 12; // play area height (y)
const PADDLE_W = 0.4;
const PADDLE_H = 2.4;
const PADDLE_SPEED = 14;
const AI_PADDLE_SPEED = 11; // slower than the player so AI can be beaten
const AI_CENTER_DEADZONE = 0.25; // only used when drifting to center (avoids hover twitch)
const AI_MAX_ERROR = 1.0; // random vertical aim offset, re-rolled per rally
const BALL_SIZE = 0.4;
const BALL_START_SPEED = 9;
const BALL_SPEED_GAIN = 1.05; // per paddle hit
const MAX_BOUNCE_ANGLE = Math.PI / 3; // 60deg

// ---------- Renderer / scene / camera ----------
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// Orthographic camera sized to fit the field with margin
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

function fitCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;

  // Reserve vertical space (in pixels) for HUD above and help below the field.
  // Must match `--hud-zone` in index.html.
  const HUD_PX = 64;
  // Convert reserved px into world units relative to FIELD_H so the field
  // never overlaps the HUD bands, regardless of window size.
  const playablePx = Math.max(1, h - 2 * HUD_PX);
  const unitsPerPx = FIELD_H / playablePx;
  const halfH = (h / 2) * unitsPerPx;
  const halfW = Math.max((FIELD_W / 2) * 1.1, halfH * aspect);

  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', fitCamera);
fitCamera();

// ---------- Field decoration ----------
// Top and bottom walls
const wallMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const wallGeo = new THREE.PlaneGeometry(FIELD_W, 0.15);
const topWall = new THREE.Mesh(wallGeo, wallMat);
topWall.position.y = FIELD_H / 2;
const bottomWall = new THREE.Mesh(wallGeo, wallMat);
bottomWall.position.y = -FIELD_H / 2;
scene.add(topWall, bottomWall);

// Dashed center line
const dashCount = 17;
const dashGeo = new THREE.PlaneGeometry(0.1, (FIELD_H / dashCount) * 0.55);
for (let i = 0; i < dashCount; i++) {
  const dash = new THREE.Mesh(dashGeo, wallMat);
  dash.position.y = -FIELD_H / 2 + ((i + 0.5) * FIELD_H) / dashCount;
  scene.add(dash);
}

// ---------- Paddles & ball ----------
const paddleGeo = new THREE.PlaneGeometry(PADDLE_W, PADDLE_H);
const paddleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

const leftPaddle = new THREE.Mesh(paddleGeo, paddleMat);
leftPaddle.position.set(-FIELD_W / 2 + 0.6, 0, 0);
scene.add(leftPaddle);

const rightPaddle = new THREE.Mesh(paddleGeo, paddleMat);
rightPaddle.position.set(FIELD_W / 2 - 0.6, 0, 0);
scene.add(rightPaddle);

const ballGeo = new THREE.PlaneGeometry(BALL_SIZE, BALL_SIZE);
const ball = new THREE.Mesh(ballGeo, paddleMat);
scene.add(ball);

// ---------- Game state ----------
const state = {
  ball: { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_START_SPEED },
  scoreLeft: 0,
  scoreRight: 0,
  serving: true,
  serveDir: 1, // 1 = serve to right, -1 = serve to left
  mode: 'ai', // 'ai' = 1P vs AI, '2p' = 2P local
  aiAimError: 0, // randomized per rally so the AI isn't pixel-perfect
};

const scoreLeftEl = document.getElementById('score-left');
const scoreRightEl = document.getElementById('score-right');
const modeEl = document.getElementById('mode');
function updateHud() {
  scoreLeftEl.textContent = state.scoreLeft;
  scoreRightEl.textContent = state.scoreRight;
  if (modeEl) modeEl.textContent = state.mode === 'ai' ? '1P vs AI' : '2P LOCAL';
}

function resetBall(towardDir) {
  state.ball.x = 0;
  state.ball.y = 0;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.speed = BALL_START_SPEED;
  state.serving = true;
  state.serveDir = towardDir;
  // Re-roll AI aim error so each rally plays differently.
  state.aiAimError = (Math.random() * 2 - 1) * AI_MAX_ERROR;
}

function serve() {
  if (!state.serving) return;
  const angle = Math.random() * 0.6 - 0.3; // small vertical component
  state.ball.vx = Math.cos(angle) * state.ball.speed * state.serveDir;
  state.ball.vy = Math.sin(angle) * state.ball.speed;
  state.serving = false;
}

resetBall(Math.random() < 0.5 ? 1 : -1);

// ---------- Input ----------
const keys = Object.create(null);
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') {
    serve();
    e.preventDefault();
  }
  // Mode toggle is only allowed between rallies to avoid mid-play surprises.
  if (state.serving && (e.code === 'Digit1' || e.code === 'Numpad1')) {
    state.mode = 'ai';
    updateHud();
  } else if (state.serving && (e.code === 'Digit2' || e.code === 'Numpad2')) {
    state.mode = '2p';
    updateHud();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// ---------- Physics helpers ----------
function clampPaddle(p) {
  const limit = FIELD_H / 2 - PADDLE_H / 2 - 0.075;
  if (p.position.y > limit) p.position.y = limit;
  if (p.position.y < -limit) p.position.y = -limit;
}

function paddleHit(ball, paddle, side) {
  // side: -1 left paddle, +1 right paddle
  const halfW = PADDLE_W / 2;
  const halfH = PADDLE_H / 2;
  const halfBall = BALL_SIZE / 2;
  const px = paddle.position.x;
  const py = paddle.position.y;

  const overlapX = Math.abs(ball.x - px) <= halfW + halfBall;
  const overlapY = Math.abs(ball.y - py) <= halfH + halfBall;
  if (!(overlapX && overlapY)) return false;
  // Only register if moving toward the paddle
  if (side === -1 && ball.vx >= 0) return false;
  if (side === 1 && ball.vx <= 0) return false;

  // Reflect with angle based on hit position on the paddle
  const rel = (ball.y - py) / halfH; // -1..1
  const clamped = Math.max(-1, Math.min(1, rel));
  const angle = clamped * MAX_BOUNCE_ANGLE;

  state.ball.speed = Math.min(state.ball.speed * BALL_SPEED_GAIN, 30);
  const dir = -side; // bounce away from the paddle
  state.ball.vx = Math.cos(angle) * state.ball.speed * dir;
  state.ball.vy = Math.sin(angle) * state.ball.speed;

  // Push the ball out of the paddle to avoid sticking
  state.ball.x = px + (halfW + halfBall) * dir;
  return true;
}

// ---------- AI ----------
function updateAI(dt) {
  // Target defaults to drifting back to center when the ball is moving away.
  let targetY = 0;
  let tracking = false;
  if (state.ball.vx > 0 && !state.serving) {
    // Ball heading toward AI: aim at ball.y plus a stable per-rally error.
    targetY = state.ball.y + state.aiAimError;
    tracking = true;
  }

  const dy = targetY - rightPaddle.position.y;

  // Only apply a deadzone when idling toward center; when actively tracking the
  // ball we move every frame so the motion stays smooth (no step-stop stutter).
  // Math.min(step, |dy|) below already prevents overshoot, so no jitter guard
  // is needed in tracking mode.
  if (!tracking && Math.abs(dy) < AI_CENTER_DEADZONE) return;

  const step = AI_PADDLE_SPEED * dt;
  rightPaddle.position.y += Math.sign(dy) * Math.min(step, Math.abs(dy));
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);

  // Paddle input
  if (keys['KeyW']) leftPaddle.position.y += PADDLE_SPEED * dt;
  if (keys['KeyS']) leftPaddle.position.y -= PADDLE_SPEED * dt;
  if (state.mode === '2p') {
    if (keys['ArrowUp']) rightPaddle.position.y += PADDLE_SPEED * dt;
    if (keys['ArrowDown']) rightPaddle.position.y -= PADDLE_SPEED * dt;
  } else {
    updateAI(dt);
  }
  clampPaddle(leftPaddle);
  clampPaddle(rightPaddle);

  // Ball
  if (!state.serving) {
    state.ball.x += state.ball.vx * dt;
    state.ball.y += state.ball.vy * dt;

    // Top / bottom wall bounce
    const yLimit = FIELD_H / 2 - BALL_SIZE / 2 - 0.075;
    if (state.ball.y > yLimit) {
      state.ball.y = yLimit;
      state.ball.vy = -Math.abs(state.ball.vy);
    } else if (state.ball.y < -yLimit) {
      state.ball.y = -yLimit;
      state.ball.vy = Math.abs(state.ball.vy);
    }

    // Paddles
    paddleHit(state.ball, leftPaddle, -1);
    paddleHit(state.ball, rightPaddle, 1);

    // Score
    if (state.ball.x < -FIELD_W / 2) {
      state.scoreRight++;
      updateHud();
      resetBall(-1); // next serve toward the player who was scored on
    } else if (state.ball.x > FIELD_W / 2) {
      state.scoreLeft++;
      updateHud();
      resetBall(1);
    }
  } else {
    // Park the ball at center while waiting for serve
    state.ball.x = 0;
    state.ball.y = 0;
  }

  ball.position.set(state.ball.x, state.ball.y, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

updateHud();
tick();
