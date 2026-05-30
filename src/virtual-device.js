const mqtt = require("mqtt");

const deviceId = process.argv[2] || "gallery-1";
const MQTT_URL = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
const DEVICE_PROFILE = process.env.DEVICE_PROFILE || profileForDevice(deviceId);
const BATTERY_SHUTDOWN = parseBoolean(process.env.BATTERY_SHUTDOWN);
const BATTERY_DRAIN_STEP = Number(process.env.BATTERY_DRAIN_STEP || 20);
const BATTERY_START = Number(process.env.BATTERY_START || 100);

let led = false;
let messageCounter = 0;
let telemetryTimer = null;
let battery = BATTERY_START;
let batteryDepleted = false;
let temperature = randomBetween(profile().temperatureMin, profile().temperatureMax);
let humidity = randomBetween(profile().humidityMin, profile().humidityMax);
let light = randomBetween(profile().lightMin, profile().lightMax);
let motion = false;

const client = mqtt.connect(MQTT_URL, {
  clientId: `${deviceId}-${Math.random().toString(16).slice(2)}`
});

function randomBetween(min, max) {
  return Number((min + Math.random() * (max - min)).toFixed(1));
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
      temperatureMin: 21,
      temperatureMax: 24,
      humidityMin: 42,
      humidityMax: 52,
      lightMin: 260,
      lightMax: 520,
      motionChance: 0.05
    },
    archive: {
      name: `Archive Zone ${deviceId}`,
      type: "museum-archive-sensor",
      temperatureMin: 18.5,
      temperatureMax: 22,
      humidityMin: 61,
      humidityMax: 68,
      lightMin: 120,
      lightMax: 300,
      motionChance: 0.03
    },
    exhibit: {
      name: `Exhibit Case ${deviceId}`,
      type: "museum-exhibit-sensor",
      temperatureMin: 25.5,
      temperatureMax: 28.2,
      humidityMin: 36,
      humidityMax: 48,
      lightMin: 820,
      lightMax: 950,
      motionChance: 0.08
    },
    entrance: {
      name: `Entrance Access ${deviceId}`,
      type: "museum-access-sensor",
      temperatureMin: 20,
      temperatureMax: 24,
      humidityMin: 35,
      humidityMax: 48,
      lightMin: 180,
      lightMax: 450,
      motionChance: 0.65
    }
  };

  return profiles[DEVICE_PROFILE] || profiles.gallery;
}

function drift(value, min, max, step) {
  const next = value + randomBetween(-step, step);
  return Number(Math.min(max, Math.max(min, next)).toFixed(1));
}

function publishStatus(online, callback) {
  client.publish(
    `iot/devices/${deviceId}/status`,
    JSON.stringify({
      deviceId,
      name: profile().name,
      type: profile().type,
      online
    }),
    { retain: false },
    callback
  );
}

function nextBatteryLevel() {
  if (BATTERY_SHUTDOWN) {
    battery = Math.max(0, battery - BATTERY_DRAIN_STEP);
    return battery;
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

  temperature = drift(temperature, 18, 35, 0.7);
  humidity = drift(humidity, 30, 75, 1.4);
  light = drift(light, 60, 980, 38);
  motion = Math.random() < profile().motionChance;
  messageCounter += 1;
  const currentBattery = nextBatteryLevel();

  const telemetry = {
    deviceId,
    name: profile().name,
    type: profile().type,
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
