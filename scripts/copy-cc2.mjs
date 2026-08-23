// wasm-pack resolves --out-dir relative to the crate root, so build into
// vendor/cc2-wasm/wasm-pkg and copy the generated package into src/ai/cc2-wasm.
import { copyFileSync, rmSync, unlinkSync } from 'node:fs'

const from = 'vendor/cc2-wasm/wasm-pkg'
const to = 'src/ai/cc2-wasm'

for (const f of ['cc2_wasm.js', 'cc2_wasm.d.ts', 'cc2_wasm_bg.wasm', 'cc2_wasm_bg.wasm.d.ts', 'package.json']) {
  copyFileSync(`${from}/${f}`, `${to}/${f}`)
}
rmSync(from, { recursive: true, force: true })

// wasm-pack generates a .gitignore that would exclude the .wasm binary
try {
  unlinkSync(`${to}/.gitignore`)
} catch {
  /* already removed */
}
