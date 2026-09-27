// Copy this file to config.h and fill it in. config.h is git-ignored because it holds the beacon key.
// Generate a matching id + key pair with:  npm run keygen pl-b01
#pragma once
#include <stdint.h>

#define BEACON_ID "pl-b01"

// 16-byte SipHash key. Must match BEACON_KEYS in the node's .env.
static const uint8_t BEACON_KEY[16] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                       0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f};

// The Tiny Machine Learning Shield's button is on D13, shared with the on-board LED.
// Shield mode (1) drives the pin high and senses presses through the input buffer, like Arduino's
// TinyMLShield library. For your own button wired between a pin and GND, use mode 0 and that pin.
#define BUTTON_PIN 13
#define BUTTON_SHIELD_MODE 1

// Hold the button this long to send "I'm safe" instead of "help".
#define LONG_PRESS_MS 1500

// Re-send an unacknowledged help alert this often, and stop after this long.
#define RESEND_EVERY_MS 3000
#define RESEND_FOR_MS 600000

// Automatic fall detection with the on-board motion sensor. 1 = on, 0 = off.
#define FALL_DETECTION 1

// Signs of life: camera presence by frame difference (demo). 1 = on, 0 = off.
#define CAMERA_PRESENCE 1
// Signs of life: ambient light on/off via the APDS9960 (demo). 1 = on, 0 = off.
#define LIGHT_SENSING 1
// Signs of life: periodic moved/presence reports (demo). 1 = on, 0 = off.
#define ALIVE_REPORTS 1
// How often to send a moved or presence frame if one was marked (demo 20 s; real deploys use minutes).
#define ALIVE_EVERY_SEC 20
// How often to capture a presence frame when idle (demo 10 s; real deploys use minutes).
#define PRESENCE_EVERY_SEC 10
// Ambient clear channel below this is dark (hysteresis with LIGHT_BRIGHT).
#define LIGHT_DARK 20
// Ambient clear channel above this is bright (hysteresis with LIGHT_DARK).
#define LIGHT_BRIGHT 60
