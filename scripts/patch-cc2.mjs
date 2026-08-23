// Post-build fixups for the wasm-pack output in src/ai/cc2-wasm.
// Run after `wasm-pack build` (see package.json "build:cc2").
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const glue = 'src/ai/cc2-wasm/cc2_wasm.js'
let src = readFileSync(glue, 'utf8')

// Rust std on wasm32-unknown-unknown imports its clock as env.now(); inline a
// monotonic provider so no bundler alias for the bare "env" specifier is needed.
src = src.replace(
  "import * as __wbg_star0 from 'env';",
  'const __wbg_star0 = { now: () => performance.now() };',
)
src = '/* oxlint-disable */\n' + src
writeFileSync(glue, src)

// wasm-pack generates a .gitignore that would exclude the .wasm binary
try {
  unlinkSync('src/ai/cc2-wasm/.gitignore')
} catch {
  /* already removed */
}

