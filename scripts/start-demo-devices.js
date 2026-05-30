const { spawn } = require("child_process");

const devices = process.argv.slice(2);
const demoDevices =
  devices.length > 0
    ? devices
    : ["gallery-1", "archive-1", "exhibit-1", "entrance-1"];

const children = [];

function startDevice(deviceId) {
  const child = spawn(process.execPath, ["src/virtual-device.js", deviceId], {
    cwd: process.cwd(),
    env: {
      ...process.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (data) => process.stdout.write(`[${deviceId}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${deviceId}:err] ${data}`));
  children.push(child);
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

console.log(`Starting ${demoDevices.length} demo device(s): ${demoDevices.join(", ")}`);
console.log("Press Ctrl+C to stop all demo devices.");

for (const deviceId of demoDevices) {
  startDevice(deviceId);
}

process.on("SIGINT", () => {
  console.log("\nStopping demo devices...");
  stopAll();
  setTimeout(() => process.exit(0), 500);
});

process.on("SIGTERM", () => {
  stopAll();
  setTimeout(() => process.exit(0), 500);
});
