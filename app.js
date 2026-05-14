const app = document.querySelector(".app");
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const scoreEl = document.querySelector("#score");
const comboEl = document.querySelector("#combo");
const timerEl = document.querySelector("#timer");
const pausePanel = document.querySelector("#pausePanel");
const gameOverPanel = document.querySelector("#gameOverPanel");
const finalScoreEl = document.querySelector("#finalScore");
const pool = document.querySelector("#pool");
const cameraFeed = document.querySelector("#cameraFeed");
const cameraStatusEl = document.querySelector("#cameraStatus");
const cameraButton = document.querySelector('[data-action="camera"]');
const cameraCanvas = document.createElement("canvas");
const cameraCtx = cameraCanvas.getContext("2d", { willReadFrequently: true });
const sharkSpeedInput = document.querySelector("#sharkSpeed");
const sharkSpeedValueEl = document.querySelector("#sharkSpeedValue");
const sharkCountInput = document.querySelector("#sharkCount");
const sharkCountValueEl = document.querySelector("#sharkCountValue");

const state = {
  score: 0,
  combo: 0,
  paused: false,
  hidden: false,
  gameOver: false,
  dragging: false,
  lastTick: performance.now(),
  lastSpawn: 0,
  lastObstacleSpawn: 0,
  slowedUntil: 0,
  bubbles: [],
  obstacles: [],
  ripples: [],
  fish: {
    x: canvas.width * 0.5,
    y: canvas.height * 0.55,
    targetX: canvas.width * 0.5,
    targetY: canvas.height * 0.55,
    angle: 0,
  },
  sharks: [],
};

const colors = ["#ffffff", "#eaf8ff", "#fff4cc", "#ffd9d4"];
const DEFAULT_SHARK_SPEED = 65;
const DEFAULT_SHARK_COUNT = 1;
const FACE_SAMPLE_SIZE = 6;
const FACE_ALERT_VOTES = 4;

const camera = {
  active: false,
  detector: null,
  mode: "off",
  stream: null,
  alertFrames: 0,
  samples: [],
  stableFaceCount: 0,
  timer: null,
};

function resizeCanvas() {
  const rect = pool.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = rect.width;
  const height = (rect.width / 12) * 7;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  state.fish.x = Math.min(Math.max(state.fish.x, 80), width - 60);
  state.fish.y = Math.min(Math.max(state.fish.y, 45), height - 45);
  state.fish.targetX = Math.min(Math.max(state.fish.targetX, 80), width - 60);
  state.fish.targetY = Math.min(Math.max(state.fish.targetY, 45), height - 45);
  state.sharks.forEach((shark) => {
    shark.x = Math.min(shark.x, width + 160);
    shark.y = Math.min(Math.max(shark.y, 70), height - 70);
  });
}

function logicalSize() {
  const ratio = window.devicePixelRatio || 1;
  return {
    width: canvas.width / ratio,
    height: canvas.height / ratio,
  };
}

function setHidden(hidden) {
  state.hidden = hidden;
  state.paused = hidden || state.paused;
  app.dataset.mode = hidden ? "work" : "play";
  syncPanels();
  document.title = hidden ? "Q2 工作流看板" : "摸鱼补给站";
}

function togglePause(force) {
  if (state.gameOver) return;
  state.paused = typeof force === "boolean" ? force : !state.paused;
  syncPanels();
  state.lastTick = performance.now();
}

function syncPanels() {
  pausePanel.classList.toggle("is-visible", state.paused && !state.hidden && !state.gameOver);
  gameOverPanel.classList.toggle("is-visible", state.gameOver && !state.hidden);
}

function setCameraStatus(text) {
  cameraStatusEl.textContent = text;
}

function stopCamera() {
  camera.active = false;
  camera.mode = "off";
  camera.detector = null;
  camera.alertFrames = 0;
  camera.samples = [];
  camera.stableFaceCount = 0;
  if (camera.timer) {
    window.clearTimeout(camera.timer);
    camera.timer = null;
  }
  if (camera.stream) {
    camera.stream.getTracks().forEach((track) => track.stop());
    camera.stream = null;
  }
  cameraFeed.srcObject = null;
  cameraButton.classList.remove("is-active");
  setCameraStatus("老板雷达未开启");
}

async function startCamera() {
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    setCameraStatus("当前浏览器不支持摄像头");
    return;
  }

  try {
    if ("FaceDetector" in window) {
      camera.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
      camera.mode = "native";
    } else {
      camera.detector = null;
      camera.mode = "skin";
    }

    camera.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 360 },
      },
      audio: false,
    });
    cameraFeed.srcObject = camera.stream;
    await cameraFeed.play();
    camera.active = true;
    camera.alertFrames = 0;
    camera.samples = [];
    camera.stableFaceCount = 0;
    cameraButton.classList.add("is-active");
    setCameraStatus(camera.mode === "native" ? "老板雷达扫描中" : "备用雷达扫描中");
    detectFaces();
  } catch (error) {
    stopCamera();
    setCameraStatus(error.name === "NotAllowedError" ? "摄像头权限未开启" : "老板雷达启动失败");
  }
}

async function detectFaces() {
  if (!camera.active || cameraFeed.readyState < 2) {
    if (camera.active) camera.timer = window.setTimeout(detectFaces, 450);
    return;
  }

  try {
    const faceCount =
      camera.mode === "native" && camera.detector
        ? (await camera.detector.detect(cameraFeed)).length
        : detectSkinFaceCandidates();

    const stableCount = stableFaceCount(faceCount);

    if (stableCount >= 2) {
      camera.alertFrames += 1;
      setCameraStatus(`稳定检测到 ${stableCount} 张脸，已切伪装`);
      if (camera.alertFrames >= 2) {
        setHidden(true);
      }
    } else {
      camera.alertFrames = 0;
      const label = camera.mode === "native" ? "老板雷达扫描中" : "备用雷达扫描中";
      setCameraStatus(stableCount === 1 ? `${label}：1 张脸` : label);
    }
  } catch (error) {
    setCameraStatus(camera.mode === "native" ? "人脸检测暂时不可用" : "备用雷达暂时不可用");
  }

  if (camera.active) {
    camera.timer = window.setTimeout(detectFaces, 450);
  }
}

function stableFaceCount(rawCount) {
  const normalizedCount = Math.min(Math.max(rawCount, 0), 4);
  camera.samples.push(normalizedCount);

  if (camera.samples.length > FACE_SAMPLE_SIZE) {
    camera.samples.shift();
  }

  const alertVotes = camera.samples.filter((count) => count >= 2).length;
  const calmVotes = camera.samples.filter((count) => count <= 1).length;

  if (alertVotes >= FACE_ALERT_VOTES) {
    camera.stableFaceCount = Math.max(2, modeFaceCount(camera.samples.filter((count) => count >= 2)));
    return camera.stableFaceCount;
  }

  if (calmVotes >= FACE_ALERT_VOTES) {
    camera.stableFaceCount = modeFaceCount(camera.samples.filter((count) => count <= 1));
  }

  return camera.stableFaceCount;
}

function modeFaceCount(samples) {
  if (samples.length === 0) return 0;

  const counts = new Map();
  samples.forEach((count) => {
    counts.set(count, (counts.get(count) || 0) + 1);
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

function detectSkinFaceCandidates() {
  const width = 96;
  const height = 72;
  cameraCanvas.width = width;
  cameraCanvas.height = height;
  cameraCtx.drawImage(cameraFeed, 0, 0, width, height);

  const image = cameraCtx.getImageData(0, 0, width, height);
  const pixels = image.data;
  const skin = new Uint8Array(width * height);

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const isSkin =
      r > 58 &&
      g > 34 &&
      b > 22 &&
      max - min > 14 &&
      Math.abs(r - g) > 8 &&
      r > g &&
      r > b &&
      r / (g + 1) < 1.85;

    if (isSkin) skin[index / 4] = 1;
  }

  return countFaceLikeBlobs(skin, width, height);
}

function countFaceLikeBlobs(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const candidates = [];
  const queue = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      count += 1;

      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (
          next >= 0 &&
          next < mask.length &&
          !visited[next] &&
          mask[next] &&
          Math.abs((next % width) - x) <= 1
        ) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    const blobWidth = maxX - minX + 1;
    const blobHeight = maxY - minY + 1;
    const area = blobWidth * blobHeight;
    const fillRatio = count / area;
    const aspectRatio = blobWidth / blobHeight;

    if (
      count >= 34 &&
      blobWidth >= 6 &&
      blobHeight >= 7 &&
      aspectRatio >= 0.45 &&
      aspectRatio <= 1.75 &&
      fillRatio >= 0.22
    ) {
      candidates.push({ count, minX, maxX, minY, maxY });
    }
  }

  return mergeNearbyBlobs(candidates).length;
}

function mergeNearbyBlobs(blobs) {
  const merged = [];

  for (const blob of blobs.sort((a, b) => b.count - a.count)) {
    const overlaps = merged.some((item) => {
      const centerX = (blob.minX + blob.maxX) / 2;
      const centerY = (blob.minY + blob.maxY) / 2;
      const itemCenterX = (item.minX + item.maxX) / 2;
      const itemCenterY = (item.minY + item.maxY) / 2;
      return Math.hypot(centerX - itemCenterX, centerY - itemCenterY) < 20;
    });

    if (!overlaps) merged.push(blob);
  }

  const largestBlob = merged[0]?.count || 0;
  return merged.filter((blob) => blob.count >= Math.max(34, largestBlob * 0.45)).slice(0, 4);
}

function toggleCamera() {
  if (camera.active) {
    stopCamera();
    return;
  }
  startCamera();
}

function sharkSpeed() {
  return Number(sharkSpeedInput.value) || DEFAULT_SHARK_SPEED;
}

function sharkCount() {
  return Number(sharkCountInput.value) || 0;
}

function syncSharkSpeed() {
  const speed = sharkSpeed();
  state.sharks.forEach((shark) => {
    shark.speed = speed;
  });
  sharkSpeedValueEl.textContent = speed.toString();
}

function syncSharkCount() {
  const count = sharkCount();
  const { width, height } = logicalSize();
  const previousCount = state.sharks.length;

  if (count < previousCount) {
    state.sharks = state.sharks.slice(0, count);
  }

  while (state.sharks.length < count) {
    state.sharks.push(createShark(state.sharks.length, width, height));
  }

  sharkCountValueEl.textContent = count.toString();
  syncSharkSpeed();
  syncHud();
}

function createShark(index, width, height) {
  return {
    x: -150 - index * 110,
    y: height * (0.34 + index * 0.16),
    angle: 0,
    speed: sharkSpeed(),
    offset: index * 1.4,
    biteRadius: 72,
  };
}

function spawnBubble(now) {
  const size = logicalSize();
  const radius = 10 + Math.random() * 20;
  state.bubbles.push({
    x: 30 + Math.random() * (size.width - 60),
    y: size.height + radius,
    r: radius,
    speed: 34 + Math.random() * 52,
    drift: -24 + Math.random() * 48,
    color: colors[Math.floor(Math.random() * colors.length)],
    born: now,
  });
}

function spawnObstacle(now) {
  const size = logicalSize();
  const radius = 18 + Math.random() * 18;
  state.obstacles.push({
    x: size.width + radius,
    y: 55 + Math.random() * (size.height - 110),
    r: radius,
    speed: 58 + Math.random() * 42,
    wobble: Math.random() * Math.PI * 2,
    born: now,
  });
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const point = event.touches ? event.touches[0] : event;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function moveFish(event) {
  if (state.paused || state.hidden || state.gameOver) return;
  const pos = pointerPosition(event);
  state.fish.targetX = pos.x;
  state.fish.targetY = pos.y;
}

function drawBackground(width, height, now) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let i = 0; i < 8; i += 1) {
    const y = ((now / 28 + i * 74) % (height + 90)) - 45;
    ctx.beginPath();
    ctx.ellipse(width * (0.12 + i * 0.12), y, 84, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFish(fish) {
  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.rotate(fish.angle);
  ctx.fillStyle = "#ef6f61";
  ctx.beginPath();
  ctx.ellipse(0, 0, 42, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d84f47";
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.lineTo(-72, -24);
  ctx.lineTo(-64, 0);
  ctx.lineTo(-72, 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff7d6";
  ctx.beginPath();
  ctx.arc(22, -8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(25, -8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(5, 3, 17, 0.3, 1.9);
  ctx.stroke();
  ctx.restore();
}

function drawShark(shark) {
  ctx.save();
  ctx.translate(shark.x, shark.y);
  ctx.rotate(shark.angle);
  ctx.fillStyle = "#324256";
  ctx.beginPath();
  ctx.ellipse(0, 0, 82, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#253244";
  ctx.beginPath();
  ctx.moveTo(-70, 0);
  ctx.lineTo(-128, -34);
  ctx.lineTo(-112, 0);
  ctx.lineTo(-128, 34);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-12, -30);
  ctx.lineTo(22, -78);
  ctx.lineTo(44, -24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.ellipse(24, 10, 42, 16, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(50, -9, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(53, -9, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(52, 12);
  ctx.lineTo(74, 8);
  ctx.stroke();
  ctx.restore();
}

function drawObstacle(obstacle) {
  ctx.save();
  ctx.translate(obstacle.x, obstacle.y);
  ctx.rotate(Math.sin(obstacle.born + obstacle.x) * 0.1);
  ctx.fillStyle = "#6b7280";
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-obstacle.r, -obstacle.r * 0.7, obstacle.r * 2, obstacle.r * 1.4, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.arc(-obstacle.r * 0.35, -obstacle.r * 0.2, obstacle.r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBubble(bubble) {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = bubble.color;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(bubble.x - bubble.r * 0.35, bubble.y - bubble.r * 0.35, bubble.r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRipple(ripple) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, ripple.life);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function update(delta, now) {
  if (now - state.lastSpawn > 520) {
    spawnBubble(now);
    state.lastSpawn = now;
  }

  if (now - state.lastObstacleSpawn > 1500) {
    spawnObstacle(now);
    state.lastObstacleSpawn = now;
  }

  const fish = state.fish;
  const dx = fish.targetX - fish.x;
  const dy = fish.targetY - fish.y;
  const speedPenalty = now < state.slowedUntil ? 0.045 : 0.12;
  fish.x += dx * speedPenalty;
  fish.y += dy * speedPenalty;
  fish.angle = Math.atan2(dy, dx) * 0.18;

  const size = logicalSize();
  fish.x = Math.min(Math.max(fish.x, 54), size.width - 44);
  fish.y = Math.min(Math.max(fish.y, 32), size.height - 32);

  state.bubbles = state.bubbles.filter((bubble) => {
    bubble.y -= bubble.speed * delta;
    bubble.x += Math.sin((now - bubble.born) / 350) * bubble.drift * delta;
    const distance = Math.hypot(bubble.x - fish.x, bubble.y - fish.y);
    if (distance < bubble.r + 38) {
      state.combo += 1;
      state.score += 10 + Math.min(state.combo, 12) * 2;
      state.sharks.forEach((shark) => {
        shark.x -= Math.min(18 + state.combo, 42);
      });
      state.ripples.push({ x: bubble.x, y: bubble.y, r: bubble.r, life: 1 });
      return false;
    }
    return bubble.y + bubble.r > -10;
  });

  state.obstacles = state.obstacles.filter((obstacle) => {
    obstacle.x -= obstacle.speed * delta;
    obstacle.y += Math.sin((now - obstacle.born) / 260 + obstacle.wobble) * 26 * delta;
    const distance = Math.hypot(obstacle.x - fish.x, obstacle.y - fish.y);
    if (distance < obstacle.r + 32) {
      state.combo = 0;
      state.slowedUntil = now + 1050;
      state.ripples.push({ x: obstacle.x, y: obstacle.y, r: obstacle.r + 12, life: 0.85 });
      return false;
    }
    return obstacle.x + obstacle.r > -20;
  });

  state.sharks.forEach((shark, index) => {
    const targetY = fish.y + Math.sin(now / 520 + shark.offset) * (18 + index * 6);
    const chaseDx = fish.x - shark.x;
    const chaseDy = targetY - shark.y;
    const chaseDistance = Math.hypot(chaseDx, chaseDy) || 1;
    const pressure = 1 + Math.min(state.score / 900, 0.85);
    shark.x += (chaseDx / chaseDistance) * shark.speed * pressure * delta;
    shark.y += (chaseDy / chaseDistance) * shark.speed * pressure * delta;
    shark.angle = Math.atan2(chaseDy, chaseDx) * 0.22;

    if (Math.hypot(shark.x - fish.x, shark.y - fish.y) < shark.biteRadius) {
      endGame();
    }
  });

  state.ripples = state.ripples.filter((ripple) => {
    ripple.r += 70 * delta;
    ripple.life -= 1.6 * delta;
    return ripple.life > 0;
  });

}

function render(now) {
  const { width, height } = logicalSize();
  drawBackground(width, height, now);
  state.bubbles.forEach(drawBubble);
  state.obstacles.forEach(drawObstacle);
  state.ripples.forEach(drawRipple);
  state.sharks.forEach(drawShark);
  drawFish(state.fish);
}

function syncHud() {
  scoreEl.textContent = state.score.toString();
  comboEl.textContent = state.combo.toString();
  if (state.sharks.length === 0) {
    timerEl.textContent = "安全";
    return;
  }

  const nearestDistance = state.sharks.reduce((nearest, shark) => {
    const distance = Math.hypot(shark.x - state.fish.x, shark.y - state.fish.y) - shark.biteRadius;
    return Math.min(nearest, distance);
  }, Number.POSITIVE_INFINITY);
  timerEl.textContent = `${Math.max(0, Math.round(nearestDistance))}m`;
}

function endGame() {
  state.gameOver = true;
  state.paused = true;
  finalScoreEl.textContent = `本局摸鱼值 ${state.score}`;
  syncPanels();
}

function resetGame() {
  const { width, height } = logicalSize();
  state.score = 0;
  state.combo = 0;
  state.paused = false;
  state.hidden = false;
  state.gameOver = false;
  state.dragging = false;
  state.lastTick = performance.now();
  state.lastSpawn = 0;
  state.lastObstacleSpawn = 0;
  state.slowedUntil = 0;
  state.bubbles = [];
  state.obstacles = [];
  state.ripples = [];
  state.fish.x = width * 0.56;
  state.fish.y = height * 0.52;
  state.fish.targetX = state.fish.x;
  state.fish.targetY = state.fish.y;
  state.sharks = Array.from({ length: sharkCount() }, (_, index) => createShark(index, width, height));
  app.dataset.mode = "play";
  document.title = "摸鱼补给站";
  syncPanels();
  syncHud();
}

function loop(now) {
  const delta = Math.min((now - state.lastTick) / 1000, 0.033);
  state.lastTick = now;

  if (!state.paused && !state.hidden) {
    update(delta, now);
  }

  if (!state.hidden) {
    render(now);
    syncHud();
  }

  requestAnimationFrame(loop);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setHidden(true);
  }

  if (event.code === "Space" && !state.hidden) {
    event.preventDefault();
    togglePause();
  }

  if (event.altKey && event.key.toLowerCase() === "h") {
    setHidden(true);
  }
});

document.querySelector('[data-action="pause"]').addEventListener("click", () => togglePause());
document.querySelector('[data-action="hide"]').addEventListener("click", () => setHidden(true));
document.querySelector('[data-action="restart"]').addEventListener("click", resetGame);
cameraButton.addEventListener("click", toggleCamera);
sharkSpeedInput.addEventListener("input", syncSharkSpeed);
sharkCountInput.addEventListener("input", syncSharkCount);
document.querySelector('[data-action="reveal"]').addEventListener("click", () => {
  setHidden(false);
  if (!state.gameOver) togglePause(false);
});

window.addEventListener("beforeunload", stopCamera);

canvas.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  canvas.setPointerCapture(event.pointerId);
  moveFish(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (state.dragging) moveFish(event);
});

canvas.addEventListener("pointerup", () => {
  state.dragging = false;
  state.combo = 0;
});

canvas.addEventListener("pointercancel", () => {
  state.dragging = false;
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
syncSharkSpeed();
resetGame();
requestAnimationFrame(loop);
