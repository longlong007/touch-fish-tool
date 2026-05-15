/**
 * 摸鱼补给站 - 一个摸鱼小游戏
 * 玩家控制小鱼躲避鲨鱼和障碍物，收集气泡获得分数
 */

// ============================================================
// DOM 元素引用
// ============================================================

/** 主应用容器 */
const app = document.querySelector(".app");
/** 游戏画布元素 */
const canvas = document.querySelector("#game");
/** Canvas 2D 绘图上下文 */
const ctx = canvas.getContext("2d");
/** 分数显示元素 */
const scoreEl = document.querySelector("#score");
/** 连击数显示元素 */
const comboEl = document.querySelector("#combo");
/** 计时器/距离显示元素 */
const timerEl = document.querySelector("#timer");
/** 暂停面板 */
const pausePanel = document.querySelector("#pausePanel");
/** 游戏结束面板 */
const gameOverPanel = document.querySelector("#gameOverPanel");
/** 最终分数显示元素 */
const finalScoreEl = document.querySelector("#finalScore");
/** 画布容器元素（用于计算尺寸） */
const pool = document.querySelector("#pool");
/** 摄像头视频流显示元素 */
const cameraFeed = document.querySelector("#cameraFeed");
/** 摄像头状态文字元素 */
const cameraStatusEl = document.querySelector("#cameraStatus");
/** 摄像头控制按钮 */
const cameraButton = document.querySelector('[data-action="camera"]');

/** 离屏 Canvas，用于摄像头图像处理 */
const cameraCanvas = document.createElement("canvas");
/** 离屏 Canvas 的 2D 上下文，启用频繁读取优化 */
const cameraCtx = cameraCanvas.getContext("2d", { willReadFrequently: true });

/** 鲨鱼速度滑块输入框 */
const sharkSpeedInput = document.querySelector("#sharkSpeed");
/** 鲨鱼速度数值显示 */
const sharkSpeedValueEl = document.querySelector("#sharkSpeedValue");
/** 鲨鱼数量滑块输入框 */
const sharkCountInput = document.querySelector("#sharkCount");
/** 鲨鱼数量数值显示 */
const sharkCountValueEl = document.querySelector("#sharkCountValue");

// ============================================================
// 游戏状态
// ============================================================

/**
 * 游戏核心状态对象
 * 包含所有游戏相关的数据：分数、生物、障碍物、时间等
 */
const state = {
  /** 当前分数 */
  score: 0,
  /** 连击计数器（连续收集气泡的次数） */
  combo: 0,
  /** 游戏是否暂停 */
  paused: false,
  /** 是否处于"伪装"模式（隐藏游戏） */
  hidden: false,
  /** 游戏是否结束 */
  gameOver: false,
  /** 是否正在拖动/控制小鱼 */
  dragging: false,
  /** 上次游戏循环的时间戳（用于计算 delta） */
  lastTick: performance.now(),
  /** 上次生成气泡的时间戳 */
  lastSpawn: 0,
  /** 上次生成障碍物的时间戳 */
  lastObstacleSpawn: 0,
  /** 减速效果结束的时间戳（碰到障碍物后短暂减速） */
  slowedUntil: 0,
  /** 气泡数组 */
  bubbles: [],
  /** 障碍物数组 */
  obstacles: [],
  /** 涟漪效果数组 */
  ripples: [],
  /** 玩家控制的小鱼 */
  fish: {
    x: canvas.width * 0.5,        // 初始 X 位置（画布中心）
    y: canvas.height * 0.55,     // 初始 Y 位置（略低于中心）
    targetX: canvas.width * 0.5,  // 目标 X 位置（跟随鼠标）
    targetY: canvas.height * 0.55, // 目标 Y 位置
    angle: 0,                     // 当前旋转角度
  },
  /** 鲨鱼数组 */
  sharks: [],
};

// ============================================================
// 常量配置
// ============================================================

/** 气泡颜色数组（半透明的柔和色彩） */
const colors = ["#ffffff", "#eaf8ff", "#fff4cc", "#ffd9d4"];
/** 鲨鱼默认速度（像素/秒） */
const DEFAULT_SHARK_SPEED = 65;
/** 鲨鱼默认数量 */
const DEFAULT_SHARK_COUNT = 1;
/** 面部检测样本数量（用于平滑检测结果） */
const FACE_SAMPLE_SIZE = 6;
/** 触发警报所需的有效票数 */
const FACE_ALERT_VOTES = 4;

// ============================================================
// 摄像头与人脸检测
// ============================================================

/**
 * 摄像头状态对象
 * 管理摄像头开启状态、人脸检测模式和检测数据
 */
const camera = {
  /** 摄像头是否正在运行 */
  active: false,
  /** 人脸检测器实例（原生或自定义） */
  detector: null,
  /** 检测模式："off" | "native" | "skin" */
  mode: "off",
  /** 媒体流对象 */
  stream: null,
  /** 连续检测到多张脸的帧数 */
  alertFrames: 0,
  /** 近期检测样本数组（用于平滑） */
  samples: [],
  /** 稳定检测到的人脸数量 */
  stableFaceCount: 0,
  /** 检测定时器 ID */
  timer: null,
};

// ============================================================
// Canvas 尺寸管理
// ============================================================

/**
 * 调整画布尺寸以适配容器
 * 处理设备像素比（DPR）以确保高清显示
 */
function resizeCanvas() {
  // 获取容器 bounding rectangle
  const rect = pool.getBoundingClientRect();
  // 获取设备像素比（Retina 屏为 2 或更高）
  const ratio = window.devicePixelRatio || 1;
  const width = rect.width;
  // 按 12:7 比例计算高度（游戏画布的宽高比）
  const height = (rect.width / 12) * 7;

  // 设置 Canvas 实际像素尺寸（乘以 DPR）
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(height * ratio);
  // 重置 Canvas 变换矩阵，使用逻辑像素尺寸
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  // 边界约束：确保小鱼在画布范围内
  state.fish.x = Math.min(Math.max(state.fish.x, 80), width - 60);
  state.fish.y = Math.min(Math.max(state.fish.y, 45), height - 45);
  state.fish.targetX = Math.min(Math.max(state.fish.targetX, 80), width - 60);
  state.fish.targetY = Math.min(Math.max(state.fish.targetY, 45), height - 45);

  // 边界约束：确保鲨鱼在画布范围内（留出鲨鱼自身大小）
  state.sharks.forEach((shark) => {
    shark.x = Math.min(shark.x, width + 160);
    shark.y = Math.min(Math.max(shark.y, 70), height - 70);
  });
}

/**
 * 获取画布的逻辑尺寸（去除设备像素比影响）
 * @returns {{width: number, height: number}} 逻辑像素尺寸
 */
function logicalSize() {
  const ratio = window.devicePixelRatio || 1;
  return {
    width: canvas.width / ratio,
    height: canvas.height / ratio,
  };
}

// ============================================================
// 游戏模式切换
// ============================================================

/**
 * 设置游戏的"隐藏/伪装"模式
 * 当检测到多人脸时自动切换到工作模式（隐藏游戏）
 * @param {boolean} hidden - 是否隐藏游戏
 */
function setHidden(hidden) {
  state.hidden = hidden;
  // 隐藏时同时暂停游戏
  state.paused = hidden || state.paused;
  // 更新 data-mode 属性以切换 CSS 样式
  app.dataset.mode = hidden ? "work" : "play";
  // 同步面板显示状态
  syncPanels();
  // 更新页面标题（伪装成工作界面）
  document.title = hidden ? "Q2 工作流看板" : "摸鱼补给站";
}

/**
 * 切换游戏暂停状态
 * @param {boolean|undefined} force - 强制设置暂停状态
 */
function togglePause(force) {
  // 游戏结束时不能切换暂停
  if (state.gameOver) return;
  // 如果提供了 force 参数则使用它，否则取反当前状态
  state.paused = typeof force === "boolean" ? force : !state.paused;
  syncPanels();
  // 重置时间基准，避免暂停期间 delta 过大
  state.lastTick = performance.now();
}

/**
 * 同步面板显示状态
 * 根据当前游戏状态显示/隐藏暂停和游戏结束面板
 */
function syncPanels() {
  // 暂停面板：暂停状态 且 未隐藏 且 未游戏结束
  pausePanel.classList.toggle("is-visible", state.paused && !state.hidden && !state.gameOver);
  // 游戏结束面板：游戏结束状态 且 未隐藏
  gameOverPanel.classList.toggle("is-visible", state.gameOver && !state.hidden);
}

// ============================================================
// 摄像头功能
// ============================================================

/**
 * 更新摄像头状态显示文字
 * @param {string} text - 要显示的状态文字
 */
function setCameraStatus(text) {
  cameraStatusEl.textContent = text;
}

/**
 * 停止摄像头，释放资源
 */
function stopCamera() {
  camera.active = false;
  camera.mode = "off";
  camera.detector = null;
  camera.alertFrames = 0;
  camera.samples = [];
  camera.stableFaceCount = 0;

  // 清除待执行的检测定时器
  if (camera.timer) {
    window.clearTimeout(camera.timer);
    camera.timer = null;
  }

  // 停止所有媒体轨道
  if (camera.stream) {
    camera.stream.getTracks().forEach((track) => track.stop());
    camera.stream = null;
  }

  // 清除视频源
  cameraFeed.srcObject = null;
  // 移除按钮激活状态
  cameraButton.classList.remove("is-active");
  setCameraStatus("老板雷达未开启");
}

/**
 * 启动摄像头和人脸检测
 * 优先使用原生 FaceDetector API，失败则使用肤色检测
 */
async function startCamera() {
  // 检查浏览器是否支持媒体设备
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    setCameraStatus("当前浏览器不支持摄像头");
    return;
  }

  try {
    // 尝试使用原生 FaceDetector API
    if ("FaceDetector" in window) {
      camera.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
      camera.mode = "native";
    } else {
      // 回退到肤色检测方案
      camera.detector = null;
      camera.mode = "skin";
    }

    // 请求摄像头权限
    camera.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",  // 使用前置摄像头
        width: { ideal: 640 },
        height: { ideal: 360 },
      },
      audio: false,
    });

    // 显示视频流
    cameraFeed.srcObject = camera.stream;
    await cameraFeed.play();

    // 更新状态
    camera.active = true;
    camera.alertFrames = 0;
    camera.samples = [];
    camera.stableFaceCount = 0;
    cameraButton.classList.add("is-active");

    // 根据检测模式设置状态文字
    setCameraStatus(camera.mode === "native" ? "老板雷达扫描中" : "备用雷达扫描中");

    // 开始检测循环
    detectFaces();
  } catch (error) {
    stopCamera();
    // 根据错误类型设置状态
    setCameraStatus(error.name === "NotAllowedError" ? "摄像头权限未开启" : "老板雷达启动失败");
  }
}

/**
 * 人脸检测主循环
 * 定期检测摄像头画面中的面部数量
 */
async function detectFaces() {
  // 检查视频是否准备就绪
  if (!camera.active || cameraFeed.readyState < 2) {
    if (camera.active) {
      // 视频未就绪，450ms 后重试
      camera.timer = window.setTimeout(detectFaces, 450);
    }
    return;
  }

  try {
    // 根据模式选择检测方法
    const faceCount =
      camera.mode === "native" && camera.detector
        ? (await camera.detector.detect(cameraFeed)).length
        : detectSkinFaceCandidates();

    // 获取平滑后的稳定人脸数
    const stableCount = stableFaceCount(faceCount);

    // 检测到多人脸（>=2）时的处理
    if (stableCount >= 2) {
      camera.alertFrames += 1;
      setCameraStatus(`稳定检测到 ${stableCount} 张脸，已切伪装`);
      // 连续 2 帧检测到多人脸，触发隐藏
      if (camera.alertFrames >= 2) {
        setHidden(true);
      }
    } else {
      // 未检测到多人脸，重置计数
      camera.alertFrames = 0;
      const label = camera.mode === "native" ? "老板雷达扫描中" : "备用雷达扫描中";
      setCameraStatus(stableCount === 1 ? `${label}：1 张脸` : label);
    }
  } catch (error) {
    setCameraStatus(camera.mode === "native" ? "人脸检测暂时不可用" : "备用雷达暂时不可用");
  }

  // 继续检测循环
  if (camera.active) {
    camera.timer = window.setTimeout(detectFaces, 450);
  }
}

/**
 * 计算稳定的人脸检测数量
 * 使用滑动窗口和投票机制平滑检测结果
 * @param {number} rawCount - 原始检测数量
 * @returns {number} 平滑后的人脸数
 */
function stableFaceCount(rawCount) {
  // 归一化到 0-4 范围
  const normalizedCount = Math.min(Math.max(rawCount, 0), 4);
  camera.samples.push(normalizedCount);

  // 保持固定大小的滑动窗口
  if (camera.samples.length > FACE_SAMPLE_SIZE) {
    camera.samples.shift();
  }

  // 统计"警报"票数（>=2张脸）和"平静"票数（<=1张脸）
  const alertVotes = camera.samples.filter((count) => count >= 2).length;
  const calmVotes = camera.samples.filter((count) => count <= 1).length;

  // 达到警报阈值
  if (alertVotes >= FACE_ALERT_VOTES) {
    camera.stableFaceCount = Math.max(2, modeFaceCount(camera.samples.filter((count) => count >= 2)));
    return camera.stableFaceCount;
  }

  // 达到平静阈值
  if (calmVotes >= FACE_ALERT_VOTES) {
    camera.stableFaceCount = modeFaceCount(camera.samples.filter((count) => count <= 1));
  }

  return camera.stableFaceCount;
}

/**
 * 计算数组中的众数（出现次数最多的值）
 * @param {number[]} samples - 样本数组
 * @returns {number} 众数值
 */
function modeFaceCount(samples) {
  if (samples.length === 0) return 0;

  // 统计每个值出现的次数
  const counts = new Map();
  samples.forEach((count) => {
    counts.set(count, (counts.get(count) || 0) + 1);
  });

  // 按出现次数降序排序，返回次数最多的值
  // 若次数相同则取较大的那个值
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/**
 * 肤色检测方案：检测图像中疑似人脸的区域
 * 基于肤色模型和连通区域分析识别人脸
 * @returns {number} 检测到的人脸数量
 */
function detectSkinFaceCandidates() {
  // 低分辨率以提高性能
  const width = 96;
  const height = 72;
  cameraCanvas.width = width;
  cameraCanvas.height = height;
  cameraCtx.drawImage(cameraFeed, 0, 0, width, height);

  // 获取图像像素数据
  const image = cameraCtx.getImageData(0, 0, width, height);
  const pixels = image.data;
  // 肤色蒙版数组
  const skin = new Uint8Array(width * height);

  // 遍历每个像素（每 4 个字节为一个像素：R,G,B,A）
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    // 肤色判断条件：
    // 1. RGB分量都高于一定阈值
    // 2. 颜色对比度足够（max-min）
    // 3. 红色分量大于绿色和蓝色
    // 4. 红色与绿色比例适中
    const isSkin =
      r > 58 &&
      g > 34 &&
      b > 22 &&
      max - min > 14 &&
      Math.abs(r - g) > 8 &&
      r > g &&
      r > b &&
      r / (g + 1) < 1.85;

    if (isSkin) {
      skin[index / 4] = 1;
    }
  }

  // 统计疑似人脸的连通区域
  return countFaceLikeBlobs(skin, width, height);
}

/**
 * 计算疑似人脸的连通区域数量
 * 使用 BFS（广度优先搜索）进行区域标记
 * @param {Uint8Array} mask - 肤色蒙版
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {number} 疑似人脸区域数量
 */
function countFaceLikeBlobs(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const candidates = [];
  const queue = [];

  // 遍历所有像素
  for (let start = 0; start < mask.length; start += 1) {
    // 跳过非肤色或已访问的像素
    if (!mask[start] || visited[start]) continue;

    // BFS 初始化
    let head = 0;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    // BFS 遍历连通区域
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      count += 1;

      // 计算当前像素坐标
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      // 检查 4 个邻接像素（上下左右）
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (
          next >= 0 &&
          next < mask.length &&
          !visited[next] &&
          mask[next] &&
          Math.abs((next % width) - x) <= 1  // 限制水平距离避免跨越断裂区域
        ) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    // 计算区域几何特征
    const blobWidth = maxX - minX + 1;
    const blobHeight = maxY - minY + 1;
    const area = blobWidth * blobHeight;
    const fillRatio = count / area;      // 填充率（肤色像素占比）
    const aspectRatio = blobWidth / blobHeight;  // 宽高比

    // 根据几何特征判断是否像人脸
    // 人脸通常：面积足够大、宽高比接近 1、填充率足够高
    if (
      count >= 34 &&              // 最小像素数
      blobWidth >= 6 &&          // 最小宽度
      blobHeight >= 7 &&         // 最小高度
      aspectRatio >= 0.45 &&     // 宽高比下限（接近正方形）
      aspectRatio <= 1.75 &&      // 宽高比上限
      fillRatio >= 0.22          // 填充率（不能太稀疏）
    ) {
      candidates.push({ count, minX, maxX, minY, maxY });
    }
  }

  // 合并相近的区域，返回最终人脸数量
  return mergeNearbyBlobs(candidates).length;
}

/**
 * 合并距离过近的区域，过滤噪声
 * @param {Array} blobs - 疑似人脸区域数组
 * @returns {Array} 合并后的区域数组
 */
function mergeNearbyBlobs(blobs) {
  const merged = [];

  // 按面积降序处理
  for (const blob of blobs.sort((a, b) => b.count - a.count)) {
    const blobCenterX = (blob.minX + blob.maxX) / 2;
    const blobCenterY = (blob.minY + blob.maxY) / 2;

    // 检查是否与已合并区域重叠
    const overlaps = merged.some((item) => {
      const itemCenterX = (item.minX + item.maxX) / 2;
      const itemCenterY = (item.minY + item.maxY) / 2;
      return Math.hypot(blobCenterX - itemCenterX, blobCenterY - itemCenterY) < 20;
    });

    if (!overlaps) {
      merged.push(blob);
    }
  }

  // 过滤太小的区域（至少是最大区域的 45%）
  const largestBlob = merged[0]?.count || 0;
  return merged.filter((blob) => blob.count >= Math.max(34, largestBlob * 0.45)).slice(0, 4);
}

/**
 * 切换摄像头开关状态
 */
function toggleCamera() {
  if (camera.active) {
    stopCamera();
    return;
  }
  startCamera();
}

// ============================================================
// 鲨鱼管理
// ============================================================

/**
 * 获取当前鲨鱼速度设置值
 * @returns {number} 鲨鱼速度（像素/秒）
 */
function sharkSpeed() {
  return Number(sharkSpeedInput.value) || DEFAULT_SHARK_SPEED;
}

/**
 * 获取当前鲨鱼数量设置值
 * @returns {number} 鲨鱼数量
 */
function sharkCount() {
  return Number(sharkCountInput.value) || 0;
}

/**
 * 同步鲨鱼速度显示和实际速度
 */
function syncSharkSpeed() {
  const speed = sharkSpeed();
  state.sharks.forEach((shark) => {
    shark.speed = speed;
  });
  sharkSpeedValueEl.textContent = speed.toString();
}

/**
 * 同步鲨鱼数量显示和实际数量
 * 根据数量变化添加或移除鲨鱼
 */
function syncSharkCount() {
  const count = sharkCount();
  const { width, height } = logicalSize();
  const previousCount = state.sharks.length;

  // 数量减少：移除多余的鲨鱼
  if (count < previousCount) {
    state.sharks = state.sharks.slice(0, count);
  }

  // 数量增加：创建新的鲨鱼
  while (state.sharks.length < count) {
    state.sharks.push(createShark(state.sharks.length, width, height));
  }

  sharkCountValueEl.textContent = count.toString();
  syncSharkSpeed();
  syncHud();
}

/**
 * 创建一条新鲨鱼
 * @param {number} index - 鲨鱼索引（用于错开位置）
 * @param {number} width - 画布宽度
 * @param {number} height - 画布高度
 * @returns {Object} 鲨鱼对象
 */
function createShark(index, width, height) {
  return {
    x: -150 - index * 110,           // 初始 X：从屏幕左侧依次排列
    y: height * (0.34 + index * 0.16), // 初始 Y：不同高度错开
    angle: 0,                        // 初始旋转角度
    speed: sharkSpeed(),             // 移动速度
    offset: index * 1.4,             // 巡逻相位偏移
    biteRadius: 72,                  // 咬合判定半径
  };
}

// ============================================================
// 游戏对象生成
// ============================================================

/**
 * 在屏幕底部生成一个新气泡
 * @param {number} now - 当前时间戳
 */
function spawnBubble(now) {
  const size = logicalSize();
  const radius = 10 + Math.random() * 20;  // 随机大小
  state.bubbles.push({
    x: 30 + Math.random() * (size.width - 60),  // 随机 X 位置
    y: size.height + radius,                     // 从底部出现
    r: radius,                                   // 半径
    speed: 34 + Math.random() * 52,             // 随机上升速度
    drift: -24 + Math.random() * 48,             // 随机水平漂移
    color: colors[Math.floor(Math.random() * colors.length)],  // 随机颜色
    born: now,                                  // 生成时间
  });
}

/**
 * 在屏幕右侧生成一个新障碍物
 * @param {number} now - 当前时间戳
 */
function spawnObstacle(now) {
  const size = logicalSize();
  const radius = 18 + Math.random() * 18;  // 随机大小
  state.obstacles.push({
    x: size.width + radius,                  // 从右侧出现
    y: 55 + Math.random() * (size.height - 110),  // 随机 Y 位置
    r: radius,                               // 半径
    speed: 58 + Math.random() * 42,         // 随机水平速度
    wobble: Math.random() * Math.PI * 2,    // 上下摆动相位
    born: now,                              // 生成时间
  });
}

// ============================================================
// 输入处理
// ============================================================

/**
 * 从事件中获取画布上的坐标
 * 支持鼠标和触摸两种输入方式
 * @param {Event} event - 鼠标或触摸事件
 * @returns {{x: number, y: number}} 画布上的坐标
 */
function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  // 支持触摸事件（取第一个触点）
  const point = event.touches ? event.touches[0] : event;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

/**
 * 移动小鱼到指定位置
 * @param {Event} event - 鼠标或触摸事件
 */
function moveFish(event) {
  // 暂停、隐藏、游戏结束时忽略输入
  if (state.paused || state.hidden || state.gameOver) return;
  const pos = pointerPosition(event);
  state.fish.targetX = pos.x;
  state.fish.targetY = pos.y;
}

// ============================================================
// 绘制函数
// ============================================================

/**
 * 绘制游戏背景
 * 包含多层半透明的水波纹效果
 * @param {number} width - 画布宽度
 * @param number} height - 画布高度
 * @param {number} now - 当前时间戳（用于动画）
 */
function drawBackground(width, height, now) {
  // 清空画布
  ctx.clearRect(0, 0, width, height);

  // 半透明白色，用于水波效果
  ctx.fillStyle = "rgba(255,255,255,0.16)";

  // 绘制 8 层水平波纹
  for (let i = 0; i < 8; i += 1) {
    // Y 位置随时间滚动，形成水流效果
    const y = ((now / 28 + i * 74) % (height + 90)) - 45;
    ctx.beginPath();
    // 水平椭圆模拟波浪
    ctx.ellipse(width * (0.12 + i * 0.12), y, 84, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 绘制小鱼
 * 使用 Canvas 2D 路径绘制鱼身、尾鳍、眼睛和高光
 * @param {Object} fish - 小鱼对象
 */
function drawFish(fish) {
  ctx.save();
  ctx.translate(fish.x, fish.y);   // 移动到小鱼位置
  ctx.rotate(fish.angle);         // 应用旋转角度

  // 鱼身：椭圆形，珊瑚红
  ctx.fillStyle = "#ef6f61";
  ctx.beginPath();
  ctx.ellipse(0, 0, 42, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  // 尾鳍：三角形，深红
  ctx.fillStyle = "#d84f47";
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.lineTo(-72, -24);  // 上尾尖
  ctx.lineTo(-64, 0);
  ctx.lineTo(-72, 24);   // 下尾尖
  ctx.closePath();
  ctx.fill();

  // 眼睛：白色圆形 + 黑色瞳孔
  ctx.fillStyle = "#fff7d6";
  ctx.beginPath();
  ctx.arc(22, -8, 8, 0, Math.PI * 2);  // 眼白
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(25, -8, 3, 0, Math.PI * 2);  // 瞳孔
  ctx.fill();

  // 鱼身高光：弧形白色描边
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(5, 3, 17, 0.3, 1.9);
  ctx.stroke();

  ctx.restore();
}

/**
 * 绘制鲨鱼
 * 由多个几何形状组成：身体、背鳍、尾鳍、肚皮白、眼睛、牙齿
 * @param {Object} shark - 鲨鱼对象
 */
function drawShark(shark) {
  ctx.save();
  ctx.translate(shark.x, shark.y);  // 移动到鲨鱼位置
  ctx.rotate(shark.angle);          // 应用旋转角度

  // 鲨鱼身体：深蓝灰色椭圆形
  ctx.fillStyle = "#324256";
  ctx.beginPath();
  ctx.ellipse(0, 0, 82, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // 尾鳍：两个三角形，深蓝灰
  ctx.fillStyle = "#253244";
  ctx.beginPath();
  ctx.moveTo(-70, 0);
  ctx.lineTo(-128, -34);  // 上尾尖
  ctx.lineTo(-112, 0);
  ctx.lineTo(-128, 34);   // 下尾尖
  ctx.closePath();
  ctx.fill();

  // 背鳍：三角形
  ctx.beginPath();
  ctx.moveTo(-12, -30);
  ctx.lineTo(22, -78);    // 背鳍尖
  ctx.lineTo(44, -24);
  ctx.closePath();
  ctx.fill();

  // 肚皮：白色半椭圆
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.ellipse(24, 10, 42, 16, 0, 0, Math.PI);
  ctx.fill();

  // 眼睛：白色圆形 + 黑色瞳孔
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(50, -9, 9, 0, Math.PI * 2);  // 眼白
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(53, -9, 3, 0, Math.PI * 2);  // 瞳孔
  ctx.fill();

  // 牙齿：白色短线段
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(52, 12);
  ctx.lineTo(74, 8);
  ctx.stroke();

  ctx.restore();
}

/**
 * 绘制障碍物（灰色圆角矩形）
 * @param {Object} obstacle - 障碍物对象
 */
function drawObstacle(obstacle) {
  ctx.save();
  ctx.translate(obstacle.x, obstacle.y);
  // 微小的旋转摆动效果
  ctx.rotate(Math.sin(obstacle.born + obstacle.x) * 0.1);

  // 主体：灰色圆角矩形
  ctx.fillStyle = "#6b7280";
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-obstacle.r, -obstacle.r * 0.7, obstacle.r * 2, obstacle.r * 1.4, 8);
  ctx.fill();
  ctx.stroke();

  // 高光：小圆形
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.arc(-obstacle.r * 0.35, -obstacle.r * 0.2, obstacle.r * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * 绘制气泡
 * 半透明圆形，带有白色边框和高光点
 * @param {Object} bubble - 气泡对象
 */
function drawBubble(bubble) {
  ctx.save();
  ctx.globalAlpha = 0.82;  // 透明度

  // 气泡主体
  ctx.fillStyle = bubble.color;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 高光点
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(bubble.x - bubble.r * 0.35, bubble.y - bubble.r * 0.35, bubble.r * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * 绘制涟漪效果
 * 逐渐扩大并淡出的白色圆环
 * @param {Object} ripple - 涟漪对象
 */
function drawRipple(ripple) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, ripple.life);  // 渐变透明度
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 游戏逻辑更新
// ============================================================

/**
 * 更新游戏状态（每帧调用）
 * @param {number} delta - 距离上一帧的时间（秒）
 * @param {number} now - 当前时间戳
 */
function update(delta, now) {
  // 气泡生成
  if (now - state.lastSpawn > 520) {
    spawnBubble(now);
    state.lastSpawn = now;
  }

  // 障碍物生成
  if (now - state.lastObstacleSpawn > 1500) {
    spawnObstacle(now);
    state.lastObstacleSpawn = now;
  }

  // ---- 小鱼移动（向目标位置平滑移动）----
  const fish = state.fish;
  const dx = fish.targetX - fish.x;
  const dy = fish.targetY - fish.y;
  // 碰到障碍物后速度降低
  const speedPenalty = now < state.slowedUntil ? 0.045 : 0.12;
  fish.x += dx * speedPenalty;  // 线性插值移动
  fish.y += dy * speedPenalty;
  // 微调旋转角度，跟随移动方向
  fish.angle = Math.atan2(dy, dx) * 0.18;

  const size = logicalSize();
  // 边界约束
  fish.x = Math.min(Math.max(fish.x, 54), size.width - 44);
  fish.y = Math.min(Math.max(fish.y, 32), size.height - 32);

  // ---- 气泡更新和碰撞检测 ----
  state.bubbles = state.bubbles.filter((bubble) => {
    // 气泡上升并左右飘动
    bubble.y -= bubble.speed * delta;
    bubble.x += Math.sin((now - bubble.born) / 350) * bubble.drift * delta;

    // 碰撞检测：气泡与小鱼的圆心距离
    const distance = Math.hypot(bubble.x - fish.x, bubble.y - fish.y);
    if (distance < bubble.r + 38) {
      // 收集气泡：增加分数和连击
      state.combo += 1;
      state.score += 10 + Math.min(state.combo, 12) * 2;
      // 收集气泡会暂时驱退鲨鱼
      state.sharks.forEach((shark) => {
        shark.x -= Math.min(18 + state.combo, 42);
      });
      // 生成涟漪效果
      state.ripples.push({ x: bubble.x, y: bubble.y, r: bubble.r, life: 1 });
      return false;  // 移除气泡
    }
    // 气泡飘出屏幕后移除
    return bubble.y + bubble.r > -10;
  });

  // ---- 障碍物更新和碰撞检测 ----
  state.obstacles = state.obstacles.filter((obstacle) => {
    // 障碍物向左移动并上下摆动
    obstacle.x -= obstacle.speed * delta;
    obstacle.y += Math.sin((now - obstacle.born) / 260 + obstacle.wobble) * 26 * delta;

    // 碰撞检测
    const distance = Math.hypot(obstacle.x - fish.x, obstacle.y - fish.y);
    if (distance < obstacle.r + 32) {
      // 碰撞：重置连击，应用减速效果
      state.combo = 0;
      state.slowedUntil = now + 1050;  // 1.05 秒减速
      // 生成涟漪效果
      state.ripples.push({ x: obstacle.x, y: obstacle.y, r: obstacle.r + 12, life: 0.85 });
      return false;  // 移除障碍物
    }
    // 障碍物移出屏幕后移除
    return obstacle.x + obstacle.r > -20;
  });

  // ---- 鲨鱼更新：追踪小鱼 ----
  state.sharks.forEach((shark, index) => {
    // 目标 Y = 小鱼 Y + 周期性波动（实现巡逻效果）
    const targetY = fish.y + Math.sin(now / 520 + shark.offset) * (18 + index * 6);

    const chaseDx = fish.x - shark.x;
    const chaseDy = targetY - shark.y;
    const chaseDistance = Math.hypot(chaseDx, chaseDy) || 1;

    // 压力系数：分数越高，鲨鱼越快（最高 1.85 倍）
    const pressure = 1 + Math.min(state.score / 900, 0.85);

    // 向小鱼方向移动
    shark.x += (chaseDx / chaseDistance) * shark.speed * pressure * delta;
    shark.y += (chaseDy / chaseDistance) * shark.speed * pressure * delta;

    // 更新朝向角度
    shark.angle = Math.atan2(chaseDy, chaseDx) * 0.22;

    // 碰撞检测：鲨鱼碰到小鱼，游戏结束
    if (Math.hypot(shark.x - fish.x, shark.y - fish.y) < shark.biteRadius) {
      endGame();
    }
  });

  // ---- 涟漪效果更新 ----
  state.ripples = state.ripples.filter((ripple) => {
    ripple.r += 70 * delta;   // 半径扩大
    ripple.life -= 1.6 * delta;  // 透明度降低
    return ripple.life > 0;   // 淡出完成后移除
  });
}

// ============================================================
// 渲染
// ============================================================

/**
 * 渲染游戏画面（每帧调用）
 * 按照从后到前的顺序绘制各个元素
 * @param {number} now - 当前时间戳
 */
function render(now) {
  const { width, height } = logicalSize();

  // 1. 背景（水波纹）
  drawBackground(width, height, now);

  // 2. 气泡
  state.bubbles.forEach(drawBubble);

  // 3. 障碍物
  state.obstacles.forEach(drawObstacle);

  // 4. 涟漪效果
  state.ripples.forEach(drawRipple);

  // 5. 鲨鱼
  state.sharks.forEach(drawShark);

  // 6. 小鱼（最后绘制，在最上层）
  drawFish(state.fish);
}

// ============================================================
// HUD 更新
// ============================================================

/**
 * 同步 HUD 显示
 * 更新分数、连击数和最近鲨鱼距离
 */
function syncHud() {
  scoreEl.textContent = state.score.toString();
  comboEl.textContent = state.combo.toString();

  // 无鲨鱼时显示"安全"
  if (state.sharks.length === 0) {
    timerEl.textContent = "安全";
    return;
  }

  // 计算最近鲨鱼的距离
  const nearestDistance = state.sharks.reduce((nearest, shark) => {
    // 距离 = 欧氏距离 - 鲨鱼咬合半径
    const distance = Math.hypot(shark.x - state.fish.x, shark.y - state.fish.y) - shark.biteRadius;
    return Math.min(nearest, distance);
  }, Number.POSITIVE_INFINITY);

  timerEl.textContent = `${Math.max(0, Math.round(nearestDistance))}m`;
}

// ============================================================
// 游戏状态管理
// ============================================================

/**
 * 结束游戏
 */
function endGame() {
  state.gameOver = true;
  state.paused = true;
  finalScoreEl.textContent = `本局摸鱼值 ${state.score}`;
  syncPanels();
}

/**
 * 重置游戏到初始状态
 */
function resetGame() {
  const { width, height } = logicalSize();

  // 重置所有状态
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

  // 重置小鱼位置
  state.fish.x = width * 0.56;
  state.fish.y = height * 0.52;
  state.fish.targetX = state.fish.x;
  state.fish.targetY = state.fish.y;

  // 重置鲨鱼
  state.sharks = Array.from({ length: sharkCount() }, (_, index) => createShark(index, width, height));

  // 恢复游戏界面
  app.dataset.mode = "play";
  document.title = "摸鱼补给站";

  syncPanels();
  syncHud();
}

// ============================================================
// 游戏主循环
// ============================================================

/**
 * 游戏主循环
 * 使用 requestAnimationFrame 实现流畅的 60fps 渲染
 * @param {number} now - 当前时间戳
 */
function loop(now) {
  // 计算 delta 时间（秒），限制最大值为 0.033（约 30fps 最低帧率）
  const delta = Math.min((now - state.lastTick) / 1000, 0.033);
  state.lastTick = now;

  // 仅在非暂停和非隐藏状态下更新逻辑
  if (!state.paused && !state.hidden) {
    update(delta, now);
  }

  // 仅在非隐藏状态下渲染
  if (!state.hidden) {
    render(now);
    syncHud();
  }

  // 调度下一帧
  requestAnimationFrame(loop);
}

// ============================================================
// 事件监听
// ============================================================

/** 键盘快捷键 */
document.addEventListener("keydown", (event) => {
  // Escape：隐藏游戏（伪装模式）
  if (event.key === "Escape") {
    setHidden(true);
  }

  // 空格：暂停/继续
  if (event.code === "Space" && !state.hidden) {
    event.preventDefault();
    togglePause();
  }

  // Alt+H：隐藏游戏
  if (event.altKey && event.key.toLowerCase() === "h") {
    setHidden(true);
  }
});

/** 暂停按钮 */
document.querySelector('[data-action="pause"]').addEventListener("click", () => togglePause());
/** 隐藏按钮 */
document.querySelector('[data-action="hide"]').addEventListener("click", () => setHidden(true));
/** 重新开始按钮 */
document.querySelector('[data-action="restart"]').addEventListener("click", resetGame);
/** 摄像头按钮 */
cameraButton.addEventListener("click", toggleCamera);
/** 鲨鱼速度滑块 */
sharkSpeedInput.addEventListener("input", syncSharkSpeed);
/** 鲨鱼数量滑块 */
sharkCountInput.addEventListener("input", syncSharkCount);
/** 显示游戏按钮 */
document.querySelector('[data-action="reveal"]').addEventListener("click", () => {
  setHidden(false);
  if (!state.gameOver) togglePause(false);
});

/** 页面关闭时停止摄像头 */
window.addEventListener("beforeunload", stopCamera);

/** 画布触摸/鼠标事件 */
canvas.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  canvas.setPointerCapture(event.pointerId);  // 捕获指针，防止移出画布
  moveFish(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (state.dragging) moveFish(event);
});

canvas.addEventListener("pointerup", () => {
  state.dragging = false;
  state.combo = 0;  // 停止控制时重置连击
});

canvas.addEventListener("pointercancel", () => {
  state.dragging = false;
});

/** 窗口大小变化时调整画布 */
window.addEventListener("resize", resizeCanvas);

// ============================================================
// 游戏初始化
// ============================================================

resizeCanvas();       // 设置画布尺寸
syncSharkSpeed();     // 同步鲨鱼速度设置
resetGame();          // 初始化游戏状态
requestAnimationFrame(loop);  // 启动游戏循环
