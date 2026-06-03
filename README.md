# Smart Museum Digital Twin

This project is a hybrid IoT monitoring and control system for a museum/archive environment. It uses **MQTT** for real-time telemetry, **CoAP** for lightweight query/control operations, and a lightweight **digital twin** model to keep the latest state of each museum zone.

The system runs completely on a local computer with virtual IoT sensors. An optional ESP32 template is also included for future physical device support.

## Project Idea

Museums and archives need stable environmental conditions to protect artifacts, documents, and exhibition areas. Temperature, humidity, light exposure, motion/access activity, and battery status can all create preservation risks.

This demo simulates museum zones such as a gallery, archive room, exhibit case, and entrance. Each virtual sensor publishes telemetry with MQTT. The backend updates a digital twin for each zone. The dashboard visualizes live telemetry, connection status, preservation risks, actuator state, and recent history.

## What This Project Demonstrates

1. Monitor physical or virtual IoT devices.
2. Collect real-time telemetry using MQTT.
3. Support lightweight query/control using CoAP.
4. Maintain a digital twin for each device/zone.
5. Visualize latest state, alerts, history, and synchronization on a dashboard.
6. Demonstrate control flow with a protection actuator.

## System Architecture

```text
Virtual / Physical Museum Sensor
        |
        | MQTT telemetry + status
        v
Local MQTT Broker + Digital Twin Server
        |
        | HTTP API + WebSocket
        v
Dashboard

CoAP Client
        |
        | CoAP query/control
        v
CoAP Server -> MQTT command -> Device
```

## Museum Demo Zones

The default demo starts four virtual museum sensors:

```text
gallery-1    Normal gallery environment
archive-1    Archive room with humidity risk
exhibit-1    Exhibit case with light/temperature risk
entrance-1   Entrance/access sensor with motion activity
```

These are virtual devices, but they behave like IoT sensor nodes. They continuously send telemetry to the local MQTT broker.

## Digital Twin Model

For every zone, the server keeps a digital twin object. This object is the software copy of the latest known device state.

Each digital twin contains:

```text
deviceId
name
type
connection.online
connection.lastMessageAt
connection.ageSeconds
telemetry.temperature
telemetry.humidity
telemetry.light
telemetry.motion
telemetry.battery
decisionSupport.score
decisionSupport.riskLevel
decisionSupport.recommendedAction
decisionSupport.standards
desired.led
reported.led
sync.state
alerts
history
```

In the dashboard, `desired.led` and `reported.led` are shown as the **Protection Actuator** state. The field name is still `led` in the JSON because the same command can represent a warning light, fan, dehumidifier, or protective lighting control.

Important actuator behavior:

```text
desired.led   User/server target state
reported.led  Last actuator state confirmed by the device
```

If a device is offline or its battery is depleted, actuator commands are rejected. This prevents the dashboard from showing a dead sensor as if it actually turned the actuator on. The visual room twin uses `reported.led` for the real actuator light, while `desired.led` remains only the requested target state.

## Decision Support Engine

The backend includes a rule-based conservation decision support engine. It evaluates every digital twin against a conservation profile and writes the result into `decisionSupport`.

Each result contains:

```text
engine
profile.id
profile.label
score
riskLevel
recommendedAction
explanation
standards
factors
```

The score is not a machine-learning prediction. It is a transparent weighted rule score based on:

```text
temperature outside the profile range
relative humidity outside the profile range
damp/mould risk
light above the profile lux limit
motion/access activity
low or critical sensor battery
offline sensor state
desired/reported actuator mismatch
```

The demo profiles are based on Canadian Conservation Institute guidance:

```text
Mixed museum collection:      15-25C, 45-55% RH, light <=150 lx
Archive and paper storage:    10-25C, 30-50% RH, light <=150 lx
Sensitive organic exhibit:    15-25C, 45-55% RH, light <=50 lx
Entrance/access monitoring:   environmental monitoring + motion/access signal
```

Sources:

```text
Canadian Conservation Institute - Incorrect relative humidity
https://www.canada.ca/en/conservation-institute/services/agents-deterioration/humidity.html

Canadian Conservation Institute - Care of Mounted Specimens and Pelts
https://www.canada.ca/en/conservation-institute/services/conservation-preservation-publications/canadian-conservation-institute-notes/care-mounted-specimens-pelts.html

Canadian Conservation Institute - Basic Care of Books
https://www.canada.ca/en/conservation-institute/services/conservation-preservation-publications/canadian-conservation-institute-notes/basic-care-books.html
```

## Protocols and Ports

When the server starts, it opens three local services:

```text
MQTT broker:  mqtt://localhost:1883
CoAP server:  coap://localhost:5683
Dashboard:    http://localhost:3000
```

Important:

1. `http://localhost:3000` is the web dashboard. Open this in Chrome or Edge.
2. `mqtt://localhost:1883` is not a normal web page. Virtual devices use it in the background to send MQTT telemetry.
3. `coap://localhost:5683` is also not normally opened in a browser. It is tested with the included CoAP client commands.

So during the demo, manually open only:

```text
http://localhost:3000
```

MQTT and CoAP run in the background.

## Technologies Used

```text
Node.js
JavaScript
MQTT
CoAP
Express.js
Socket.IO
HTML/CSS/JavaScript dashboard
Optional ESP32 Arduino template
```

Main Node packages:

```text
aedes      Local MQTT broker
mqtt       MQTT client
coap       CoAP server/client
express    HTTP API and dashboard server
socket.io  Real-time dashboard updates
```

## Installation

Open a terminal in the project folder:

```powershell
cd C:\Users\UMUTCAN\Desktop\iot_final
```

Install required packages:

```powershell
npm.cmd install
```

On Windows PowerShell, `npm.cmd` is recommended because plain `npm` can be blocked by script execution policy.

## Running the Project

Use separate terminals because the server and devices keep running.

### Terminal 1: Start Server

```powershell
npm.cmd start
```

Expected output:

```text
[MQTT] Broker listening on mqtt://localhost:1883
[HTTP] Dashboard listening on http://localhost:3000
[CoAP] Server listening on coap://localhost:5683
[MQTT] Digital twin service connected to local broker
```

Keep this terminal open.

### Terminal 2: Start Museum Sensors

```powershell
npm.cmd run devices:demo
```

This starts:

```text
gallery-1
archive-1
exhibit-1
entrance-1
```

Keep this terminal open. Telemetry messages should appear continuously.

For the final presentation, the stronger story mode is recommended:

```powershell
npm.cmd run devices:museum-story
```

Story mode starts the same four museum zones, but `archive-1` also demonstrates gradual battery drain. By default, `archive-1` lasts about 75 seconds so there is enough time to inspect the dashboard before the sensor goes offline. This creates a clear sequence:

```text
normal telemetry -> LOW_BATTERY -> SENSOR OFFLINE -> digital twin update
```

For a slower presentation, start story mode like this:

```powershell
$env:ARCHIVE_BATTERY_DRAIN_STEP="2"
npm.cmd run devices:museum-story
```

### Browser: Open Dashboard

Open:

```text
http://localhost:3000
```

The dashboard should show museum zones, online/offline status, risk count, latest telemetry, a 3D museum digital twin, active risks, and actuator control buttons.

## CoAP Test Commands

Open a third terminal in the project folder.

System summary:

```powershell
node src/coap-client.js summary
```

List all digital twins:

```powershell
node src/coap-client.js list
```

Get one zone:

```powershell
node src/coap-client.js get gallery-1
```

Turn protection actuator on:

```powershell
node src/coap-client.js control gallery-1 led on
```

Turn protection actuator off:

```powershell
node src/coap-client.js control gallery-1 led off
```

The CoAP command reaches the server. The server forwards the command to the device through MQTT. The device then reports its new state back through MQTT telemetry.

If the selected device is offline, the server rejects the command instead of changing the desired actuator state:

```text
HTTP API: 409 Conflict
CoAP:     4.09 Conflict
```

## Dashboard Sections

### Summary Cards

Shows:

```text
Total Zones
Online Sensors
Offline Sensors
Active Risks
```

### Monitored Zones

Shows all known museum zones. Each zone card displays online/offline state, last message time, sync state, and active risk count.

### Digital Twin

Shows the selected zone's latest state:

```text
Temperature
Relative Humidity
Sensor Battery
Light Exposure
Motion
Protocol
Last seen
Desired Actuator
Reported Actuator
```

### 3D Digital Twin

The **Smart Museum Command Center** is a Three.js based 3D digital twin view. It shows four museum zones and synchronizes visual state with the backend digital twin.

The 3D sensor nodes change color depending on selected zone state:

```text
Green/normal: no active risk
Yellow: humidity or warning risk
Orange: high light exposure
Red: critical risk
Gray: offline device
```

It also shows:

```text
Gallery, archive, exhibit, and entrance areas
Clickable 3D sensor nodes
Battery low / sensor offline marker
Motion pulse indicator
Light exposure effect for exhibit risk
Selected sensor highlight
```

The goal of this 3D view is not to create a realistic game scene. It is a visual digital twin layer that reflects live IoT state.

### Selected Zone Micro Twin

The smaller **Museum Room Twin** panel shows the selected zone with a simpler room-level visual. It gives a focused view of light exposure, humidity risk, motion, and actuator state.

### Telemetry History

Shows the last 20 temperature and humidity messages for the selected zone.

### Active Preservation Risks

Shows active alerts for the selected zone.

### Protection Actuator

The actuator represents a simple control output. In a real museum system, it could represent:

```text
Warning light
Ventilation fan
Dehumidifier
Protective lighting control
```

The demo uses a boolean `led` command internally because it is simple and easy to test.

### Raw JSON Block

The dark JSON block shows the raw digital twin object. It is useful in a presentation because it proves that the backend is maintaining a real software-side twin, not only drawing values on the screen.

## Decision Rules

The system now uses profile-based conservation rules instead of one global demo threshold. The default profile limits are:

```text
Mixed collection:       15-25C, 45-55% RH, light <=150 lx
Archive/paper storage:  10-25C, 30-50% RH, light <=150 lx
Sensitive exhibit:      15-25C, 45-55% RH, light <=50 lx
Low battery:            20%
Offline timeout:        12 seconds
```

Decision factors and alert types include:

```text
HIGH_TEMPERATURE
LOW_TEMPERATURE
HIGH_HUMIDITY
LOW_HUMIDITY
DAMP_MOULD_RISK
HIGH_LIGHT_EXPOSURE
MOTION_DETECTED
LOW_BATTERY
BATTERY_CRITICAL
DEVICE_OFFLINE
STATE_SYNC_PENDING
```

These rules are simplified for a classroom demo, but the ranges and light limits are tied to conservation guidance rather than arbitrary random values.

## Battery / Sensor Reliability Demo

Battery failure is used as a **monitoring reliability risk**. It does not directly damage an artifact, but if a wireless sensor battery dies, the system can no longer monitor temperature, humidity, light, or motion for that zone.

Recommended final demo:

```powershell
npm.cmd run devices:museum-story
```

In this mode:

```text
archive-1 starts online
archive-1 reports humidity risk
archive-1 battery decreases gradually for about 75 seconds
archive-1 creates LOW_BATTERY alert
archive-1 reaches 0%
archive-1 sends offline status and stops telemetry
3D scene turns archive sensor gray/offline
```

The story demo is intentionally slower than the standalone battery demo. This gives enough time to explain the zone card, digital twin JSON, risk score, and actuator behavior before `archive-1` goes offline.

There is also a separate standalone battery demo:

```powershell
npm.cmd run device:battery-demo
```

It starts an extra device named:

```text
battery-demo
```

Its battery intentionally drains quickly:

```text
100 -> 80 -> 60 -> 40 -> 20 -> 0
```

When battery reaches `0%`, the device sends an offline status and stops telemetry. The dashboard should show:

```text
battery-demo offline
LOW_BATTERY alert
DEVICE_OFFLINE alert
Battery 0%
```

This is intentionally fast so it can be shown during a short demo.

## Physical Device Support

The project includes an optional ESP32 MQTT example:

```text
arduino/esp32_mqtt_device.ino
```

Required Arduino libraries:

```text
PubSubClient
ArduinoJson
```

The ESP32 code requires Wi-Fi information and the computer's local IP address:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_SERVER = "YOUR_COMPUTER_IP";
```

If there is no ESP32 available, the project can still be fully demonstrated with virtual devices.

## RPL Note

RPL is a routing protocol used in low-power IPv6 mesh networks. This project does not implement RPL because the selected final topic focuses on MQTT, CoAP, device monitoring, control, and digital twins.

RPL could be future work if the project is extended with Contiki/Cooja or a real low-power mesh simulation. It is not required for this version.

## Quick Smoke Test

To run a basic automated test:

```powershell
npm.cmd run test:smoke
```

Expected result:

```text
Smoke test passed.
```

The smoke test starts the server and a virtual device, checks the HTTP API, checks CoAP summary/list, and sends one CoAP control command.

## Recommended Presentation Flow

1. Start server: `npm.cmd start`
2. Start museum story sensors: `npm.cmd run devices:museum-story`
3. Open dashboard: `http://localhost:3000`
4. Show the 3D Smart Museum Command Center.
5. Explain MQTT telemetry updates.
6. Click 3D sensor nodes and show the selected digital twin state.
7. Show risk colors: archive humidity/battery, exhibit light exposure, entrance motion.
8. Show active preservation risks.
9. Use the actuator buttons in the dashboard.
10. Run `node src/coap-client.js summary`
11. Run `node src/coap-client.js control gallery-1 led on`
12. Wait for `archive-1` battery to reach low/empty state.
13. Show archive sensor turning offline in the 3D scene.

## Troubleshooting

### Dashboard does not open

Make sure `npm.cmd start` is still running and shows:

```text
[HTTP] Dashboard listening on http://localhost:3000
```

Then open:

```text
http://localhost:3000
```

### Devices do not appear

Start the server first, then start devices:

```powershell
npm.cmd start
npm.cmd run devices:demo
```

### `npm` command is blocked

Use:

```powershell
npm.cmd install
npm.cmd start
```

### Port already in use

Another program may be using port `3000`, `1883`, or `5683`. Close old terminals running the project or restart the computer.

## Sharing the Project

When sending this project as a zip file, do not include `node_modules`. The receiver can install dependencies with:

```powershell
npm.cmd install
```

Recommended zip contents:

```text
arduino
docs
public
scripts
src
.gitignore
package.json
package-lock.json
README.md
```

## Conclusion

This project demonstrates a complete IoT monitoring and control flow for museum/archive preservation. MQTT is used for real-time telemetry, CoAP is used for lightweight query/control, the backend maintains a digital twin for every zone, and the dashboard visualizes live state, risks, history, and actuator synchronization.
