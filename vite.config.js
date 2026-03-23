import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {
  AiDescriptionSchema,
} from './scripts/photo_ai_description_helpers.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const photoIndexPath = path.join(rootDir, 'src', 'data', 'photoIndex.json')
const photosDir = path.join(rootDir, 'public', 'photos')
const swiftScriptPath = path.join(rootDir, 'scripts', 'write_photo_metadata.swift')
const swiftCachePath = path.join(os.tmpdir(), 'codex-swift-cache')

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.name = 'RequestError'
    this.statusCode = statusCode
  }
}

function readPhotoIndex() {
  const parsed = JSON.parse(readFileSync(photoIndexPath, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error('photoIndex.json must contain an array.')
  }

  return parsed
}

function writePhotoIndex(nextValue) {
  writeFileSync(photoIndexPath, `${JSON.stringify(nextValue, null, 2)}\n`)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = ''

    request.on('data', (chunk) => {
      rawBody += chunk

      if (rawBody.length > 1_000_000) {
        reject(new Error('Request body is too large.'))
        request.destroy()
      }
    })

    request.on('end', () => {
      if (!rawBody) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(rawBody))
      } catch {
        reject(new Error('Request body must be valid JSON.'))
      }
    })

    request.on('error', reject)
  })
}

function normalizeCoordinate(rawValue, minimum, maximum, label) {
  const numericValue = Number(rawValue)
  if (!Number.isFinite(numericValue) || numericValue < minimum || numericValue > maximum) {
    throw new RequestError(400, `${label} must be between ${minimum} and ${maximum}.`)
  }

  return Number(numericValue.toFixed(6))
}

function normalizeOptionalText(rawValue) {
  if (rawValue == null) {
    return null
  }

  const text = String(rawValue).trim()
  return text === '' ? null : text
}

function normalizeRequiredText(rawValue, label) {
  const text = normalizeOptionalText(rawValue)
  if (!text) {
    throw new RequestError(400, `${label} is required.`)
  }

  return text
}

function normalizeAiDescription(rawValue) {
  if (rawValue == null || rawValue === '') {
    return null
  }

  let parsedValue = rawValue
  if (typeof rawValue === 'string') {
    try {
      parsedValue = JSON.parse(rawValue)
    } catch {
      throw new RequestError(400, 'AI description must be valid JSON or blank.')
    }
  }

  try {
    return AiDescriptionSchema.parse(parsedValue)
  } catch (error) {
    const firstIssue = error?.issues?.[0]
    const pathLabel = firstIssue?.path?.length ? firstIssue.path.join('.') : 'aiDescription'
    const message = firstIssue?.message ?? 'AI description is invalid.'
    throw new RequestError(400, `${pathLabel}: ${message}`)
  }
}

function normalizeOptionalInteger(rawValue, label, { minimum = null, maximum = null } = {}) {
  if (rawValue == null || rawValue === '') {
    return null
  }

  const numericValue = Number(rawValue)
  if (!Number.isInteger(numericValue)) {
    throw new RequestError(400, `${label} must be a whole number.`)
  }
  if (minimum != null && numericValue < minimum) {
    throw new RequestError(400, `${label} must be at least ${minimum}.`)
  }
  if (maximum != null && numericValue > maximum) {
    throw new RequestError(400, `${label} must be at most ${maximum}.`)
  }

  return numericValue
}

function normalizeOptionalNumber(
  rawValue,
  label,
  { minimum = null, maximum = null, precision = null } = {},
) {
  if (rawValue == null || rawValue === '') {
    return null
  }

  const numericValue = Number(rawValue)
  if (!Number.isFinite(numericValue)) {
    throw new RequestError(400, `${label} must be a number.`)
  }
  if (minimum != null && numericValue < minimum) {
    throw new RequestError(400, `${label} must be at least ${minimum}.`)
  }
  if (maximum != null && numericValue > maximum) {
    throw new RequestError(400, `${label} must be at most ${maximum}.`)
  }

  return precision == null ? numericValue : Number(numericValue.toFixed(precision))
}

function normalizeTimestamp(rawValue) {
  const captureTimestamp = normalizeRequiredText(rawValue, 'Capture timestamp')
  const match = captureTimestamp.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/,
  )

  if (!match) {
    throw new RequestError(400, 'Capture timestamp must use YYYY-MM-DD HH:MM:SS +0000.')
  }

  const [, year, month, day, hour, minute, second] = match
  return {
    captureTimestamp,
    captureDate: `${year}${month}${day}`,
    captureExifTimestamp: `${year}:${month}:${day} ${hour}:${minute}:${second}`,
  }
}

function normalizeMetadataFields(fields, currentEntry) {
  const timestamp = normalizeTimestamp(fields.captureTimestamp ?? currentEntry.captureTimestamp)
  const camera = normalizeRequiredText(fields.camera ?? currentEntry.camera, 'Camera')
  const lens = normalizeOptionalText(fields.lens ?? currentEntry.lens)
  const focalLength = normalizeOptionalNumber(fields.focalLength, 'Focal length', { minimum: 0 })
  const focalLength35mm = normalizeOptionalInteger(
    fields.focalLength35mm,
    '35mm focal length',
    { minimum: 0 },
  )
  const iso = normalizeOptionalInteger(fields.iso, 'ISO', { minimum: 0 })
  const exposureTimeSeconds = normalizeOptionalNumber(
    fields.exposureTimeSeconds,
    'Exposure time',
    { minimum: 0 },
  )
  const aperture = normalizeOptionalNumber(fields.aperture, 'Aperture', { minimum: 0 })
  const flashOn = normalizeOptionalInteger(fields.flashOn, 'Flash', { minimum: 0 })
  const meteringMode = normalizeOptionalInteger(fields.meteringMode, 'Metering mode', {
    minimum: 0,
  })
  const whiteBalance = normalizeOptionalInteger(fields.whiteBalance, 'White balance', {
    minimum: 0,
  })
  const latitude =
    fields.latitude == null || fields.latitude === ''
      ? null
      : normalizeCoordinate(fields.latitude, -90, 90, 'Latitude')
  const longitude =
    fields.longitude == null || fields.longitude === ''
      ? null
      : normalizeCoordinate(fields.longitude, -180, 180, 'Longitude')
  const altitude = normalizeOptionalNumber(fields.altitude, 'Altitude', { precision: 6 })
  const imageDirection = normalizeOptionalNumber(fields.imageDirection, 'Image direction', {
    minimum: 0,
    maximum: 360,
    precision: 6,
  })
  const aiDescription = normalizeAiDescription(fields.aiDescription)

  if ((latitude == null) !== (longitude == null)) {
    throw new RequestError(400, 'Latitude and longitude must be set together.')
  }

  if ((altitude != null || imageDirection != null) && (latitude == null || longitude == null)) {
    throw new RequestError(400, 'Altitude and direction require latitude and longitude.')
  }

  return {
    ...timestamp,
    camera,
    lens,
    focalLength,
    focalLength35mm,
    iso,
    exposureTimeSeconds,
    aperture,
    flashOn,
    meteringMode,
    whiteBalance,
    latitude,
    longitude,
    altitude,
    imageDirection,
    aiDescription,
  }
}

async function fetchElevationFromOpenTopoData(latitude, longitude) {
  const locations = `${latitude},${longitude}`
  const response = await fetch(
    `https://api.opentopodata.org/v1/aster30m?locations=${encodeURIComponent(locations)}`,
  )

  if (!response.ok) {
    throw new Error(`Elevation lookup failed with status ${response.status}.`)
  }

  const payload = await response.json()
  if (payload?.status !== 'OK') {
    throw new Error('Elevation service returned an unexpected response.')
  }

  const elevation = payload?.results?.[0]?.elevation
  if (typeof elevation !== 'number' || !Number.isFinite(elevation)) {
    throw new Error('No elevation was returned for those coordinates.')
  }

  return Number(elevation.toFixed(2))
}

function applyMetadataToPhotoEntry(currentEntry, metadata) {
  return {
    ...currentEntry,
    captureTimestamp: metadata.captureTimestamp,
    captureDate: metadata.captureDate,
    camera: metadata.camera,
    lens: metadata.lens,
    focalLength: metadata.focalLength,
    focalLength35mm: metadata.focalLength35mm,
    iso: metadata.iso,
    exposureTimeSeconds: metadata.exposureTimeSeconds,
    aperture: metadata.aperture,
    flashOn: metadata.flashOn,
    meteringMode: metadata.meteringMode,
    whiteBalance: metadata.whiteBalance,
    latitude: metadata.latitude,
    longitude: metadata.longitude,
    altitude: metadata.altitude,
    imageDirection: metadata.imageDirection,
    aiDescription: metadata.aiDescription,
    exifLatitude: metadata.latitude,
    exifLongitude: metadata.longitude,
    geotagSource:
      metadata.latitude != null && metadata.longitude != null ? 'exif' : null,
    geotagUpdatedAt: null,
  }
}

function updateCameraModel(imagePath, camera) {
  const tempPath = path.join(
    os.tmpdir(),
    `codex-camera-${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(imagePath)}`,
  )

  try {
    execFileSync('sips', ['-s', 'model', camera, imagePath, '--out', tempPath], {
      encoding: 'utf8',
      stdio: 'ignore',
    })
    copyFileSync(tempPath, imagePath)
  } finally {
    try {
      unlinkSync(tempPath)
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

function updateExifMetadata(imagePath, metadata) {
  mkdirSync(swiftCachePath, { recursive: true })
  const exifPayload = {
    ...metadata,
    aiDescription:
      metadata.aiDescription == null ? null : JSON.stringify(metadata.aiDescription),
  }

  execFileSync('swift', [swiftScriptPath, imagePath, JSON.stringify(exifPayload)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SWIFT_MODULECACHE_PATH: swiftCachePath,
      CLANG_MODULE_CACHE_PATH: swiftCachePath,
    },
  })
}

function rewriteImageMetadata(imagePath, metadata) {
  const tempImagePath = path.join(
    os.tmpdir(),
    `codex-photo-${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(imagePath)}`,
  )

  try {
    copyFileSync(imagePath, tempImagePath)
    updateCameraModel(tempImagePath, metadata.camera)
    updateExifMetadata(tempImagePath, metadata)
    copyFileSync(tempImagePath, imagePath)
  } finally {
    try {
      unlinkSync(tempImagePath)
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

function writeJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(`${JSON.stringify(payload)}\n`)
}

function photoIndexMetadataApi() {
  return {
    name: 'photoindex-metadata-api',
    configureServer(server) {
      server.middlewares.use('/api/photoindex', (request, response, next) => {
        if (request.method !== 'GET') {
          next()
          return
        }

        const url = new URL(request.originalUrl ?? request.url ?? '', 'http://localhost')
        if (url.pathname !== '/api/photoindex') {
          next()
          return
        }

        try {
          writeJson(response, 200, { photos: readPhotoIndex() })
        } catch (error) {
          writeJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to read photoIndex.json.',
          })
        }
      })

      server.middlewares.use('/api/elevation', async (request, response, next) => {
        if (request.method !== 'GET') {
          next()
          return
        }

        try {
          const url = new URL(request.originalUrl ?? request.url ?? '', 'http://localhost')
          const latitude = normalizeCoordinate(url.searchParams.get('lat'), -90, 90, 'Latitude')
          const longitude = normalizeCoordinate(
            url.searchParams.get('lng'),
            -180,
            180,
            'Longitude',
          )
          const altitude = await fetchElevationFromOpenTopoData(latitude, longitude)

          writeJson(response, 200, { altitude, source: 'OpenTopoData', dataset: 'aster30m' })
        } catch (error) {
          if (error instanceof RequestError) {
            writeJson(response, error.statusCode, { error: error.message })
            return
          }

          writeJson(response, 502, {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to fetch altitude from the elevation service.',
          })
        }
      })

      server.middlewares.use('/api/photoindex/metadata', async (request, response, next) => {
        if (request.method !== 'POST') {
          next()
          return
        }

        try {
          const payload = await readJsonBody(request)
          if (!payload || typeof payload !== 'object') {
            writeJson(response, 400, { error: 'Request body must be an object.' })
            return
          }

          if (typeof payload.filename !== 'string' || payload.filename.trim() === '') {
            writeJson(response, 400, { error: 'A filename is required.' })
            return
          }
          if (!payload.fields || typeof payload.fields !== 'object') {
            writeJson(response, 400, { error: 'A fields object is required.' })
            return
          }

          const currentPhotoIndex = readPhotoIndex()
          const photoIndexPosition = currentPhotoIndex.findIndex(
            (entry) => entry?.filename === payload.filename,
          )

          if (photoIndexPosition === -1) {
            writeJson(response, 404, { error: `Photo "${payload.filename}" was not found.` })
            return
          }

          const currentEntry = currentPhotoIndex[photoIndexPosition]
          const normalizedFields = normalizeMetadataFields(payload.fields, currentEntry)
          const imagePath = path.join(photosDir, currentEntry.filename)

          rewriteImageMetadata(imagePath, normalizedFields)

          const updatedEntry = applyMetadataToPhotoEntry(currentEntry, normalizedFields)
          const nextPhotoIndex = [...currentPhotoIndex]
          nextPhotoIndex[photoIndexPosition] = updatedEntry

          writePhotoIndex(nextPhotoIndex)
          writeJson(response, 200, { photo: updatedEntry })
        } catch (error) {
          if (error instanceof RequestError) {
            writeJson(response, error.statusCode, { error: error.message })
            return
          }

          writeJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'Unable to update image metadata and photoIndex.json.',
          })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), photoIndexMetadataApi()],
})
