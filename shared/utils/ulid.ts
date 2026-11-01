// ULID (https://github.com/ulid/spec): 26 Crockford base32 characters, written in lowercase here.
// The first 10 encode a 48-bit millisecond timestamp, the last 16 encode 80 random bits,
// so IDs sort by creation time.

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const MAX_TIME = 2 ** 48 - 1
const ULID_RE = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/

/** True for a lowercase ULID, the only form the app uses. */
export function isUlid(value: string): boolean {
  return ULID_RE.test(value)
}

/** True for a ULID in any letter case (uppercase is the spec's canonical form). */
export function isUlidAnyCase(value: string): boolean {
  return ULID_RE.test(value.toLowerCase())
}

export function ulid(time: number | Date = Date.now()): string {
  let ms = typeof time === 'number' ? time : time.getTime()
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME) throw new Error(`Invalid ULID timestamp: ${ms}`)
  let timePart = ''
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[ms % 32] + timePart
    ms = Math.floor(ms / 32)
  }
  // 16 characters x 5 bits = 80 bits. Each random byte's low 5 bits are uniform.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let randomPart = ''
  for (const b of bytes) randomPart += ALPHABET[b & 31]
  return timePart + randomPart
}

/** Timestamp (ms since epoch) encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new Error(`Not a ULID: ${id}`)
  let ms = 0
  for (const c of id.slice(0, 10)) ms = ms * 32 + ALPHABET.indexOf(c)
  return ms
}
