const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");

const CONFIG = {
  worldSize: 80,
  creatureCount: 20,
  foodCount: 10,
  baseSpeed: 1,
  baseLifespan: 5,
  baseSize: 1,
  mutationStep: 0.03,
  minSpeed: 0.7,
  maxSpeed: 1.3,
  eatDistance: 2.4,
  senseRadius: 18,
  wanderTurnSpeed: 2.2,
  generationCooldown: 1.2,
  movementScale: 14,
};

const state = {
  width: 0,
  height: 0,
  centerX: 0,
  centerY: 0,
  projectionScale: 1,
  generation: 0,
  creatures: [],
  foods: [],
  history: [],
  phase: "running",
  cooldown: 0,
  nextParentPool: null,
  previousTime: 0,
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  state.width = width;
  state.height = height;
  state.centerX = width / 2;
  state.centerY = height * 0.58;
  state.projectionScale = Math.min(width, height) / (CONFIG.worldSize * 1.2);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function project(x, y, z) {
  const isoX = (x - z) * state.projectionScale;
  const isoY = (x + z) * state.projectionScale * 0.48 - y * state.projectionScale * 1.15;
  return {
    x: state.centerX + isoX,
    y: state.centerY + isoY,
  };
}

function pathRoundedRect(x, y, width, height, radius) {
  const limitedRadius = Math.min(radius, width / 2, height / 2);

  ctx.moveTo(x + limitedRadius, y);
  ctx.lineTo(x + width - limitedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + limitedRadius);
  ctx.lineTo(x + width, y + height - limitedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - limitedRadius, y + height);
  ctx.lineTo(x + limitedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - limitedRadius);
  ctx.lineTo(x, y + limitedRadius);
  ctx.quadraticCurveTo(x, y, x + limitedRadius, y);
}

function speedToLifespan(speed) {
  return CONFIG.baseLifespan * (CONFIG.baseSpeed / speed);
}

function speedToSize(speed) {
  return CONFIG.baseSize * (CONFIG.baseSpeed / speed);
}

function speedToColor(speed) {
  const delta = clamp((speed - CONFIG.baseSpeed) / 0.3, -1, 1);
  const faster = Math.max(0, delta);
  const slower = Math.max(0, -delta);

  const r = Math.round(72 + faster * 185);
  const g = Math.round(184 - (faster + slower) * 42);
  const b = Math.round(92 + slower * 180 - faster * 36);
  return `rgb(${r}, ${g}, ${b})`;
}

function createFood() {
  return {
    x: randomRange(-CONFIG.worldSize / 2, CONFIG.worldSize / 2),
    z: randomRange(-CONFIG.worldSize / 2, CONFIG.worldSize / 2),
    y: 0,
    eaten: false,
  };
}

function getEdgeSpawnPoint(index, total) {
  const half = CONFIG.worldSize / 2;
  const perimeter = CONFIG.worldSize * 4;
  const travel = ((index + 0.5) / total) * perimeter;

  if (travel < CONFIG.worldSize) {
    return { x: -half + travel, z: -half };
  }

  if (travel < CONFIG.worldSize * 2) {
    return { x: half, z: -half + (travel - CONFIG.worldSize) };
  }

  if (travel < CONFIG.worldSize * 3) {
    return { x: half - (travel - CONFIG.worldSize * 2), z: half };
  }

  return { x: -half, z: half - (travel - CONFIG.worldSize * 3) };
}

function createCreature(speed, id, lineage = "seed") {
  const spawnPoint = getEdgeSpawnPoint(id, CONFIG.creatureCount);
  const headingToCenter = Math.atan2(-spawnPoint.z, -spawnPoint.x);

  return {
    id,
    lineage,
    x: spawnPoint.x,
    z: spawnPoint.z,
    y: 0,
    heading: headingToCenter,
    headingDrift: randomRange(-0.35, 0.35),
    bob: randomRange(0, Math.PI * 2),
    speed,
    lifespan: speedToLifespan(speed),
    size: speedToSize(speed),
    timeAlive: 0,
    alive: true,
    won: false,
    foodId: null,
    winSource: null,
    score: 0,
    distanceTravelled: 0,
    timeToFood: null,
  };
}

function getAvailableFoods() {
  return state.foods.filter((food) => !food.eaten);
}

function findSensedFood(creature) {
  let bestFood = null;
  let bestDistance = Infinity;

  for (const food of state.foods) {
    if (food.eaten) {
      continue;
    }

    const distance = distance2D(creature.x, creature.z, food.x, food.z);
    if (distance <= CONFIG.senseRadius && distance < bestDistance) {
      bestDistance = distance;
      bestFood = food;
    }
  }

  return bestFood;
}

function findSensedPrey(creature) {
  let bestTarget = null;
  let bestDistance = Infinity;

  for (const other of state.creatures) {
    if (
      other.id === creature.id ||
      !other.alive ||
      other.won ||
      creature.size <= other.size
    ) {
      continue;
    }

    const distance = distance2D(creature.x, creature.z, other.x, other.z);
    if (distance <= CONFIG.senseRadius && distance < bestDistance) {
      bestDistance = distance;
      bestTarget = other;
    }
  }

  return bestTarget;
}

function startGeneration(parentPool = null) {
  state.generation += 1;
  state.phase = "running";
  state.cooldown = 0;
  state.foods = Array.from({ length: CONFIG.foodCount }, createFood);

  if (!parentPool) {
    state.creatures = Array.from({ length: CONFIG.creatureCount }, (_, index) =>
      createCreature(CONFIG.baseSpeed, index, "seed"),
    );
    updateStats();
    return;
  }

  const elite = parentPool[0];
  const nextCreatures = [createCreature(elite.speed, 0, elite.lineage)];

  while (nextCreatures.length < CONFIG.creatureCount) {
    const parent = weightedPick(parentPool);
    const direction = Math.random() < 0.5 ? -1 : 1;
    const mutatedSpeed = clamp(
      parent.speed * (1 + CONFIG.mutationStep * direction),
      CONFIG.minSpeed,
      CONFIG.maxSpeed,
    );
    nextCreatures.push(
      createCreature(
        mutatedSpeed,
        nextCreatures.length,
        `${parent.lineage.split(">").slice(-1)[0]}>${state.generation}`,
      ),
    );
  }

  state.creatures = nextCreatures;
  updateStats();
}

function weightedPick(pool) {
  const totalWeight = pool.reduce((sum, creature) => sum + creature.selectionWeight, 0);
  let threshold = Math.random() * totalWeight;

  for (const creature of pool) {
    threshold -= creature.selectionWeight;
    if (threshold <= 0) {
      return creature;
    }
  }

  return pool[pool.length - 1];
}

function finishGeneration() {
  const ranked = [...state.creatures]
    .map((creature) => {
      const successBonus = creature.won ? 1000 : 0;
      const timeBonus = creature.won && creature.timeToFood !== null ? (creature.lifespan - creature.timeToFood) * 40 : 0;
      const rangeBonus = creature.distanceTravelled * 0.25;
      const survivalBonus = creature.alive ? 10 : 0;

      return {
        ...creature,
        selectionWeight: Math.max(1, successBonus + timeBonus + rangeBonus + survivalBonus),
      };
    })
    .sort((a, b) => b.selectionWeight - a.selectionWeight);

  const winners = ranked.filter((creature) => creature.won).length;
  const best = ranked[0];
  const averageSpeed = ranked.reduce((sum, creature) => sum + creature.speed, 0) / ranked.length;

  state.history.unshift({
    generation: state.generation,
    winners,
    bestSpeed: best.speed,
    averageSpeed,
  });
  state.history = state.history.slice(0, 10);

  state.phase = "cooldown";
  state.cooldown = CONFIG.generationCooldown;
  state.nextParentPool = ranked;
  updateStats();
}

function resolveCreatureHunt(creature) {
  for (const other of state.creatures) {
    if (
      other.id === creature.id ||
      !other.alive ||
      other.won ||
      creature.size <= other.size
    ) {
      continue;
    }

    const catchDistance = 1 + creature.size + other.size;
    const distanceToOther = distance2D(creature.x, creature.z, other.x, other.z);

    if (distanceToOther <= catchDistance) {
      other.alive = false;
      other.foodId = `blob-${creature.id}`;
      other.winSource = "eaten";
      creature.won = true;
      creature.foodId = `blob-${other.id}`;
      creature.winSource = "predation";
      creature.timeToFood = creature.timeAlive;
      return true;
    }
  }

  return false;
}

function updateCreature(creature, dt) {
  if (!creature.alive || creature.won) {
    return;
  }

  creature.timeAlive += dt;
  creature.bob += dt * 6;
  if (creature.timeAlive >= creature.lifespan) {
    creature.alive = false;
    return;
  }

  const targetFood = findSensedFood(creature);
  const targetPrey = findSensedPrey(creature);
  let desiredHeading = creature.heading;

  if (targetFood || targetPrey) {
    const foodDistance = targetFood
      ? distance2D(creature.x, creature.z, targetFood.x, targetFood.z)
      : Infinity;
    const preyDistance = targetPrey
      ? distance2D(creature.x, creature.z, targetPrey.x, targetPrey.z)
      : Infinity;
    const target =
      preyDistance < Infinity && preyDistance <= foodDistance * 1.15
        ? targetPrey
        : targetFood;

    desiredHeading = Math.atan2(target.z - creature.z, target.x - creature.x);
  } else {
    creature.headingDrift += randomRange(-1, 1) * dt * 0.9;
    creature.headingDrift = clamp(creature.headingDrift, -1.4, 1.4);
    desiredHeading = creature.heading + creature.headingDrift * CONFIG.wanderTurnSpeed * dt;
  }

  let deltaHeading = desiredHeading - creature.heading;
  if (deltaHeading > Math.PI) {
    deltaHeading -= Math.PI * 2;
  } else if (deltaHeading < -Math.PI) {
    deltaHeading += Math.PI * 2;
  }

  const turnRate = 3.2 - (creature.speed - 1) * 1.4;
  creature.heading += deltaHeading * clamp(turnRate * dt, 0, 1);

  const distance = creature.speed * CONFIG.movementScale * dt;
  creature.x += Math.cos(creature.heading) * distance;
  creature.z += Math.sin(creature.heading) * distance;
  creature.distanceTravelled += distance;

  const half = CONFIG.worldSize / 2;
  if (creature.x < -half || creature.x > half) {
    creature.heading = Math.PI - creature.heading;
    creature.x = clamp(creature.x, -half, half);
  }
  if (creature.z < -half || creature.z > half) {
    creature.heading = -creature.heading;
    creature.z = clamp(creature.z, -half, half);
  }

  if (resolveCreatureHunt(creature)) {
    return;
  }

  for (const food of state.foods) {
    if (food.eaten) {
      continue;
    }

    const distanceToFood = distance2D(creature.x, creature.z, food.x, food.z);
    const foodCatchDistance = CONFIG.eatDistance + creature.size * 0.55;
    if (distanceToFood <= foodCatchDistance) {
      food.eaten = true;
      creature.won = true;
      creature.foodId = `${food.x.toFixed(2)}:${food.z.toFixed(2)}`;
      creature.winSource = "food";
      creature.timeToFood = creature.timeAlive;
      return;
    }
  }
}

function updateSimulation(dt) {
  if (state.phase === "running") {
    for (const creature of state.creatures) {
      updateCreature(creature, dt);
    }

    const activeCreatures = state.creatures.some((creature) => creature.alive && !creature.won);

    if (!activeCreatures) {
      finishGeneration();
    }
  } else {
    state.cooldown -= dt;
    if (state.cooldown <= 0) {
      startGeneration(state.nextParentPool);
    }
  }
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, "#17324b");
  gradient.addColorStop(1, "#07111f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = "rgba(140, 212, 255, 0.08)";
  for (let i = 0; i < 3; i += 1) {
    const radius = 120 + i * 90;
    ctx.beginPath();
    ctx.arc(state.width * 0.82, state.height * 0.18, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawField() {
  const half = CONFIG.worldSize / 2;
  const corners = [
    project(-half, 0, -half),
    project(half, 0, -half),
    project(half, 0, half),
    project(-half, 0, half),
  ];

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();

  const fieldGradient = ctx.createLinearGradient(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
  fieldGradient.addColorStop(0, "rgba(44, 132, 85, 0.85)");
  fieldGradient.addColorStop(1, "rgba(17, 74, 46, 0.95)");
  ctx.fillStyle = fieldGradient;
  ctx.fill();

  ctx.strokeStyle = "rgba(210, 255, 228, 0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = -half; i <= half; i += 10) {
    const a = project(i, 0, -half);
    const b = project(i, 0, half);
    const c = project(-half, 0, i);
    const d = project(half, 0, i);

    ctx.strokeStyle = "rgba(240, 255, 244, 0.08)";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
}

function drawFood(food) {
  if (food.eaten) {
    return;
  }

  const base = project(food.x, 0, food.z);
  const top = project(food.x, 1.8, food.z);

  ctx.strokeStyle = "rgba(122, 76, 24, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();

  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(top.x, top.y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 222, 109, 0.2)";
  ctx.beginPath();
  ctx.arc(base.x, base.y + 2, 9, 0, Math.PI * 2);
  ctx.fill();
}

function drawCreature(creature) {
  const bounce = Math.sin(creature.bob) * 0.6 + (creature.won ? 0.7 : 0);
  const position = project(creature.x, 1.2 + bounce, creature.z);
  const shadow = project(creature.x, 0.05, creature.z);
  const size = 7 + creature.size * 7;
  const color =
    creature.winSource === "predation" ? "rgb(122, 18, 18)" : speedToColor(creature.speed);

  ctx.fillStyle = creature.alive ? "rgba(0, 0, 0, 0.22)" : "rgba(0, 0, 0, 0.12)";
  ctx.beginPath();
  ctx.ellipse(shadow.x, shadow.y + 4, size * 1.3, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = creature.alive ? color : "rgba(120, 140, 150, 0.55)";
  ctx.beginPath();
  ctx.ellipse(position.x, position.y, size * 1.05, size * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.ellipse(position.x - size * 0.24, position.y - size * 0.22, size * 0.32, size * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();

  if (creature.won) {
    ctx.strokeStyle = "rgba(255, 244, 130, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(position.x, position.y - size * 0.15, size * 1.28, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (creature.winSource === "eaten") {
    ctx.fillStyle = "rgba(245, 245, 245, 0.92)";
    ctx.font = `700 ${Math.max(12, Math.round(size * 1.1))}px 'Segoe UI Symbol', 'Arial Unicode MS', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("☠", position.x, position.y - 1);
  }
}

function drawHistory() {
  const boxWidth = 240;
  const boxHeight = 86;
  const x = state.width - boxWidth - 18;
  const y = 18;

  ctx.fillStyle = "rgba(7, 20, 35, 0.68)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  pathRoundedRect(x, y, boxWidth, boxHeight, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ecf5ff";
  ctx.font = "600 14px 'Trebuchet MS', sans-serif";
  ctx.fillText("Recent Best Speeds", x + 14, y + 22);

  if (state.history.length < 2) {
    return;
  }

  const maxSpeed = CONFIG.maxSpeed;
  const minSpeed = CONFIG.minSpeed;

  ctx.strokeStyle = "rgba(255, 209, 102, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();

  state.history
    .slice()
    .reverse()
    .forEach((entry, index, history) => {
      const px = x + 14 + (index / (history.length - 1)) * (boxWidth - 28);
      const normalized = (entry.bestSpeed - minSpeed) / (maxSpeed - minSpeed);
      const py = y + boxHeight - 14 - normalized * (boxHeight - 34);

      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });

  ctx.stroke();
}

function drawScene() {
  drawBackground();
  drawField();

  for (const food of state.foods) {
    drawFood(food);
  }

  const creaturesByDepth = [...state.creatures].sort((a, b) => a.x + a.z - (b.x + b.z));
  for (const creature of creaturesByDepth) {
    drawCreature(creature);
  }

  drawHistory();
}

function updateStats() {
  const winners = state.creatures.filter((creature) => creature.won).length;
  const alive = state.creatures.filter((creature) => creature.alive && !creature.won).length;
  const averageSpeed =
    state.creatures.reduce((sum, creature) => sum + creature.speed, 0) / Math.max(1, state.creatures.length);
  const averageSize =
    state.creatures.reduce((sum, creature) => sum + creature.size, 0) / Math.max(1, state.creatures.length);
  const bestSpeed = Math.max(...state.creatures.map((creature) => creature.speed));
  const slowestSpeed = Math.min(...state.creatures.map((creature) => creature.speed));
  const largestSize = Math.max(...state.creatures.map((creature) => creature.size));
  const predationWins = state.creatures.filter((creature) => creature.winSource === "predation").length;

  statsEl.innerHTML = `
    <div>Generation: <strong>${state.generation}</strong> (${state.phase})</div>
    <div>Winners this round: <strong>${winners}/${CONFIG.creatureCount}</strong></div>
    <div>Wins by eating blobs: <strong>${predationWins}</strong></div>
    <div>Still searching: <strong>${alive}</strong></div>
    <div>Average speed / size: <strong>${averageSpeed.toFixed(3)} / ${averageSize.toFixed(3)}</strong></div>
    <div>Fastest / Slowest: <strong>${bestSpeed.toFixed(3)} / ${slowestSpeed.toFixed(3)}</strong></div>
    <div>Largest blob size: <strong>${largestSize.toFixed(3)}</strong></div>
    <div>Base rules: speed 1.0, lifespan 5.0s, mutation +/-3%</div>
  `;
}

function loop(timestamp) {
  if (!state.previousTime) {
    state.previousTime = timestamp;
  }

  const dt = Math.min((timestamp - state.previousTime) / 1000, 0.033);
  state.previousTime = timestamp;

  updateSimulation(dt);
  updateStats();
  drawScene();

  window.requestAnimationFrame(loop);
}

window.addEventListener("resize", resize);

resize();
startGeneration();
window.requestAnimationFrame(loop);
