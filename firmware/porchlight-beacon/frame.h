// Porchlight beacon frame, 18 bytes. Mirrors packages/protocol/src/beacon.ts.
//   [0] version=1  [1] kind (1 help, 2 ok, 3 test, 16 ack)  [2..5] session u32 LE  [6..9] counter u32 LE
//   [10..17] SipHash-2-4 over (beaconId || 0x00 || bytes 0..9)
#pragma once
#include <string.h>
#include "siphash.h"

namespace pl {

enum Kind : uint8_t { KIND_HELP = 1, KIND_OK = 2, KIND_TEST = 3, KIND_ACK = 16 };
static const size_t FRAME_LEN = 18;

static inline void put32le(uint8_t *p, uint32_t v) {
  p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24;
}
static inline uint32_t get32le(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static inline void macFor(const char *beaconId, const uint8_t head[10], const uint8_t key[16], uint8_t tag[8]) {
  uint8_t buf[64];
  size_t idLen = strlen(beaconId);
  if (idLen > 48) idLen = 48;
  memcpy(buf, beaconId, idLen);
  buf[idLen] = 0;
  memcpy(buf + idLen + 1, head, 10);
  siphash24(buf, idLen + 11, key, tag);
}

static inline void encodeFrame(const char *beaconId, const uint8_t key[16], uint8_t kind, uint32_t session,
                               uint32_t counter, uint8_t out[FRAME_LEN]) {
  out[0] = 1;
  out[1] = kind;
  put32le(out + 2, session);
  put32le(out + 6, counter);
  macFor(beaconId, out, key, out + 10);
}

// Returns true only for an authentic frame of the expected kind.
static inline bool verifyFrame(const char *beaconId, const uint8_t key[16], const uint8_t *frame, size_t len,
                               uint8_t expectKind, uint32_t *session, uint32_t *counter) {
  if (len != FRAME_LEN || frame[0] != 1 || frame[1] != expectKind) return false;
  uint8_t tag[8];
  macFor(beaconId, frame, key, tag);
  if (!tagsEqual(tag, frame + 10, 8)) return false;
  *session = get32le(frame + 2);
  *counter = get32le(frame + 6);
  return true;
}

}  // namespace pl
