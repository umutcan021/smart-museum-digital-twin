const { spawn } = require("child_process");

const deviceId = process.argv[2] || "battery-demo";

const child = spawn(process.execPath, ["src/virtual-device.js", deviceId], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BATTERY_SHUTDOWN: "true",
    BATTERY_DRAIN_STEP: process.env.BATTERY_DRAIN_STEP || "20",
    DEVICE_PROFILE: process.env.DEVICE_PROFILE || "gallery"
  },
  stdio: "inherit"
});

child.on("exit", (code) => {
  console.log(`Battery demo device stopped with exit code ${code}.`);
});
