import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const photosDir = path.join(rootDir, 'public', 'photos')
const previewsDir = path.join(rootDir, 'public', 'previews')

mkdirSync(previewsDir, { recursive: true })

const files = readdirSync(photosDir)
  .filter((file) => file.toLowerCase().endsWith('.jpg'))
  .sort()

for (const file of files) {
  execFileSync(
    'sips',
    [
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      '60',
      '-Z',
      '1600',
      path.join(photosDir, file),
      '--out',
      path.join(previewsDir, file),
    ],
    { stdio: 'ignore' },
  )
}

console.log(`Wrote ${files.length} previews to public/previews`)
