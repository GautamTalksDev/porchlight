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
    purple, fast blink possible fall detected; press within 10 s to cancel

  The alert is re-sent every few seconds until a neighbour acknowledges it, so a node that
  comes into range later still hears it. Nodes discard the repeats as duplicates.

  Signs of life (optional): moved, lights on/off, and camera presence by frame difference.
  Presence never stores or sends an image, only a yes or no. Uniform brightness changes
  (lights out, covered lens) are normalised away or skipped when the frame is too dark.

  Library: ArduinoBLE (Library Manager). Board: Arduino Mbed OS Nano Boards > Nano 33 BLE.
  Optional: Arduino_LSM9DS1, Arduino_APDS9960, TinyMLShield when the matching flags are on.
*/
#include <ArduinoBLE.h>
#include "config.h"
#include "frame.h"

#ifndef FALL_DETECTION
#define FALL_DETECTION 0
#endif
#ifndef CAMERA_PRESENCE
#define CAMERA_PRESENCE 0
#endif
#ifndef LIGHT_SENSING
#define LIGHT_SENSING 0
#endif
#ifndef ALIVE_REPORTS
#define ALIVE_REPORTS 0
#endif
#ifndef ALIVE_EVERY_SEC
#define ALIVE_EVERY_SEC 20
#endif
#ifndef PRESENCE_EVERY_SEC
#define PRESENCE_EVERY_SEC 10
#endif
#ifndef LIGHT_DARK
#define LIGHT_DARK 1
#endif
#ifndef LIGHT_BRIGHT
#define LIGHT_BRIGHT 3
#endif
#ifndef CAMERA_TOO_DARK
// Mean grayscale below this (0 to 255) is too dark to judge presence.
#define CAMERA_TOO_DARK 18
#endif
#ifndef CAMERA_PRESENCE_SUPPRESS_MS
// After lights_on or lights_off, ignore presence this long (uniform light change looks like motion).
#define CAMERA_PRESENCE_SUPPRESS_MS 10000
#endif

#if FALL_DETECTION || ALIVE_REPORTS
#include <Arduino_LSM9DS1.h>
#include <math.h>
#endif

#if LIGHT_SENSING
#include <Arduino_APDS9960.h>
#endif

#if CAMERA_PRESENCE
// Same shield header and camera modes as firmware/vendor/person_detection/arduino_image_provider.cpp.
#include <TinyMLShield.h>
#endif

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

enum class Led { Off, HelpUnsent, HelpWaiting, Acked, OkFlash, FallWarn };

uint32_t session = 0;
uint32_t counter = 0;
uint8_t lastFrame[pl::FRAME_LEN];
uint8_t helpFrame[pl::FRAME_LEN];  // the pending help or fall alert, kept separate so a test frame can't replace it
uint8_t ffFrame[pl::FRAME_LEN];    // fire-and-forget signs-of-life frame (sent twice, one second apart)
uint32_t pendingHelpCounter = 0;  // 0 = nothing pending
unsigned long pendingSince = 0;
unsigned long lastSendAt = 0;
unsigned long ledUntil = 0;
Led led = Led::Off;
bool everDelivered = false;
uint8_t ffRemaining = 0;
unsigned long ffNextAt = 0;

bool buttonDown();

#if FALL_DETECTION || ALIVE_REPORTS
bool imuReady = false;
#endif

#if FALL_DETECTION
enum class FallPhase { Idle, Freefall, Impact, Stillness, Countdown };
FallPhase fallPhase = FallPhase::Idle;
unsigned long fallPhaseAt = 0;
unsigned long freefallLowAt = 0;
bool fallCancelSwallow = false;
bool fallCountdownPrinted = false;
#endif

#if ALIVE_REPORTS
bool movedMarked = false;
bool presenceMarked = false;
uint8_t movedSamples = 0;
unsigned long lastAliveReportAt = 0;
#endif

#if LIGHT_SENSING
enum class LightState { Unknown, Dark, Bright };
bool apdsReady = false;
LightState lightState = LightState::Unknown;
LightState lightCandidate = LightState::Unknown;
unsigned long lightCandidateSince = 0;
unsigned long lastLightReadAt = 0;
#endif

#if CAMERA_PRESENCE
// QCIF grayscale, same size as the vendor GetImage receive buffer (176 * 144).
static uint8_t camFrame[176 * 144];
// Block averages relative to that frame's mean (brightness-normalised).
static int16_t prevGrid[64];
static int16_t currGrid[64];
static bool havePrevGrid = false;
static bool cameraReady = false;
static bool cameraFailed = false;
static bool cameraFailPrinted = false;
static unsigned long lastPresenceAt = 0;
static unsigned long presenceSuppressUntil = 0;
#endif

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
    case Led::FallWarn: { bool on = (t / 150) % 2; rgb(on, false, on); break; }
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
  // When the camera is enabled, A0/A1/A4/A5 (and D0 to D10) belong to the OV7675.
  // Do not analogRead those pins: that steals GPIO the camera needs for XCLK/data/I2C.
#if !CAMERA_PRESENCE
  for (int p = A0; p <= A7; p++) v = (v << 1) ^ (uint32_t)analogRead(p);
#endif
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
  if (kind == pl::KIND_HELP || kind == pl::KIND_FALL) {
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

// Fire-and-forget: send once now, again one second later. No ack, no LED change.
void sendFireAndForget(uint8_t kind) {
  if (ffRemaining) return;
  counter++;
  pl::encodeFrame(BEACON_ID, BEACON_KEY, kind, session, counter, ffFrame);
  transmit(ffFrame);
  ffRemaining = 1;
  ffNextAt = millis() + 1000;
}

void pollFireAndForget() {
  if (!ffRemaining) return;
  if (millis() < ffNextAt) return;
  transmit(ffFrame);
  ffRemaining -= 1;
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

#if FALL_DETECTION
void enterFallCountdown() {
  fallPhase = FallPhase::Countdown;
  fallPhaseAt = millis();
  fallCountdownPrinted = false;
  led = Led::FallWarn;
  ledUntil = 0;
}

void cancelFallCountdown() {
  fallPhase = FallPhase::Idle;
  freefallLowAt = 0;
  fallCountdownPrinted = false;
  Serial.println("PLI fall cancelled");
  led = Led::OkFlash;
  ledUntil = millis() + 1500;
}
#endif

#if ALIVE_REPORTS
void noteMotionSample(float mag) {
  if (fabsf(mag - 1.0f) > 0.15f) {
    if (movedSamples < 255) movedSamples += 1;
    if (movedSamples >= 3) movedMarked = true;
  }
}
#endif

#if FALL_DETECTION
void pollFall() {
  const unsigned long t = millis();

  if (fallPhase == FallPhase::Countdown) {
    if (!fallCountdownPrinted) {
      Serial.println("PLI possible fall, press the button within 10 s to cancel");
      fallCountdownPrinted = true;
    }
    if (t - fallPhaseAt >= 10000) {
      sendKind(pl::KIND_FALL);
      Serial.println("PLI fall reported");
      fallPhase = FallPhase::Idle;
      freefallLowAt = 0;
      fallCountdownPrinted = false;
    }
    return;
  }

  // Bounce window: ignore acceleration samples for 300 ms after impact.
  if (fallPhase == FallPhase::Impact) {
    if (t - fallPhaseAt >= 300) {
      fallPhase = FallPhase::Stillness;
      fallPhaseAt = t;
    }
    return;
  }

  if (!imuReady) return;
  // Do not start automatic detection while a help or fall frame still waits for an acknowledgement.
  if (pendingHelpCounter) {
    fallPhase = FallPhase::Idle;
    freefallLowAt = 0;
    return;
  }

  const bool haveReading = IMU.accelerationAvailable();
  float mag = 0;
  if (haveReading) {
    float x = 0, y = 0, z = 0;
    IMU.readAcceleration(x, y, z);
    mag = sqrtf(x * x + y * y + z * z);
#if ALIVE_REPORTS
    noteMotionSample(mag);
#endif
  }

  switch (fallPhase) {
    case FallPhase::Idle:
      if (!haveReading) break;
      // Only a sustained free fall can start the sequence. A hard knock alone (desk set-down)
      // must not jump straight to IMPACT.
      if (mag < 0.45f) {
        if (!freefallLowAt) freefallLowAt = t;
        else if (t - freefallLowAt >= 80) {
          fallPhase = FallPhase::Freefall;
          fallPhaseAt = t;
          freefallLowAt = 0;
        }
      } else {
        freefallLowAt = 0;
      }
      break;
    case FallPhase::Freefall:
      if (haveReading && mag > 2.0f) {
        fallPhase = FallPhase::Impact;
        fallPhaseAt = t;
      } else if (t - fallPhaseAt >= 1000) {
        fallPhase = FallPhase::Idle;
      }
      break;
    case FallPhase::Stillness:
      if (haveReading && (mag < 0.75f || mag > 1.3f)) {
        fallPhase = FallPhase::Idle;
        freefallLowAt = 0;
      } else if (t - fallPhaseAt >= 1500) {
        enterFallCountdown();
      }
      break;
    case FallPhase::Impact:
    case FallPhase::Countdown:
      break;
  }
}
#elif ALIVE_REPORTS
void pollMotionOnly() {
  if (!imuReady) return;
  if (!IMU.accelerationAvailable()) return;
  float x = 0, y = 0, z = 0;
  IMU.readAcceleration(x, y, z);
  noteMotionSample(sqrtf(x * x + y * y + z * z));
}
#endif

#if LIGHT_SENSING
void pollLight() {
  if (!apdsReady) return;
  const unsigned long t = millis();
  if (t - lastLightReadAt < 2000) return;
  // Unavailable readings are ignored completely: not dark, not bright, timer untouched.
  if (!APDS.colorAvailable()) return;
  lastLightReadAt = t;
  int r = 0, g = 0, b = 0, clear = 0;
  APDS.readColor(r, g, b, clear);

  LightState next = lightState;
  if (clear < LIGHT_DARK) next = LightState::Dark;
  else if (clear > LIGHT_BRIGHT) next = LightState::Bright;

  if (next == lightState || next == LightState::Unknown) {
    lightCandidate = LightState::Unknown;
    return;
  }
  if (lightCandidate != next) {
    lightCandidate = next;
    lightCandidateSince = t;
    return;
  }
  if (t - lightCandidateSince < 5000) return;
  lightState = next;
  lightCandidate = LightState::Unknown;
  sendFireAndForget(next == LightState::Dark ? pl::KIND_LIGHTS_OFF : pl::KIND_LIGHTS_ON);
  Serial.println(next == LightState::Dark ? "PLI lights off" : "PLI lights on");
#if CAMERA_PRESENCE
  presenceSuppressUntil = millis() + (unsigned long)CAMERA_PRESENCE_SUPPRESS_MS;
#endif
}

// Wait up to 300 ms for a fresh APDS reading. Returns false if none arrives.
bool readLightClear(int *outClear) {
  if (!apdsReady || !outClear) return false;
  const unsigned long start = millis();
  while (!APDS.colorAvailable()) {
    if (millis() - start >= 300) return false;
  }
  int r = 0, g = 0, b = 0, clear = 0;
  APDS.readColor(r, g, b, clear);
  *outClear = clear;
  return true;
}
#endif

#if CAMERA_PRESENCE
// Mirrors vendor GetImage: Camera.begin(QCIF, GRAYSCALE, 5, OV7675) then Camera.readFrame.
// Must run before BLE.begin(): the SoftDevice claims PPI/timer resources the OV767X XCLK needs.
bool ensureCamera() {
  if (cameraReady) return true;
  if (cameraFailed) return false;
  return false;
}

void startCameraEarly() {
  Serial.println("PLI camera starting");
  if (!Camera.begin(QCIF, GRAYSCALE, 5, OV7675)) {
    cameraFailed = true;
    cameraFailPrinted = true;
    Serial.println("PLI camera failed");
    Serial.println("PLI camera not available, presence off");
    return;
  }
  cameraReady = true;
  Serial.println("PLI camera ready");
}

void averageGridRelative(const uint8_t *frame, uint32_t mean, int16_t *grid) {
  const int W = 176;
  const int H = 144;
  const int BW = 8;
  const int BH = 8;
  const int blockW = W / BW;
  const int blockH = H / BH;
  for (int by = 0; by < BH; by += 1) {
    for (int bx = 0; bx < BW; bx += 1) {
      uint32_t sum = 0;
      const int y0 = by * blockH;
      const int x0 = bx * blockW;
      for (int y = 0; y < blockH; y += 1) {
        const uint8_t *row = frame + (y0 + y) * W + x0;
        for (int x = 0; x < blockW; x += 1) sum += row[x];
      }
      const int blockAvg = (int)(sum / (uint32_t)(blockW * blockH));
      grid[by * BW + bx] = (int16_t)(blockAvg - (int)mean);
    }
  }
}

uint32_t frameMean(const uint8_t *frame) {
  const int N = 176 * 144;
  uint32_t sum = 0;
  for (int i = 0; i < N; i += 1) sum += frame[i];
  return sum / (uint32_t)N;
}

enum class PresenceVerdict { No, Yes, TooDark };

// Never prints or returns pixel data. TooDark leaves the previous grid unchanged.
PresenceVerdict runPresenceCheck() {
  if (!ensureCamera()) return PresenceVerdict::No;
  Camera.readFrame(camFrame);
  const uint32_t mean = frameMean(camFrame);
  if (mean < (uint32_t)CAMERA_TOO_DARK) {
    return PresenceVerdict::TooDark;
  }
  averageGridRelative(camFrame, mean, currGrid);
  if (!havePrevGrid) {
    memcpy(prevGrid, currGrid, sizeof(prevGrid));
    havePrevGrid = true;
    return PresenceVerdict::No;
  }
  int changed = 0;
  for (int i = 0; i < 64; i += 1) {
    int d = (int)currGrid[i] - (int)prevGrid[i];
    if (d < 0) d = -d;
    if (d > 12) changed += 1;
  }
  memcpy(prevGrid, currGrid, sizeof(prevGrid));
  // At least 6 percent of 64 blocks: 4 or more.
  return changed * 100 >= 6 * 64 ? PresenceVerdict::Yes : PresenceVerdict::No;
}

bool presenceIdleOk() {
  if (pendingHelpCounter) return false;
  if (buttonDown()) return false;
#if FALL_DETECTION
  if (fallPhase != FallPhase::Idle) return false;
#endif
  return true;
}

void pollPresence() {
  if (cameraFailed) return;
  const unsigned long t = millis();
  if (t < presenceSuppressUntil) return;
  if (t - lastPresenceAt < (unsigned long)PRESENCE_EVERY_SEC * 1000UL) return;
  if (!presenceIdleOk()) return;
  lastPresenceAt = t;
  if (runPresenceCheck() == PresenceVerdict::Yes) {
#if ALIVE_REPORTS
    presenceMarked = true;
#endif
  }
}
#endif

#if ALIVE_REPORTS
void pollAliveReport() {
  const unsigned long t = millis();
  if (t - lastAliveReportAt < (unsigned long)ALIVE_EVERY_SEC * 1000UL) return;
  lastAliveReportAt = t;
  if (!movedMarked && !presenceMarked) return;
  const uint8_t kind = movedMarked ? pl::KIND_MOVED : pl::KIND_PRESENCE;
  sendFireAndForget(kind);
  Serial.println(movedMarked ? "PLI moved" : "PLI presence");
  movedMarked = false;
  presenceMarked = false;
  movedSamples = 0;
}
#endif

// Serial commands (USB mode and bench testing):
//   PLA1 <36 hex>  authenticated ack from the node
//   PLH            simulate a help press      PLO  simulate "I'm safe"      PLT  test frame
//   PLX            jump to fall countdown (bench test, no drop needed)
//   PLL            wait up to 300 ms for light, then print level or "no reading yet"
//   PLP            run one presence check now (prints yes, no, or too dark; never pixels)
//   PLC            print camera status (ready or failed)
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
#if FALL_DETECTION
    } else if (strcmp(line, "PLX") == 0) {
      enterFallCountdown();
#endif
#if LIGHT_SENSING
    } else if (strcmp(line, "PLL") == 0) {
      int clear = 0;
      if (readLightClear(&clear)) {
        Serial.print("PLI light ");
        Serial.println(clear);
      } else {
        Serial.println("PLI light no reading yet");
      }
#endif
#if CAMERA_PRESENCE
    } else if (strcmp(line, "PLP") == 0) {
      const PresenceVerdict v = runPresenceCheck();
      if (v == PresenceVerdict::Yes) Serial.println("PLI presence yes");
      else if (v == PresenceVerdict::TooDark) Serial.println("PLI presence too dark to judge");
      else Serial.println("PLI presence no");
    } else if (strcmp(line, "PLC") == 0) {
      Serial.println(cameraReady ? "PLI camera ready" : "PLI camera failed");
#endif
    }
  }
}

// Button

// On the Tiny Machine Learning Shield the button shares D13 with the Nano's on-board LED, so a plain
// pull-up input can read LOW all the time. Like Arduino's own TinyMLShield library, we drive the pin
// HIGH and sense it through the input buffer: a press pulls it LOW. Set BUTTON_SHIELD_MODE 0 in
// config.h for a separate button wired between any pin and GND.
#if defined(PL_HAVE_NRF) && BUTTON_SHIELD_MODE
// Some versions of the Mbed core leave out nrf_gpio_cfg_out_with_input, so configure the pin the same
// way Arduino's TinyMLShield library does: output driver on and input buffer connected, so the pin can
// be driven high and still be read.
static void plShieldPinConfig(uint32_t pin) {
  nrf_gpio_cfg(pin, NRF_GPIO_PIN_DIR_OUTPUT, NRF_GPIO_PIN_INPUT_CONNECT, NRF_GPIO_PIN_NOPULL, NRF_GPIO_PIN_S0S1, NRF_GPIO_PIN_NOSENSE);
}
#endif
void setupButton() {
#if defined(PL_HAVE_NRF) && BUTTON_SHIELD_MODE
  pinMode(BUTTON_PIN, OUTPUT);
  digitalWrite(BUTTON_PIN, HIGH);
  plShieldPinConfig((uint32_t)digitalPinToPinName(BUTTON_PIN));
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
#if FALL_DETECTION
    if (fallPhase == FallPhase::Countdown) {
      cancelFallCountdown();
      fallCancelSwallow = true;
    }
#endif
  } else {
#if FALL_DETECTION
    if (fallCancelSwallow) {
      fallCancelSwallow = false;
      return;
    }
#endif
    sendKind(t - downAt >= LONG_PRESS_MS ? pl::KIND_OK : pl::KIND_HELP);
  }
}

// Setup / loop

void setup() {
  // Serial first so camera start messages are visible. Do not touch LED PWM or BLE yet:
  // the OV767X driver needs free PPI/timer resources for XCLK, and pins D0 to D10 plus A0/A1/A4/A5.
  Serial.begin(115200);

#if CAMERA_PRESENCE
  startCameraEarly();
#endif

  // RGB LEDs: digitalWrite only (never analogWrite/PWM), so we do not steal the camera's timers.
  pinMode(LEDR, OUTPUT);
  pinMode(LEDG, OUTPUT);
  pinMode(LEDB, OUTPUT);
  rgb(false, false, false);
  setupButton();

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

#if FALL_DETECTION || ALIVE_REPORTS
  if (IMU.begin()) {
    imuReady = true;
  } else {
    imuReady = false;
    Serial.println("PLI motion sensor not found, fall detection and move reports off");
  }
#endif

#if LIGHT_SENSING
  if (APDS.begin()) {
    apdsReady = true;
  } else {
    apdsReady = false;
    Serial.println("PLI light sensor not found, lights reports off");
  }
#endif

  Serial.print("PLI Porchlight beacon ");
  Serial.print(BEACON_ID);
  Serial.print(" session ");
  Serial.println(session, HEX);
  Serial.print("PLI button pin reads ");
  Serial.println(buttonDown() ? "pressed (if you are not pressing it, see docs/HARDWARE.md)" : "released");

#if ALIVE_REPORTS
  lastAliveReportAt = millis();
#endif
#if CAMERA_PRESENCE
  lastPresenceAt = millis();
#endif
#if LIGHT_SENSING
  lastLightReadAt = millis();
#endif
}

void loop() {
  BLE.poll();
  pollButton();
  pollSerial();
  pollFireAndForget();
#if FALL_DETECTION
  pollFall();
#elif ALIVE_REPORTS
  pollMotionOnly();
#endif
#if LIGHT_SENSING
  pollLight();
#endif
#if CAMERA_PRESENCE
  pollPresence();
#endif
#if ALIVE_REPORTS
  pollAliveReport();
#endif

  // Keep re-sending an unacknowledged help or fall alert so a node that connects later still hears it.
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
