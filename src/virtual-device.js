const mqtt = require("mqtt");

const deviceId = process.argv[2] || "gallery-1";
const MQTT_URL = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
const DEVICE_PROFILE = process.env.DEVICE_PROFILE || profileForDevice(deviceId);
const BATTERY_SHUTDOWN = parseBoolean(process.env.BATTERY_SHUTDOWN);
const BATTERY_DRAIN_STEP = Number(process.env.BATTERY_DRAIN_STEP || 20);
const BATTERY_START = Number(process.env.BATTERY_START || 100);

let rngSeed = hashString(deviceId);
let led = false;
let messageCounter = 0;
let telemetryTimer = null;
let battery = BATTERY_START;
let batteryDepleted = false;
let temperature = scenarioValue(profile().temperature);
let humidity = scenarioValue(profile().humidity);
let light = scenarioValue(profile().light);
let motion = false;

const client = mqtt.connect(MQTT_URL, {
  clientId: `${deviceId}-${Math.random().toString(16).slice(2)}`
});

function hashString(value) {
  let hash = 2166136261;

  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom() {
  rngSeed = (Math.imul(rngSeed, 1664525) + 1013904223) >>> 0;
  return rngSeed / 4294967296;
}

function randomBetween(min, max) {
  return Number((min + seededRandom() * (max - min)).toFixed(1));
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function profileForDevice(id) {
  if (id.includes("gallery") || id.includes("room-1")) return "gallery";
  if (id.includes("archive") || id.includes("room-2")) return "archive";
  if (id.includes("exhibit") || id.includes("lab")) return "exhibit";
  if (id.includes("entrance") || id.includes("door")) return "entrance";
  if (id.includes("battery")) return "gallery";
  return "gallery";
}

function profile() {
  const profiles = {
    gallery: {
      name: `Gallery Zone ${deviceId}`,
      type: "museum-gallery-sensor",
      conservationProfile: "mixedCollection",
      temperature: { base: 21, amplitude: 0.8, noise: 0.2, min: 19.8, max: 22.4, period: 8, phase: 1 },
      humidity: { base: 50, amplitude: 2.4, noise: 0.4, min: 46, max: 54, period: 10, phase: 2 },
      light: { base: 125, amplitude: 22, noise: 4, min: 80, max: 155, period: 9, phase: 3 },
      motionChance: 0.04,
      simulationBasis: "CCI mixed museum profile: 15-25C, about 50% RH, low display light."
    },
    archive: {
      name: `Archive Zone ${deviceId}`,
      type: "museum-archive-sensor",
      conservationProfile: "archivePaper",
      temperature: { base: 18.5, amplitude: 0.9, noise: 0.2, min: 17.2, max: 20.2, period: 12, phase: 2 },
      humidity: { base: 57, amplitude: 4.2, noise: 0.5, min: 52, max: 64, period: 9, phase: 4 },
      light: { base: 45, amplitude: 10, noise: 3, min: 25, max: 70, period: 11, phase: 1 },
      motionChance: 0.02,
      simulationBasis: "Archive profile intentionally exceeds the 30-50% RH target to create a paper-storage humidity risk."
    },
    exhibit: {
      name: `Exhibit Case ${deviceId}`,
      type: "museum-exhibit-sensor",
      conservationProfile: "sensitiveOrganic",
      temperature: { base: 24.8, amplitude: 1.0, noise: 0.2, min: 23.8, max: 26.4, period: 10, phase: 0 },
      humidity: { base: 50, amplitude: 2.2, noise: 0.4, min: 46, max: 54, period: 8, phase: 5 },
      light: { base: 74, amplitude: 14, noise: 4, min: 52, max: 96, period: 7, phase: 2 },
      motionChance: 0.06,
      simulationBasis: "Sensitive exhibit profile uses a 50 lux light limit; readings intentionally exceed it."
    },
    entrance: {
      name: `Entrance Access ${deviceId}`,
      type: "museum-access-sensor",
      conservationProfile: "accessMonitoring",
      temperature: { base: 21.5, amplitude: 1.1, noise: 0.2, min: 19.5, max: 23.7, period: 7, phase: 3 },
      humidity: { base: 45, amplitude: 3.5, noise: 0.5, min: 38, max: 52, period: 8, phase: 1 },
      light: { base: 135, amplitude: 24, noise: 5, min: 85, max: 180, period: 6, phase: 4 },
      motionChance: 0.58,
      simulationBasis: "Entrance profile focuses on access activity while keeping environmental values near a mixed collection range."
    }
  };

  return profiles[DEVICE_PROFILE] || profiles.gallery;
}

function scenarioValue(metricProfile) {
  const wave = Math.sin((messageCounter + metricProfile.phase) / metricProfile.period);
  const noise = randomBetween(-metricProfile.noise, metricProfile.noise);
  const next = metricProfile.base + wave * metricProfile.amplitude + noise;

  return Number(Math.min(metricProfile.max, Math.max(metricProfile.min, next)).toFixed(1));
}

function publishStatus(online, callback) {
  client.publish(
    `iot/devices/${deviceId}/status`,
    JSON.stringify({
      deviceId,
      name: profile().name,
      type: profile().type,
      conservationProfile: profile().conservationProfile,
      online
    }),
    { retain: false },
    callback
  );
}

function nextBatteryLevel() {
  if (BATTERY_SHUTDOWN) {
    const currentBattery = battery;
    battery = Math.max(0, battery - BATTERY_DRAIN_STEP);
    return currentBattery;
  }

  return Math.max(5, 100 - Math.floor(messageCounter / 5));
}

function shutdownBecauseBatteryEnded() {
  if (batteryDepleted) return;

  batteryDepleted = true;
  clearInterval(telemetryTimer);
  console.log(`[${deviceId}] battery depleted. Sending offline status and stopping telemetry.`);
  publishStatus(false, () => {
    client.end(false, () => process.exit(0));
  });
}

function publishTelemetry() {
  if (batteryDepleted) return;

  messageCounter += 1;
  temperature = scenarioValue(profile().temperature);
  humidity = scenarioValue(profile().humidity);
  light = scenarioValue(profile().light);
  motion = seededRandom() < profile().motionChance;
  const currentBattery = nextBatteryLevel();

  const telemetry = {
    deviceId,
    name: profile().name,
    type: profile().type,
    conservationProfile: profile().conservationProfile,
    simulationBasis: profile().simulationBasis,
    temperature,
    humidity,
    light: Math.round(light),
    motion,
    led,
    battery: currentBattery,
    sequence: messageCounter,
    sentAt: new Date().toISOString()
  };

  client.publish(`iot/devices/${deviceId}/telemetry`, JSON.stringify(telemetry), () => {
    if (BATTERY_SHUTDOWN && currentBattery <= 0) {
      shutdownBecauseBatteryEnded();
    }
  });
  console.log(`[${deviceId}] telemetry`, telemetry);
}

client.on("connect", () => {
  console.log(`[${deviceId}] connected to ${MQTT_URL}`);
  publishStatus(true);
  client.subscribe(`iot/devices/${deviceId}/commands`);
  publishTelemetry();
  telemetryTimer = setInterval(publishTelemetry, 3000);
});

client.on("message", (topic, message) => {
  try {
    const command = JSON.parse(message.toString("utf8"));

    if (typeof command.led === "boolean") {
      led = command.led;
      console.log(`[${deviceId}] actuator changed to ${led ? "ON" : "OFF"}`);
      publishTelemetry();
    }
  } catch (error) {
    console.log(`[${deviceId}] invalid command`, error.message);
  }
});

process.on("SIGINT", () => {
  publishStatus(false);
  client.end(true, () => process.exit(0));
});
