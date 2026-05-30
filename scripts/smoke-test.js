const http = require("http");
const { spawn } = require("child_process");

const coap = require("coap");

const children = [];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startProcess(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env
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
        port: 3000,
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
        port: 3000,
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

function coapJson({ method, pathname, payload }) {
  return new Promise((resolve, reject) => {
    const req = coap.request({
      hostname: "localhost",
      port: 5683,
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
  startProcess("server", ["src/server.js"]);
  await wait(3500);

  startProcess("device", ["src/virtual-device.js", "smoke-device"]);
  await wait(6500);

  const devices = await getJson("/api/devices");
  const smokeDevice = devices.find((device) => device.deviceId === "smoke-device");

  if (!smokeDevice) {
    throw new Error("smoke-device did not appear in HTTP API");
  }

  if (typeof smokeDevice.telemetry.light !== "number") {
    throw new Error("smoke-device telemetry did not include light value");
  }

  console.log(`HTTP API OK: ${devices.length} device(s) found`);

  const summary = await getJson("/api/summary");

  if (summary.totalDevices < 1 || typeof summary.onlineDevices !== "number") {
    throw new Error("HTTP summary did not include expected device counts");
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
