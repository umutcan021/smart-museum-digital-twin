const coap = require("coap");

const action = process.argv[2] || "list";
const deviceId = process.argv[3] || "gallery-1";
const field = process.argv[4] || "led";
const value = process.argv[5] || "on";
const COAP_HOST = process.env.COAP_HOST || "localhost";
const COAP_PORT = Number(process.env.COAP_PORT || 5683);
const COAP_TIMEOUT_MS = Number(process.env.COAP_TIMEOUT_MS || 5000);

function requestJson({ method, pathname, payload }) {
  return new Promise((resolve, reject) => {
    const req = coap.request({
      hostname: COAP_HOST,
      port: COAP_PORT,
      pathname,
      method
    });
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${method} ${pathname}`));
    }, COAP_TIMEOUT_MS);

    req.setOption("Accept", "application/json");

    req.on("response", (res) => {
      clearTimeout(timeout);
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");

        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
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

function parseValue(raw) {
  if (raw === "on" || raw === "true") return true;
  if (raw === "off" || raw === "false") return false;
  if (!Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

async function main() {
  let response;

  if (action === "list") {
    response = await requestJson({ method: "GET", pathname: "/devices" });
  } else if (action === "summary") {
    response = await requestJson({ method: "GET", pathname: "/summary" });
  } else if (action === "get") {
    response = await requestJson({ method: "GET", pathname: `/devices/${deviceId}` });
  } else if (action === "control") {
    response = await requestJson({
      method: "POST",
      pathname: `/devices/${deviceId}/control`,
      payload: {
        [field]: parseValue(value)
      }
    });
  } else {
    console.log("Usage:");
    console.log("  node src/coap-client.js list");
    console.log("  node src/coap-client.js summary");
    console.log("  node src/coap-client.js get gallery-1");
    console.log("  node src/coap-client.js control gallery-1 led on");
    process.exit(1);
  }

  console.log(JSON.stringify(response, null, 2));
}

main().catch((error) => {
  console.error("CoAP request failed:", error.message);
  process.exit(1);
});
