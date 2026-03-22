import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import photoIndex from '../data/photoIndex.json'
import {
  formatCamera,
  formatDate,
  formatDimensions,
  formatTime,
} from '../lib/photoFormatters'
import './GeotagPage.css'

const DEFAULT_CENTER = [20, 0]
const DEFAULT_ZOOM = 2
const DETAIL_ZOOM = 12

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function roundCoordinate(value) {
  return Number(value.toFixed(6))
}

function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function draftValue(value) {
  return value == null ? '' : String(value)
}

function stringifyAiDescription(value) {
  if (!value) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function formatTimestampForInput(timestamp) {
  if (!timestamp) {
    return ''
  }

  const match = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) [+-]\d{4}$/,
  )

  if (!match) {
    return ''
  }

  const [, year, month, day, hour, minute] = match
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function formatInputTimestampForSave(value) {
  if (!value) {
    return ''
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/)
  if (!match) {
    return value
  }

  const [, date, hour, minute] = match
  return `${date} ${hour}:${minute}:00 +0000`
}

function getPhotoCoordinates(photo) {
  if (isFiniteCoordinate(photo.latitude) && isFiniteCoordinate(photo.longitude)) {
    return {
      latitude: photo.latitude,
      longitude: photo.longitude,
    }
  }

  return null
}

function parseAiDescriptionDraft(rawValue) {
  const value = rawValue.trim()

  if (!value) {
    return { value: null, error: null }
  }

  try {
    const parsedValue = JSON.parse(value)
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return { value: null, error: 'AI description JSON must be an object.' }
    }

    return { value: parsedValue, error: null }
  } catch {
    return { value: null, error: 'AI description JSON must be valid JSON.' }
  }
}

function getLandmarkAnnotations(aiDescription) {
  if (!aiDescription || typeof aiDescription !== 'object') {
    return []
  }

  const annotations = aiDescription.landmarkAnnotations
  if (!Array.isArray(annotations)) {
    return []
  }

  return annotations.filter((annotation) => {
    if (!annotation || typeof annotation !== 'object' || typeof annotation.label !== 'string') {
      return false
    }

    if (
      annotation.kind === 'point' &&
      typeof annotation.x === 'number' &&
      typeof annotation.y === 'number'
    ) {
      return true
    }

    return (
      annotation.kind === 'box' &&
      typeof annotation.x === 'number' &&
      typeof annotation.y === 'number' &&
      typeof annotation.width === 'number' &&
      typeof annotation.height === 'number'
    )
  })
}

function mergeAiDraftsIntoPhotos(photos, drafts) {
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return { nextPhotos: photos, draftCount: 0 }
  }

  const draftByFilename = new Map(
    drafts
      .filter((draft) => draft && typeof draft.filename === 'string')
      .map((draft) => [draft.filename, draft.aiDescription ?? null]),
  )

  let draftCount = 0
  const nextPhotos = photos.map((photo) => {
    if (photo.aiDescription || !draftByFilename.has(photo.filename)) {
      return photo
    }

    draftCount += 1
    return {
      ...photo,
      aiDescription: draftByFilename.get(photo.filename),
    }
  })

  return { nextPhotos, draftCount }
}

function createMetadataDraft(photo) {
  return {
    captureTimestamp: formatTimestampForInput(photo.captureTimestamp),
    camera: photo.camera ?? '',
    lens: draftValue(photo.lens),
    focalLength: draftValue(photo.focalLength),
    focalLength35mm: draftValue(photo.focalLength35mm),
    iso: draftValue(photo.iso),
    exposureTimeSeconds: draftValue(photo.exposureTimeSeconds),
    aperture: draftValue(photo.aperture),
    flashOn: draftValue(photo.flashOn),
    meteringMode: draftValue(photo.meteringMode),
    whiteBalance: draftValue(photo.whiteBalance),
    latitude: draftValue(photo.latitude),
    longitude: draftValue(photo.longitude),
    altitude: draftValue(photo.altitude),
    imageDirection: draftValue(photo.imageDirection),
    aiDescription: stringifyAiDescription(photo.aiDescription),
  }
}

function createSaveFields(draft) {
  return {
    ...draft,
    captureTimestamp: formatInputTimestampForSave(draft.captureTimestamp),
  }
}

function formatAiValue(value) {
  if (value == null || value === '') {
    return '—'
  }

  return String(value).replaceAll('_', ' ')
}

function formatAiLabel(value) {
  return formatAiValue(value).replace(/\b\w/g, (character) => character.toUpperCase())
}

function getAiTagSections(aiDescription) {
  if (!aiDescription || typeof aiDescription !== 'object' || !aiDescription.tags) {
    return []
  }

  const sections = [
    ['Genres', aiDescription.tags.genres],
    ['Presence', aiDescription.tags.presence],
    ['Subjects', aiDescription.tags.subjectTags],
    ['Setting', aiDescription.tags.settingTags],
    ['Style', aiDescription.tags.styleTags],
  ]

  return sections
    .map(([label, values]) => [
      label,
      Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : [],
    ])
    .filter(([, values]) => values.length > 0)
}

function shouldHydrateAiDescriptionDraft(metadataDraft, savedMetadataDraft) {
  if (!metadataDraft || !savedMetadataDraft) {
    return false
  }

  const currentAiDescription = metadataDraft.aiDescription.trim()
  const nextAiDescription = savedMetadataDraft.aiDescription.trim()

  if (currentAiDescription || !nextAiDescription) {
    return false
  }

  const currentWithoutAi = createSaveFields({
    ...metadataDraft,
    aiDescription: '',
  })
  const savedWithoutAi = createSaveFields({
    ...savedMetadataDraft,
    aiDescription: '',
  })

  return JSON.stringify(currentWithoutAi) === JSON.stringify(savedWithoutAi)
}

function collectExistingValues(entries, field) {
  return [...new Set(
    entries
      .map((entry) => entry[field])
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()),
  )].sort((left, right) => left.localeCompare(right))
}

function parsePreviewCoordinates(latitudeRawValue, longitudeRawValue) {
  const latitudeValue = latitudeRawValue.trim()
  const longitudeValue = longitudeRawValue.trim()

  if (!latitudeValue && !longitudeValue) {
    return { coordinates: null, error: null }
  }

  if (!latitudeValue || !longitudeValue) {
    return { coordinates: null, error: 'Enter both latitude and longitude.' }
  }

  const latitude = Number(latitudeValue)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { coordinates: null, error: 'Latitude must be between -90 and 90.' }
  }

  const longitude = Number(longitudeValue)
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { coordinates: null, error: 'Longitude must be between -180 and 180.' }
  }

  return {
    coordinates: {
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
    },
    error: null,
  }
}

function RecenterMap({ center, zoom }) {
  const map = useMap()

  useEffect(() => {
    map.setView(center, zoom, { animate: true })
  }, [center, map, zoom])

  return null
}

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng)
    },
  })

  return null
}

export default function GeotagPage() {
  const [photoEntries, setPhotoEntries] = useState(() => photoIndex)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [metadataDraft, setMetadataDraft] = useState(() => createMetadataDraft(photoIndex[0]))
  const [isSaving, setIsSaving] = useState(false)
  const [isFetchingAltitude, setIsFetchingAltitude] = useState(false)
  const [manualGpsLookupVersion, setManualGpsLookupVersion] = useState(0)
  const [destructiveUnlockValue, setDestructiveUnlockValue] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [draftLoadMessage, setDraftLoadMessage] = useState('')
  const lastAltitudeLookupKeyRef = useRef('')
  const lastManualGpsLookupVersionRef = useRef(0)
  const lastAutoSaveSnapshotRef = useRef('')
  const mapRef = useRef(null)

  const currentPhoto = photoEntries[currentIndex]
  const savedMetadataDraft = useMemo(() => createMetadataDraft(currentPhoto), [currentPhoto])
  const cameraOptions = useMemo(() => collectExistingValues(photoEntries, 'camera'), [photoEntries])
  const lensOptions = useMemo(() => collectExistingValues(photoEntries, 'lens'), [photoEntries])
  const currentCoordinates = useMemo(() => getPhotoCoordinates(currentPhoto), [currentPhoto])
  const previewResult = useMemo(
    () => parsePreviewCoordinates(metadataDraft.latitude, metadataDraft.longitude),
    [metadataDraft.latitude, metadataDraft.longitude],
  )
  const aiDescriptionPreview = useMemo(
    () => parseAiDescriptionDraft(metadataDraft.aiDescription),
    [metadataDraft.aiDescription],
  )
  const aiDescriptionValue = aiDescriptionPreview.value
  const landmarkAnnotations = useMemo(
    () => getLandmarkAnnotations(aiDescriptionValue),
    [aiDescriptionValue],
  )
  const aiTagSections = useMemo(() => getAiTagSections(aiDescriptionValue), [aiDescriptionValue])
  const currentAiStatus = useMemo(() => {
    if (aiDescriptionPreview.error) {
      return aiDescriptionPreview.error
    }

    if (landmarkAnnotations.length) {
      return `AI overlays active for this photo: ${landmarkAnnotations.length} landmark annotation${landmarkAnnotations.length === 1 ? '' : 's'}.`
    }

    if (currentPhoto.aiDescription) {
      return 'AI description loaded for this photo, but it does not include landmark overlays.'
    }

    return 'No AI draft data loaded for this photo yet.'
  }, [
    aiDescriptionPreview.error,
    currentPhoto.aiDescription,
    landmarkAnnotations.length,
  ])
  const aiStatusTone = aiDescriptionPreview.error
    ? 'error'
    : landmarkAnnotations.length
      ? 'active'
      : aiDescriptionValue
        ? 'ready'
        : 'idle'
  const previewCoordinates = previewResult.coordinates ?? currentCoordinates
  const currentDraftSnapshot = useMemo(
    () => JSON.stringify(createSaveFields(metadataDraft)),
    [metadataDraft],
  )
  const savedDraftSnapshot = useMemo(
    () => JSON.stringify(createSaveFields(savedMetadataDraft)),
    [savedMetadataDraft],
  )
  const hasPendingChanges = currentDraftSnapshot !== savedDraftSnapshot
  const isDestructiveUnlocked = destructiveUnlockValue.trim() === currentPhoto.filename

  const center = previewCoordinates
    ? [previewCoordinates.latitude, previewCoordinates.longitude]
    : DEFAULT_CENTER
  const zoom = previewCoordinates ? DETAIL_ZOOM : DEFAULT_ZOOM

  const showPhotoAt = useCallback(
    (nextIndex) => {
      const safeIndex = Math.min(Math.max(nextIndex, 0), photoEntries.length - 1)
      const nextPhoto = photoEntries[safeIndex]

      setCurrentIndex(safeIndex)
      setMetadataDraft(createMetadataDraft(nextPhoto))
      lastAltitudeLookupKeyRef.current = ''
      lastManualGpsLookupVersionRef.current = 0
      lastAutoSaveSnapshotRef.current = ''
      setManualGpsLookupVersion(0)
      setDestructiveUnlockValue('')
      setSaveMessage('')
      setSaveError('')
    },
    [photoEntries],
  )

  const applyUpdatedPhoto = (updatedPhoto) => {
    setPhotoEntries((current) =>
      current.map((photo) => (photo.filename === updatedPhoto.filename ? updatedPhoto : photo)),
    )
  }

  const handleDraftChange = (field, value) => {
    setMetadataDraft((current) => ({
      ...current,
      [field]: value,
    }))
    setSaveMessage('')
    setSaveError('')
  }

  const handleGpsFieldChange = (field, value) => {
    handleDraftChange(field, value)
    setManualGpsLookupVersion((current) => current + 1)
  }

  const fetchAltitude = async (latitude, longitude) => {
    setIsFetchingAltitude(true)

    try {
      const response = await fetch(
        `/api/elevation?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`,
      )
      const responseBody = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(responseBody?.error ?? 'Unable to fetch altitude.')
      }

      setMetadataDraft((current) => ({
        ...current,
        altitude: String(responseBody.altitude),
      }))
      setSaveMessage('Altitude filled from the elevation service.')
      setSaveError('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to fetch altitude.')
      setSaveMessage('')
    } finally {
      setIsFetchingAltitude(false)
    }
  }

  const handleMapSelection = async (latlng) => {
    if (isSaving || isFetchingAltitude) {
      return
    }

    const latitude = String(roundCoordinate(latlng.lat))
    const longitude = String(roundCoordinate(latlng.lng))

    setMetadataDraft((current) => ({
      ...current,
      latitude,
      longitude,
    }))
    lastAltitudeLookupKeyRef.current = `${currentPhoto.filename}:${latitude},${longitude}`
    setSaveMessage('')
    setSaveError('')

    await fetchAltitude(latitude, longitude)
  }

  const handleReset = () => {
    if (
      !isDestructiveUnlocked ||
      !window.confirm(`Reset all editor fields for ${currentPhoto.filename} back to the last saved values?`)
    ) {
      return
    }

    setMetadataDraft(createMetadataDraft(currentPhoto))
    lastAltitudeLookupKeyRef.current = ''
    lastManualGpsLookupVersionRef.current = 0
    lastAutoSaveSnapshotRef.current = ''
    setManualGpsLookupVersion(0)
    setDestructiveUnlockValue('')
    setSaveMessage('')
    setSaveError('')
  }

  const clearGpsFields = () => {
    if (
      !isDestructiveUnlocked ||
      !window.confirm(`Clear and save all GPS fields for ${currentPhoto.filename}?`)
    ) {
      return
    }

    setMetadataDraft((current) => ({
      ...current,
      latitude: '',
      longitude: '',
      altitude: '',
      imageDirection: '',
    }))
    lastAltitudeLookupKeyRef.current = ''
    lastManualGpsLookupVersionRef.current = 0
    lastAutoSaveSnapshotRef.current = ''
    setManualGpsLookupVersion(0)
    setDestructiveUnlockValue('')
    setSaveMessage('')
    setSaveError('')
  }

  const handleFetchAltitude = async () => {
    if (!previewResult.coordinates) {
      setSaveError(previewResult.error ?? 'Enter latitude and longitude first.')
      setSaveMessage('')
      return
    }

    await fetchAltitude(previewResult.coordinates.latitude, previewResult.coordinates.longitude)
  }

  const handleSave = useCallback(
    async (draftToSave = metadataDraft, saveSource = 'manual') => {
      const aiDescriptionDraft = parseAiDescriptionDraft(draftToSave.aiDescription)
      if (aiDescriptionDraft.error) {
        setSaveError(aiDescriptionDraft.error)
        setSaveMessage('')
        return
      }

      setIsSaving(true)
      setSaveMessage('')
      setSaveError('')
      lastAutoSaveSnapshotRef.current = JSON.stringify(createSaveFields(draftToSave))

      try {
        const response = await fetch('/api/photoindex/metadata', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: currentPhoto.filename,
            fields: createSaveFields(draftToSave),
          }),
        })

        const responseBody = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(responseBody?.error ?? 'Unable to update photoIndex.json.')
        }

        applyUpdatedPhoto(responseBody.photo)
        setMetadataDraft(createMetadataDraft(responseBody.photo))
        setSaveMessage('Updated file metadata and photoIndex.json.')
        if (saveSource === 'auto' || saveSource === 'manual') {
          lastAutoSaveSnapshotRef.current = ''
        }
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : 'Unable to update image metadata and photoIndex.json.',
        )
      } finally {
        setIsSaving(false)
      }
    },
    [currentPhoto.filename, metadataDraft],
  )

  useEffect(() => {
    if (
      !manualGpsLookupVersion ||
      manualGpsLookupVersion === lastManualGpsLookupVersionRef.current ||
      !previewResult.coordinates ||
      isSaving ||
      isFetchingAltitude
    ) {
      return undefined
    }

    const lookupKey = `${currentPhoto.filename}:${previewResult.coordinates.latitude},${previewResult.coordinates.longitude}`
    if (lookupKey === lastAltitudeLookupKeyRef.current && metadataDraft.altitude.trim()) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      lastManualGpsLookupVersionRef.current = manualGpsLookupVersion
      lastAltitudeLookupKeyRef.current = lookupKey
      void fetchAltitude(previewResult.coordinates.latitude, previewResult.coordinates.longitude)
    }, 450)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    currentPhoto.filename,
    isFetchingAltitude,
    isSaving,
    manualGpsLookupVersion,
    metadataDraft.altitude,
    previewResult.coordinates,
  ])

  useEffect(() => {
    if (
      !hasPendingChanges ||
      isSaving ||
      isFetchingAltitude ||
      aiDescriptionPreview.error ||
      previewResult.error ||
      currentDraftSnapshot === lastAutoSaveSnapshotRef.current
    ) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      lastAutoSaveSnapshotRef.current = currentDraftSnapshot
      void handleSave(metadataDraft, 'auto')
    }, 900)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    currentDraftSnapshot,
    handleSave,
    hasPendingChanges,
    isFetchingAltitude,
    isSaving,
    metadataDraft,
    aiDescriptionPreview.error,
    previewResult.error,
  ])

  useEffect(() => {
    let isActive = true

    async function loadAiDrafts() {
      try {
        const response = await fetch('/api/photoindex/ai-drafts', { cache: 'no-store' })
        const responseBody = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(responseBody?.error ?? 'Unable to load AI draft descriptions.')
        }

        if (!isActive) {
          return
        }

        let loadedDraftCount = 0
        setPhotoEntries((current) => {
          const { nextPhotos, draftCount } = mergeAiDraftsIntoPhotos(
            current,
            responseBody?.drafts ?? [],
          )
          loadedDraftCount = draftCount
          return nextPhotos
        })
        setDraftLoadMessage(
          loadedDraftCount
            ? `Loaded ${loadedDraftCount} AI draft ${loadedDraftCount === 1 ? 'entry' : 'entries'} from tmp/photo-ai-descriptions.draft.json.`
            : '',
        )
      } catch (error) {
        if (!isActive) {
          return
        }

        setDraftLoadMessage(
          error instanceof Error ? error.message : 'Unable to load AI draft descriptions.',
        )
      }
    }

    void loadAiDrafts()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (hasPendingChanges && !shouldHydrateAiDescriptionDraft(metadataDraft, savedMetadataDraft)) {
      return
    }

    setMetadataDraft(createMetadataDraft(currentPhoto))
  }, [currentPhoto, hasPendingChanges, metadataDraft, savedMetadataDraft])

  useEffect(() => {
    const handleKeydown = (event) => {
      const target = event.target
      const tagName = target instanceof HTMLElement ? target.tagName : ''
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT')

      if (isEditableTarget || isSaving) {
        return
      }

      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault()
        showPhotoAt(currentIndex - 1)
      }

      if (event.key === 'ArrowRight' && currentIndex < photoEntries.length - 1) {
        event.preventDefault()
        showPhotoAt(currentIndex + 1)
      }

      if ((event.key === '+' || event.key === '=') && mapRef.current) {
        event.preventDefault()
        mapRef.current.zoomIn()
      }

      if ((event.key === '-' || event.key === '_') && mapRef.current) {
        event.preventDefault()
        mapRef.current.zoomOut()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [currentIndex, isSaving, photoEntries.length, showPhotoAt])

  return (
    <main className="geotag-page">
      <header className="geotag-header">
        <div>
          <p className="geotag-kicker">Mac Keller Jr.</p>
          <h1 className="geotag-title">EXIF data updater</h1>
          <p className="geotag-subtitle">
            Edit the image data, rewrite supported file metadata, and keep photoIndex.json in sync.
          </p>
        </div>

        <div className="geotag-actions">
          <p className="geotag-count">
            Photo {currentIndex + 1}/{photoEntries.length}
          </p>
          <Link className="geotag-link" to="/">
            Back to archive
          </Link>
        </div>
      </header>

      <section className="geotag-toolbar">
        <button
          className="geotag-button"
          disabled={isSaving || currentIndex === 0}
          onClick={() => showPhotoAt(currentIndex - 1)}
          type="button"
        >
          Previous
        </button>
        <div className="geotag-toolbar-center">
          <span>{currentPhoto.id}</span>
          <span>{currentPhoto.filename}</span>
        </div>
        <button
          className="geotag-button"
          disabled={isSaving || currentIndex === photoEntries.length - 1}
          onClick={() => showPhotoAt(currentIndex + 1)}
          type="button"
        >
          Next
        </button>
      </section>

      <section className="geotag-layout">
        <article className="geotag-panel geotag-photo-panel">
          <div className="geotag-photo-meta">
            <p>{formatDate(currentPhoto.captureTimestamp)}</p>
            <p>{formatTime(currentPhoto.captureTimestamp)} UTC</p>
            <p>{formatCamera(currentPhoto.camera)}</p>
            <p>{formatDimensions(currentPhoto.width, currentPhoto.height)}</p>
          </div>

          <div className="geotag-photo-frame">
            <div className="geotag-photo-stage">
              <img
                alt=""
                className="geotag-photo-image"
                src={`/previews/${currentPhoto.filename}`}
              />
              {landmarkAnnotations.length ? (
                <div className="geotag-photo-overlay">
                  {landmarkAnnotations.map((annotation, index) => {
                    if (annotation.kind === 'point') {
                      return (
                        <div
                          className="geotag-landmark geotag-landmark-point"
                          key={`${annotation.label}-${index}`}
                          style={{
                            left: `${annotation.x * 100}%`,
                            top: `${annotation.y * 100}%`,
                          }}
                        >
                          <span className="geotag-landmark-dot" />
                          <span className="geotag-landmark-label">{annotation.label}</span>
                        </div>
                      )
                    }

                    return (
                      <div
                        className="geotag-landmark geotag-landmark-box"
                        key={`${annotation.label}-${index}`}
                        style={{
                          left: `${annotation.x * 100}%`,
                          top: `${annotation.y * 100}%`,
                          width: `${annotation.width * 100}%`,
                          height: `${annotation.height * 100}%`,
                        }}
                      >
                        <span className="geotag-landmark-label">{annotation.label}</span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
          {aiDescriptionPreview.error ? (
            <p className="geotag-status geotag-status-error">{aiDescriptionPreview.error}</p>
          ) : landmarkAnnotations.length ? (
            <p className="geotag-status">
              Showing {landmarkAnnotations.length} landmark overlay
              {landmarkAnnotations.length === 1 ? '' : 's'} from the AI description.
            </p>
          ) : draftLoadMessage ? (
            <p className="geotag-status">{draftLoadMessage}</p>
          ) : null}

          <section className="geotag-ai-panel">
            <div className="geotag-ai-header">
              <div>
                <p className="geotag-kicker">AI analysis</p>
                <h2 className="geotag-ai-title">Readable summary</h2>
              </div>
              <span className={`geotag-ai-badge geotag-ai-badge-${aiStatusTone}`}>
                {aiDescriptionPreview.error
                  ? 'Invalid JSON'
                  : landmarkAnnotations.length
                    ? `${landmarkAnnotations.length} overlays`
                    : aiDescriptionValue
                      ? 'Loaded'
                      : 'Empty'}
              </span>
            </div>

            <p className={`geotag-ai-status${aiDescriptionPreview.error ? ' geotag-ai-status-error' : ''}`}>
              {currentAiStatus}
            </p>
            {draftLoadMessage ? <p className="geotag-ai-meta">{draftLoadMessage}</p> : null}

            {aiDescriptionValue ? (
              <div className="geotag-ai-content">
                <div className="geotag-ai-grid">
                  <div className="geotag-ai-stat">
                    <span className="geotag-label">Time of day</span>
                    <strong>{formatAiLabel(aiDescriptionValue.timeOfDay)}</strong>
                  </div>
                  <div className="geotag-ai-stat">
                    <span className="geotag-label">Setting</span>
                    <strong>{formatAiValue(aiDescriptionValue.setting)}</strong>
                  </div>
                  <div className="geotag-ai-stat">
                    <span className="geotag-label">Mood</span>
                    <strong>{formatAiValue(aiDescriptionValue.mood)}</strong>
                  </div>
                  <div className="geotag-ai-stat">
                    <span className="geotag-label">Lighting</span>
                    <strong>{formatAiValue(aiDescriptionValue.lighting)}</strong>
                  </div>
                  <div className="geotag-ai-stat">
                    <span className="geotag-label">Composition</span>
                    <strong>{formatAiValue(aiDescriptionValue.composition)}</strong>
                  </div>
                  <div className="geotag-ai-stat">
                    <span className="geotag-label">Landmark</span>
                    <strong>
                      {aiDescriptionValue.landmark?.isFamousLandmark
                        ? formatAiValue(aiDescriptionValue.landmark?.name) || 'Flagged'
                        : 'None flagged'}
                    </strong>
                  </div>
                </div>

                {aiDescriptionValue.description ? (
                  <div className="geotag-ai-copy">
                    <p className="geotag-label">Description</p>
                    <p>{aiDescriptionValue.description}</p>
                  </div>
                ) : null}

                {Array.isArray(aiDescriptionValue.subjects) && aiDescriptionValue.subjects.length ? (
                  <div className="geotag-ai-section">
                    <p className="geotag-label">Subjects</p>
                    <div className="geotag-ai-chip-row">
                      {aiDescriptionValue.subjects.map((subject) => (
                        <span className="geotag-ai-chip" key={subject}>
                          {subject}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(aiDescriptionValue.notableDetails) &&
                aiDescriptionValue.notableDetails.length ? (
                  <div className="geotag-ai-section">
                    <p className="geotag-label">Notable details</p>
                    <ul className="geotag-ai-list">
                      {aiDescriptionValue.notableDetails.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {aiTagSections.length ? (
                  <div className="geotag-ai-section">
                    <p className="geotag-label">Tags</p>
                    <div className="geotag-ai-tag-groups">
                      {aiTagSections.map(([label, values]) => (
                        <div className="geotag-ai-tag-group" key={label}>
                          <p className="geotag-ai-tag-title">{label}</p>
                          <div className="geotag-ai-chip-row">
                            {values.map((value) => (
                              <span className="geotag-ai-chip" key={`${label}-${value}`}>
                                {formatAiValue(value)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <form
            className="geotag-editor-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <label className="geotag-field geotag-field-wide">
              <span className="geotag-label">Capture timestamp</span>
              <input
                className="geotag-input"
                onChange={(event) => handleDraftChange('captureTimestamp', event.target.value)}
                step="60"
                type="datetime-local"
                value={metadataDraft.captureTimestamp}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Camera</span>
              <select
                className="geotag-input"
                onChange={(event) => {
                  if (event.target.value) {
                    handleDraftChange('camera', event.target.value)
                  }
                }}
                value=""
              >
                <option value="">Choose existing camera…</option>
                {cameraOptions.map((camera) => (
                  <option key={camera} value={camera}>
                    {camera}
                  </option>
                ))}
              </select>
              <input
                className="geotag-input"
                onChange={(event) => handleDraftChange('camera', event.target.value)}
                placeholder="Type a new camera or pick one above"
                type="text"
                value={metadataDraft.camera}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Lens</span>
              <select
                className="geotag-input"
                onChange={(event) => {
                  if (event.target.value) {
                    handleDraftChange('lens', event.target.value)
                  }
                }}
                value=""
              >
                <option value="">Choose existing lens…</option>
                {lensOptions.map((lens) => (
                  <option key={lens} value={lens}>
                    {lens}
                  </option>
                ))}
              </select>
              <input
                className="geotag-input"
                onChange={(event) => handleDraftChange('lens', event.target.value)}
                placeholder="Type a new lens or pick one above"
                type="text"
                value={metadataDraft.lens}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Focal length</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) => handleDraftChange('focalLength', event.target.value)}
                type="text"
                value={metadataDraft.focalLength}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">35mm focal length</span>
              <input
                className="geotag-input"
                inputMode="numeric"
                onChange={(event) => handleDraftChange('focalLength35mm', event.target.value)}
                type="text"
                value={metadataDraft.focalLength35mm}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">ISO</span>
              <input
                className="geotag-input"
                inputMode="numeric"
                onChange={(event) => handleDraftChange('iso', event.target.value)}
                type="text"
                value={metadataDraft.iso}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Exposure time (seconds)</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) =>
                  handleDraftChange('exposureTimeSeconds', event.target.value)
                }
                type="text"
                value={metadataDraft.exposureTimeSeconds}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Aperture</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) => handleDraftChange('aperture', event.target.value)}
                type="text"
                value={metadataDraft.aperture}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Flash</span>
              <select
                className="geotag-input"
                onChange={(event) => handleDraftChange('flashOn', event.target.value)}
                value={metadataDraft.flashOn}
              >
                <option value="">Unset</option>
                <option value="0">Off</option>
                <option value="1">On</option>
              </select>
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Metering mode</span>
              <input
                className="geotag-input"
                inputMode="numeric"
                onChange={(event) => handleDraftChange('meteringMode', event.target.value)}
                type="text"
                value={metadataDraft.meteringMode}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">White balance</span>
              <select
                className="geotag-input"
                onChange={(event) => handleDraftChange('whiteBalance', event.target.value)}
                value={metadataDraft.whiteBalance}
              >
                <option value="">Unset</option>
                <option value="0">Auto</option>
                <option value="1">Manual</option>
              </select>
            </label>

            <details
              className="geotag-advanced geotag-field geotag-field-wide"
              open={Boolean(aiDescriptionPreview.error)}
            >
              <summary className="geotag-advanced-summary">
                <span>Advanced AI JSON</span>
                <span className="geotag-advanced-hint">
                  {aiDescriptionPreview.error ? 'Needs attention' : 'Optional manual editing'}
                </span>
              </summary>
              <div className="geotag-advanced-body">
                <label className="geotag-field">
                  <span className="geotag-label">AI description JSON</span>
                  <textarea
                    className="geotag-input geotag-textarea geotag-json-input"
                    onChange={(event) => handleDraftChange('aiDescription', event.target.value)}
                    placeholder="Paste structured AI description JSON here"
                    value={metadataDraft.aiDescription}
                  />
                </label>
              </div>
            </details>

            <div className="geotag-form-actions">
              <button className="geotag-button" disabled={isSaving} type="submit">
                {isSaving ? 'Saving…' : 'Save now'}
              </button>
              <button
                className="geotag-button"
                disabled={isSaving || !isDestructiveUnlocked}
                onClick={handleReset}
                type="button"
              >
                Reset fields
              </button>
            </div>

            <div className="geotag-danger-zone geotag-field-wide">
              <p className="geotag-danger-title">Destructive actions locked</p>
              <p className="geotag-danger-copy">
                Auto-save is on. To unlock reset or GPS clearing, type the full filename exactly.
              </p>
              <input
                className="geotag-input"
                onChange={(event) => setDestructiveUnlockValue(event.target.value)}
                placeholder={currentPhoto.filename}
                type="text"
                value={destructiveUnlockValue}
              />
            </div>

            {saveError ? <p className="geotag-status geotag-status-error">{saveError}</p> : null}
            {saveMessage ? <p className="geotag-status">{saveMessage}</p> : null}
            {!saveError && !saveMessage && draftLoadMessage ? (
              <p className="geotag-status">{draftLoadMessage}</p>
            ) : null}
            {!saveError && !saveMessage ? (
              <p className="geotag-status">
                {isSaving ? 'Saving changes…' : hasPendingChanges ? 'Unsaved changes queued…' : 'Auto-save is on.'}
              </p>
            ) : null}
          </form>
        </article>

        <article className="geotag-panel geotag-map-panel">
          <div className="geotag-coordinates">
            <div>
              <p className="geotag-label">Latitude</p>
              <p className="geotag-value">
                {previewCoordinates ? previewCoordinates.latitude : '—'}
              </p>
            </div>
            <div>
              <p className="geotag-label">Longitude</p>
              <p className="geotag-value">
                {previewCoordinates ? previewCoordinates.longitude : '—'}
              </p>
            </div>
            <div>
              <p className="geotag-label">Altitude</p>
              <p className="geotag-value">
                {metadataDraft.altitude.trim() || '—'}
              </p>
            </div>
            <div>
              <p className="geotag-label">Direction</p>
              <p className="geotag-value">
                {metadataDraft.imageDirection.trim() || '—'}
              </p>
            </div>
          </div>

          {previewResult.error ? (
            <p className="geotag-status geotag-status-error">{previewResult.error}</p>
          ) : null}

          <div className="geotag-map-shell">
            <MapContainer
              center={center}
              className="geotag-map"
              ref={mapRef}
              zoom={zoom}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <RecenterMap center={center} zoom={zoom} />
              <MapClickHandler onSelect={handleMapSelection} />
              {previewCoordinates ? (
                <Marker
                  position={[previewCoordinates.latitude, previewCoordinates.longitude]}
                />
              ) : null}
            </MapContainer>
          </div>

          <div className="geotag-gps-form">
            <label className="geotag-field">
              <span className="geotag-label">Latitude</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) => handleGpsFieldChange('latitude', event.target.value)}
                placeholder="52.367573"
                type="text"
                value={metadataDraft.latitude}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Longitude</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) => handleGpsFieldChange('longitude', event.target.value)}
                placeholder="4.904139"
                type="text"
                value={metadataDraft.longitude}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Altitude</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) => handleDraftChange('altitude', event.target.value)}
                type="text"
                value={metadataDraft.altitude}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">Image direction</span>
              <input
                className="geotag-input"
                inputMode="decimal"
                onChange={(event) => handleDraftChange('imageDirection', event.target.value)}
                type="text"
                value={metadataDraft.imageDirection}
              />
            </label>

            <div className="geotag-gps-actions">
              <button
                className="geotag-button"
                disabled={isSaving || isFetchingAltitude}
                onClick={handleFetchAltitude}
                type="button"
              >
                {isFetchingAltitude ? 'Fetching altitude…' : 'Fetch altitude'}
              </button>
              <button
                className="geotag-button"
                disabled={isSaving || isFetchingAltitude || !isDestructiveUnlocked}
                onClick={clearGpsFields}
                type="button"
              >
                Clear GPS fields
              </button>
            </div>
          </div>
        </article>
      </section>
    </main>
  )
}
