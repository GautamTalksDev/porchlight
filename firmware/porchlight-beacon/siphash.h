// SipHash-2-4, 64-bit output (Aumasson & Bernstein). Mirrors packages/protocol/src/siphash.ts.
// Verified against the reference vectors by firmware/test/siphash_host_test.cpp.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace pl {

static inline uint64_t rotl64(uint64_t x, int b) { return (x << b) | (x >> (64 - b)); }

static inline uint64_t load64le(const uint8_t *p) {
  return (uint64_t)p[0] | ((uint64_t)p[1] << 8) | ((uint64_t)p[2] << 16) | ((uint64_t)p[3] << 24) |
         ((uint64_t)p[4] << 32) | ((uint64_t)p[5] << 40) | ((uint64_t)p[6] << 48) | ((uint64_t)p[7] << 56);
}

#define PL_SIPROUND                                                                                  \
  do {                                                                                               \
    v0 += v1; v1 = rotl64(v1, 13); v1 ^= v0; v0 = rotl64(v0, 32);                                    \
    v2 += v3; v3 = rotl64(v3, 16); v3 ^= v2;                                                         \
    v0 += v3; v3 = rotl64(v3, 21); v3 ^= v0;                                                         \
    v2 += v1; v1 = rotl64(v1, 17); v1 ^= v2; v2 = rotl64(v2, 32);                                    \
  } while (0)

static inline void siphash24(const uint8_t *in, size_t len, const uint8_t key[16], uint8_t out[8]) {
  const uint64_t k0 = load64le(key);
  const uint64_t k1 = load64le(key + 8);
  uint64_t v0 = 0x736f6d6570736575ULL ^ k0;
  uint64_t v1 = 0x646f72616e646f6dULL ^ k1;
  uint64_t v2 = 0x6c7967656e657261ULL ^ k0;
  uint64_t v3 = 0x7465646279746573ULL ^ k1;
  const uint8_t *end = in + len - (len % 8);
  for (; in != end; in += 8) {
    const uint64_t m = load64le(in);
    v3 ^= m; PL_SIPROUND; PL_SIPROUND; v0 ^= m;
  }
  uint64_t b = ((uint64_t)(len & 0xff)) << 56;
  for (size_t i = 0; i < (len & 7); i++) b |= ((uint64_t)in[i]) << (8 * i);
  v3 ^= b; PL_SIPROUND; PL_SIPROUND; v0 ^= b;
  v2 ^= 0xff;
  PL_SIPROUND; PL_SIPROUND; PL_SIPROUND; PL_SIPROUND;
  const uint64_t r = v0 ^ v1 ^ v2 ^ v3;
  for (int i = 0; i < 8; i++) out[i] = (uint8_t)(r >> (8 * i));
}

// Constant-time tag comparison.
static inline bool tagsEqual(const uint8_t *a, const uint8_t *b, size_t n) {
  uint8_t d = 0;
  for (size_t i = 0; i < n; i++) d |= a[i] ^ b[i];
  return d == 0;
}

}  // namespace pl
