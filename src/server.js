const http = require("http");
const net = require("net");
const path = require("path");

const aedes = require("aedes")();
const coap = require("coap");
const express = require("express");
const mqtt = require("mqtt");
const { Server } = require("socket.io");

const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);
const COAP_PORT = Number(process.env.COAP_PORT || 5683);
const DEVICE_TIMEOUT_MS = Number(process.env.DEVICE_TIMEOUT_MS || 12000);
const STATUS_SWEEP_INTERVAL_MS = Number(process.env.STATUS_SWEEP_INTERVAL_MS || 2000);

const ALERT_THRESHOLDS = {
  temperatureHigh: Number(process.env.TEMPERATURE_HIGH || 25),
  humidityHigh: Number(process.env.HUMIDITY_HIGH || 55),
  humidityLow: Number(process.env.HUMIDITY_LOW || 45),
  lightHigh: Number(process.env.LIGHT_HIGH || 150),
  batteryLow: Number(process.env.BATTERY_LOW || 20)
};

const CONSERVATION_PROFILES = {
  mixedCollection: {
    id: "mixedCollection",
    label: "Mixed museum collection",
    temperature: { min: 15, target: 21, max: 25, severeHigh: 30 },
    humidity: { min: 45, target: 50, max: 55, damp: 65 },
    light: { maxLux: 150, severeLux: 300 },
    sources: [
      "CCI incorrect RH: general museums, galleries, libraries and archives use 50% RH and 15-25C as a design range.",
      "CCI basic care of books: display/store books at maximum 150 lux."
    ]
  },
  archivePaper: {
    id: "archivePaper",
    label: "Archive and paper storage",
    temperature: { min: 10, target: 18, max: 25, severeHigh: 30 },
    humidity: { min: 30, target: 40, max: 50, damp: 65 },
    light: { maxLux: 150, severeLux: 300 },
    sources: [
      "CCI incorrect RH: cool archive storage benefits from 30-50% RH.",
      "CCI basic care of books: light damage is cumulative; maximum 150 lux for books."
    ]
  },
  sensitiveOrganic: {
    id: "sensitiveOrganic",
    label: "Light-sensitive organic exhibit",
    temperature: { min: 15, target: 21, max: 25, severeHigh: 30 },
    humidity: { min: 45, target: 50, max: 55, damp: 65 },
    light: { maxLux: 50, severeLux: 150 },
    sources: [
      "CCI mounted specimens and pelts: recommended RH is 45-55%, avoid temperatures above 25C.",
      "CCI mounted specimens and pelts: light-sensitive fur and feathers should not exceed 50 lux."
    ]
  },
  accessMonitoring: {
    id: "accessMonitoring",
    label: "Entrance access monitoring",
    temperature: { min: 15, target: 21, max: 25, severeHigh: 30 },
    humidity: { min: 35, target: 45, max: 60, damp: 65 },
    light: { maxLux: 150, severeLux: 300 },
    sources: [
      "CCI incorrect RH: RH control is handled as risk management for the collection type.",
      "Access motion is treated as a security/reliability signal rather than a conservation standard."
    ]
  }
};

const MQTT_URL = `mqtt://127.0.0.1:${MQTT_PORT}`;
const twins = new Map();

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use("/vendor/three", express.static(path.join(__dirname, "..", "node_modules", "three", "build")));
app.use(express.static(path.join(__dirname, "..", "public")));

function timestamp() {
  return new Date().toISOString();
}

function cloneTwin(twin) {
  return JSON.parse(JSON.stringify(twin));
}

function getAllTwins() {
  refreshAllTwins();
  return [...twins.values()].map(cloneTwin);
}

function ensureTwin(deviceId, metadata = {}) {
  if (!twins.has(deviceId)) {
    twins.set(deviceId, {
      deviceId,
      name: metadata.name || deviceId,
      type: metadata.type || "unknown",
      conservationProfile: metadata.conservationProfile || null,
      connection: {
        online: false,
        protocol: "mqtt",
        lastMessageAt: null,
        ageSeconds: null,
        reportedOnline: false,
        offlineReason: "No messages received yet"
      },
      telemetry: {},
      desired: {
        led: false
      },
      reported: {
        led: null
      },
      sync: {
        state: "waiting-for-telemetry",
        lastCommandAt: null,
        lastReportedAt: null
      },
      decisionSupport: {
        engine: "rule-based conservation decision support",
        score: 0,
        riskLevel: "Waiting",
        recommendedAction: "Waiting for telemetry.",
        factors: []
      },
      alerts: [],
      history: [],
      createdAt: timestamp(),
      updatedAt: timestamp()
    });
  }

  const twin = twins.get(deviceId);

  if (metadata.name) twin.name = metadata.name;
  if (metadata.type) twin.type = metadata.type;
  if (metadata.conservationProfile) twin.conservationProfile = metadata.conservationProfile;

  return twin;
}

function emitTwins() {
  io.emit("twins:update", getAllTwins());
}

function conservationProfileForTwin(twin) {
  const explicitProfile = String(
    twin.conservationProfile || twin.telemetry?.conservationProfile || ""
  ).trim();

  if (CONSERVATION_PROFILES[explicitProfile]) {
    return CONSERVATION_PROFILES[explicitProfile];
  }

  const type = String(twin.type || "").toLowerCase();
  const deviceId = String(twin.deviceId || "").toLowerCase();

  if (type.includes("archive") || deviceId.includes("archive")) return CONSERVATION_PROFILES.archivePaper;
  if (type.includes("exhibit") || deviceId.includes("exhibit")) return CONSERVATION_PROFILES.sensitiveOrganic;
  if (type.includes("access") || deviceId.includes("entrance") || deviceId.includes("door")) {
    return CONSERVATION_PROFILES.accessMonitoring;
  }

  return CONSERVATION_PROFILES.mixedCollection;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rangeText(range, suffix) {
  return `${range.min}-${range.max}${suffix}`;
}

function riskLevelForScore(score) {
  if (score >= 75) return "Critical Risk";
  if (score >= 45) return "High Risk";
  if (score >= 20) return "Moderate Risk";
  return "Low Risk";
}

function addDecisionFactor(factors, factor) {
  factors.push({
    at: factor.at || timestamp(),
    score: factor.score,
    code: factor.code,
    level: factor.level,
    message: factor.message,
    recommendation: factor.recommendation
  });
}

function buildDecisionSupport(twin) {
  const telemetry = twin.telemetry || {};
  const profile = conservationProfileForTwin(twin);
  const factors = [];
  const now = timestamp();

  if (!twin.connection.online) {
    addDecisionFactor(factors, {
      code: "DEVICE_OFFLINE",
      level: "warning",
      score: 35,
      message: twin.connection.offlineReason || "Device is offline",
      recommendation: "Check sensor power, battery, and local network connectivity before trusting this zone.",
      at: now
    });
  }

  if (typeof telemetry.temperature === "number") {
    if (telemetry.temperature > profile.temperature.max) {
      const severe = telemetry.temperature >= profile.temperature.severeHigh;
      addDecisionFactor(factors, {
        code: "HIGH_TEMPERATURE",
        level: severe ? "critical" : "warning",
        score: clamp(Math.round((telemetry.temperature - profile.temperature.max) * 4) + 8, 8, severe ? 28 : 18),
        message: `Temperature is ${telemetry.temperature}C; target range is ${rangeText(profile.temperature, "C")}.`,
        recommendation: "Reduce heat load, inspect HVAC cooling, and avoid spotlight heat near objects.",
        at: telemetry.receivedAt || now
      });
    } else if (telemetry.temperature < profile.temperature.min) {
      addDecisionFactor(factors, {
        code: "LOW_TEMPERATURE",
        level: "warning",
        score: clamp(Math.round((profile.temperature.min - telemetry.temperature) * 3) + 6, 6, 16),
        message: `Temperature is ${telemetry.temperature}C; target range is ${rangeText(profile.temperature, "C")}.`,
        recommendation: "Avoid rapid temperature changes and verify that RH remains stable.",
        at: telemetry.receivedAt || now
      });
    }
  }

  if (typeof telemetry.humidity === "number") {
    if (telemetry.humidity >= profile.humidity.damp) {
      addDecisionFactor(factors, {
        code: "DAMP_MOULD_RISK",
        level: "critical",
        score: 30,
        message: `RH is ${telemetry.humidity}%; damp/mould danger threshold is ${profile.humidity.damp}%.`,
        recommendation: "Start dehumidification, inspect ventilation, and check for condensation or leaks.",
        at: telemetry.receivedAt || now
      });
    } else if (telemetry.humidity > profile.humidity.max) {
      addDecisionFactor(factors, {
        code: "HIGH_HUMIDITY",
        level: "warning",
        score: clamp(Math.round((telemetry.humidity - profile.humidity.max) * 2) + 8, 8, 22),
        message: `RH is ${telemetry.humidity}%; target range is ${rangeText(profile.humidity, "%")}.`,
        recommendation: "Lower RH gradually and inspect room ventilation or dehumidifier operation.",
        at: telemetry.receivedAt || now
      });
    } else if (telemetry.humidity < profile.humidity.min) {
      addDecisionFactor(factors, {
        code: "LOW_HUMIDITY",
        level: "warning",
        score: clamp(Math.round((profile.humidity.min - telemetry.humidity) * 2) + 8, 8, 22),
        message: `RH is ${telemetry.humidity}%; target range is ${rangeText(profile.humidity, "%")}.`,
        recommendation: "Increase humidity control gradually and avoid rapid RH swings.",
        at: telemetry.receivedAt || now
      });
    }
  }

  if (typeof telemetry.light === "number" && telemetry.light > profile.light.maxLux) {
    const severe = telemetry.light >= profile.light.severeLux;
    addDecisionFactor(factors, {
      code: "HIGH_LIGHT_EXPOSURE",
      level: severe ? "critical" : "warning",
      score: clamp(Math.round((telemetry.light - profile.light.maxLux) / 8) + 8, 8, severe ? 26 : 18),
      message: `Light is ${telemetry.light} lx; recommended maximum is ${profile.light.maxLux} lx for this zone.`,
      recommendation: "Reduce light level, shorten exposure time, and use protective lighting mode.",
      at: telemetry.receivedAt || now
    });
  }

  if (telemetry.motion === true) {
    addDecisionFactor(factors, {
      code: "MOTION_DETECTED",
      level: twin.type === "museum-access-sensor" ? "warning" : "info",
      score: twin.type === "museum-access-sensor" ? 8 : 5,
      message: "Motion/access activity detected.",
      recommendation: "Verify whether the movement is an expected access event.",
      at: telemetry.receivedAt || now
    });
  }

  if (typeof telemetry.battery === "number") {
    const criticalBattery = Math.max(5, Math.round(ALERT_THRESHOLDS.batteryLow * 0.25));

    if (telemetry.battery <= criticalBattery) {
      addDecisionFactor(factors, {
        code: "BATTERY_CRITICAL",
        level: "critical",
        score: 25,
        message: `Battery is ${telemetry.battery}%; sensor may stop reporting soon.`,
        recommendation: "Replace or recharge the sensor battery immediately.",
        at: telemetry.receivedAt || now
      });
    } else if (telemetry.battery <= ALERT_THRESHOLDS.batteryLow) {
      addDecisionFactor(factors, {
        code: "LOW_BATTERY",
        level: "warning",
        score: 12,
        message: `Battery is ${telemetry.battery}%; low battery threshold is ${ALERT_THRESHOLDS.batteryLow}%.`,
        recommendation: "Schedule battery replacement before telemetry is lost.",
        at: telemetry.receivedAt || now
      });
    }
  }

  if (
    twin.reported.led !== null &&
    typeof twin.desired.led === "boolean" &&
    twin.desired.led !== twin.reported.led
  ) {
    addDecisionFactor(factors, {
      code: "STATE_SYNC_PENDING",
      level: "info",
      score: 5,
      message: "Desired actuator state has not been reported by the device yet",
      recommendation: "Wait for the next telemetry report before assuming actuator state changed.",
      at: twin.sync.lastCommandAt || now
    });
  }

  const score = clamp(
    factors.reduce((total, factor) => total + factor.score, 0),
    0,
    100
  );
  const sortedFactors = [...factors].sort((a, b) => b.score - a.score);
  const primaryFactor = sortedFactors[0];

  return {
    engine: "rule-based conservation decision support",
    generatedAt: now,
    profile: {
      id: profile.id,
      label: profile.label
    },
    score,
    riskLevel: riskLevelForScore(score),
    recommendedAction: primaryFactor
      ? primaryFactor.recommendation
      : "Conditions are inside the selected conservation profile; continue monitoring.",
    explanation: primaryFactor
      ? sortedFactors.map((factor) => factor.message).join(" ")
      : "No active conservation or reliability risk factors were detected.",
    standards: {
      temperatureRangeC: rangeText(profile.temperature, "C"),
      relativeHumidityRange: rangeText(profile.humidity, "%"),
      dampMouldRiskAt: `${profile.humidity.damp}% RH`,
      lightMaxLux: profile.light.maxLux,
      batteryLowPercent: ALERT_THRESHOLDS.batteryLow,
      sources: profile.sources
    },
    factors: sortedFactors
  };
}

function buildAlerts(decisionSupport) {
  return (decisionSupport.factors || []).map((factor) => ({
    code: factor.code,
    level: factor.level,
    message: factor.message,
    recommendation: factor.recommendation,
    scoreContribution: factor.score,
    at: factor.at
  }));
}

function isRiskAlert(alert) {
  return ["critical", "warning"].includes(alert.level);
}

function updateTwinDerivedState(twin, nowMs = Date.now()) {
  const previous = JSON.stringify({
    connection: twin.connection,
    sync: twin.sync,
    alerts: twin.alerts,
    decisionSupport: twin.decisionSupport
  });
  const lastMessageMs = twin.connection.lastMessageAt
    ? Date.parse(twin.connection.lastMessageAt)
    : null;

  if (!lastMessageMs) {
    twin.connection.online = false;
    twin.connection.ageSeconds = null;
    twin.connection.offlineReason = "No messages received yet";
  } else {
    const ageMs = Math.max(0, nowMs - lastMessageMs);
    twin.connection.ageSeconds = Math.round(ageMs / 1000);

    if (twin.connection.reportedOnline === false) {
      twin.connection.online = false;
      twin.connection.offlineReason = "Device sent an offline status";
    } else if (ageMs > DEVICE_TIMEOUT_MS) {
      twin.connection.online = false;
      twin.connection.offlineReason = `No telemetry for ${twin.connection.ageSeconds}s`;
    } else {
      twin.connection.online = true;
      twin.connection.offlineReason = null;
    }
  }

  if (twin.reported.led === null) {
    twin.sync.state = "waiting-for-telemetry";
  } else if (twin.desired.led === twin.reported.led) {
    twin.sync.state = "synced";
  } else {
    twin.sync.state = "pending";
  }

  twin.decisionSupport = buildDecisionSupport(twin);
  twin.alerts = buildAlerts(twin.decisionSupport);

  return (
    previous !==
    JSON.stringify({
      connection: twin.connection,
      sync: twin.sync,
      alerts: twin.alerts,
      decisionSupport: twin.decisionSupport
    })
  );
}

function refreshAllTwins({ emitIfChanged = false } = {}) {
  let changed = false;

  for (const twin of twins.values()) {
    changed = updateTwinDerivedState(twin) || changed;
  }

  if (changed && emitIfChanged) {
    emitTwins();
  }
}

function getSummary() {
  const devices = getAllTwins();
  const alerts = devices.flatMap((device) =>
    (device.alerts || []).filter(isRiskAlert).map((alert) => ({
      deviceId: device.deviceId,
      deviceName: device.name,
      ...alert
    }))
  );
  const riskLevels = devices.reduce((levels, device) => {
    const level = device.decisionSupport?.riskLevel || "Waiting";
    levels[level] = (levels[level] || 0) + 1;
    return levels;
  }, {});

  return {
    generatedAt: timestamp(),
    totalDevices: devices.length,
    onlineDevices: devices.filter((device) => device.connection.online).length,
    offlineDevices: devices.filter((device) => !device.connection.online).length,
    alertCount: alerts.length,
    alerts,
    riskLevels,
    thresholds: ALERT_THRESHOLDS,
    decisionEngine: "rule-based conservation decision support",
    conservationProfiles: Object.fromEntries(
      Object.entries(CONSERVATION_PROFILES).map(([key, profile]) => [
        key,
        {
          label: profile.label,
          temperatureRangeC: rangeText(profile.temperature, "C"),
          relativeHumidityRange: rangeText(profile.humidity, "%"),
          lightMaxLux: profile.light.maxLux,
          sources: profile.sources
        }
      ])
    ),
    timeoutSeconds: Math.round(DEVICE_TIMEOUT_MS / 1000)
  };
}

function applyTelemetry(deviceId, payload) {
  const now = timestamp();
  const twin = ensureTwin(deviceId, {
    name: payload.name,
    type: payload.type,
    conservationProfile: payload.conservationProfile
  });

  twin.connection.online = true;
  twin.connection.protocol = "mqtt";
  twin.connection.lastMessageAt = now;
  twin.connection.reportedOnline = true;
  twin.telemetry = {
    ...payload,
    receivedAt: now
  };

  if (typeof payload.led === "boolean") {
    twin.reported.led = payload.led;
    twin.sync.lastReportedAt = now;
  }

  twin.history.unshift({
    at: now,
    telemetry: twin.telemetry
  });
  twin.history = twin.history.slice(0, 20);
  twin.updatedAt = now;

  updateTwinDerivedState(twin);
  emitTwins();
}

function applyStatus(deviceId, payload) {
  const now = timestamp();
  const twin = ensureTwin(deviceId, {
    name: payload.name,
    type: payload.type,
    conservationProfile: payload.conservationProfile
  });

  twin.connection.reportedOnline = payload.online !== false;
  twin.connection.protocol = "mqtt";
  twin.connection.lastMessageAt = now;
  twin.updatedAt = now;

  updateTwinDerivedState(twin);
  emitTwins();
}

function validateControlCommand(deviceId, command) {
  const twin = twins.get(deviceId);

  if (!twin) {
    return {
      httpStatus: 404,
      coapCode: "4.04",
      error: "Device not found"
    };
  }

  updateTwinDerivedState(twin);

  if (typeof command.led !== "boolean") {
    return {
      httpStatus: 400,
      coapCode: "4.00",
      error: "Unsupported control command",
      expected: {
        led: "boolean"
      },
      twin: cloneTwin(twin)
    };
  }

  if (!twin.connection.online) {
    return {
      httpStatus: 409,
      coapCode: "4.09",
      error: "Device is offline; actuator command was not sent",
      reason: twin.connection.offlineReason || "Device is offline",
      twin: cloneTwin(twin)
    };
  }

  return null;
}

function controlRejectionPayload(rejection) {
  return {
    ok: false,
    error: rejection.error,
    reason: rejection.reason,
    expected: rejection.expected,
    twin: rejection.twin
  };
}

function publishCommand(deviceId, command) {
  const now = timestamp();
  const twin = twins.get(deviceId);
  const normalizedCommand = {
    ...command,
    sentAt: now
  };

  if (typeof command.led === "boolean") {
    twin.desired.led = command.led;
    twin.sync.lastCommandAt = now;
  }

  twin.updatedAt = now;
  updateTwinDerivedState(twin);
  mqttClient.publish(
    `iot/devices/${deviceId}/commands`,
    JSON.stringify(normalizedCommand),
    { qos: 0 }
  );

  emitTwins();
  return cloneTwin(twin);
}

function parseJson(buffer, fallback = {}) {
  try {
    const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (error) {
    return {
      ...fallback,
      parseError: error.message
    };
  }
}

const mqttBroker = net.createServer(aedes.handle);

mqttBroker.listen(MQTT_PORT, () => {
  console.log(`[MQTT] Broker listening on mqtt://localhost:${MQTT_PORT}`);
});

const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: "digital-twin-server"
});

mqttClient.on("connect", () => {
  console.log("[MQTT] Digital twin service connected to local broker");
  mqttClient.subscribe(["iot/devices/+/telemetry", "iot/devices/+/status"]);
});

mqttClient.on("message", (topic, message) => {
  const parts = topic.split("/");
  const deviceId = parts[2];
  const messageType = parts[3];
  const payload = parseJson(message);

  if (!deviceId) return;

  if (messageType === "telemetry") {
    applyTelemetry(deviceId, payload);
  }

  if (messageType === "status") {
    applyStatus(deviceId, payload);
  }
});

app.get("/api/devices", (req, res) => {
  res.json(getAllTwins());
});

app.get("/api/devices/:deviceId", (req, res) => {
  const twin = twins.get(req.params.deviceId);

  if (!twin) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  updateTwinDerivedState(twin);
  res.json(cloneTwin(twin));
});

app.get("/api/summary", (req, res) => {
  res.json(getSummary());
});

app.post("/api/devices/:deviceId/control", (req, res) => {
  const command = req.body || {};
  const rejection = validateControlCommand(req.params.deviceId, command);

  if (rejection) {
    res.status(rejection.httpStatus).json(controlRejectionPayload(rejection));
    return;
  }

  const twin = publishCommand(req.params.deviceId, command);

  res.json({
    ok: true,
    status: "Command sent; waiting for device report",
    command,
    twin
  });
});

io.on("connection", (socket) => {
  socket.emit("twins:update", getAllTwins());
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Dashboard listening on http://localhost:${HTTP_PORT}`);
});

function sendCoapJson(res, code, payload) {
  res.code = code;
  res.setOption("Content-Format", "application/json");
  res.end(JSON.stringify(payload, null, 2));
}

function readCoapBody(req, callback) {
  if (req.payload) {
    callback(req.payload);
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => callback(Buffer.concat(chunks)));
}

const coapServer = coap.createServer((req, res) => {
  const method = req.method || "GET";
  const segments = (req.url || "/").split("?")[0].split("/").filter(Boolean);

  readCoapBody(req, (body) => {
    if (method === "GET" && segments.length === 1 && segments[0] === "devices") {
      sendCoapJson(res, "2.05", getAllTwins());
      return;
    }

    if (method === "GET" && segments.length === 1 && segments[0] === "summary") {
      sendCoapJson(res, "2.05", getSummary());
      return;
    }

    if (method === "GET" && segments.length === 2 && segments[0] === "devices") {
      const twin = twins.get(segments[1]);

      if (!twin) {
        sendCoapJson(res, "4.04", { error: "Device not found" });
        return;
      }

      updateTwinDerivedState(twin);
      sendCoapJson(res, "2.05", cloneTwin(twin));
      return;
    }

    if (
      method === "POST" &&
      segments.length === 3 &&
      segments[0] === "devices" &&
      segments[2] === "control"
    ) {
      const command = parseJson(body, {});
      const rejection = validateControlCommand(segments[1], command);

      if (rejection) {
        sendCoapJson(res, rejection.coapCode, controlRejectionPayload(rejection));
        return;
      }

      const twin = publishCommand(segments[1], command);

      sendCoapJson(res, "2.04", {
        ok: true,
        status: "Command sent; waiting for device report",
        command,
        twin
      });
      return;
    }

    sendCoapJson(res, "4.04", {
      error: "Unknown CoAP route",
      examples: [
        "GET coap://localhost/devices",
        "GET coap://localhost/summary",
        "GET coap://localhost/devices/gallery-1",
        "POST coap://localhost/devices/gallery-1/control"
      ]
    });
  });
});

coapServer.listen(COAP_PORT, () => {
  console.log(`[CoAP] Server listening on coap://localhost:${COAP_PORT}`);
});

setInterval(() => {
  refreshAllTwins({ emitIfChanged: true });
}, STATUS_SWEEP_INTERVAL_MS);

process.on("SIGINT", () => {
  console.log("\nShutting down IoT demo...");
  mqttClient.end(true);
  mqttBroker.close();
  coapServer.close();
  httpServer.close(() => process.exit(0));
});
