import * as THREE from "/vendor/three/three.module.js";

const canvas = document.querySelector("#museum-3d-canvas");
const selectedLabel = document.querySelector("#three-selected-zone");
const riskLabel = document.querySelector("#three-risk-text");
const zoneLegend = document.querySelector("#three-zone-legend");

const zoneDefinitions = [
  {
    id: "gallery-1",
    label: "Gallery Zone",
    subtitle: "Ambient gallery sensor",
    position: [-2.9, 0, -1.45],
    accent: 0x2bb673,
    type: "gallery"
  },
  {
    id: "archive-1",
    label: "Archive Room",
    subtitle: "Humidity + battery reliability",
    position: [2.2, 0, -1.45],
    accent: 0xf2b705,
    type: "archive"
  },
  {
    id: "exhibit-1",
    label: "Exhibit Case",
    subtitle: "Light exposure monitor",
    position: [-2.9, 0, 1.5],
    accent: 0xf08a24,
    type: "exhibit"
  },
  {
    id: "entrance-1",
    label: "Entrance Area",
    subtitle: "Access / motion sensor",
    position: [2.2, 0, 1.5],
    accent: 0x2f80ed,
    type: "entrance"
  }
];

const palette = {
  normal: 0x14c38e,
  warning: 0xf2b705,
  light: 0xff8a1d,
  humidity: 0xf2b705,
  critical: 0xd64545,
  offline: 0x9aa3a8,
  selected: 0xffffff,
  dark: 0x17272c
};

const deviceState = {
  devices: [],
  selectedDeviceId: null
};

const sceneObjects = new Map();
const clickableObjects = [];
const clock = new THREE.Clock();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let renderer = null;
let scene = null;
let camera = null;
let museumGroup = null;

if (canvas) {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x90a8ab, 8.6, 18.5);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0.22, 4.9, 7.05);
  camera.lookAt(0, 0, 0);

  museumGroup = new THREE.Group();
  scene.add(museumGroup);

  addLights(scene);
  buildMuseumStage(museumGroup);
  for (const zone of zoneDefinitions) {
    buildZone(museumGroup, zone);
  }

  window.addEventListener("resize", resize);
  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("museum3d:update", (event) => {
    deviceState.devices = event.detail?.devices || [];
    deviceState.selectedDeviceId = event.detail?.selectedDeviceId || null;
    updateScene();
  });

  if (window.museumTwinState) {
    deviceState.devices = window.museumTwinState.devices || [];
    deviceState.selectedDeviceId = window.museumTwinState.selectedDeviceId || null;
    updateScene();
  }

  resize();
  renderer.setAnimationLoop(animate);
}

function addLights(scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 1.28);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff2d0, 2.55);
  key.position.set(-3.8, 6.5, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.width = 1024;
  key.shadow.mapSize.height = 1024;
  scene.add(key);

  const cool = new THREE.PointLight(0x73d9ff, 2.9, 10);
  cool.position.set(3.5, 2.4, 3.8);
  scene.add(cool);

  const warm = new THREE.PointLight(0xffbd5a, 2.5, 9);
  warm.position.set(-4.2, 2.1, -3.8);
  scene.add(warm);
}

function buildMuseumStage(group) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(7.9, 0.14, 5.4),
    new THREE.MeshStandardMaterial({
      color: 0xd6c3a2,
      roughness: 0.72,
      metalness: 0.05
    })
  );
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  group.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 2.65, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0xe2e2d8,
      roughness: 0.74
    })
  );
  backWall.position.set(0, 1.22, -2.78);
  backWall.receiveShadow = true;
  group.add(backWall);

  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 2.35, 5.4),
    new THREE.MeshStandardMaterial({
      color: 0xd6ddd3,
      roughness: 0.8
    })
  );
  leftWall.position.set(-4.1, 1.08, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const dividerA = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.15, 4.9),
    new THREE.MeshStandardMaterial({
      color: 0xc9d6cf,
      roughness: 0.78,
      transparent: true,
      opacity: 0.64
    })
  );
  dividerA.position.set(-0.35, 0.55, 0);
  group.add(dividerA);

  const dividerB = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.08, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0xc9d6cf,
      roughness: 0.78,
      transparent: true,
      opacity: 0.64
    })
  );
  dividerB.position.set(-0.25, 0.55, 0);
  group.add(dividerB);
}

function buildZone(group, zone) {
  const zoneGroup = new THREE.Group();
  zoneGroup.position.set(...zone.position);
  zoneGroup.userData.deviceId = zone.id;
  group.add(zoneGroup);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7f2e8,
    roughness: 0.64,
    metalness: 0.08
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.12, 1.65), baseMaterial);
  base.position.y = 0.02;
  base.castShadow = true;
  base.receiveShadow = true;
  base.userData.deviceId = zone.id;
  zoneGroup.add(base);
  clickableObjects.push(base);

  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(2.32, 0.035, 0.08),
    new THREE.MeshBasicMaterial({ color: zone.accent })
  );
  accent.position.set(0, 0.105, -0.74);
  zoneGroup.add(accent);

  const sensorMaterial = new THREE.MeshStandardMaterial({
    color: palette.offline,
    emissive: 0x101010,
    emissiveIntensity: 0.25,
    roughness: 0.42,
    metalness: 0.18
  });
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 24), sensorMaterial);
  sensor.position.set(0.84, 0.52, 0.52);
  sensor.castShadow = true;
  sensor.userData.deviceId = zone.id;
  zoneGroup.add(sensor);
  clickableObjects.push(sensor);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.018, 12, 72),
    new THREE.MeshBasicMaterial({
      color: palette.selected,
      transparent: true,
      opacity: 0
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.copy(sensor.position);
  zoneGroup.add(ring);

  const batteryLabel = createTextSprite("BATTERY", {
    width: 360,
    height: 94,
    fontSize: 40,
    color: "#11181b",
    background: "rgba(255, 204, 77, 0.98)"
  });
  batteryLabel.position.set(0.54, 1.02, 0.5);
  batteryLabel.scale.set(0.94, 0.24, 1);
  batteryLabel.visible = false;
  zoneGroup.add(batteryLabel);

  const label = createTextSprite(zone.label, {
    width: 420,
    height: 112,
    fontSize: 44,
    color: "#f9fff9",
    background: "rgba(15, 32, 39, 0.9)"
  });
  label.position.set(-0.24, 1.08, -0.68);
  label.scale.set(1.14, 0.3, 1);
  zoneGroup.add(label);

  const detailLabel = createTextSprite("waiting", {
    width: 380,
    height: 86,
    fontSize: 32,
    color: "#102027",
    background: "rgba(255, 255, 255, 0.94)"
  });
  detailLabel.position.set(-0.18, 0.76, -0.68);
  detailLabel.scale.set(1.02, 0.24, 1);
  zoneGroup.add(detailLabel);

  const lightCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.1, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc83d,
      transparent: true,
      opacity: zone.type === "exhibit" ? 0.24 : 0.08,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  lightCone.rotation.x = Math.PI;
  lightCone.position.set(-0.65, 1.12, 0.05);
  zoneGroup.add(lightCone);

  const motionPulse = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.014, 12, 72),
    new THREE.MeshBasicMaterial({
      color: palette.critical,
      transparent: true,
      opacity: 0
    })
  );
  motionPulse.rotation.x = Math.PI / 2;
  motionPulse.position.set(0.84, 0.2, 0.52);
  zoneGroup.add(motionPulse);

  addZoneProp(zoneGroup, zone);

  sceneObjects.set(zone.id, {
    zone,
    group: zoneGroup,
    base,
    accent,
    sensor,
    ring,
    batteryLabel,
    label,
    detailLabel,
    lightCone,
    motionPulse,
    currentStatus: "offline"
  });
}

function addZoneProp(group, zone) {
  if (zone.type === "archive") {
    const cabinetMaterial = new THREE.MeshStandardMaterial({ color: 0x67513d, roughness: 0.72 });
    for (let i = 0; i < 3; i += 1) {
      const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.62, 0.72), cabinetMaterial);
      cabinet.position.set(-0.66 + i * 0.38, 0.44, 0.04);
      cabinet.castShadow = true;
      group.add(cabinet);
    }
    return;
  }

  if (zone.type === "exhibit") {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.56, 0.56),
      new THREE.MeshStandardMaterial({
        color: 0xa7d4d9,
        roughness: 0.18,
        metalness: 0.02,
        transparent: true,
        opacity: 0.42
      })
    );
    glass.position.set(-0.42, 0.48, 0.1);
    glass.castShadow = true;
    group.add(glass);

    const artifact = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.25, 0.5, 32),
      new THREE.MeshStandardMaterial({ color: 0xb87936, roughness: 0.5, metalness: 0.1 })
    );
    artifact.position.set(-0.42, 0.45, 0.1);
    artifact.castShadow = true;
    group.add(artifact);
    return;
  }

  if (zone.type === "entrance") {
    const gateMaterial = new THREE.MeshStandardMaterial({ color: 0x26484f, roughness: 0.58 });
    const postA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), gateMaterial);
    const postB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), gateMaterial);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 0.12), gateMaterial);
    postA.position.set(-0.46, 0.48, 0.0);
    postB.position.set(0.46, 0.48, 0.0);
    top.position.set(0, 0.86, 0.0);
    group.add(postA, postB, top);
    return;
  }

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x503a29, roughness: 0.7 });
  const art = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.52, 0.08), frameMaterial);
  art.position.set(-0.42, 0.58, -0.18);
  art.castShadow = true;
  group.add(art);
}

function updateScene() {
  const devicesById = new Map(deviceState.devices.map((device) => [device.deviceId, device]));

  for (const definition of zoneDefinitions) {
    const device = devicesById.get(definition.id);
    const objects = sceneObjects.get(definition.id);
    const status = statusForDevice(device);
    const color = colorForStatus(status);
    const battery = device?.telemetry?.battery;
    const hasDevice = Boolean(device);
    const isSelected = definition.id === deviceState.selectedDeviceId;
    const motion = Boolean(device?.telemetry?.motion);
    const hasBatteryWarning = typeof battery === "number" && battery <= 20;
    const batteryDead = typeof battery === "number" && battery <= 0;

    objects.currentStatus = status;
    objects.sensor.material.color.setHex(color);
    objects.sensor.material.emissive.setHex(status === "offline" ? 0x2a2a2a : color);
    objects.sensor.material.emissiveIntensity = status === "normal" ? 0.35 : 0.72;
    objects.base.material.color.setHex(status === "offline" ? 0xd8dcdd : 0xf7f2e8);
    objects.ring.material.opacity = isSelected ? 0.92 : 0;
    objects.ring.material.color.setHex(status === "offline" ? 0xd8dcdd : palette.selected);
    objects.batteryLabel.visible = hasDevice && (hasBatteryWarning || status === "offline");
    setSpriteText(
      objects.batteryLabel,
      batteryDead ? "BATTERY EMPTY" : status === "offline" ? "SENSOR OFFLINE" : `BATTERY ${battery}%`,
      batteryDead || status === "offline" ? "rgba(170, 177, 181, 0.99)" : "rgba(255, 204, 77, 0.98)"
    );
    setSpriteText(objects.detailLabel, detailTextForDevice(device, status), "rgba(255, 255, 255, 0.84)");
    objects.lightCone.material.opacity =
      status === "light" || status === "critical" ? 0.52 : definition.type === "exhibit" ? 0.25 : 0.08;
    objects.lightCone.material.color.setHex(status === "critical" ? palette.critical : 0xffc83d);
    objects.motionPulse.material.opacity = motion ? 0.72 : 0;
  }

  renderLegend(devicesById);
  updateTopLabels(devicesById);
}

function updateTopLabels(devicesById) {
  const selectedDevice =
    devicesById.get(deviceState.selectedDeviceId) || deviceState.devices[0] || null;

  if (!selectedDevice) {
    selectedLabel.textContent = "Waiting for telemetry";
    riskLabel.textContent = "No 3D data yet";
    return;
  }

  selectedLabel.textContent = selectedDevice.name || selectedDevice.deviceId;
  riskLabel.textContent = `${labelForStatus(statusForDevice(selectedDevice))} / battery ${
    selectedDevice.telemetry?.battery ?? "-"
  }%`;
}

function renderLegend(devicesById) {
  if (!zoneLegend) return;

  zoneLegend.innerHTML = zoneDefinitions
    .map((zone) => {
      const device = devicesById.get(zone.id);
      const status = statusForDevice(device);
      const selected = zone.id === deviceState.selectedDeviceId ? "selected" : "";
      const battery = device?.telemetry?.battery;
      const online = device?.connection?.online;

      return `
        <button class="zone-chip ${selected}" data-zone-id="${zone.id}">
          <span class="zone-dot" style="background: #${colorForStatus(status).toString(16).padStart(6, "0")}"></span>
          <strong>${zone.label}</strong>
          <small>${labelForStatus(status)} | battery ${battery ?? "-"}% | ${online ? "online" : "offline"}</small>
        </button>
      `;
    })
    .join("");

  zoneLegend.querySelectorAll("[data-zone-id]").forEach((chip) => {
    chip.addEventListener("click", () => selectDevice(chip.dataset.zoneId));
  });
}

function statusForDevice(device) {
  if (!device || !device.connection?.online) return "offline";

  const alerts = device.alerts || [];
  if (alerts.some((alert) => alert.level === "critical" && alert.code !== "HIGH_LIGHT_EXPOSURE")) return "critical";
  if (alerts.some((alert) => alert.code === "HIGH_LIGHT_EXPOSURE")) return "light";
  if (alerts.some((alert) => alert.code === "HIGH_HUMIDITY" || alert.code === "LOW_HUMIDITY")) return "humidity";
  if (alerts.length > 0) return "warning";
  return "normal";
}

function colorForStatus(status) {
  return palette[status] || palette.warning;
}

function labelForStatus(status) {
  const labels = {
    normal: "normal",
    warning: "warning",
    humidity: "humidity risk",
    light: "light exposure risk",
    critical: "critical risk",
    offline: "sensor offline"
  };

  return labels[status] || "attention";
}

function detailTextForDevice(device, status) {
  if (!device) return "waiting";

  const temp = metric(device.telemetry?.temperature, "C");
  const humidity = metric(device.telemetry?.humidity, "%");
  const battery = metric(device.telemetry?.battery, "%");
  return `${labelForStatus(status)} | ${temp} | ${humidity} | ${battery}`;
}

function metric(value, suffix) {
  if (value === null || value === undefined) return "-";
  return `${value}${suffix}`;
}

function createTextSprite(text, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width || 320;
  canvas.height = options.height || 90;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);

  sprite.userData = {
    canvas,
    texture,
    options,
    text: ""
  };
  setSpriteText(sprite, text, options.background);
  return sprite;
}

function setSpriteText(sprite, text, background) {
  if (!sprite || sprite.userData.text === text && sprite.userData.background === background) return;

  const { canvas, texture, options } = sprite.userData;
  const context = canvas.getContext("2d");
  const radius = 26;

  context.clearRect(0, 0, canvas.width, canvas.height);
  roundedRect(context, 8, 8, canvas.width - 16, canvas.height - 16, radius);
  context.fillStyle = background || options.background || "rgba(255, 255, 255, 0.86)";
  context.fill();
  context.fillStyle = options.color || "#102027";
  context.font = `800 ${options.fontSize || 34}px Trebuchet MS, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1, canvas.width - 34);

  texture.needsUpdate = true;
  sprite.userData.text = text;
  sprite.userData.background = background;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function handleCanvasClick(event) {
  const hit = raycast(event);
  if (!hit?.object?.userData?.deviceId) return;

  selectDevice(hit.object.userData.deviceId);
}

function handlePointerMove(event) {
  const hit = raycast(event);
  canvas.style.cursor = hit?.object?.userData?.deviceId ? "pointer" : "default";
}

function raycast(event) {
  if (!camera) return null;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  return raycaster.intersectObjects(clickableObjects, false)[0] || null;
}

function selectDevice(deviceId) {
  document.dispatchEvent(
    new CustomEvent("museum3d:select", {
      detail: { deviceId }
    })
  );
}

function resize() {
  if (!renderer || !camera) return;

  const width = canvas.clientWidth || 900;
  const height = canvas.clientHeight || 520;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(time) {
  if (!renderer || !scene || !camera) return;

  const elapsed = clock.getElapsedTime();

  for (const [id, objects] of sceneObjects.entries()) {
    const device = deviceState.devices.find((item) => item.deviceId === id);
    const motion = Boolean(device?.telemetry?.motion);
    const status = objects.currentStatus;
    const pulse = 1 + Math.sin(elapsed * 4.4 + id.length) * 0.045;

    objects.sensor.scale.setScalar(status === "normal" ? 1 : pulse);
    objects.ring.rotation.z += 0.01;
    objects.motionPulse.scale.setScalar(motion ? 1 + Math.sin(elapsed * 5) * 0.25 : 1);
    objects.lightCone.rotation.z = Math.sin(elapsed * 0.8 + id.length) * 0.06;
  }

  museumGroup.rotation.y = Math.sin(elapsed * 0.15) * 0.03;
  camera.position.x = Math.sin(elapsed * 0.1) * 0.2;
  camera.lookAt(0, 0.5, 0);
  renderer.render(scene, camera);
}
