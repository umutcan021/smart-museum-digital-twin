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
  temperatureHigh: Number(process.env.TEMPERATURE_HIGH || 26),
  humidityHigh: Number(process.env.HUMIDITY_HIGH || 60),
  humidityLow: Number(process.env.HUMIDITY_LOW || 35),
  lightHigh: Number(process.env.LIGHT_HIGH || 800),
  batteryLow: Number(process.env.BATTERY_LOW || 20)
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
      alerts: [],
      history: [],
      createdAt: timestamp(),
      updatedAt: timestamp()
    });
  }

  const twin = twins.get(deviceId);

  if (metadata.name) twin.name = metadata.name;
  if (metadata.type) twin.type = metadata.type;

  return twin;
}

function emitTwins() {
  io.emit("twins:update", getAllTwins());
}

function buildAlerts(twin) {
  const alerts = [];
  const telemetry = twin.telemetry || {};
  const now = timestamp();

  if (!twin.connection.online) {
    alerts.push({
      code: "DEVICE_OFFLINE",
      level: "warning",
      message: twin.connection.offlineReason || "Device is offline",
      at: now
    });
  }

  if (
    typeof telemetry.temperature === "number" &&
    telemetry.temperature >= ALERT_THRESHOLDS.temperatureHigh
  ) {
    alerts.push({
      code: "HIGH_TEMPERATURE",
      level: "critical",
      message: `Temperature is ${telemetry.temperature}C`,
      at: telemetry.receivedAt || now
    });
  }

  if (typeof telemetry.humidity === "number" && telemetry.humidity >= ALERT_THRESHOLDS.humidityHigh) {
    alerts.push({
      code: "HIGH_HUMIDITY",
      level: "warning",
      message: `Humidity is ${telemetry.humidity}%`,
      at: telemetry.receivedAt || now
    });
  }

  if (typeof telemetry.humidity === "number" && telemetry.humidity <= ALERT_THRESHOLDS.humidityLow) {
    alerts.push({
      code: "LOW_HUMIDITY",
      level: "warning",
      message: `Humidity is ${telemetry.humidity}%`,
      at: telemetry.receivedAt || now
    });
  }

  if (typeof telemetry.light === "number" && telemetry.light >= ALERT_THRESHOLDS.lightHigh) {
    alerts.push({
      code: "HIGH_LIGHT_EXPOSURE",
      level: "critical",
      message: `Light exposure is ${telemetry.light} lx`,
      at: telemetry.receivedAt || now
    });
  }

  if (telemetry.motion === true) {
    alerts.push({
      code: "MOTION_DETECTED",
      level: "warning",
      message: "Motion/access activity detected",
      at: telemetry.receivedAt || now
    });
  }

  if (typeof telemetry.battery === "number" && telemetry.battery <= ALERT_THRESHOLDS.batteryLow) {
    alerts.push({
      code: "LOW_BATTERY",
      level: "warning",
      message: `Battery is ${telemetry.battery}%`,
      at: telemetry.receivedAt || now
    });
  }

  if (
    twin.reported.led !== null &&
    typeof twin.desired.led === "boolean" &&
    twin.desired.led !== twin.reported.led
  ) {
    alerts.push({
      code: "STATE_SYNC_PENDING",
      level: "info",
      message: "Desired actuator state has not been reported by the device yet",
      at: twin.sync.lastCommandAt || now
    });
  }

  return alerts;
}

function updateTwinDerivedState(twin, nowMs = Date.now()) {
  const previous = JSON.stringify({
    connection: twin.connection,
    sync: twin.sync,
    alerts: twin.alerts
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

  twin.alerts = buildAlerts(twin);

  return (
    previous !==
    JSON.stringify({
      connection: twin.connection,
      sync: twin.sync,
      alerts: twin.alerts
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
    (device.alerts || []).map((alert) => ({
      deviceId: device.deviceId,
      deviceName: device.name,
      ...alert
    }))
  );

  return {
    generatedAt: timestamp(),
    totalDevices: devices.length,
    onlineDevices: devices.filter((device) => device.connection.online).length,
    offlineDevices: devices.filter((device) => !device.connection.online).length,
    alertCount: alerts.length,
    alerts,
    thresholds: ALERT_THRESHOLDS,
    timeoutSeconds: Math.round(DEVICE_TIMEOUT_MS / 1000)
  };
}

function applyTelemetry(deviceId, payload) {
  const now = timestamp();
  const twin = ensureTwin(deviceId, {
    name: payload.name,
    type: payload.type
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
    type: payload.type
  });

  twin.connection.reportedOnline = payload.online !== false;
  twin.connection.protocol = "mqtt";
  twin.connection.lastMessageAt = now;
  twin.updatedAt = now;

  updateTwinDerivedState(twin);
  emitTwins();
}

function publishCommand(deviceId, command) {
  const now = timestamp();
  const twin = ensureTwin(deviceId);
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
  const twin = publishCommand(req.params.deviceId, command);

  res.json({
    ok: true,
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
      const twin = publishCommand(segments[1], command);

      sendCoapJson(res, "2.04", {
        ok: true,
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
