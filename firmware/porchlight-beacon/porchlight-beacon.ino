/*
  Porchlight beacon
  Arduino Nano 33 BLE Sense (Tiny Machine Learning Kit)

  Press the button: send an authenticated "help" alert over Bluetooth LE (and USB serial).
  Hold the button:  send "I'm safe".
  The on-board RGB LED tells the resident what is happening:
    red, fast blink   help sent, no node connected yet
    amber, slow blink help delivered to a node, waiting for a neighbour
    green, solid      a neighbour is on the way (authenticated ack received)
    blue, short flash "I'm safe" sent

  The alert is re-sent every few seconds until a neighbour acknowledges it, so a node that
  comes into range later still hears it. Nodes discard the repeats as duplicates.

  Library: ArduinoBLE (Library Manager). Board: Arduino Mbed OS Nano Boards > Nano 33 BLE.
*/
#include <ArduinoBLE.h>
#include "config.h"
#include "frame.h"

#if defined(ARDUINO_ARCH_MBED) || defined(NRF52840_XXAA)
#include "nrf.h"
#include "nrf_gpio.h"
#define PL_HAVE_NRF 1
#endif

#ifndef BUTTON_SHIELD_MODE
#define BUTTON_SHIELD_MODE 1
#endif

static const char *SERVICE_UUID = "7a1f0001-5c3e-4f6b-9d2a-6c1e0b8f4a10";
BLEService plService(SERVICE_UUID);
BLECharacteristic alertChar("7a1f0002-5c3e-4f6b-9d2a-6c1e0b8f4a10", BLERead | BLENotify, pl::FRAME_LEN, true);
BLECharacteristic ackChar("7a1f0003-5c3e-4f6b-9d2a-6c1e0b8f4a10", BLEWrite | BLEWriteWithoutResponse, pl::FRAME_LEN, true);
BLEStringCharacteristic idChar("7a1f0004-5c3e-4f6b-9d2a-6c1e0b8f4a10", BLERead, 48);

enum class Led { Off, HelpUnsent, HelpWaiting, Acked, OkFlash };

uint32_t session = 0;
uint32_t counter = 0;
uint8_t lastFrame[pl::FRAME_LEN];
uint8_t helpFrame[pl::FRAME_LEN];  // the pending help alert, kept separate so a test frame can't replace it
uint32_t pendingHelpCounter = 0;  // 0 = nothing pending
unsigned long pendingSince = 0;
unsigned long lastSendAt = 0;
unsigned long ledUntil = 0;
Led led = Led::Off;
bool everDelivered = false;

// LED (the Nano 33 BLE RGB LED is active LOW)

void rgb(bool r, bool g, bool b) {
  digitalWrite(LEDR, r ? LOW : HIGH);
  digitalWrite(LEDG, g ? LOW : HIGH);
  digitalWrite(LEDB, b ? LOW : HIGH);
}

void updateLed() {
  const unsigned long t = millis();
  if (ledUntil && t > ledUntil) {
    ledUntil = 0;
    led = Led::Off;
  }
  switch (led) {
    case Led::Off: rgb(false, false, false); break;
    case Led::HelpUnsent: rgb((t / 150) % 2, false, false); break;
    case Led::HelpWaiting: { bool on = (t / 600) % 2; rgb(on, on, false); break; }
    case Led::Acked: rgb(false, true, false); break;
    case Led::OkFlash: rgb(false, false, true); break;
  }
}

// Randomness for the per-boot session id

uint32_t hardwareRandom32() {
  uint32_t v = 0;
#ifdef PL_HAVE_NRF
  NRF_RNG->CONFIG = RNG_CONFIG_DERCEN_Enabled;
  NRF_RNG->TASKS_START = 1;
  for (int i = 0; i < 4; i++) {
    NRF_RNG->EVENTS_VALRDY = 0;
    while (NRF_RNG->EVENTS_VALRDY == 0) {}
    v = (v << 8) | (uint8_t)NRF_RNG->VALUE;
  }
  NRF_RNG->TASKS_STOP = 1;
  v ^= NRF_FICR->DEVICEID[0];
#endif
  v ^= micros();
  for (int p = A0; p <= A7; p++) v = (v << 1) ^ (uint32_t)analogRead(p);
  return v ? v : 0x5eed1234;
}

// Sending

void printHex(const uint8_t *b, size_t n) {
  static const char *digits = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    Serial.print(digits[b[i] >> 4]);
    Serial.print(digits[b[i] & 0xf]);
  }
}

void transmit(const uint8_t *frame) {
  alertChar.writeValue(frame, pl::FRAME_LEN);  // notifies every subscribed node
  // Same frame over USB for the Web Serial fallback: "PLF1 <beaconId> <hex>"
  Serial.print("PLF1 ");
  Serial.print(BEACON_ID);
  Serial.print(' ');
  printHex(frame, pl::FRAME_LEN);
  Serial.println();
  lastSendAt = millis();
  if (BLE.connected()) everDelivered = true;
}

void sendKind(uint8_t kind) {
  counter++;
  pl::encodeFrame(BEACON_ID, BEACON_KEY, kind, session, counter, lastFrame);
  transmit(lastFrame);
  if (kind == pl::KIND_HELP) {
    memcpy(helpFrame, lastFrame, pl::FRAME_LEN);
    pendingHelpCounter = counter;
    pendingSince = millis();
    everDelivered = BLE.connected();
    led = everDelivered ? Led::HelpWaiting : Led::HelpUnsent;
    ledUntil = 0;
  } else if (kind == pl::KIND_OK) {
    pendingHelpCounter = 0;
    led = Led::OkFlash;
    ledUntil = millis() + 1500;
  }
}

// Receiving an acknowledgement

void handleAck(const uint8_t *data, size_t len) {
  uint32_t s, c;
  if (!pl::verifyFrame(BEACON_ID, BEACON_KEY, data, len, pl::KIND_ACK, &s, &c)) {
    Serial.println("PLE ack rejected (bad MAC or kind)");
    return;
  }
  if (s != session || c != pendingHelpCounter || pendingHelpCounter == 0) {
    Serial.println("PLE ack does not match the pending alert");
    return;
  }
  pendingHelpCounter = 0;
  led = Led::Acked;
  ledUntil = millis() + 15000;
  Serial.println("PLI ack accepted: a neighbour is on the way");
}

void onAckWritten(BLEDevice, BLECharacteristic chr) {
  handleAck(chr.value(), chr.valueLength());
}

uint8_t hexNibble(char ch) {
  if (ch >= '0' && ch <= '9') return ch - '0';
  if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
  if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
  return 0xff;
}

// Serial commands (USB mode and bench testing):
//   PLA1 <36 hex>  authenticated ack from the node
//   PLH            simulate a help press      PLO  simulate "I'm safe"      PLT  test frame
void pollSerial() {
  static char line[64];
  static size_t n = 0;
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch != '\n') {
      if (n < sizeof(line) - 1) line[n++] = ch;
      continue;
    }
    line[n] = 0;
    n = 0;
    if (strncmp(line, "PLA1 ", 5) == 0 && strlen(line) == 5 + 2 * pl::FRAME_LEN) {
      uint8_t buf[pl::FRAME_LEN];
      bool ok = true;
      for (size_t i = 0; i < pl::FRAME_LEN; i++) {
        uint8_t hi = hexNibble(line[5 + 2 * i]), lo = hexNibble(line[6 + 2 * i]);
        if (hi == 0xff || lo == 0xff) ok = false;
        buf[i] = (hi << 4) | lo;
      }
      if (ok) handleAck(buf, pl::FRAME_LEN);
    } else if (strcmp(line, "PLH") == 0) {
      sendKind(pl::KIND_HELP);
    } else if (strcmp(line, "PLO") == 0) {
      sendKind(pl::KIND_OK);
    } else if (strcmp(line, "PLT") == 0) {
      sendKind(pl::KIND_TEST);
    }
  }
}

// Button

// On the Tiny Machine Learning Shield the button shares D13 with the Nano's on-board LED, so a plain
// pull-up input can read LOW all the time. Like Arduino's own TinyMLShield library, we drive the pin
// HIGH and sense it through the input buffer: a press pulls it LOW. Set BUTTON_SHIELD_MODE 0 in
// config.h for a separate button wired between any pin and GND.
void setupButton() {
#if defined(PL_HAVE_NRF) && BUTTON_SHIELD_MODE
  pinMode(BUTTON_PIN, OUTPUT);
  digitalWrite(BUTTON_PIN, HIGH);
  nrf_gpio_cfg_out_with_input((uint32_t)digitalPinToPinName(BUTTON_PIN));
#else
  pinMode(BUTTON_PIN, INPUT_PULLUP);
#endif
}

bool buttonDown() {
#if defined(PL_HAVE_NRF) && BUTTON_SHIELD_MODE
  return nrf_gpio_pin_read((uint32_t)digitalPinToPinName(BUTTON_PIN)) == 0;
#else
  return digitalRead(BUTTON_PIN) == LOW;
#endif
}

void pollButton() {
  static bool wasDown = false;
  static unsigned long downAt = 0;
  static unsigned long lastChange = 0;
  const bool down = buttonDown();
  const unsigned long t = millis();
  if (down == wasDown || t - lastChange < 30) return;  // debounce
  lastChange = t;
  wasDown = down;
  if (down) {
    downAt = t;
  } else {
    sendKind(t - downAt >= LONG_PRESS_MS ? pl::KIND_OK : pl::KIND_HELP);
  }
}

// Setup / loop

void setup() {
  pinMode(LEDR, OUTPUT);
  pinMode(LEDG, OUTPUT);
  pinMode(LEDB, OUTPUT);
  rgb(false, false, false);
  setupButton();
  Serial.begin(115200);

  session = hardwareRandom32();

  if (!BLE.begin()) {
    // Without Bluetooth the beacon still works over USB serial.
    Serial.println("PLE Bluetooth failed to start; USB serial only");
  } else {
    char name[32];
    snprintf(name, sizeof(name), "PL %s", BEACON_ID);
    BLE.setLocalName(name);
    BLE.setDeviceName(name);
    BLE.setAdvertisedService(plService);
    plService.addCharacteristic(alertChar);
    plService.addCharacteristic(ackChar);
    plService.addCharacteristic(idChar);
    BLE.addService(plService);
    idChar.writeValue(BEACON_ID);
    uint8_t zero[pl::FRAME_LEN] = {0};
    alertChar.writeValue(zero, pl::FRAME_LEN);
    ackChar.setEventHandler(BLEWritten, onAckWritten);
    BLE.advertise();
  }

  Serial.print("PLI Porchlight beacon ");
  Serial.print(BEACON_ID);
  Serial.print(" session ");
  Serial.println(session, HEX);
  Serial.print("PLI button pin reads ");
  Serial.println(buttonDown() ? "pressed (if you are not pressing it, see docs/HARDWARE.md)" : "released");
}

void loop() {
  BLE.poll();
  pollButton();
  pollSerial();

  // Keep re-sending an unacknowledged help alert so a node that connects later still hears it.
  if (pendingHelpCounter && millis() - lastSendAt >= RESEND_EVERY_MS) {
    if (millis() - pendingSince < RESEND_FOR_MS) {
      transmit(helpFrame);
    } else {
      pendingHelpCounter = 0;
      led = Led::Off;
    }
  }
  if (pendingHelpCounter && led == Led::HelpUnsent && BLE.connected()) led = Led::HelpWaiting;
  updateLed();
}
