import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// frontend root is parent of scripts/
const frontendRoot = path.resolve(__dirname, '..')
const targetDir = path.join(frontendRoot, 'public', 'human-models')

// Find source directory in frontend/node_modules or root node_modules
const candidateDirs = [
  path.join(frontendRoot, 'node_modules', '@vladmandic', 'human', 'models'),
  path.resolve(frontendRoot, '..', 'node_modules', '@vladmandic', 'human', 'models'),
]

const sourceDir = candidateDirs.find((dir) => fs.existsSync(dir))

// Ensure target directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true })
}

if (!sourceDir) {
  console.warn('[copy-human-models] Warning: source directory @vladmandic/human/models not found')
  process.exit(0)
}

const prefixes = ['blazeface', 'facemesh', 'faceres']
const files = fs.readdirSync(sourceDir)
let copiedCount = 0

for (const file of files) {
  const matchesPrefix = prefixes.some((prefix) => file.startsWith(prefix))
  const matchesExt = file.endsWith('.json') || file.endsWith('.bin')
  if (matchesPrefix && matchesExt) {
    const src = path.join(sourceDir, file)
    const dst = path.join(targetDir, file)
    fs.copyFileSync(src, dst)
    copiedCount++
  }
}

console.log(`[copy-human-models] Copied ${copiedCount} model file(s) to ${targetDir}`)
