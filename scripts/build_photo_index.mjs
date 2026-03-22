import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const manifestPath = path.join(rootDir, 'photo-rename-manifest.csv')
const photosDir = path.join(rootDir, 'public', 'photos')
const outputDir = path.join(rootDir, 'src', 'data')
const outputPath = path.join(outputDir, 'photoIndex.json')

const mdlsKeys = [
  'kMDItemLensModel',
  'kMDItemFocalLength',
  'kMDItemFocalLength35mm',
  'kMDItemISOSpeed',
  'kMDItemExposureTimeSeconds',
  'kMDItemAperture',
  'kMDItemFlashOnOff',
  'kMDItemMeteringMode',
  'kMDItemWhiteBalance',
]

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      const nextCharacter = line[index + 1]
      if (inQuotes && nextCharacter === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (character === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += character
  }

  values.push(current)
  return values
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = parseCsvLine(lines[0])

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function readMdlsMap(filePath) {
  return Object.fromEntries(
    mdlsKeys.map((key) => {
      const output = execFileSync('mdls', ['-raw', '-name', key, filePath], { encoding: 'utf8' })
      return [key, output.trim()]
    }),
  )
}

function normalizeValue(rawValue) {
  if (!rawValue || rawValue === '(null)') {
    return null
  }

  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1)
  }

  const numeric = Number(rawValue)
  if (!Number.isNaN(numeric)) {
    return numeric
  }

  return rawValue
}

function createIndexEntry(row, index) {
  const filePath = path.join(photosDir, row.new_path)
  const stats = statSync(filePath)
  const mdlsMap = readMdlsMap(filePath)

  const metadata = Object.fromEntries(
    Object.entries(mdlsMap).map(([key, rawValue]) => [key, normalizeValue(rawValue)]),
  )

  return {
    id: String(index + 1).padStart(4, '0'),
    filename: row.new_path,
    src: `/photos/${row.new_path}`,
    captureTimestamp: row.capture_timestamp,
    captureDate: row.capture_date,
    camera: row.model,
    lens: metadata.kMDItemLensModel,
    focalLength: metadata.kMDItemFocalLength,
    focalLength35mm: metadata.kMDItemFocalLength35mm,
    iso: metadata.kMDItemISOSpeed,
    exposureTimeSeconds: metadata.kMDItemExposureTimeSeconds,
    aperture:
      typeof metadata.kMDItemAperture === 'number' && metadata.kMDItemAperture < 1000
        ? metadata.kMDItemAperture
        : null,
    flashOn: metadata.kMDItemFlashOnOff,
    meteringMode: metadata.kMDItemMeteringMode,
    whiteBalance: metadata.kMDItemWhiteBalance,
    fileSizeBytes: stats.size,
    width: Number(row.width),
    height: Number(row.height),
  }
}

const manifestRows = parseCsv(readFileSync(manifestPath, 'utf8'))
  .sort((left, right) => {
    const byTimestamp = left.capture_timestamp.localeCompare(right.capture_timestamp)
    if (byTimestamp !== 0) {
      return byTimestamp
    }
    return left.new_path.localeCompare(right.new_path)
  })

const photoIndex = manifestRows.map(createIndexEntry)

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(photoIndex, null, 2)}\n`)

console.log(`Wrote ${photoIndex.length} photo rows to ${path.relative(rootDir, outputPath)}`)
