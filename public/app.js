const socket = io();

const state = {
  devices: [],
  selectedDeviceId: null,
  thresholds: {
    temperatureHigh: 26,
    humidityHigh: 60,
    humidityLow: 35,
    lightHigh: 800,
    batteryLow: 20
  }
};

const elements = {
  count: document.querySelector("#device-count"),
  onlineCount: document.querySelector("#online-count"),
  alertCount: document.querySelector("#alert-count"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryOnline: document.querySelector("#summary-online"),
  summaryOffline: document.querySelector("#summary-offline"),
  summaryAlerts: document.querySelector("#summary-alerts"),
  list: document.querySelector("#device-list"),
  refresh: document.querySelector("#refresh-button"),
  selectedTitle: document.querySelector("#selected-title"),
  selectedSummary: document.querySelector("#selected-summary"),
  syncBadge: document.querySelector("#sync-badge"),
  temp: document.querySelector("#metric-temp"),
  humidity: document.querySelector("#metric-humidity"),
  battery: document.querySelector("#metric-battery"),
  light: document.querySelector("#metric-light"),
  motion: document.querySelector("#metric-motion"),
  protocol: document.querySelector("#twin-protocol"),
  lastSeen: document.querySelector("#twin-last-seen"),
  desired: document.querySelector("#twin-desired"),
  reported: document.querySelector("#twin-reported"),
  riskScoreValue: document.querySelector("#risk-score-value"),
  riskScoreLabel: document.querySelector("#risk-score-label"),
  riskScoreReasons: document.querySelector("#risk-score-reasons"),
  scene: document.querySelector("#museum-scene"),
  sceneRiskLabel: document.querySelector("#scene-risk-label"),
  sceneZoneLabel: document.querySelector("#scene-zone-label"),
  sceneMotion: document.querySelector("#scene-motion"),
  sceneActuator: document.querySelector("#scene-actuator"),
  sceneLightBar: document.querySelector("#scene-light-bar"),
  sceneHumidityBar: document.querySelector("#scene-humidity-bar"),
  chart: document.querySelector("#telemetry-chart"),
  chartEmpty: document.querySelector("#chart-empty"),
  alerts: document.querySelector("#alert-list"),
  rawJson: document.querySelector("#raw-json"),
  ledOn: document.querySelector("#led-on"),
  ledOff: document.querySelector("#led-off")
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "not yet";

  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function boolText(value) {
  if (value === null || value === undefined) return "unknown";
  return value ? "ON" : "OFF";
}

function metric(value, suffix) {
  if (value === undefined || value === null) return "-";
  return `${value}${suffix}`;
}

function selectedDevice() {
  return state.devices.find((device) => device.deviceId === state.selectedDeviceId) || state.devices[0];
}

function allAlerts() {
  return state.devices.flatMap((device) =>
    (device.alerts || []).map((alert) => ({
      ...alert,
      deviceId: device.deviceId,
      deviceName: device.name
    }))
  );
}

function riskClassForDevice(device) {
  if (!device || !device.connection.online) return "risk-offline";

  const alerts = device.alerts || [];
  if (alerts.length === 0) return "risk-normal";
  if (alerts.some((alert) => alert.level === "critical")) return "risk-critical";
  if (alerts.some((alert) => alert.code === "HIGH_LIGHT_EXPOSURE")) return "risk-light";
  if (alerts.some((alert) => alert.code === "HIGH_HUMIDITY" || alert.code === "LOW_HUMIDITY")) {
    return "risk-humidity";
  }

  return "risk-warning";
}

function riskLabelForDevice(device) {
  const riskClass = riskClassForDevice(device);

  if (riskClass === "risk-normal") return "normal";
  if (riskClass === "risk-offline") return "offline";
  if (riskClass === "risk-critical") return "critical risk";
  if (riskClass === "risk-light") return "light risk";
  if (riskClass === "risk-humidity") return "humidity risk";
  return "attention needed";
}

function riskCountText(count) {
  if (count === 0) return "no active risk";
  if (count === 1) return "1 active risk";
  return `${count} active risks`;
}

function recommendedActionForAlert(alert) {
  switch (alert.code) {
    case "DEVICE_OFFLINE":
      return "Check sensor power source and local network connectivity for this zone.";
    case "LOW_BATTERY":
      return "Replace or recharge the sensor battery as soon as possible.";
    case "HIGH_HUMIDITY":
      return "Activate dehumidification and inspect room ventilation.";
    case "LOW_HUMIDITY":
      return "Increase humidity control and inspect humidifier operation.";
    case "HIGH_TEMPERATURE":
      return "Lower ambient temperature and verify HVAC cooling performance.";
    case "HIGH_LIGHT_EXPOSURE":
      return "Reduce light exposure level and apply protective lighting mode.";
    case "MOTION_DETECTED":
      return "Verify access event and check entrance security controls.";
    default:
      return "Inspect zone conditions and validate sensor readings.";
  }
}

function calculateRiskScore(device) {
  if (!device) {
    return { score: 0, label: "waiting", reasons: [] };
  }

  const telemetry = device.telemetry || {};
  const alerts = device.alerts || [];
  const thresholds = state.thresholds || {};
  const temperatureHigh = Number(thresholds.temperatureHigh ?? 26);
  const humidityHigh = Number(thresholds.humidityHigh ?? 60);
  const humidityLow = Number(thresholds.humidityLow ?? 35);
  const lightHigh = Number(thresholds.lightHigh ?? 800);
  const batteryLow = Number(thresholds.batteryLow ?? 20);
  let score = 0;
  const reasons = [];

  if (!device.connection?.online) {
    score += 35;
    reasons.push("Offline sensor (+35)");
  }
  if (typeof telemetry.battery === "number") {
    const batteryCritical = Math.max(5, Math.round(batteryLow * 0.25));
    if (telemetry.battery <= batteryCritical) {
      score += 25;
      reasons.push(`Battery critical <=${batteryCritical}% (+25)`);
    } else if (telemetry.battery <= batteryLow) {
      score += 12;
      reasons.push(`Battery low <=${batteryLow}% (+12)`);
    }
  }

  if (typeof telemetry.temperature === "number") {
    if (telemetry.temperature > temperatureHigh) {
      const tempPenalty = Math.min(18, Math.round((telemetry.temperature - temperatureHigh) * 3));
      score += tempPenalty;
      reasons.push(`High temperature (+${tempPenalty})`);
    }
  }

  if (typeof telemetry.humidity === "number") {
    if (telemetry.humidity > humidityHigh) {
      const humidityHighPenalty = Math.min(16, Math.round((telemetry.humidity - humidityHigh) * 1.6));
      score += humidityHighPenalty;
      reasons.push(`High humidity (+${humidityHighPenalty})`);
    } else if (telemetry.humidity < humidityLow) {
      const humidityLowPenalty = Math.min(16, Math.round((humidityLow - telemetry.humidity) * 1.6));
      score += humidityLowPenalty;
      reasons.push(`Low humidity (+${humidityLowPenalty})`);
    }
  }

  if (typeof telemetry.light === "number" && telemetry.light > lightHigh) {
    const lightPenalty = Math.min(16, Math.round((telemetry.light - lightHigh) / 40));
    score += lightPenalty;
    reasons.push(`High light exposure (+${lightPenalty})`);
  }

  if (telemetry.motion) {
    score += 8;
    reasons.push("Motion/access detected (+8)");
  }

  alerts.forEach((alert) => {
    if (alert.level === "critical") score += 10;
    else if (alert.level === "warning") score += 6;
    else score += 3;
  });
  if (alerts.length > 0) {
    reasons.push(`Alert severity contribution (${alerts.length} alert)`);
  }

  score = Math.max(0, Math.min(100, score));

  let label = "Low Risk";
  if (score >= 75) label = "Critical Risk";
  else if (score >= 45) label = "High Risk";
  else if (score >= 20) label = "Moderate Risk";

  return { score, label, reasons };
}

function percent(value, min, max) {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function humidityRiskPercent(value) {
  if (typeof value !== "number") return 0;

  if (value < 35) return percent(35 - value, 0, 25);
  if (value > 60) return percent(value - 60, 0, 25);

  return 0;
}

function renderSummary() {
  const online = state.devices.filter((device) => device.connection.online).length;
  const offline = state.devices.length - online;
  const alerts = allAlerts().length;

  elements.count.textContent = `${state.devices.length} zones`;
  elements.onlineCount.textContent = `${online} online`;
  elements.alertCount.textContent = `${alerts} active risks`;
  elements.summaryTotal.textContent = state.devices.length;
  elements.summaryOnline.textContent = online;
  elements.summaryOffline.textContent = offline;
  elements.summaryAlerts.textContent = alerts;
}

function renderDeviceList() {
  if (state.devices.length === 0) {
    elements.list.innerHTML = `
      <div class="device-card">
        <strong>No museum zones yet</strong>
        <small>Start virtual sensors in another terminal with <code>npm.cmd run devices:demo</code>.</small>
      </div>
    `;
    return;
  }

  elements.list.innerHTML = state.devices
    .map((device) => {
      const active = device.deviceId === state.selectedDeviceId ? "active" : "";
      const online = device.connection.online;
      const alertCount = (device.alerts || []).length;
      const riskClass = riskClassForDevice(device);

      return `
        <div class="device-card ${active} ${riskClass}" data-device-id="${escapeHtml(device.deviceId)}">
          <div class="device-topline">
            <strong>${escapeHtml(device.name || device.deviceId)}</strong>
            <span class="badge ${online ? "" : "offline"}">${online ? "online" : "offline"}</span>
          </div>
          <small>${escapeHtml(device.type)} | last message: ${formatDate(device.connection.lastMessageAt)}</small>
          <div class="device-meta">
            <span>${riskCountText(alertCount)}</span>
            <span>sync: ${escapeHtml(device.sync?.state || "unknown")}</span>
            <span>${escapeHtml(riskLabelForDevice(device))}</span>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-device-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedDeviceId = card.dataset.deviceId;
      render();
    });
  });
}

function renderAlerts(device) {
  const alerts = device?.alerts || [];

  if (alerts.length === 0) {
    elements.alerts.innerHTML = `<div class="alert-item ok">No active preservation risk for this zone.</div>`;
    return;
  }

  elements.alerts.innerHTML = alerts
    .map(
      (alert) => `
        <div class="alert-item ${escapeHtml(alert.level)}">
          <strong>${escapeHtml(alert.code)}</strong>
          <span>${escapeHtml(alert.message)}</span>
          <small>Recommended action: ${escapeHtml(recommendedActionForAlert(alert))}</small>
        </div>
      `
    )
    .join("");
}

function renderMuseumScene(device) {
  if (!device) {
    elements.scene.className = "museum-scene risk-waiting";
    elements.sceneRiskLabel.textContent = "waiting";
    elements.sceneZoneLabel.textContent = "No zone selected";
    elements.sceneMotion.classList.remove("active");
    elements.sceneActuator.classList.remove("active");
    elements.sceneLightBar.style.width = "0%";
    elements.sceneHumidityBar.style.width = "0%";
    return;
  }

  const riskClass = riskClassForDevice(device);
  const light = device.telemetry.light;
  const humidity = device.telemetry.humidity;
  const actuatorOn = Boolean(device.reported.led || device.desired.led);
  const lightExposureRisk =
    typeof light === "number" ? Math.max(0, Math.min(100, ((light - 300) / 600) * 100)) : 0;
  const humidityRisk = humidityRiskPercent(humidity);

  elements.scene.className = `museum-scene ${riskClass}`;
  elements.sceneRiskLabel.textContent = riskLabelForDevice(device);
  elements.sceneZoneLabel.textContent = device.name || device.deviceId;
  elements.sceneMotion.classList.toggle("active", Boolean(device.telemetry.motion));
  elements.sceneActuator.classList.toggle("active", actuatorOn);
  elements.sceneLightBar.style.width = `${lightExposureRisk}%`;
  elements.sceneHumidityBar.style.width = `${humidityRisk}%`;
  elements.sceneLightBar.className = `bar-level-${riskBucket(lightExposureRisk)}`;
  elements.sceneHumidityBar.className = `bar-level-${riskBucket(humidityRisk)}`;
}

function riskBucket(value) {
  if (value >= 70) return "high";
  if (value >= 35) return "medium";
  return "safe";
}

function renderChart(device) {
  const canvas = elements.chart;
  const history = (device?.history || []).slice().reverse();
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width || canvas.width);
  const height = 260;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  if (history.length < 2) {
    elements.chartEmpty.style.display = "block";
    return;
  }

  elements.chartEmpty.style.display = "none";

  const padding = 34;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const tempValues = history.map((point) => point.telemetry.temperature).filter((value) => typeof value === "number");
  const humidityValues = history.map((point) => point.telemetry.humidity).filter((value) => typeof value === "number");
  const values = [...tempValues, ...humidityValues];
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const range = Math.max(1, max - min);

  function x(index) {
    return padding + (index / Math.max(1, history.length - 1)) * chartWidth;
  }

  function y(value) {
    return padding + chartHeight - ((value - min) / range) * chartHeight;
  }

  function drawLine(key, color) {
    context.beginPath();
    context.lineWidth = 3;
    context.strokeStyle = color;

    history.forEach((point, index) => {
      const value = point.telemetry[key];
      if (typeof value !== "number") return;

      if (index === 0) {
        context.moveTo(x(index), y(value));
      } else {
        context.lineTo(x(index), y(value));
      }
    });

    context.stroke();
  }

  context.strokeStyle = "rgba(16, 32, 39, 0.12)";
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gridY = padding + (i / 4) * chartHeight;
    context.beginPath();
    context.moveTo(padding, gridY);
    context.lineTo(width - padding, gridY);
    context.stroke();
  }

  drawLine("temperature", "#d64545");
  drawLine("humidity", "#1f6feb");

  context.fillStyle = "#102027";
  context.font = "700 12px Trebuchet MS";
  context.fillText("Temp", padding, 18);
  context.fillStyle = "#1f6feb";
  context.fillText("Humidity", padding + 52, 18);
}

function renderDetails() {
  const device = selectedDevice();

  if (!device) {
    elements.selectedTitle.textContent = "Zone waiting";
    elements.selectedSummary.textContent = "Start virtual museum sensors to see preservation state here.";
    elements.syncBadge.textContent = "waiting";
    elements.temp.textContent = "-";
    elements.humidity.textContent = "-";
    elements.battery.textContent = "-";
    elements.light.textContent = "-";
    elements.motion.textContent = "-";
    elements.protocol.textContent = "-";
    elements.lastSeen.textContent = "-";
    elements.desired.textContent = "-";
    elements.reported.textContent = "-";
    elements.riskScoreValue.textContent = "-";
    elements.riskScoreLabel.textContent = "waiting";
    elements.riskScoreReasons.textContent = "No score factors yet.";
    elements.alerts.innerHTML = `<div class="alert-item ok">Waiting for museum sensor data.</div>`;
    elements.rawJson.textContent = "{}";
    renderMuseumScene(null);
    renderChart(null);
    return;
  }

  state.selectedDeviceId = device.deviceId;
  elements.selectedTitle.textContent = device.name || device.deviceId;
  if (!device.connection.online && typeof device.telemetry.battery === "number" && device.telemetry.battery <= 0) {
    elements.selectedSummary.textContent = `${device.deviceId} digital twin was last updated at ${formatDate(
      device.updatedAt
    )}. The sensor is currently offline due to battery depletion.`;
  } else {
    elements.selectedSummary.textContent = `${device.deviceId} digital twin updated at ${formatDate(
      device.updatedAt
    )}. Connection: ${device.connection.online ? "online" : "offline"}.`;
  }

  elements.syncBadge.textContent = device.connection.online ? device.sync?.state || "unknown" : "offline";
  elements.syncBadge.className = `badge ${
    device.connection.online && device.sync?.state === "synced" ? "" : "neutral"
  }`;
  elements.temp.textContent = metric(device.telemetry.temperature, "C");
  elements.humidity.textContent = metric(device.telemetry.humidity, "%");
  elements.battery.textContent = metric(device.telemetry.battery, "%");
  elements.light.textContent = metric(device.telemetry.light, " lx");
  elements.motion.textContent = device.telemetry.motion ? "detected" : "clear";
  elements.protocol.textContent = device.connection.protocol || "-";
  elements.lastSeen.textContent = device.connection.ageSeconds === null ? "-" : `${device.connection.ageSeconds}s ago`;
  elements.desired.textContent = boolText(device.desired.led);
  elements.reported.textContent = boolText(device.reported.led);
  const riskScore = calculateRiskScore(device);
  elements.riskScoreValue.textContent = `${riskScore.score} / 100`;
  elements.riskScoreLabel.textContent = riskScore.label;
  elements.riskScoreReasons.textContent =
    riskScore.reasons.length > 0
      ? `Score factors: ${riskScore.reasons.slice(0, 3).join(", ")}`
      : "Score factors: zone is within normal thresholds.";
  elements.rawJson.textContent = JSON.stringify(device, null, 2);

  renderMuseumScene(device);
  renderAlerts(device);
  renderChart(device);
}

function render() {
  renderSummary();
  renderDeviceList();
  renderDetails();
  notifyMuseum3D();
}

function notifyMuseum3D() {
  window.museumTwinState = {
    devices: state.devices,
    selectedDeviceId: state.selectedDeviceId
  };
  document.dispatchEvent(
    new CustomEvent("museum3d:update", {
      detail: window.museumTwinState
    })
  );
}

async function loadDevices() {
  const [devicesResponse, summaryResponse] = await Promise.all([
    fetch("/api/devices"),
    fetch("/api/summary")
  ]);
  state.devices = await devicesResponse.json();
  const summary = await summaryResponse.json();
  if (summary?.thresholds) {
    state.thresholds = {
      ...state.thresholds,
      ...summary.thresholds
    };
  }

  if (!state.selectedDeviceId && state.devices[0]) {
    state.selectedDeviceId = state.devices[0].deviceId;
  }

  render();
}

async function sendActuatorCommand(led) {
  const device = selectedDevice();

  if (!device) return;

  await fetch(`/api/devices/${device.deviceId}/control`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ led })
  });
}

socket.on("twins:update", (devices) => {
  state.devices = devices;

  if (!state.selectedDeviceId && state.devices[0]) {
    state.selectedDeviceId = state.devices[0].deviceId;
  }

  render();
});

window.addEventListener("resize", () => renderChart(selectedDevice()));
document.addEventListener("museum3d:select", (event) => {
  const deviceId = event.detail?.deviceId;

  if (!deviceId || !state.devices.some((device) => device.deviceId === deviceId)) return;

  state.selectedDeviceId = deviceId;
  render();
  document.querySelector("#detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.refresh.addEventListener("click", loadDevices);
elements.ledOn.addEventListener("click", () => sendActuatorCommand(true));
elements.ledOff.addEventListener("click", () => sendActuatorCommand(false));

loadDevices();
