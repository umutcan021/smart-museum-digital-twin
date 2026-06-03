const { spawn } = require("child_process");

const demoDevices = [
  {
    id: "gallery-1",
    env: {}
  },
  {
    id: "archive-1",
    env: {
      BATTERY_SHUTDOWN: "true",
      BATTERY_DRAIN_STEP: process.env.ARCHIVE_BATTERY_DRAIN_STEP || "4",
      DEVICE_PROFILE: "archive"
    }
  },
  {
    id: "exhibit-1",
    env: {}
  },
  {
    id: "entrance-1",
    env: {}
  }
];

const children = [];

function startDevice(device) {
  const child = spawn(process.execPath, ["src/virtual-device.js", device.id], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...device.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (data) => process.stdout.write(`[${device.id}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${device.id}:err] ${data}`));
  child.on("exit", (code) => {
    console.log(`[${device.id}] stopped with exit code ${code}.`);
  });
  children.push(child);
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

console.log("Starting Smart Museum story demo:");
console.log("- gallery-1 stays mostly normal.");
console.log("- archive-1 has humidity risk and gradual battery drain.");
console.log("- exhibit-1 has high light exposure risk.");
console.log("- entrance-1 simulates access/motion events.");
console.log("- archive-1 battery lasts about 75 seconds by default.");
console.log("  Set ARCHIVE_BATTERY_DRAIN_STEP=2 for a slower presentation.");
console.log("Press Ctrl+C to stop all story devices.");

for (const device of demoDevices) {
  startDevice(device);
}

process.on("SIGINT", () => {
  console.log("\nStopping museum story devices...");
  stopAll();
  setTimeout(() => process.exit(0), 500);
});

process.on("SIGTERM", () => {
  stopAll();
  setTimeout(() => process.exit(0), 500);
});
