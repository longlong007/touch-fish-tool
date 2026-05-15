# 摸鱼补给站 - 代码解读报告

## 项目概述

**摸鱼补给站** 是一个有趣的 HTML5 摸鱼小游戏。玩家控制一条小鱼，在水池中躲避凶猛的鲨鱼和随机出现的障碍物，同时收集漂浮上来的气泡获得分数。游戏还具备"老板雷达"功能，通过摄像头检测是否有多人脸出现，自动切换到工作界面进行伪装。

- **技术栈**: 原生 JavaScript + Canvas 2D
- **核心机制**: 玩家移动、碰撞检测、AI 追踪、分数系统、人脸识别
- **代码规模**: 约 786 行

---

## 目录结构

```
touch-fish-tool/
├── index.html      # 游戏页面结构
├── app.js          # 游戏逻辑（主代码）
├── styles.css      # 样式表
└── README.md       # 项目说明
```

---

## 核心架构

### 1. 游戏循环机制

游戏使用 `requestAnimationFrame` 驱动的主循环，实现流畅的 60fps 渲染：

```javascript
function loop(now) {
  const delta = Math.min((now - state.lastTick) / 1000, 0.033);
  state.lastTick = now;

  if (!state.paused && !state.hidden) {
    update(delta, now);   // 更新游戏逻辑
  }

  if (!state.hidden) {
    render(now);          // 渲染画面
    syncHud();            // 更新 HUD
  }

  requestAnimationFrame(loop);
}
```

**关键设计**：
- `delta` 是距离上一帧的时间（秒），用于帧率无关的移动计算
- 限制最大 delta 为 0.033 秒，防止标签页切换后回来时物体瞬移
- 暂停和隐藏状态会暂停更新和渲染，节省性能

### 2. 状态管理

所有游戏数据集中在 `state` 对象中：

```javascript
const state = {
  score: 0,           // 分数
  combo: 0,          // 连击数
  paused: false,     // 暂停状态
  hidden: false,      // 伪装模式
  gameOver: false,   // 游戏结束
  fish: { ... },     // 玩家小鱼
  sharks: [],        // 鲨鱼数组
  bubbles: [],       // 气泡数组
  obstacles: [],     // 障碍物数组
  ripples: [],       // 涟漪特效
};
```

---

## 核心模块解析

### 模块一：渲染系统

#### 画布初始化

```javascript
function resizeCanvas() {
  const rect = pool.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
```

**设计亮点**：
- 支持 Retina 屏幕（devicePixelRatio = 2），高清显示
- 按 12:7 比例保持游戏画面宽高比
- `setTransform` 重置变换矩阵，确保坐标一致性

#### 渲染层次

渲染按从后到前的顺序进行：

```
1. drawBackground()   - 水波背景
2. drawBubble()       - 气泡
3. drawObstacle()     - 障碍物
4. drawRipple()       - 涟漪特效
5. drawShark()        - 鲨鱼
6. drawFish()         - 小鱼（最上层）
```

后绘制的物体会遮挡前面的物体，形成正确的视觉层次。

---

### 模块二：小鱼控制

#### 移动机制

小鱼使用 **线性插值（lerp）** 实现平滑跟随：

```javascript
const dx = fish.targetX - fish.x;
const dy = fish.targetY - fish.y;
const speedPenalty = now < state.slowedUntil ? 0.045 : 0.12;

fish.x += dx * speedPenalty;
fish.y += dy * speedPenalty;
fish.angle = Math.atan2(dy, dx) * 0.18;
```

**关键参数**：
- `speedPenalty` 正常为 0.12，表示每帧移动剩余距离的 12%
- 碰撞障碍物后变为 0.045，移速降低约 4 倍
- `angle` 根据移动方向微调，最大约 0.18 弧度

#### 绘制细节

```javascript
function drawFish(fish) {
  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.rotate(fish.angle);

  // 鱼身 - 椭圆形
  ctx.fillStyle = "#ef6f61";
  ctx.ellipse(0, 0, 42, 24, 0, 0, Math.PI * 2);

  // 尾鳍 - 三角形
  ctx.fillStyle = "#d84f47";
  ctx.moveTo(-38, 0);
  ctx.lineTo(-72, -24);
  ctx.lineTo(-72, 24);

  // 眼睛 - 同心圆
  ctx.arc(22, -8, 8, 0, Math.PI * 2);  // 眼白
  ctx.arc(25, -8, 3, 0, Math.PI * 2);  // 瞳孔

  ctx.restore();
}
```

---

### 模块三：鲨鱼 AI

#### 追踪行为

鲨鱼使用**向量追踪 + 周期波动**实现自然的追击效果：

```javascript
state.sharks.forEach((shark, index) => {
  // 目标 Y = 小鱼 Y + 正弦波动（巡逻效果）
  const targetY = fish.y + Math.sin(now / 520 + shark.offset) * (18 + index * 6);

  const chaseDx = fish.x - shark.x;
  const chaseDy = targetY - shark.y;
  const chaseDistance = Math.hypot(chaseDx, chaseDy) || 1;

  // 压力系数随分数增加（1.0 ~ 1.85）
  const pressure = 1 + Math.min(state.score / 900, 0.85);

  // 向目标移动
  shark.x += (chaseDx / chaseDistance) * shark.speed * pressure * delta;
  shark.y += (chaseDy / chaseDistance) * shark.speed * pressure * delta;

  // 碰撞检测
  if (Math.hypot(shark.x - fish.x, shark.y - fish.y) < shark.biteRadius) {
    endGame();
  }
});
```

**AI 特性**：
| 特性 | 实现方式 |
|------|----------|
| 追踪目标 | 计算方向向量，单位化后乘以速度 |
| 巡逻波动 | `sin(now / 520 + offset)` 实现上下起伏 |
| 难度递增 | `pressure` 系数随分数增长，最高 1.85 倍 |
| 碰撞判定 | 欧氏距离 < biteRadius 时游戏结束 |

#### 鲨鱼生成

```javascript
function createShark(index, width, height) {
  return {
    x: -150 - index * 110,           // 屏幕左侧依次排列
    y: height * (0.34 + index * 0.16), // 不同高度错开
    speed: sharkSpeed(),
    offset: index * 1.4,             // 相位偏移，错开巡逻节奏
    biteRadius: 72,
  };
}
```

---

### 模块四：碰撞与收集系统

#### 气泡收集

```javascript
state.bubbles = state.bubbles.filter((bubble) => {
  // 气泡上升 + 左右漂移
  bubble.y -= bubble.speed * delta;
  bubble.x += Math.sin((now - bubble.born) / 350) * bubble.drift * delta;

  // 碰撞检测
  const distance = Math.hypot(bubble.x - fish.x, bubble.y - fish.y);
  if (distance < bubble.r + 38) {
    // 收集成功
    state.combo += 1;
    state.score += 10 + Math.min(state.combo, 12) * 2;

    // 驱退鲨鱼
    state.sharks.forEach((shark) => {
      shark.x -= Math.min(18 + state.combo, 42);
    });

    // 涟漪特效
    state.ripples.push({ x: bubble.x, y: bubble.y, r: bubble.r, life: 1 });
    return false;  // 移除气泡
  }
  return bubble.y + bubble.r > -10;
});
```

#### 分数公式

```
得分 = 10 + min(combo, 12) * 2
```

- 基础分：10 分
- 连击加成：每连击 +2 分，上限 12 连击（24 分）
- 每次收集最多可得：10 + 24 = 34 分

#### 障碍物碰撞

```javascript
if (distance < obstacle.r + 32) {
  state.combo = 0;           // 重置连击
  state.slowedUntil = now + 1050;  // 减速 1.05 秒
  // 涟漪特效...
  return false;
}
```

---

### 模块五：涟漪特效

```javascript
function drawRipple(ripple) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, ripple.life);  // 渐变透明
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// 动画更新
state.ripples = state.ripples.filter((ripple) => {
  ripple.r += 70 * delta;       // 半径扩大
  ripple.life -= 1.6 * delta;    // 透明度降低
  return ripple.life > 0;
});
```

---

### 模块六：老板雷达（人脸检测）

#### 双模式检测

```javascript
async function startCamera() {
  if ("FaceDetector" in window) {
    // 优先使用原生 API
    camera.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
    camera.mode = "native";
  } else {
    // 回退到肤色检测
    camera.mode = "skin";
  }
}
```

#### 肤色检测算法

```javascript
const isSkin =
  r > 58 && g > 34 && b > 22 &&      // RGB 阈值
  max - min > 14 &&                   // 对比度
  Math.abs(r - g) > 8 &&              // 红绿差异
  r > g && r > b &&                   // 红色主导
  r / (g + 1) < 1.85;                // 红绿比例
```

这些条件基于人脸肤色的统计学特征，能有效识别黄种人和白人的肤色区域。

#### 连通区域分析

检测到的肤色像素通过 **BFS（广度优先搜索）** 聚合成区域，再根据以下特征判断是否像人脸：

| 条件 | 值 | 说明 |
|------|-----|------|
| 最小像素数 | ≥ 34 | 太小不是人脸 |
| 宽高比 | 0.45 ~ 1.75 | 人脸接近正方形 |
| 填充率 | ≥ 0.22 | 不能太稀疏 |

#### 滑动窗口平滑

```javascript
function stableFaceCount(rawCount) {
  camera.samples.push(normalizedCount);
  if (camera.samples.length > FACE_SAMPLE_SIZE) {
    camera.samples.shift();
  }

  // 投票机制：连续 4 帧相同结果才确认
  const alertVotes = camera.samples.filter((count) => count >= 2).length;
  if (alertVotes >= FACE_ALERT_VOTES) {
    return camera.stableFaceCount = 2;
  }
  // ...
}
```

---

### 模块七：游戏状态流转

```
┌──────────────────────────────────────────────┐
│                   开始                        │
└─────────────────┬────────────────────────────┘
                  ▼
┌──────────────────────────────────────────────┐
│              PLAYING 状态                     │
│   - 小鱼跟随鼠标移动                          │
│   - 鲨鱼追踪小鱼                              │
│   - 气泡和障碍物 生成/消失                    │
└────┬───────────────┬───────────────┬──────────┘
     │               │               │
     ▼               ▼               ▼
┌─────────┐    ┌───────────┐    ┌───────────┐
│ 暂停    │    │ 鲨鱼碰撞   │    │ 多人脸检测 │
│ (Space) │    │ (GameOver)│    │ (老板来了) │
└─────────┘    └───────────┘    └─────┬─────┘
                                     ▼
                            ┌───────────────┐
                            │ WORK 伪装模式  │
                            │ 标题变为"Q2"  │
                            └───────┬───────┘
                                    │
                                    ▼
                            ┌───────────────┐
                            │ 点击恢复       │
                            │ (摸鱼补给站)    │
                            └───────────────┘
```

---

## 设计亮点

### 1. 帧率无关的物理计算

所有移动速度都乘以 `delta`，确保无论实际帧率如何（60fps、30fps），物体运动速度保持一致。

### 2. 对象池管理

通过 `filter` 及时移除离开屏幕的对象，防止内存泄漏：

```javascript
return bubble.y + bubble.r > -10;  // 飘出屏幕才移除
```

### 3. 平滑插值的艺术

```javascript
fish.x += dx * 0.12;  // 每帧只移动剩余距离的 12%
```

这种 lerp 方式比直接设置位置更自然，有惯性和缓冲感。

### 4. 多层次防误触

- 老板雷达需要**连续 2 帧**检测到多人脸才触发隐藏
- 人脸检测使用**滑动窗口 + 投票机制**平滑结果
- 摄像头切换有延迟检测，避免瞬时波动误触发

---

## 总结

这是一个结构清晰、设计精良的小游戏：

| 方面 | 评价 |
|------|------|
| 代码组织 | 状态集中管理，函数职责单一 |
| 渲染效率 | Canvas 2D，高效的帧率无关计算 |
| 游戏手感 | lerp 平滑跟随，连击系统有激励感 |
| 伪装设计 | 老板雷达创意十足，实用性满分 |
| AI 行为 | 鲨鱼追踪 + 巡逻波动，可玩性高 |

作为学习 Canvas 游戏开发或 JavaScript 实战的项目，非常值得参考。