const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 5

/** Short join code: unambiguous alphabet (no 0/O, 1/I/L). */
export function generateCode(rng: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(rng() * ALPHABET.length)]
  }
  return out
}