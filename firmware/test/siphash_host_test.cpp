// Host-side test: proves the firmware's SipHash and frame codec produce the same bytes as the TypeScript node.
// Run: g++ -std=c++17 -I../porchlight-beacon siphash_host_test.cpp -o /tmp/pl_test && /tmp/pl_test
#include <cstdio>
#include <cstring>
#include "frame.h"

static void hex(const uint8_t *b, size_t n, char *out) {
  for (size_t i = 0; i < n; i++) sprintf(out + 2 * i, "%02x", b[i]);
}

int main() {
  int fails = 0;
  uint8_t key[16];
  for (int i = 0; i < 16; i++) key[i] = i;
  uint8_t out[8];
  char h[64];

  pl::siphash24(nullptr, 0, key, out);
  hex(out, 8, h);
  if (strcmp(h, "310e0edd47db6f72") != 0) { printf("FAIL empty vector: %s\n", h); fails++; }

  uint8_t msg15[15];
  for (int i = 0; i < 15; i++) msg15[i] = i;
  pl::siphash24(msg15, 15, key, out);
  hex(out, 8, h);
  if (strcmp(h, "e545be4961ca29a1") != 0) { printf("FAIL 15-byte vector: %s\n", h); fails++; }

  // Cross-language frame vector (must equal protocol encodeFrame("pl-b01", key 0011..ff, "help", 0x1234, 7)).
  const uint8_t k2[16] = {0x00,0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff};
  uint8_t frame[pl::FRAME_LEN];
  pl::encodeFrame("pl-b01", k2, pl::KIND_HELP, 0x1234, 7, frame);
  hex(frame, pl::FRAME_LEN, h);
  printf("FRAME %s\n", h);

  uint32_t s, c;
  if (!pl::verifyFrame("pl-b01", k2, frame, pl::FRAME_LEN, pl::KIND_HELP, &s, &c) || s != 0x1234 || c != 7) {
    printf("FAIL verify own frame\n"); fails++;
  }
  frame[7] ^= 1;
  if (pl::verifyFrame("pl-b01", k2, frame, pl::FRAME_LEN, pl::KIND_HELP, &s, &c)) { printf("FAIL tampered frame accepted\n"); fails++; }

  printf(fails ? "FAILED\n" : "ALL OK\n");
  return fails ? 1 : 0;
}
