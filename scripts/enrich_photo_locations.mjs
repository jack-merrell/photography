import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const photoIndexPath = path.join(rootDir, 'src', 'data', 'photoIndex.json')
const USER_AGENT = 'mac-keller-jr-photography/1.0 (local archive location enrichment)'
const REQUEST_DELAY_MS = 1100

const localityFields = [
  'city',
  'town',
  'village',
  'municipality',
  'city_district',
  'suburb',
  'borough',
  'hamlet',
  'county',
  'state_district',
  'state',
]

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function readPhotoIndex() {
  const parsed = JSON.parse(readFileSync(photoIndexPath, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error('src/data/photoIndex.json must contain an array.')
  }

  return parsed
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getCoordinateKey(photo) {
  if (typeof photo.latitude !== 'number' || typeof photo.longitude !== 'number') {
    return null
  }

  return `${photo.latitude.toFixed(6)},${photo.longitude.toFixed(6)}`
}

function pickLocalityName(address) {
  for (const field of localityFields) {
    const value = normalizeText(address?.[field])
    if (value) {
      return value
    }
  }

  return null
}

function toAsciiCode(value) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s-]+/g, ' ')
    .trim()

  if (!normalized) {
    return null
  }

  const lettersOnly = normalized.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return lettersOnly ? lettersOnly.slice(0, 3) : null
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lon', String(longitude))
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('zoom', '10')
  url.searchParams.set('accept-language', 'en')

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with status ${response.status}.`)
  }

  const payload = await response.json()
  const address = payload?.address ?? {}
  const locationCity = pickLocalityName(address)
  const locationCountryName = normalizeText(address.country)
  const rawCountryCode = normalizeText(address.country_code)

  return {
    locationCity,
    locationCityCode: locationCity ? toAsciiCode(locationCity) : null,
    locationCountryName,
    locationCountryCode: rawCountryCode ? rawCountryCode.toUpperCase() : null,
  }
}

async function main() {
  const photoIndex = readPhotoIndex()
  const cache = new Map()
  let enrichedCount = 0
  let clearedCount = 0
  let requestCount = 0

  for (const photo of photoIndex) {
    const coordinateKey = getCoordinateKey(photo)

    if (!coordinateKey) {
      if (
        photo.locationCity != null ||
        photo.locationCityCode != null ||
        photo.locationCountryName != null ||
        photo.locationCountryCode != null
      ) {
        photo.locationCity = null
        photo.locationCityCode = null
        photo.locationCountryName = null
        photo.locationCountryCode = null
        clearedCount += 1
      }
      continue
    }

    if (!cache.has(coordinateKey)) {
      const [latitude, longitude] = coordinateKey.split(',').map(Number)
      cache.set(coordinateKey, await reverseGeocode(latitude, longitude))
      requestCount += 1

      if (requestCount < photoIndex.length) {
        await sleep(REQUEST_DELAY_MS)
      }
    }

    const location = cache.get(coordinateKey)
    const hasChanged =
      photo.locationCity !== location.locationCity ||
      photo.locationCityCode !== location.locationCityCode ||
      photo.locationCountryName !== location.locationCountryName ||
      photo.locationCountryCode !== location.locationCountryCode

    if (hasChanged) {
      photo.locationCity = location.locationCity
      photo.locationCityCode = location.locationCityCode
      photo.locationCountryName = location.locationCountryName
      photo.locationCountryCode = location.locationCountryCode
      enrichedCount += 1
    }
  }

  writeFileSync(photoIndexPath, `${JSON.stringify(photoIndex, null, 2)}\n`)

  console.log(
    `Updated ${enrichedCount} photo rows with location codes and cleared ${clearedCount}. Reverse-geocoded ${requestCount} unique coordinate pairs.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
