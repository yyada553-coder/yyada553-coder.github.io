const canvas = document.getElementById("draw-surface");
const context = canvas.getContext("2d");

const bgColorInput = document.getElementById("bg-color");
const inkColorInput = document.getElementById("ink-color");
const densityInput = document.getElementById("density");
const clearButton = document.getElementById("clear");

const permanentLayer = document.createElement("canvas");
const permanentContext = permanentLayer.getContext("2d");

const pointer = {
  active: false,
  id: null,
  lastTapTime: 0,
  dragStartTime: 0,
  dragStartPos: null,
  lastPos: null,
};

const activeElements = [];
const dpr = Math.min(window.devicePixelRatio || 1, 2);

const CUT_DELAY = 125;
const DOUBLE_TAP_DELAY = 300;
const DRIP_PAUSE_DURATION = [4, 12];
const CUT_THICKNESS_MAX = 10;
const DRIP_RATIO = 150;
const DRIP_MARGIN = 0.2;
const ARMPIT_WIDTH = 0.05;
const ARMPIT_LENGTH = 15;
const DRIP_PAUSE_CHANCE = 0.04;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function lerpPoint(start, end, amount) {
  return {
    x: lerp(start.x, end.x, amount),
    y: lerp(start.y, end.y, amount),
  };
}

function distanceBetween(start, end) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max));
}

function withCanvasDefaults(targetContext) {
  targetContext.lineCap = "round";
  targetContext.lineJoin = "round";
}

function getLineWidth() {
  return 0.85 + Number(densityInput.value) * 0.32;
}

function getCutThickness(distance) {
  return Math.min(distance / 20, CUT_THICKNESS_MAX) + getLineWidth() * 2;
}

function getNormalAngle(angle) {
  const halfPi = Math.PI / 2;
  const quarterPi = Math.PI / 4;
  return angle >= -halfPi && angle < halfPi ? angle + quarterPi : angle - quarterPi;
}

function resizeSurface() {
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  permanentLayer.width = canvas.width;
  permanentLayer.height = canvas.height;

  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  permanentContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  withCanvasDefaults(context);
  withCanvasDefaults(permanentContext);

  clearCanvas();
}

function drawCutShape(targetContext, start, end, color) {
  const dist = distanceBetween(start, end);

  if (dist < 1) {
    return;
  }

  const radius = getCutThickness(dist);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const normalAngle = getNormalAngle(angle);
  const mid = {
    x: (start.x + end.x) * 0.5,
    y: (start.y + end.y) * 0.5,
  };
  const control = {
    x: mid.x + radius * Math.cos(normalAngle),
    y: mid.y + radius * Math.sin(normalAngle),
  };
  const correction = getLineWidth() + 1;
  const offsetX = -correction * Math.cos(normalAngle);
  const offsetY = -correction * Math.sin(normalAngle);

  targetContext.fillStyle = color;
  targetContext.beginPath();
  targetContext.moveTo(start.x + offsetX, start.y + offsetY);
  targetContext.lineTo(end.x + offsetX, end.y + offsetY);
  targetContext.quadraticCurveTo(
    control.x + offsetX,
    control.y + offsetY,
    start.x + offsetX,
    start.y + offsetY,
  );
  targetContext.closePath();
  targetContext.fill();
}

function drawArmpit(targetContext, armpit) {
  const center = {
    x: (armpit.start.x + armpit.end.x) * 0.5,
    y: (armpit.start.y + armpit.end.y) * 0.5,
  };

  targetContext.fillStyle = armpit.color;
  targetContext.strokeStyle = armpit.color;
  targetContext.lineWidth = armpit.lineWidth;
  targetContext.beginPath();
  targetContext.moveTo(armpit.start.x, armpit.start.y);
  targetContext.quadraticCurveTo(
    center.x,
    center.y + armpit.length * 0.2,
    center.x,
    center.y + armpit.length,
  );
  targetContext.quadraticCurveTo(
    center.x,
    center.y + armpit.length * 0.2,
    armpit.end.x,
    armpit.end.y,
  );
  targetContext.closePath();
  targetContext.fill();
  targetContext.stroke();
}

function drawDrop(targetContext, drop) {
  const progress = clamp(drop.currentTick / drop.goalTick, 0, 1);
  const easedProgress = 1 - (1 - progress) * (1 - progress);
  const sway = Math.sin(progress * drop.waveRate + drop.wavePhase) * drop.waveAmount;
  const tipX = drop.origin.x + sway;
  const tipY = drop.origin.y + drop.travelDistance * easedProgress;
  const stemWidth = lerp(drop.baseWidth, drop.baseWidth * 0.72, progress);
  const headRadius = lerp(drop.baseWidth * 0.6, drop.baseWidth * 1.12, progress);

  targetContext.strokeStyle = drop.color;
  targetContext.lineWidth = stemWidth;
  targetContext.beginPath();
  targetContext.moveTo(drop.origin.x, drop.origin.y);
  targetContext.lineTo(tipX, tipY);
  targetContext.stroke();

  targetContext.fillStyle = drop.color;
  targetContext.beginPath();
  targetContext.ellipse(tipX, tipY, headRadius * 0.78, headRadius, 0, 0, Math.PI * 2);
  targetContext.fill();
}

function updateElement(element) {
  if (element.type === "armpit") {
    if (element.length >= element.maxLength) {
      return false;
    }

    element.length = Math.min(element.maxLength, element.length + 1.5);
    return true;
  }

  if (element.pauseTicks > 0) {
    element.pauseTicks -= 1;
    return true;
  }

  if (element.currentTick >= element.goalTick) {
    return false;
  }

  element.currentTick += 1;

  if (element.currentTick > element.goalTick * 0.18 && Math.random() <= element.pauseChance) {
    element.pauseTicks = randomInt(DRIP_PAUSE_DURATION[0], DRIP_PAUSE_DURATION[1] + 1);
  }

  return true;
}

function drawElement(targetContext, element) {
  if (element.type === "armpit") {
    drawArmpit(targetContext, element);
    return;
  }

  drawDrop(targetContext, element);
}

function commitElement(element) {
  drawElement(permanentContext, element);
}

function drawFrame() {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(permanentLayer, 0, 0);
  context.restore();

  for (let index = activeElements.length - 1; index >= 0; index -= 1) {
    const element = activeElements[index];
    const active = updateElement(element);
    drawElement(context, element);

    if (!active) {
      commitElement(element);
      activeElements.splice(index, 1);
    }
  }

  requestAnimationFrame(drawFrame);
}

function spawnArmpit(start, end, color) {
  activeElements.push({
    type: "armpit",
    start,
    end,
    color,
    lineWidth: getLineWidth(),
    length: 0,
    maxLength: ARMPIT_LENGTH,
  });
}

function spawnDrop(origin, color) {
  const baseWidth = getLineWidth() + randomBetween(0.6, 1.8);

  activeElements.push({
    type: "drop",
    origin,
    color,
    baseWidth,
    travelDistance: randomBetween(48, 168),
    goalTick: randomInt(28, 68),
    currentTick: 0,
    pauseTicks: 0,
    pauseChance: DRIP_PAUSE_CHANCE,
    waveAmount: randomBetween(-4, 4),
    waveRate: randomBetween(3.4, 6.2),
    wavePhase: randomBetween(0, Math.PI * 2),
  });
}

function addCut(start, end) {
  const dist = distanceBetween(start, end);

  if (dist < 8) {
    return;
  }

  const color = inkColorInput.value;
  drawCutShape(permanentContext, start, end, color);

  if (dist <= 25) {
    return;
  }

  const dripCount = Math.floor(dist / DRIP_RATIO);

  for (let index = 0; index < dripCount; index += 1) {
    const position = randomBetween(DRIP_MARGIN, 1 - DRIP_MARGIN);
    const armpitStart = lerpPoint(start, end, position - ARMPIT_WIDTH);
    const armpitEnd = lerpPoint(start, end, position + ARMPIT_WIDTH);
    const dropOrigin = lerpPoint(start, end, position);

    spawnArmpit(armpitStart, armpitEnd, color);
    spawnDrop(dropOrigin, color);
  }
}

function updateBackground() {
  document.documentElement.style.setProperty("--bg-color", bgColorInput.value);
}

function clearCanvas() {
  permanentContext.save();
  permanentContext.setTransform(1, 0, 0, 1, 0, 0);
  permanentContext.clearRect(0, 0, permanentLayer.width, permanentLayer.height);
  permanentContext.restore();
  activeElements.length = 0;
}

canvas.addEventListener("pointerdown", (event) => {
  if (pointer.active) {
    return;
  }

  pointer.active = true;
  pointer.id = event.pointerId;
  pointer.dragStartPos = { x: event.clientX, y: event.clientY };
  pointer.lastPos = { x: event.clientX, y: event.clientY };
  pointer.dragStartTime = performance.now();

  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointer.active || event.pointerId !== pointer.id) {
    return;
  }

  const now = performance.now();
  const currentPos = { x: event.clientX, y: event.clientY };
  pointer.lastPos = currentPos;

  if (now - pointer.dragStartTime >= CUT_DELAY) {
    addCut(pointer.dragStartPos, currentPos);
    pointer.dragStartPos = currentPos;
    pointer.dragStartTime = now;
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (event.pointerId !== pointer.id) {
    return;
  }

  if (pointer.dragStartPos && pointer.lastPos) {
    addCut(pointer.dragStartPos, pointer.lastPos);
  }

  pointer.active = false;
  pointer.id = null;
  pointer.dragStartPos = null;
  pointer.lastPos = null;

  const now = performance.now();

  if (now - pointer.lastTapTime < DOUBLE_TAP_DELAY) {
    pointer.lastTapTime = 0;
    clearCanvas();
  } else {
    pointer.lastTapTime = now;
  }

  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointerleave", () => {
  if (!pointer.active) {
    return;
  }

  if (pointer.dragStartPos && pointer.lastPos) {
    addCut(pointer.dragStartPos, pointer.lastPos);
  }

  pointer.active = false;
  pointer.id = null;
  pointer.dragStartPos = null;
  pointer.lastPos = null;
});

canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== pointer.id) {
    return;
  }

  pointer.active = false;
  pointer.id = null;
  pointer.dragStartPos = null;
  pointer.lastPos = null;
  canvas.releasePointerCapture(event.pointerId);
});

bgColorInput.addEventListener("input", updateBackground);
clearButton.addEventListener("click", clearCanvas);
window.addEventListener("resize", resizeSurface);

// Initialize once on load so the canvas fills the viewport and begins rendering.
resizeSurface();
updateBackground();
drawFrame();

resizeSurface();
updateBackground();
requestAnimationFrame(drawFrame);
