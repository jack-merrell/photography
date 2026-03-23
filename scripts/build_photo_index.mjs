import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
  'kMDItemLatitude',
  'kMDItemLongitude',
  'kMDItemAltitude',
  'kMDItemImageDirection',
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

function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function getCoordinateValue(value) {
  return isFiniteCoordinate(value) ? value : null
}

function getOptionalString(value) {
  return typeof value === 'string' ? value : null
}

function readExistingPhotoData() {
  if (!existsSync(outputPath)) {
    return new Map()
  }

  const currentIndex = JSON.parse(readFileSync(outputPath, 'utf8'))
  if (!Array.isArray(currentIndex)) {
    return new Map()
  }

  return new Map(
    currentIndex
      .filter((entry) => entry && typeof entry.filename === 'string')
      .map((entry) => [
        entry.filename,
        {
          captureTimestamp: getOptionalString(entry.captureTimestamp),
          captureDate: getOptionalString(entry.captureDate),
          camera: getOptionalString(entry.camera),
          lens: getOptionalString(entry.lens),
          focalLength:
            typeof entry.focalLength === 'number' ? entry.focalLength : null,
          focalLength35mm:
            typeof entry.focalLength35mm === 'number' ? entry.focalLength35mm : null,
          iso: typeof entry.iso === 'number' ? entry.iso : null,
          exposureTimeSeconds:
            typeof entry.exposureTimeSeconds === 'number' ? entry.exposureTimeSeconds : null,
          aperture: typeof entry.aperture === 'number' ? entry.aperture : null,
          flashOn: typeof entry.flashOn === 'number' ? entry.flashOn : null,
          meteringMode:
            typeof entry.meteringMode === 'number' ? entry.meteringMode : null,
          whiteBalance:
            typeof entry.whiteBalance === 'number' ? entry.whiteBalance : null,
          aiDescription: entry.aiDescription ?? null,
          locationCountryCode:
            typeof entry.locationCountryCode === 'string' ? entry.locationCountryCode : null,
          locationCountryName:
            typeof entry.locationCountryName === 'string' ? entry.locationCountryName : null,
          locationCity: typeof entry.locationCity === 'string' ? entry.locationCity : null,
          locationCityCode:
            typeof entry.locationCityCode === 'string' ? entry.locationCityCode : null,
          latitude: getCoordinateValue(entry.latitude),
          longitude: getCoordinateValue(entry.longitude),
          altitude: typeof entry.altitude === 'number' ? entry.altitude : null,
          imageDirection:
            typeof entry.imageDirection === 'number' ? entry.imageDirection : null,
          exifLatitude: getCoordinateValue(entry.exifLatitude),
          exifLongitude: getCoordinateValue(entry.exifLongitude),
          geotagSource:
            entry.geotagSource === 'manual' || entry.geotagSource === 'exif'
              ? entry.geotagSource
              : null,
          geotagUpdatedAt:
            typeof entry.geotagUpdatedAt === 'string' ? entry.geotagUpdatedAt : null,
        },
      ]),
  )
}

function resolveGeotagFields(existingPhotoData, metadata) {
  const metadataLatitude = getCoordinateValue(metadata.kMDItemLatitude)
  const metadataLongitude = getCoordinateValue(metadata.kMDItemLongitude)
  const hasMetadataCoordinates = metadataLatitude != null && metadataLongitude != null

  if (!existingPhotoData) {
    return {
      latitude: hasMetadataCoordinates ? metadataLatitude : null,
      longitude: hasMetadataCoordinates ? metadataLongitude : null,
      exifLatitude: metadataLatitude,
      exifLongitude: metadataLongitude,
      geotagSource: hasMetadataCoordinates ? 'exif' : null,
      geotagUpdatedAt: null,
    }
  }

  const currentLatitude = getCoordinateValue(existingPhotoData.latitude)
  const currentLongitude = getCoordinateValue(existingPhotoData.longitude)
  const hasCurrentCoordinates = currentLatitude != null && currentLongitude != null
  const exifLatitude = metadataLatitude ?? existingPhotoData.exifLatitude
  const exifLongitude = metadataLongitude ?? existingPhotoData.exifLongitude
  const hasExifCoordinates = exifLatitude != null && exifLongitude != null
  const geotagSource = existingPhotoData.geotagSource

  const hasManualOverride =
    geotagSource === 'manual' ||
    (hasCurrentCoordinates &&
      !hasMetadataCoordinates &&
      !hasExifCoordinates) ||
    (hasCurrentCoordinates &&
      hasMetadataCoordinates &&
      (currentLatitude !== metadataLatitude || currentLongitude !== metadataLongitude))

  if (hasManualOverride) {
    return {
      latitude: currentLatitude,
      longitude: currentLongitude,
      exifLatitude,
      exifLongitude,
      geotagSource: hasCurrentCoordinates ? 'manual' : null,
      geotagUpdatedAt: existingPhotoData.geotagUpdatedAt ?? null,
    }
  }

  return {
    latitude: hasExifCoordinates ? exifLatitude : null,
    longitude: hasExifCoordinates ? exifLongitude : null,
    exifLatitude,
    exifLongitude,
    geotagSource: hasExifCoordinates ? 'exif' : null,
    geotagUpdatedAt: null,
  }
}

function createIndexEntry(row, index, existingPhotoDataByFilename) {
  const filePath = path.join(photosDir, row.new_path)
  const stats = statSync(filePath)
  const mdlsMap = readMdlsMap(filePath)

  const metadata = Object.fromEntries(
    Object.entries(mdlsMap).map(([key, rawValue]) => [key, normalizeValue(rawValue)]),
  )
  const existingPhotoData = existingPhotoDataByFilename.get(row.new_path) ?? null
  const geotagFields = resolveGeotagFields(existingPhotoData, metadata)

  return {
    id: String(index + 1).padStart(4, '0'),
    filename: row.new_path,
    src: `/photos/${row.new_path}`,
    captureTimestamp: existingPhotoData?.captureTimestamp ?? row.capture_timestamp,
    captureDate: existingPhotoData?.captureDate ?? row.capture_date,
    camera: existingPhotoData?.camera ?? row.model,
    lens: existingPhotoData?.lens ?? metadata.kMDItemLensModel,
    focalLength: existingPhotoData?.focalLength ?? metadata.kMDItemFocalLength,
    focalLength35mm:
      existingPhotoData?.focalLength35mm ?? metadata.kMDItemFocalLength35mm,
    iso: existingPhotoData?.iso ?? metadata.kMDItemISOSpeed,
    exposureTimeSeconds:
      existingPhotoData?.exposureTimeSeconds ?? metadata.kMDItemExposureTimeSeconds,
    aperture:
      existingPhotoData?.aperture ??
      (typeof metadata.kMDItemAperture === 'number' && metadata.kMDItemAperture < 1000
        ? metadata.kMDItemAperture
        : null),
    flashOn: existingPhotoData?.flashOn ?? metadata.kMDItemFlashOnOff,
    meteringMode: existingPhotoData?.meteringMode ?? metadata.kMDItemMeteringMode,
    whiteBalance: existingPhotoData?.whiteBalance ?? metadata.kMDItemWhiteBalance,
    latitude: geotagFields.latitude,
    longitude: geotagFields.longitude,
    exifLatitude: geotagFields.exifLatitude,
    exifLongitude: geotagFields.exifLongitude,
    geotagSource: geotagFields.geotagSource,
    geotagUpdatedAt: geotagFields.geotagUpdatedAt,
    altitude: existingPhotoData?.altitude ?? metadata.kMDItemAltitude,
    imageDirection: existingPhotoData?.imageDirection ?? metadata.kMDItemImageDirection,
    fileSizeBytes: stats.size,
    width: Number(row.width),
    height: Number(row.height),
    aiDescription: existingPhotoData?.aiDescription ?? null,
    locationCountryCode: existingPhotoData?.locationCountryCode ?? null,
    locationCountryName: existingPhotoData?.locationCountryName ?? null,
    locationCity: existingPhotoData?.locationCity ?? null,
    locationCityCode: existingPhotoData?.locationCityCode ?? null,
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

const existingPhotoDataByFilename = readExistingPhotoData()
const photoIndex = manifestRows.map((row, index) =>
  createIndexEntry(row, index, existingPhotoDataByFilename),
)

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(photoIndex, null, 2)}\n`)

console.log(`Wrote ${photoIndex.length} photo rows to ${path.relative(rootDir, outputPath)}`)
