const http = require("http");
const { spawn } = require("child_process");

const coap = require("coap");

const MQTT_PORT = Number(process.env.SMOKE_MQTT_PORT || 39183);
const HTTP_PORT = Number(process.env.SMOKE_HTTP_PORT || 39300);
const COAP_PORT = Number(process.env.SMOKE_COAP_PORT || 39683);
const MQTT_URL = `mqtt://127.0.0.1:${MQTT_PORT}`;
const children = [];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startProcess(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${name}:err] ${data}`));
  children.push(child);

  return child;
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "localhost",
        port: HTTP_PORT,
        path: pathname,
        timeout: 5000
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout for ${pathname}`));
    });
    req.on("error", reject);
  });
}

function getText(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "localhost",
        port: HTTP_PORT,
        path: pathname,
        timeout: 5000
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout for ${pathname}`));
    });
    req.on("error", reject);
  });
}

function postJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "localhost",
        port: HTTP_PORT,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 5000
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");

          try {
            resolve({
              statusCode: res.statusCode,
              body: JSON.parse(text)
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout for POST ${pathname}`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function coapJson({ method, pathname, payload }) {
  return new Promise((resolve, reject) => {
    const req = coap.request({
      hostname: "localhost",
      port: COAP_PORT,
      pathname,
      method
    });
    const timeout = setTimeout(() => {
      reject(new Error(`CoAP timeout for ${method} ${pathname}`));
    }, 5000);

    req.on("response", (res) => {
      clearTimeout(timeout);
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    if (payload) {
      req.write(JSON.stringify(payload));
    }

    req.end();
  });
}

function stopChildren() {
  for (const child of children.reverse()) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

async function main() {
  console.log("Starting smoke test...");
  startProcess("server", ["src/server.js"], {
    DEVICE_TIMEOUT_MS: "2500",
    MQTT_PORT: String(MQTT_PORT),
    HTTP_PORT: String(HTTP_PORT),
    COAP_PORT: String(COAP_PORT)
  });
  await wait(3500);

  const deviceProcess = startProcess("device", ["src/virtual-device.js", "smoke-device"], {
    MQTT_URL
  });
  await wait(6500);

  const devices = await getJson("/api/devices");
  const smokeDevice = devices.find((device) => device.deviceId === "smoke-device");

  if (!smokeDevice) {
    throw new Error("smoke-device did not appear in HTTP API");
  }

  if (typeof smokeDevice.telemetry.light !== "number") {
    throw new Error("smoke-device telemetry did not include light value");
  }

  if (
    typeof smokeDevice.decisionSupport?.score !== "number" ||
    !smokeDevice.decisionSupport?.recommendedAction
  ) {
    throw new Error("smoke-device did not include decision support output");
  }

  console.log(`HTTP API OK: ${devices.length} device(s) found`);
  console.log(
    `Decision support OK: ${smokeDevice.decisionSupport.riskLevel}, score ${smokeDevice.decisionSupport.score}`
  );

  const summary = await getJson("/api/summary");

  if (summary.totalDevices < 1 || typeof summary.onlineDevices !== "number") {
    throw new Error("HTTP summary did not include expected device counts");
  }

  if (!summary.decisionEngine || !summary.conservationProfiles?.mixedCollection) {
    throw new Error("HTTP summary did not include decision support metadata");
  }

  console.log(
    `HTTP summary OK: ${summary.onlineDevices} online, ${summary.alertCount} risk(s)`
  );

  const threeModule = await getText("/vendor/three/three.module.js");

  if (!threeModule.includes("REVISION")) {
    throw new Error("Three.js module was not served through /vendor/three");
  }

  console.log("Three.js asset OK: /vendor/three/three.module.js served");

  const coapDevices = await coapJson({ method: "GET", pathname: "/devices" });

  if (!Array.isArray(coapDevices)) {
    throw new Error("CoAP /devices did not return a list");
  }

  console.log(`CoAP list OK: ${coapDevices.length} device(s) found`);

  const coapSummary = await coapJson({ method: "GET", pathname: "/summary" });

  if (typeof coapSummary.totalDevices !== "number") {
    throw new Error("CoAP /summary did not return summary data");
  }

  console.log(`CoAP summary OK: ${coapSummary.totalDevices} device(s) summarized`);

  const control = await coapJson({
    method: "POST",
    pathname: "/devices/smoke-device/control",
    payload: { led: true }
  });

  if (!control.ok) {
    throw new Error("CoAP control did not return ok=true");
  }

  console.log("CoAP control OK: actuator command sent");
  await wait(2000);

  deviceProcess.kill("SIGINT");
  await wait(3500);

  const offlineDevice = await getJson("/api/devices/smoke-device");

  if (offlineDevice.connection.online) {
    throw new Error("smoke-device did not become offline after telemetry stopped");
  }

  const offlineHttpControl = await postJson("/api/devices/smoke-device/control", {
    led: false
  });

  if (offlineHttpControl.statusCode !== 409 || offlineHttpControl.body.ok !== false) {
    throw new Error("HTTP control did not reject an offline actuator command");
  }

  if (offlineHttpControl.body.twin?.desired?.led !== true) {
    throw new Error("Offline HTTP control changed desired actuator state");
  }

  console.log("HTTP offline control OK: actuator command rejected");

  const offlineCoapControl = await coapJson({
    method: "POST",
    pathname: "/devices/smoke-device/control",
    payload: { led: false }
  });

  if (offlineCoapControl.ok !== false) {
    throw new Error("CoAP control did not reject an offline actuator command");
  }

  console.log("CoAP offline control OK: actuator command rejected");
  console.log("Smoke test passed.");
}

main()
  .catch((error) => {
    console.error(`Smoke test failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    stopChildren();
  });
