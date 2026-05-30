/*
  Optional physical-device example for ESP32.

  This sketch publishes telemetry to the Node.js MQTT broker and listens
  for LED control commands from the dashboard/CoAP server.

  Required Arduino libraries:
  - PubSubClient by Nick O'Leary
  - ArduinoJson by Benoit Blanchon
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Use your computer's local IPv4 address, not "localhost".
// Example: 192.168.1.25
const char* MQTT_SERVER = "YOUR_COMPUTER_IP";
const int MQTT_PORT = 1883;

const char* DEVICE_ID = "esp32-1";
const int LED_PIN = 2;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

bool ledState = false;
unsigned long lastTelemetryAt = 0;

void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void publishStatus(bool online) {
  StaticJsonDocument<160> doc;
  char payload[160];

  doc["deviceId"] = DEVICE_ID;
  doc["name"] = "ESP32 Physical Device";
  doc["type"] = "esp32";
  doc["online"] = online;

  serializeJson(doc, payload);

  String topic = "iot/devices/" + String(DEVICE_ID) + "/status";
  mqtt.publish(topic.c_str(), payload);
}

void publishTelemetry() {
  StaticJsonDocument<240> doc;
  char payload[240];

  doc["deviceId"] = DEVICE_ID;
  doc["name"] = "ESP32 Physical Device";
  doc["type"] = "esp32";
  doc["temperature"] = random(220, 310) / 10.0;
  doc["humidity"] = random(350, 700) / 10.0;
  doc["led"] = ledState;
  doc["battery"] = 100;

  serializeJson(doc, payload);

  String topic = "iot/devices/" + String(DEVICE_ID) + "/telemetry";
  mqtt.publish(topic.c_str(), payload);
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<160> doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    return;
  }

  if (doc["led"].is<bool>()) {
    ledState = doc["led"];
    digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    publishTelemetry();
  }
}

void connectMqtt() {
  while (!mqtt.connected()) {
    if (mqtt.connect(DEVICE_ID)) {
      String commandTopic = "iot/devices/" + String(DEVICE_ID) + "/commands";
      mqtt.subscribe(commandTopic.c_str());
      publishStatus(true);
    } else {
      delay(1000);
    }
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);

  connectWifi();
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
}

void loop() {
  if (!mqtt.connected()) {
    connectMqtt();
  }

  mqtt.loop();

  if (millis() - lastTelemetryAt > 3000) {
    lastTelemetryAt = millis();
    publishTelemetry();
  }
}
