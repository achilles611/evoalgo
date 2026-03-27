const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");
const hideHudButton = document.getElementById("hideHudButton");
const showHudButton = document.getElementById("showHudButton");
const musicToggleButton = document.getElementById("musicToggleButton");
const bgm = document.getElementById("bgm");

const CONFIG = {
  worldSize: 80,
  creatureCount: 20,
  foodCount: 10,
  metalBlobSpeed: 5,
  metalBlobScore: 60,
  baseSpeed: 1,
  baseLifespan: 5,
  baseSize: 1,
  mutationStep: 0.1,
  minSpeed: 0.55,
  maxSpeed: 1.45,
  eatDistance: 2.4,
  senseRadius: 18,
  wanderTurnSpeed: 2.2,
  generationCooldown: 1.2,
  movementScale: 14,
  colorSpread: 0.22,
  specializationBias: 60,
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

function setHudCollapsed(collapsed) {
  document.body.classList.toggle("hud-collapsed", collapsed);
}

hideHudButton.addEventListener("click", () => {
  setHudCollapsed(true);
});

showHudButton.addEventListener("click", () => {
  setHudCollapsed(false);
});

bgm.volume = 0.2;
bgm.muted = false;
bgm.playsInline = true;

function updateMusicButton() {
  const playing = !bgm.paused;
  musicToggleButton.textContent = playing ? "Pause Music" : "Play Music";
  musicToggleButton.classList.toggle("is-playing", playing);
}

async function startBackgroundMusic() {
  try {
    await bgm.play();
    updateMusicButton();
  } catch (_error) {
    updateMusicButton();
  }
}

async function toggleBackgroundMusic() {
  if (bgm.paused) {
    await startBackgroundMusic();
    return;
  }

  bgm.pause();
  updateMusicButton();
}

musicToggleButton.addEventListener("click", () => {
  toggleBackgroundMusic().catch(() => {});
});

bgm.addEventListener("play", updateMusicButton);
bgm.addEventListener("pause", updateMusicButton);
bgm.addEventListener("ended", updateMusicButton);

window.addEventListener("pointerdown", startBackgroundMusic, { once: true });
window.addEventListener("keydown", startBackgroundMusic, { once: true });
updateMusicButton();

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

function isBlueCreature(creature) {
  return !creature.isMetal && creature.speed < CONFIG.baseSpeed;
}

function isRedCreature(creature) {
  return !creature.isMetal && creature.speed > CONFIG.baseSpeed;
}

function areAllFoodsEaten() {
  return state.foods.every((food) => food.eaten);
}

function speedToColor(speed) {
  const delta = clamp((speed - CONFIG.baseSpeed) / CONFIG.colorSpread, -1, 1);
  const faster = Math.max(0, delta);
  const slower = Math.max(0, -delta);

  const r = Math.round(72 + faster * 185);
  const g = Math.round(184 - (faster + slower) * 42);
  const b = Math.round(92 + slower * 180 - faster * 36);
  return `rgb(${r}, ${g}, ${b})`;
}

function createFood(x = null, z = null, source = "field") {
  const half = CONFIG.worldSize / 2;

  return {
    x: x === null ? randomRange(-half, half) : clamp(x, -half, half),
    z: z === null ? randomRange(-half, half) : clamp(z, -half, half),
    y: 0,
    eaten: false,
    source,
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
    isMetal: false,
    hasAntenna: speed < CONFIG.baseSpeed,
    timeAlive: 0,
    alive: true,
    won: false,
    foodId: null,
    winSource: null,
    score: 0,
    distanceTravelled: 0,
    timeToFood: null,
    antennaPartnerId: null,
  };
}

function createMetalBlob() {
  const half = CONFIG.worldSize / 2;

  return {
    id: "metal-blob",
    lineage: "metal",
    x: -half + 8,
    z: -half + 3,
    y: 0,
    heading: 0,
    headingDrift: 0,
    bob: randomRange(0, Math.PI * 2),
    speed: CONFIG.metalBlobSpeed,
    lifespan: Number.POSITIVE_INFINITY,
    size: 1.75,
    isMetal: true,
    hasAntenna: false,
    timeAlive: 0,
    alive: true,
    won: false,
    foodId: null,
    winSource: "metal",
    score: CONFIG.metalBlobScore,
    distanceTravelled: 0,
    timeToFood: null,
    antennaPartnerId: null,
    wingPhase: randomRange(0, Math.PI * 2),
    dropCooldown: 0.75,
    diveFlash: 0,
    perimeterIndex: 0,
    lockedPreyId: null,
    preyLockDelay: 2,
  };
}

function getRegularCreatures() {
  return state.creatures.filter((creature) => !creature.isMetal);
}

function getAvailableFoods() {
  return state.foods.filter((food) => !food.eaten);
}

function findClosestFood(creature) {
  let bestFood = null;
  let bestDistance = Infinity;

  for (const food of state.foods) {
    if (food.eaten) {
      continue;
    }

    const distance = distance2D(creature.x, creature.z, food.x, food.z);
    if (distance < bestDistance) {
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

function findNearestAntennaTarget(creature) {
  if (!isRedCreature(creature) || creature.score > 0) {
    return null;
  }

  let bestTarget = null;
  let bestDistance = Infinity;

  for (const other of state.creatures) {
    if (
      other.id === creature.id ||
      !other.alive ||
      !other.hasAntenna ||
      other.antennaPartnerId !== null
    ) {
      continue;
    }

    const distance = distance2D(creature.x, creature.z, other.x, other.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTarget = other;
    }
  }

  return bestTarget;
}

function findNearestRedTarget(creature) {
  let bestTarget = null;
  let bestDistance = Infinity;

  for (const other of state.creatures) {
    if (
      other.id === creature.id ||
      !other.alive ||
      other.won ||
      !isRedCreature(other)
    ) {
      continue;
    }

    const distance = distance2D(creature.x, creature.z, other.x, other.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTarget = other;
    }
  }

  return bestTarget;
}

function getMetalPerimeterWaypoints() {
  const half = CONFIG.worldSize / 2 - 5;
  return [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ];
}

function findCreatureById(id) {
  return state.creatures.find((creature) => creature.id === id) || null;
}

function findSlowerBlobAvoidance(creature) {
  if (creature.speed <= CONFIG.baseSpeed) {
    return null;
  }

  let avoidX = 0;
  let avoidZ = 0;
  let threatWeight = 0;

  for (const other of state.creatures) {
    if (
      other.id === creature.id ||
      !other.alive ||
      other.won ||
      other.speed >= CONFIG.baseSpeed
    ) {
      continue;
    }

    const dx = creature.x - other.x;
    const dz = creature.z - other.z;
    const distance = Math.hypot(dx, dz);
    const dangerRadius = CONFIG.senseRadius * 0.85;

    if (distance === 0 || distance > dangerRadius) {
      continue;
    }

    const closeness = 1 - distance / dangerRadius;
    const weight = closeness * (1 + Math.max(0, other.size - creature.size));

    avoidX += (dx / distance) * weight;
    avoidZ += (dz / distance) * weight;
    threatWeight += weight;
  }

  if (threatWeight <= 0) {
    return null;
  }

  return {
    heading: Math.atan2(avoidZ, avoidX),
    strength: threatWeight,
  };
}

function startGeneration(parentPool = null) {
  state.generation += 1;
  state.phase = "running";
  state.cooldown = 0;
  state.foods = Array.from({ length: CONFIG.foodCount }, createFood);

  if (!parentPool) {
    const regularCreatures = Array.from({ length: CONFIG.creatureCount }, (_, index) =>
      createCreature(CONFIG.baseSpeed, index, "seed"),
    );
    state.creatures = [...regularCreatures, createMetalBlob()];
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

  state.creatures = [...nextCreatures, createMetalBlob()];
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
  const ranked = getRegularCreatures()
    .map((creature) => {
      const timeBonus =
        creature.score > 0 && creature.timeToFood !== null
          ? Math.max(0, creature.lifespan - creature.timeToFood)
          : 0;
      const specializationBonus =
        creature.score > 0
          ? Math.abs(creature.speed - CONFIG.baseSpeed) * CONFIG.specializationBias
          : 0;
      const selectionWeight = creature.score * 100 + timeBonus + specializationBonus;

      return {
        ...creature,
        selectionWeight,
      };
    })
    .sort((a, b) => b.selectionWeight - a.selectionWeight);

  const breeders = ranked.filter((creature) => creature.score > 0);

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
  state.nextParentPool = breeders.length > 0 ? breeders : null;
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
      creature.score = 2;
      creature.timeToFood = creature.timeAlive;
      return true;
    }
  }

  return false;
}

function resolveAntennaMerge(redCreature, blueCreature) {
  if (
    !redCreature ||
    !blueCreature ||
    !redCreature.alive ||
    !blueCreature.alive ||
    redCreature.antennaPartnerId !== null ||
    blueCreature.antennaPartnerId !== null
  ) {
    return false;
  }

  const catchDistance = 1.2 + redCreature.size + blueCreature.size;
  const distanceToOther = distance2D(redCreature.x, redCreature.z, blueCreature.x, blueCreature.z);

  if (distanceToOther > catchDistance) {
    return false;
  }

  redCreature.won = true;
  redCreature.alive = false;
  redCreature.score = Math.max(redCreature.score, 10);
  redCreature.foodId = `antenna-${blueCreature.id}`;
  redCreature.winSource = "symbiosis-red";
  redCreature.timeToFood = redCreature.timeAlive;
  redCreature.antennaPartnerId = blueCreature.id;

  blueCreature.won = true;
  blueCreature.score = Math.max(blueCreature.score, 10);
  blueCreature.foodId = `antenna-${redCreature.id}`;
  blueCreature.winSource = "symbiosis-blue";
  blueCreature.timeToFood = blueCreature.timeAlive || redCreature.timeAlive;
  blueCreature.antennaPartnerId = redCreature.id;

  return true;
}

function updateMetalBlob(creature, dt) {
  creature.timeAlive += dt;
  creature.bob += dt * 9;
  creature.wingPhase += dt * 12;
  creature.score = CONFIG.metalBlobScore;
  creature.dropCooldown = Math.max(0, creature.dropCooldown - dt);
  creature.diveFlash = Math.max(0, creature.diveFlash - dt);
  const perimeterWaypoints = getMetalPerimeterWaypoints();
  const availableFoods = getAvailableFoods().length;
  let targetRed = creature.lockedPreyId ? findCreatureById(creature.lockedPreyId) : null;

  if (!targetRed || !targetRed.alive || targetRed.won || !isRedCreature(targetRed)) {
    creature.lockedPreyId = null;
    targetRed = null;
  }

  if (!targetRed && creature.timeAlive >= creature.preyLockDelay) {
    const preyCandidate = findNearestRedTarget(creature);
    if (preyCandidate) {
      creature.lockedPreyId = preyCandidate.id;
      targetRed = preyCandidate;
    }
  }

  const shouldCreateFood = creature.dropCooldown <= 0 && !targetRed && availableFoods < 4;

  if (shouldCreateFood) {
    const foodX = creature.x + Math.cos(creature.heading) * 4;
    const foodZ = creature.z + Math.sin(creature.heading) * 4;
    state.foods.push(createFood(foodX, foodZ, "metal"));
    creature.dropCooldown = 1.75;
  }

  let desiredHeading = creature.heading;
  if (targetRed) {
    desiredHeading = Math.atan2(targetRed.z - creature.z, targetRed.x - creature.x);
  } else {
    const targetWaypoint = perimeterWaypoints[creature.perimeterIndex];
    const distanceToWaypoint = distance2D(creature.x, creature.z, targetWaypoint.x, targetWaypoint.z);
    if (distanceToWaypoint <= 4) {
      creature.perimeterIndex = (creature.perimeterIndex + 1) % perimeterWaypoints.length;
    }

    const nextWaypoint = perimeterWaypoints[creature.perimeterIndex];
    desiredHeading = Math.atan2(nextWaypoint.z - creature.z, nextWaypoint.x - creature.x);
  }

  let deltaHeading = desiredHeading - creature.heading;
  if (deltaHeading > Math.PI) {
    deltaHeading -= Math.PI * 2;
  } else if (deltaHeading < -Math.PI) {
    deltaHeading += Math.PI * 2;
  }

  creature.heading += deltaHeading * clamp(6.5 * dt, 0, 1);

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

  if (!targetRed) {
    return;
  }

  const catchDistance = 1.4 + creature.size + targetRed.size;
  const distanceToTarget = distance2D(creature.x, creature.z, targetRed.x, targetRed.z);
  if (distanceToTarget <= catchDistance) {
    targetRed.alive = false;
    targetRed.foodId = "metal-blob";
    targetRed.winSource = "metal-eaten";
    creature.diveFlash = 0.45;
    creature.lockedPreyId = null;
    creature.preyLockDelay = creature.timeAlive + 2;
  }
}

function updateCreature(creature, dt) {
  if (!creature.alive || creature.won) {
    return;
  }

  if (creature.isMetal) {
    updateMetalBlob(creature, dt);
    return;
  }

  creature.timeAlive += dt;
  creature.bob += dt * 6;
  if (creature.timeAlive >= creature.lifespan) {
    creature.alive = false;
    return;
  }

  const noFoodLeft = areAllFoodsEaten();
  const targetFood = noFoodLeft ? null : findClosestFood(creature);
  const targetAntenna = noFoodLeft ? findNearestAntennaTarget(creature) : null;
  const targetPrey = targetFood || targetAntenna ? null : findSensedPrey(creature);
  const avoidThreat = findSlowerBlobAvoidance(creature);
  let desiredHeading = creature.heading;

  if (targetFood || targetAntenna || targetPrey) {
    const target = targetFood || targetAntenna || targetPrey;
    desiredHeading = Math.atan2(target.z - creature.z, target.x - creature.x);
    if (targetAntenna) {
      creature.headingDrift *= 0.9;
    }
  } else {
    creature.headingDrift += randomRange(-1, 1) * dt * 0.9;
    creature.headingDrift = clamp(creature.headingDrift, -1.4, 1.4);
    desiredHeading = creature.heading + creature.headingDrift * CONFIG.wanderTurnSpeed * dt;
  }

  if (avoidThreat) {
    const targetVectorX = Math.cos(desiredHeading);
    const targetVectorZ = Math.sin(desiredHeading);
    const avoidVectorX = Math.cos(avoidThreat.heading);
    const avoidVectorZ = Math.sin(avoidThreat.heading);
    const avoidStrength = clamp(avoidThreat.strength / 2.5, 0.35, 0.88);
    const targetStrength = 1 - avoidStrength;

    desiredHeading = Math.atan2(
      targetVectorZ * targetStrength + avoidVectorZ * avoidStrength,
      targetVectorX * targetStrength + avoidVectorX * avoidStrength,
    );
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

  if (targetAntenna && resolveAntennaMerge(creature, targetAntenna)) {
    return;
  }

  if (!targetAntenna && resolveCreatureHunt(creature)) {
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
      creature.score = 20;
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

    const activeCreatures = getRegularCreatures().some((creature) => creature.alive && !creature.won);

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
  const isMetalFood = food.source === "metal";

  ctx.strokeStyle = isMetalFood ? "rgba(228, 234, 255, 0.9)" : "rgba(122, 76, 24, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();

  ctx.fillStyle = isMetalFood ? "#f5fbff" : "#ffd166";
  ctx.beginPath();
  ctx.arc(top.x, top.y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isMetalFood ? "rgba(214, 241, 255, 0.24)" : "rgba(255, 222, 109, 0.2)";
  ctx.beginPath();
  ctx.arc(base.x, base.y + 2, 9, 0, Math.PI * 2);
  ctx.fill();
}

function drawMetalBlob(creature, position, shadow, size) {
  const wingSpread = size * 2.25;
  const wingLift = Math.sin(creature.wingPhase) * size * 0.28;
  const haloY = position.y - size * 1.25;

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(shadow.x, shadow.y + 6, size * 2.1, size * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(5, 5, 8, 0.95)";
  ctx.beginPath();
  ctx.moveTo(position.x - size * 0.65, position.y - size * 0.15);
  ctx.bezierCurveTo(
    position.x - wingSpread * 0.65,
    position.y - size * 1.2 - wingLift,
    position.x - wingSpread,
    position.y - size * 0.05,
    position.x - wingSpread * 0.72,
    position.y + size * 0.68,
  );
  ctx.bezierCurveTo(
    position.x - wingSpread * 0.38,
    position.y + size * 0.18,
    position.x - size * 0.95,
    position.y + size * 0.1,
    position.x - size * 0.42,
    position.y + size * 0.72,
  );
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(position.x + size * 0.65, position.y - size * 0.15);
  ctx.bezierCurveTo(
    position.x + wingSpread * 0.65,
    position.y - size * 1.2 + wingLift,
    position.x + wingSpread,
    position.y - size * 0.05,
    position.x + wingSpread * 0.72,
    position.y + size * 0.68,
  );
  ctx.bezierCurveTo(
    position.x + wingSpread * 0.38,
    position.y + size * 0.18,
    position.x + size * 0.95,
    position.y + size * 0.1,
    position.x + size * 0.42,
    position.y + size * 0.72,
  );
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = `rgba(245, 250, 255, ${0.72 + creature.diveFlash * 0.5})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(position.x, haloY, size * 0.85, size * 0.24, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.beginPath();
  ctx.ellipse(position.x, haloY, size * 1.02, size * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0d0d10";
  ctx.beginPath();
  ctx.ellipse(position.x - size * 0.16, position.y + size * 0.05, size * 0.78, size * 0.58, -0.18, 0, Math.PI * 2);
  ctx.ellipse(position.x + size * 0.28, position.y - size * 0.06, size * 0.58, size * 0.48, 0.32, 0, Math.PI * 2);
  ctx.ellipse(position.x, position.y - size * 0.18, size * 0.62, size * 0.42, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#eef2f7";
  ctx.beginPath();
  ctx.ellipse(position.x - size * 0.26, position.y - size * 0.16, size * 0.3, size * 0.2, -0.4, 0, Math.PI * 2);
  ctx.ellipse(position.x + size * 0.18, position.y + size * 0.08, size * 0.26, size * 0.18, 0.15, 0, Math.PI * 2);
  ctx.ellipse(position.x + size * 0.02, position.y - size * 0.3, size * 0.2, size * 0.14, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.ellipse(position.x - size * 0.22, position.y - size * 0.44, size * 0.18, size * 0.08, -0.35, 0, Math.PI * 2);
  ctx.fill();
}

function drawCreature(creature) {
  const bounce = Math.sin(creature.bob) * 0.6 + (creature.won ? 0.7 : 0);
  const position = project(creature.x, 1.2 + bounce, creature.z);
  const shadow = project(creature.x, 0.05, creature.z);
  const size = 7 + creature.size * 7;

  if (creature.isMetal) {
    drawMetalBlob(creature, position, shadow, size + 4);
    return;
  }

  const color =
    creature.winSource === "predation"
      ? "rgb(122, 18, 18)"
      : creature.winSource === "metal-eaten"
        ? "rgb(126, 82, 176)"
      : creature.winSource === "symbiosis-blue"
        ? "rgb(62, 108, 212)"
        : speedToColor(creature.speed);

  ctx.fillStyle = creature.alive ? "rgba(0, 0, 0, 0.22)" : "rgba(0, 0, 0, 0.12)";
  ctx.beginPath();
  ctx.ellipse(shadow.x, shadow.y + 4, size * 1.3, size * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = creature.alive ? color : "rgba(120, 140, 150, 0.55)";
  ctx.beginPath();
  ctx.ellipse(position.x, position.y, size * 1.05, size * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (creature.hasAntenna) {
    const antennaHeight = size * 1.1;
    const antennaLean = size * 0.16;

    ctx.strokeStyle = creature.winSource === "symbiosis-blue" ? "rgba(132, 190, 255, 0.95)" : "rgba(158, 208, 255, 0.88)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(position.x + size * 0.1, position.y - size * 0.25);
    ctx.lineTo(position.x + antennaLean, position.y - antennaHeight);
    ctx.stroke();

    ctx.fillStyle = creature.winSource === "symbiosis-blue" ? "rgba(214, 241, 255, 0.98)" : "rgba(123, 204, 255, 0.96)";
    ctx.beginPath();
    ctx.arc(position.x + antennaLean, position.y - antennaHeight, Math.max(3, size * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }

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

  if (creature.winSource === "eaten" || creature.winSource === "metal-eaten") {
    const metalDeath = creature.winSource === "metal-eaten";
    ctx.fillStyle = metalDeath ? "rgba(222, 196, 255, 0.96)" : "rgba(245, 245, 245, 0.92)";
    ctx.font = `700 ${Math.max(
      metalDeath ? 18 : 12,
      Math.round(size * (metalDeath ? 1.5 : 1.1)),
    )}px 'Segoe UI Symbol', 'Arial Unicode MS', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u2620", position.x, position.y - (metalDeath ? size * 0.95 : 1));
  }

  if (creature.winSource === "symbiosis-red") {
    ctx.strokeStyle = "rgba(132, 190, 255, 0.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(position.x, position.y, size * 0.95, 0, Math.PI * 2);
    ctx.stroke();
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
  const regularCreatures = getRegularCreatures();
  const metalBlob = state.creatures.find((creature) => creature.isMetal);
  const winners = regularCreatures.filter((creature) => creature.won).length;
  const alive = regularCreatures.filter((creature) => creature.alive && !creature.won).length;
  const totalPoints = state.creatures.reduce((sum, creature) => sum + creature.score, 0);
  const averageSpeed =
    regularCreatures.reduce((sum, creature) => sum + creature.speed, 0) / Math.max(1, regularCreatures.length);
  const averageSize =
    regularCreatures.reduce((sum, creature) => sum + creature.size, 0) / Math.max(1, regularCreatures.length);
  const bestSpeed = Math.max(...regularCreatures.map((creature) => creature.speed));
  const slowestSpeed = Math.min(...regularCreatures.map((creature) => creature.speed));
  const largestSize = Math.max(...regularCreatures.map((creature) => creature.size));
  const predationWins = regularCreatures.filter((creature) => creature.winSource === "predation").length;
  const foodWins = regularCreatures.filter((creature) => creature.winSource === "food").length;
  const antennaPairs = regularCreatures.filter((creature) => creature.winSource === "symbiosis-blue").length;
  const extinct = state.phase === "cooldown" && !state.nextParentPool;

  statsEl.innerHTML = `
    <div>Generation: <strong>${state.generation}</strong> (${state.phase})</div>
    <div>Winners this round: <strong>${winners}/${CONFIG.creatureCount}</strong></div>
    <div>Food wins / predator wins / antenna pairs: <strong>${foodWins} / ${predationWins} / ${antennaPairs}</strong></div>
    <div>Total points earned: <strong>${totalPoints}</strong>${extinct ? " - extinction reset" : ""}</div>
    <div>Metal blob score: <strong>${metalBlob ? metalBlob.score : 0}</strong></div>
    <div>Still searching: <strong>${alive}</strong></div>
    <div>Average speed / size: <strong>${averageSpeed.toFixed(3)} / ${averageSize.toFixed(3)}</strong></div>
    <div>Fastest / Slowest: <strong>${bestSpeed.toFixed(3)} / ${slowestSpeed.toFixed(3)}</strong></div>
    <div>Largest blob size: <strong>${largestSize.toFixed(3)}</strong></div>
    <div>Base rules: food = 20 points, blob = 2 points, antenna merge = 10 each, metal blob = 60 points</div>
    <div>Trait range: speed ${CONFIG.minSpeed.toFixed(2)}-${CONFIG.maxSpeed.toFixed(2)}, mutation +/-${Math.round(CONFIG.mutationStep * 100)}%</div>
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
