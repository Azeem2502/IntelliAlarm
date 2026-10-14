/*
  IntelliAlarm - ESP32-S3 Firmware (Zone: OT)
  
  Features:
  - Reads ZMPT101B (Voltage) on GPIO 4 & ACS712 (Current) on GPIO 5
  - Demo fault injection buttons on GPIO 7 (Sag) and GPIO 8 (Surge)
  - Drives 12V Buzzer (via transistor) on GPIO 6:
      * HIGH RISK   -> 3 distinct beeps (beep-beep-beep), pause, repeat
      * MEDIUM RISK -> 2 distinct beeps (beep-beep), pause, repeat
      * LOW RISK    -> 1 single beep (beep), pause, repeat
      * NORMAL/OFF  -> Silent
  - Subscribes to MQTT topic: intellialarm/buzzer/OT
  - Publishes telemetry to:   intellialarm/sensors/OT
*/

#include <WiFi.h>
#include <PubSubClient.h>

// ── Pin Configuration (ESP32-S3 DevKit) ──────────────────────────
#define PIN_ZMPT        4    // ZMPT101B Analog In
#define PIN_ACS712      5    // ACS712 Analog In
#define PIN_BUZZER      6    // Transistor base (Buzzer control)
#define PIN_BTN_SAG     7    // Fault Button: Voltage Sag (pull-up to GND)
#define PIN_BTN_SURGE   8    // Fault Button: Voltage Surge (pull-up to GND)

// ── Network Configuration ────────────────────────────────────────
const char* WIFI_SSID    = "sanjana  11";
const char* WIFI_PASS    = "g11Z/460";
const char* MQTT_BROKER  = "10.63.138.124";
const int   MQTT_PORT    = 1883;

// ── Device & MQTT Topics ─────────────────────────────────────────
const char* ZONE_NAME      = "OT";
const char* CLIENT_ID      = "IntelliAlarm-ESP32S3-OT";
const char* TOPIC_SENSORS  = "intellialarm/sensors/OT";
const char* TOPIC_BUZZER   = "intellialarm/buzzer/OT";

// ── Calibration Constants ────────────────────────────────────────
const float ZMPT_SENSITIVITY = 500.0f; // Adjust per your calibration
const float ACS_SENSITIVITY  = 0.066f; // 66mV/A for ACS712-30A (use 0.100f for 20A, 0.185f for 5A)
const float ADC_VREF         = 3.3f;
const int   ADC_MAX          = 4095;

// ── Risk Tiers ───────────────────────────────────────────────────
enum RiskTier {
  RISK_NONE,
  RISK_LOW,
  RISK_MEDIUM,
  RISK_HIGH
};

volatile RiskTier currentRisk = RISK_NONE;

WiFiClient espClient;
PubSubClient mqtt(espClient);

unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 1000; // Publish every 1s

// ── Non-Blocking Multi-Beep Pattern Generator ────────────────────
void updateBuzzer() {
  unsigned long now = millis();

  switch (currentRisk) {
    case RISK_HIGH: {
      // 3 BEEPS every 2000 ms: [BEEP] - [BEEP] - [BEEP] - [PAUSE]
      unsigned long phase = now % 2000;
      bool on = (phase < 120) || 
                (phase >= 220 && phase < 340) || 
                (phase >= 440 && phase < 560);
      digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
      break;
    }

    case RISK_MEDIUM: {
      // 2 BEEPS every 2000 ms: [BEEP] - [BEEP] - [PAUSE]
      unsigned long phase = now % 2000;
      bool on = (phase < 160) || 
                (phase >= 300 && phase < 460);
      digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
      break;
    }

    case RISK_LOW: {
      // 1 BEEP every 3000 ms: [BEEP] - [PAUSE]
      unsigned long phase = now % 3000;
      bool on = (phase < 180);
      digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
      break;
    }

    case RISK_NONE:
    default:
      digitalWrite(PIN_BUZZER, LOW);
      break;
  }
}

// ── MQTT Callback (Receives Risk Tier from Backend) ──────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  message.trim();
  Serial.printf("[Buzzer] Message on %s: %s\n", topic, message.c_str());

  // Matches either JSON ({"risk":"High"}) or raw string ("High")
  if (message.indexOf("High") >= 0 || message.indexOf("high") >= 0) {
    currentRisk = RISK_HIGH;
    Serial.println("[Buzzer] -> HIGH RISK (3 Beeps Pattern)");
  } else if (message.indexOf("Medium") >= 0 || message.indexOf("medium") >= 0) {
    currentRisk = RISK_MEDIUM;
    Serial.println("[Buzzer] -> MEDIUM RISK (2 Beeps Pattern)");
  } else if (message.indexOf("Low") >= 0 || message.indexOf("low") >= 0) {
    currentRisk = RISK_LOW;
    Serial.println("[Buzzer] -> LOW RISK (1 Beep Pattern)");
  } else {
    currentRisk = RISK_NONE;
    Serial.println("[Buzzer] -> NORMAL (Buzzer Silent)");
  }
}

// ── Wi-Fi Connection ─────────────────────────────────────────────
unsigned long lastWiFiRetry = 0;
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWiFiRetry < 5000) return; // Retry every 5s if disconnected
  lastWiFiRetry = now;

  Serial.printf("\n[WiFi] Connecting to: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(200);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected!");
    Serial.printf("[WiFi] ESP32 IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Waiting for Wi-Fi, will auto-reconnect...");
  }
}

// ── MQTT Connection ────────────────────────────────────────────
unsigned long lastMqttRetry = 0;
void connectMQTT() {
  if (mqtt.connected()) return;

  unsigned long now = millis();
  if (now - lastMqttRetry < 2000) return; // Auto-retry every 2 seconds
  lastMqttRetry = now;

  Serial.printf("[MQTT] Connecting to %s:%d ... ", MQTT_BROKER, MQTT_PORT);
  if (mqtt.connect(CLIENT_ID)) {
    Serial.println("CONNECTED!");
    mqtt.subscribe(TOPIC_BUZZER);
    Serial.printf("[MQTT] Subscribed to %s\n", TOPIC_BUZZER);
  } else {
    Serial.printf("FAILED (rc=%d), will auto-retry in 2s\n", mqtt.state());
  }
}

// ── Sensor Reading (RMS Calculation) ─────────────────────────────
float readVoltageRMS() {
  // Check demo fault injection buttons
  if (digitalRead(PIN_BTN_SAG) == LOW) {
    return 165.0f; // Injected Voltage Sag (~165V)
  }
  if (digitalRead(PIN_BTN_SURGE) == LOW) {
    return 275.0f; // Injected Voltage Surge (~275V)
  }

  // Sample AC waveform
  long sumSquares = 0;
  int samples = 0;
  unsigned long start = millis();

  while (millis() - start < 40) { // Sample across ~2 full 50Hz cycles
    int raw = analogRead(PIN_ZMPT);
    int centered = raw - 2048; // ESP32 12-bit ADC midpoint
    sumSquares += (long)centered * centered;
    samples++;
  }

  if (samples == 0) return 230.0f;
  float rmsAdc = sqrt((float)sumSquares / samples);
  float voltage = rmsAdc * (ADC_VREF / ADC_MAX) * ZMPT_SENSITIVITY;

  // Fallback to nominal if sensor is disconnected (low noise)
  if (voltage < 20.0f) {
    voltage = 230.0f;
  }
  return voltage;
}

float readCurrentRMS() {
  long sumSquares = 0;
  int samples = 0;
  unsigned long start = millis();

  while (millis() - start < 40) {
    int raw = analogRead(PIN_ACS712);
    int centered = raw - 2048;
    sumSquares += (long)centered * centered;
    samples++;
  }

  if (samples == 0) return 0.5f;
  float rmsAdc = sqrt((float)sumSquares / samples);
  float current = (rmsAdc * (ADC_VREF / ADC_MAX)) / ACS_SENSITIVITY;

  // Low threshold filter
  if (current < 0.15f) current = 0.0f;
  return current;
}

// ── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n==============================================");
  Serial.println("  IntelliAlarm ESP32-S3 (Zone: OT) Initializing ");
  Serial.println("==============================================");

  // Pin modes
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  pinMode(PIN_BTN_SAG, INPUT_PULLUP);
  pinMode(PIN_BTN_SURGE, INPUT_PULLUP);

  analogReadResolution(12); // 12-bit ADC (0-4095)

  // Network setup
  connectWiFi();
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(512);
}

// ── Main Loop ────────────────────────────────────────────────────
void loop() {
  // Wi-Fi & MQTT Keep-Alive
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    connectMQTT();
  }
  mqtt.loop();

  // Non-blocking buzzer rhythm (Runs on every loop pass)
  updateBuzzer();

  // Periodic Telemetry Publishing (Every 1000 ms)
  unsigned long now = millis();
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = now;

    float voltage = readVoltageRMS();
    float current = readCurrentRMS();

    // Determine fault type for immediate local annotation
    const char* faultType = "nominal";
    if (voltage < 190.0f)      faultType = "voltage_sag";
    else if (voltage > 255.0f) faultType = "voltage_surge";
    else if (current > 15.0f)  faultType = "overload";

    char payload[256];
    snprintf(payload, sizeof(payload),
      "{\"zone\":\"%s\",\"voltage\":%.1f,\"current\":%.2f,\"fault_type\":\"%s\",\"timestamp\":%lu}",
      ZONE_NAME, voltage, current, faultType, now / 1000
    );

    if (mqtt.connected()) {
      mqtt.publish(TOPIC_SENSORS, payload);
      Serial.printf("[MQTT Tx] %s -> %s\n", TOPIC_SENSORS, payload);
    }
  }
}
