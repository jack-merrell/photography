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
const MAX_LANDMARK_ANNOTATIONS = 8

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function roundCoordinate(value) {
  return Number(value.toFixed(6))
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
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

function cloneLandmarkAnnotation(annotation) {
  return {
    ...annotation,
  }
}

function cloneAiDescription(aiDescription) {
  return {
    ...aiDescription,
    landmarkAnnotations: Array.isArray(aiDescription.landmarkAnnotations)
      ? aiDescription.landmarkAnnotations.map(cloneLandmarkAnnotation)
      : [],
  }
}

function clampNormalizedCoordinate(value) {
  return Number(clamp(value, 0, 1).toFixed(4))
}

function percentToNormalizedCoordinate(rawValue) {
  const text = String(rawValue).trim()
  if (!text) {
    return null
  }

  const numericValue = Number(text)
  if (!Number.isFinite(numericValue)) {
    return null
  }

  return clampNormalizedCoordinate(numericValue / 100)
}

function normalizedToPercentLabel(value) {
  return Number((value * 100).toFixed(1))
}

function stringifyAiDescriptionValue(value) {
  return JSON.stringify(value, null, 2)
}

function createSafeLandmarkBox(annotation, nextBox) {
  return {
    ...annotation,
    x: clampNormalizedCoordinate(nextBox.x),
    y: clampNormalizedCoordinate(nextBox.y),
    width: clampNormalizedCoordinate(nextBox.width),
    height: clampNormalizedCoordinate(nextBox.height),
  }
}

function createDefaultLandmarkAnnotation(kind, index) {
  const offset = (index % 4) * 0.05
  const baseX = clampNormalizedCoordinate(0.42 + offset)
  const baseY = clampNormalizedCoordinate(0.42 + Math.floor(index / 4) * 0.05)

  if (kind === 'point') {
    return {
      label: 'new landmark',
      kind: 'point',
      x: baseX,
      y: baseY,
      width: null,
      height: null,
      confidence: 0.5,
    }
  }

  return {
    label: 'new landmark',
    kind: 'box',
    x: baseX,
    y: baseY,
    width: 0.18,
    height: 0.18,
    confidence: 0.5,
  }
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
    locationCountryCode: draftValue(photo.locationCountryCode),
    locationCountryName: draftValue(photo.locationCountryName),
    locationCity: draftValue(photo.locationCity),
    locationCityCode: draftValue(photo.locationCityCode),
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

function getPhotoIdFromHash(hash) {
  if (!hash) {
    return null
  }

  const value = hash.replace(/^#/, '').trim()
  return value || null
}

function formatPhotoHash(photoId) {
  return `#${photoId}`
}

function getInitialPhotoIndex(photos) {
  if (typeof window === 'undefined') {
    return 0
  }

  const photoIdFromHash = getPhotoIdFromHash(window.location.hash)
  if (!photoIdFromHash) {
    return 0
  }

  const nextIndex = photos.findIndex((entry) => entry.id === photoIdFromHash)
  return nextIndex === -1 ? 0 : nextIndex
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
  const initialPhotoIndex = getInitialPhotoIndex(photoIndex)
  const [currentIndex, setCurrentIndex] = useState(() => initialPhotoIndex)
  const [metadataDraft, setMetadataDraft] = useState(() =>
    createMetadataDraft(photoIndex[initialPhotoIndex]),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isFetchingAltitude, setIsFetchingAltitude] = useState(false)
  const [isFetchingLocationCodes, setIsFetchingLocationCodes] = useState(false)
  const [manualGpsLookupVersion, setManualGpsLookupVersion] = useState(0)
  const [destructiveUnlockValue, setDestructiveUnlockValue] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const lastAltitudeLookupKeyRef = useRef('')
  const lastManualGpsLookupVersionRef = useRef(0)
  const lastAutoSaveSnapshotRef = useRef('')
  const mapRef = useRef(null)
  const photoStageRef = useRef(null)
  const landmarkInteractionRef = useRef(null)

  const currentPhoto = photoEntries[currentIndex]
  const currentPhotoFilenameRef = useRef(currentPhoto.filename)
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
  const aiStatusLabel = aiDescriptionPreview.error
    ? 'Invalid JSON'
    : landmarkAnnotations.length
      ? `${landmarkAnnotations.length} overlays`
      : aiDescriptionValue
        ? 'Loaded'
        : 'Empty'
  const [selectedLandmarkIndex, setSelectedLandmarkIndex] = useState(null)
  const selectedLandmark =
    selectedLandmarkIndex == null ? null : landmarkAnnotations[selectedLandmarkIndex] ?? null
  const canEditLandmarks = Boolean(aiDescriptionValue) && !aiDescriptionPreview.error
  const canAddLandmarks = canEditLandmarks && landmarkAnnotations.length < MAX_LANDMARK_ANNOTATIONS
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
      setSelectedLandmarkIndex(null)
      landmarkInteractionRef.current = null
    },
    [photoEntries],
  )

  const showPhotoById = useCallback(
    (photoId) => {
      const nextIndex = photoEntries.findIndex((entry) => entry.id === photoId)
      if (nextIndex === -1) {
        return false
      }

      if (nextIndex !== currentIndex) {
        showPhotoAt(nextIndex)
      }

      return true
    },
    [currentIndex, photoEntries, showPhotoAt],
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

  const patchAiDescription = useCallback((updater) => {
    setMetadataDraft((current) => {
      const parsed = parseAiDescriptionDraft(current.aiDescription)
      if (parsed.error || !parsed.value) {
        return current
      }

      const nextAiDescription = updater(cloneAiDescription(parsed.value))
      if (!nextAiDescription) {
        return current
      }

      return {
        ...current,
        aiDescription: stringifyAiDescriptionValue(nextAiDescription),
      }
    })
    setSaveMessage('')
    setSaveError('')
  }, [])

  const setAiDescriptionError = useCallback((message) => {
    setSaveError(message)
    setSaveMessage('')
  }, [])

  const updateLandmarkAnnotation = useCallback(
    (index, updater) => {
      patchAiDescription((aiDescription) => {
        const annotations = Array.isArray(aiDescription.landmarkAnnotations)
          ? aiDescription.landmarkAnnotations.map(cloneLandmarkAnnotation)
          : []
        const currentAnnotation = annotations[index]
        if (!currentAnnotation) {
          return aiDescription
        }

        const nextAnnotation = updater(currentAnnotation)
        if (!nextAnnotation) {
          return aiDescription
        }

        annotations[index] = nextAnnotation

        return {
          ...aiDescription,
          landmarkAnnotations: annotations,
        }
      })
    },
    [patchAiDescription],
  )

  const setLandmarkField = useCallback(
    (field, rawValue) => {
      if (selectedLandmarkIndex == null || !selectedLandmark) {
        return
      }

      if (field === 'label') {
        updateLandmarkAnnotation(selectedLandmarkIndex, (annotation) => ({
          ...annotation,
          label: rawValue,
        }))
        return
      }

      const normalizedValue = percentToNormalizedCoordinate(rawValue)
      if (normalizedValue == null) {
        return
      }

      if (selectedLandmark.kind === 'point') {
        if (field === 'x' || field === 'y') {
          updateLandmarkAnnotation(selectedLandmarkIndex, (annotation) => ({
            ...annotation,
            [field]: normalizedValue,
          }))
        }
        return
      }

      if (selectedLandmark.kind === 'box') {
        if (field === 'x' || field === 'y' || field === 'width' || field === 'height') {
          updateLandmarkAnnotation(selectedLandmarkIndex, (annotation) => {
            if (field === 'x') {
              const nextX = clampNormalizedCoordinate(
                Math.min(normalizedValue, 1 - annotation.width),
              )
              return createSafeLandmarkBox(annotation, {
                ...annotation,
                x: nextX,
              })
            }

            if (field === 'y') {
              const nextY = clampNormalizedCoordinate(
                Math.min(normalizedValue, 1 - annotation.height),
              )
              return createSafeLandmarkBox(annotation, {
                ...annotation,
                y: nextY,
              })
            }

            if (field === 'width') {
              const nextWidth = Math.min(
                Math.max(normalizedValue, 0.02),
                1 - annotation.x,
              )
              return createSafeLandmarkBox(annotation, {
                ...annotation,
                width: nextWidth,
              })
            }

            const nextHeight = Math.min(
              Math.max(normalizedValue, 0.02),
              1 - annotation.y,
            )
            return createSafeLandmarkBox(annotation, {
              ...annotation,
              height: nextHeight,
            })
          })
        }
      }
    },
    [selectedLandmark, selectedLandmarkIndex, updateLandmarkAnnotation],
  )

  const addLandmarkAnnotation = useCallback(
    (kind) => {
      if (!canEditLandmarks || !aiDescriptionValue) {
        setAiDescriptionError('Load valid AI JSON before adding landmarks.')
        return
      }

      const annotations = Array.isArray(aiDescriptionValue.landmarkAnnotations)
        ? aiDescriptionValue.landmarkAnnotations.map(cloneLandmarkAnnotation)
        : []

      if (annotations.length >= MAX_LANDMARK_ANNOTATIONS) {
        setAiDescriptionError(
          `Landmark annotations are limited to ${MAX_LANDMARK_ANNOTATIONS} items.`,
        )
        return
      }

      const nextAnnotation = createDefaultLandmarkAnnotation(kind, annotations.length)
      const nextIndex = annotations.length
      annotations.push(nextAnnotation)

      patchAiDescription((aiDescription) => ({
        ...aiDescription,
        landmarkAnnotations: annotations,
      }))
      setSelectedLandmarkIndex(nextIndex)
    },
    [aiDescriptionValue, canEditLandmarks, patchAiDescription, setAiDescriptionError],
  )

  const deleteLandmarkAnnotation = useCallback(() => {
    if (!canEditLandmarks || selectedLandmarkIndex == null || !aiDescriptionValue) {
      return
    }

    const annotations = Array.isArray(aiDescriptionValue.landmarkAnnotations)
      ? aiDescriptionValue.landmarkAnnotations.map(cloneLandmarkAnnotation)
      : []
    if (!annotations[selectedLandmarkIndex]) {
      return
    }

    const nextAnnotations = annotations.filter((_, index) => index !== selectedLandmarkIndex)
    patchAiDescription((aiDescription) => ({
      ...aiDescription,
      landmarkAnnotations: nextAnnotations,
    }))

    setSelectedLandmarkIndex(
      nextAnnotations.length ? Math.min(selectedLandmarkIndex, nextAnnotations.length - 1) : null,
    )
  }, [aiDescriptionValue, canEditLandmarks, patchAiDescription, selectedLandmarkIndex])

  const beginLandmarkInteraction = useCallback(
    (event, index, mode) => {
      if (aiDescriptionPreview.error) {
        return
      }

      const annotation = landmarkAnnotations[index]
      const stage = photoStageRef.current
      if (!annotation || !stage) {
        return
      }

      const rect = stage.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSelectedLandmarkIndex(index)

      const pointer = {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      }

      landmarkInteractionRef.current = {
        index,
        mode,
        startAnnotation: cloneLandmarkAnnotation(annotation),
        startPointer: pointer,
        offsetX: pointer.x - annotation.x,
        offsetY: pointer.y - annotation.y,
      }

      if (event.currentTarget instanceof HTMLElement) {
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId)
        } catch {
          // Ignore pointer-capture failures.
        }
      }
    },
    [aiDescriptionPreview.error, landmarkAnnotations],
  )

  const endLandmarkInteraction = useCallback(() => {
    landmarkInteractionRef.current = null
  }, [])

  const handleLandmarkPointerMove = useCallback(
    (event) => {
      const interaction = landmarkInteractionRef.current
      const stage = photoStageRef.current
      if (!interaction || !stage) {
        return
      }

      const rect = stage.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        return
      }

      const pointer = {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      }

      if (interaction.mode === 'resize' && interaction.startAnnotation.kind === 'box') {
        const nextWidth = Math.min(
          Math.max(pointer.x - interaction.startAnnotation.x, 0.02),
          1 - interaction.startAnnotation.x,
        )
        const nextHeight = Math.min(
          Math.max(pointer.y - interaction.startAnnotation.y, 0.02),
          1 - interaction.startAnnotation.y,
        )

        updateLandmarkAnnotation(interaction.index, (annotation) =>
          createSafeLandmarkBox(annotation, {
            ...annotation,
            x: interaction.startAnnotation.x,
            y: interaction.startAnnotation.y,
            width: nextWidth,
            height: nextHeight,
          }),
        )
        return
      }

      const nextX = clampNormalizedCoordinate(pointer.x - interaction.offsetX)
      const nextY = clampNormalizedCoordinate(pointer.y - interaction.offsetY)

      updateLandmarkAnnotation(interaction.index, (annotation) => {
        if (annotation.kind === 'point') {
          return {
            ...annotation,
            x: nextX,
            y: nextY,
          }
        }

        const maxX = 1 - interaction.startAnnotation.width
        const maxY = 1 - interaction.startAnnotation.height
        return createSafeLandmarkBox(annotation, {
          ...annotation,
          x: clamp(nextX, 0, maxX),
          y: clamp(nextY, 0, maxY),
          width: interaction.startAnnotation.width,
          height: interaction.startAnnotation.height,
        })
      })
    },
    [updateLandmarkAnnotation],
  )

  const handleLandmarkPointerUp = useCallback(() => {
    endLandmarkInteraction()
  }, [endLandmarkInteraction])

  useEffect(() => {
    window.addEventListener('pointermove', handleLandmarkPointerMove)
    window.addEventListener('pointerup', handleLandmarkPointerUp)
    window.addEventListener('pointercancel', handleLandmarkPointerUp)

    return () => {
      window.removeEventListener('pointermove', handleLandmarkPointerMove)
      window.removeEventListener('pointerup', handleLandmarkPointerUp)
      window.removeEventListener('pointercancel', handleLandmarkPointerUp)
    }
  }, [handleLandmarkPointerMove, handleLandmarkPointerUp])

  useEffect(() => {
    if (selectedLandmarkIndex != null && !selectedLandmark) {
      setSelectedLandmarkIndex(null)
    }
  }, [selectedLandmark, selectedLandmarkIndex])

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

  const fetchLocationCodes = async (latitude, longitude) => {
    setIsFetchingLocationCodes(true)

    try {
      const response = await fetch(
        `/api/location-codes?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`,
      )
      const responseBody = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(responseBody?.error ?? 'Unable to fetch location codes.')
      }

      setMetadataDraft((current) => ({
        ...current,
        locationCountryCode: responseBody?.locationCountryCode ?? '',
        locationCountryName: responseBody?.locationCountryName ?? '',
        locationCity: responseBody?.locationCity ?? '',
        locationCityCode: responseBody?.locationCityCode ?? '',
      }))
      setSaveMessage('CC and City filled from the reverse geocoder.')
      setSaveError('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to fetch location codes.')
      setSaveMessage('')
    } finally {
      setIsFetchingLocationCodes(false)
    }
  }

  const handleMapSelection = async (latlng) => {
    if (isSaving || isFetchingAltitude || isFetchingLocationCodes) {
      return
    }

    const latitude = String(roundCoordinate(latlng.lat))
    const longitude = String(roundCoordinate(latlng.lng))

    setMetadataDraft((current) => ({
      ...current,
      latitude,
      longitude,
      locationCountryCode: '',
      locationCountryName: '',
      locationCity: '',
      locationCityCode: '',
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
      locationCountryCode: '',
      locationCountryName: '',
      locationCity: '',
      locationCityCode: '',
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

  const handleFetchLocationCodes = async () => {
    if (!previewResult.coordinates) {
      setSaveError(previewResult.error ?? 'Enter latitude and longitude first.')
      setSaveMessage('')
      return
    }

    await fetchLocationCodes(
      previewResult.coordinates.latitude,
      previewResult.coordinates.longitude,
    )
  }

  const handleSave = useCallback(
    async (draftToSave = metadataDraft, saveSource = 'manual') => {
      const requestFilename = currentPhoto.filename
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
            filename: requestFilename,
            fields: createSaveFields(draftToSave),
          }),
        })

        const responseBody = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(responseBody?.error ?? 'Unable to update photoIndex.json.')
        }

        applyUpdatedPhoto(responseBody.photo)

        if (currentPhotoFilenameRef.current === responseBody.photo.filename) {
          setMetadataDraft(createMetadataDraft(responseBody.photo))
          setSaveMessage('Updated file metadata and photoIndex.json.')
          if (saveSource === 'auto' || saveSource === 'manual') {
            lastAutoSaveSnapshotRef.current = ''
          }
        }
      } catch (error) {
        if (currentPhotoFilenameRef.current === requestFilename) {
          setSaveError(
            error instanceof Error
              ? error.message
              : 'Unable to update image metadata and photoIndex.json.',
          )
        }
      } finally {
        if (currentPhotoFilenameRef.current === requestFilename) {
          setIsSaving(false)
        }
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
      isFetchingAltitude ||
      isFetchingLocationCodes
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
    isFetchingLocationCodes,
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
    currentPhotoFilenameRef.current = currentPhoto.filename
    setMetadataDraft(createMetadataDraft(currentPhoto))
  }, [currentPhoto])

  useEffect(() => {
    const syncHashToPhoto = () => {
      const photoIdFromHash = getPhotoIdFromHash(window.location.hash)
      if (!photoIdFromHash) {
        return
      }

      showPhotoById(photoIdFromHash)
    }

    window.addEventListener('hashchange', syncHashToPhoto)

    return () => {
      window.removeEventListener('hashchange', syncHashToPhoto)
    }
  }, [showPhotoById])

  useEffect(() => {
    const nextHash = formatPhotoHash(currentPhoto.id)
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`)
    }
  }, [currentPhoto.id])

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

      <section className="geotag-summary-grid" aria-label="Photo summary">
        <article className="geotag-summary-card">
          <span className="geotag-label">Capture</span>
          <strong>{formatDate(currentPhoto.captureTimestamp)}</strong>
          <p>{formatTime(currentPhoto.captureTimestamp)} UTC</p>
        </article>
        <article className="geotag-summary-card">
          <span className="geotag-label">Camera</span>
          <strong>{formatCamera(currentPhoto.camera)}</strong>
          <p>{formatDimensions(currentPhoto.width, currentPhoto.height)}</p>
        </article>
        <article className="geotag-summary-card">
          <span className="geotag-label">Location</span>
          <strong>
            {previewCoordinates
              ? `${previewCoordinates.latitude}, ${previewCoordinates.longitude}`
              : 'No coordinates'}
          </strong>
          <p>
            {metadataDraft.altitude.trim() || '—'} altitude
            {metadataDraft.imageDirection.trim() ? ` · ${metadataDraft.imageDirection.trim()}°` : ''}
            {metadataDraft.locationCountryCode.trim() || metadataDraft.locationCityCode.trim()
              ? ` · ${metadataDraft.locationCountryCode.trim() || '—'}/${metadataDraft.locationCityCode.trim() || '—'}`
              : ''}
          </p>
        </article>
        <article className="geotag-summary-card geotag-summary-card-wide">
          <span className="geotag-label">AI status</span>
          <strong>{aiStatusLabel}</strong>
          <p>{currentAiStatus}</p>
        </article>
        <article className="geotag-summary-card geotag-summary-action-card">
          <span className="geotag-label">Save</span>
          <button
            className="geotag-button geotag-summary-save-button"
            disabled={isSaving}
            form="geotag-editor-form"
            type="submit"
          >
            {isSaving ? 'Saving…' : 'Save now'}
          </button>
        </article>
      </section>

      <section className="geotag-layout">
        <article className="geotag-panel geotag-photo-panel">
          <div className="geotag-photo-frame">
            <div
              className="geotag-photo-stage"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedLandmarkIndex(null)
                }
              }}
              ref={photoStageRef}
            >
              <img
                alt=""
                className="geotag-photo-image"
                src={`/previews/${currentPhoto.filename}`}
              />
              {landmarkAnnotations.length ? (
                <div className="geotag-photo-overlay">
                  {landmarkAnnotations.map((annotation, index) => {
                    const isSelected = index === selectedLandmarkIndex

                    if (annotation.kind === 'point') {
                      return (
                        <button
                          aria-label={`Select landmark ${annotation.label}`}
                          className={`geotag-landmark geotag-landmark-point${
                            isSelected ? ' geotag-landmark-selected' : ''
                          }`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedLandmarkIndex(index)
                          }}
                          onPointerDown={(event) => beginLandmarkInteraction(event, index, 'move')}
                          type="button"
                          key={`${annotation.label}-${index}`}
                          style={{
                            left: `${annotation.x * 100}%`,
                            top: `${annotation.y * 100}%`,
                          }}
                        >
                          <span className="geotag-landmark-hitarea" />
                          <span className="geotag-landmark-dot" />
                          <span className="geotag-landmark-label">{annotation.label}</span>
                        </button>
                      )
                    }

                    return (
                      <button
                        aria-label={`Select landmark ${annotation.label}`}
                        className={`geotag-landmark geotag-landmark-box${
                          isSelected ? ' geotag-landmark-selected' : ''
                        }`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedLandmarkIndex(index)
                        }}
                        onPointerDown={(event) => beginLandmarkInteraction(event, index, 'move')}
                        type="button"
                        key={`${annotation.label}-${index}`}
                        style={{
                          left: `${annotation.x * 100}%`,
                          top: `${annotation.y * 100}%`,
                          width: `${annotation.width * 100}%`,
                          height: `${annotation.height * 100}%`,
                        }}
                      >
                        <span className="geotag-landmark-label">{annotation.label}</span>
                        {isSelected ? (
                          <span
                            aria-hidden="true"
                            className="geotag-landmark-resize-handle"
                            onPointerDown={(event) => {
                              event.stopPropagation()
                              beginLandmarkInteraction(event, index, 'resize')
                            }}
                          />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <section className="geotag-landmark-editor">
            <div className="geotag-landmark-editor-header">
              <div>
                <p className="geotag-label">Landmarks</p>
                <h2 className="geotag-landmark-editor-title">Rename and reshape overlays</h2>
              </div>
              <div className="geotag-landmark-editor-actions">
                <span className="geotag-landmark-editor-count">
                  {landmarkAnnotations.length} overlay{landmarkAnnotations.length === 1 ? '' : 's'}
                </span>
                <button
                  className="geotag-button geotag-landmark-action"
                  disabled={!canAddLandmarks}
                  onClick={() => addLandmarkAnnotation('point')}
                  type="button"
                >
                  Add point
                </button>
                <button
                  className="geotag-button geotag-landmark-action"
                  disabled={!canAddLandmarks}
                  onClick={() => addLandmarkAnnotation('box')}
                  type="button"
                >
                  Add box
                </button>
                <button
                  className="geotag-button geotag-landmark-action"
                  disabled={!canEditLandmarks || selectedLandmarkIndex == null}
                  onClick={deleteLandmarkAnnotation}
                  type="button"
                >
                  Delete selected
                </button>
              </div>
            </div>

            {landmarkAnnotations.length ? (
              <div className="geotag-landmark-editor-body">
                <div className="geotag-landmark-list" aria-label="Landmark annotations">
                  {landmarkAnnotations.map((annotation, index) => {
                    const isSelected = index === selectedLandmarkIndex
                    return (
                      <button
                        className={`geotag-landmark-chip${
                          isSelected ? ' geotag-landmark-chip-selected' : ''
                        }`}
                        key={`${annotation.label}-${index}-chip`}
                        onClick={() => setSelectedLandmarkIndex(index)}
                        type="button"
                      >
                        <span>{annotation.label}</span>
                        <span>{annotation.kind}</span>
                      </button>
                    )
                  })}
                </div>

                {selectedLandmark ? (
                  <div className="geotag-landmark-inspector">
                    <div className="geotag-landmark-inspector-head">
                      <div>
                        <p className="geotag-label">Selected landmark</p>
                        <strong>{selectedLandmark.kind}</strong>
                      </div>
                      <p className="geotag-landmark-confidence">
                        Confidence {(selectedLandmark.confidence * 100).toFixed(1)}%
                      </p>
                    </div>

                    <label className="geotag-field geotag-field-wide">
                      <span className="geotag-label">Label</span>
                      <input
                        className="geotag-input"
                        onChange={(event) =>
                          setLandmarkField('label', event.target.value)
                        }
                        value={selectedLandmark.label}
                      />
                    </label>

                    <div className="geotag-landmark-coordinates">
                      <label className="geotag-field">
                        <span className="geotag-label">X %</span>
                        <input
                          className="geotag-input"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          onChange={(event) => setLandmarkField('x', event.target.value)}
                          step="0.1"
                          type="number"
                          value={normalizedToPercentLabel(selectedLandmark.x)}
                        />
                      </label>

                      <label className="geotag-field">
                        <span className="geotag-label">Y %</span>
                        <input
                          className="geotag-input"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          onChange={(event) => setLandmarkField('y', event.target.value)}
                          step="0.1"
                          type="number"
                          value={normalizedToPercentLabel(selectedLandmark.y)}
                        />
                      </label>

                      {selectedLandmark.kind === 'box' ? (
                        <>
                          <label className="geotag-field">
                            <span className="geotag-label">Width %</span>
                            <input
                              className="geotag-input"
                              inputMode="decimal"
                              min="0"
                              max="100"
                              onChange={(event) =>
                                setLandmarkField('width', event.target.value)
                              }
                              step="0.1"
                              type="number"
                              value={normalizedToPercentLabel(selectedLandmark.width ?? 0)}
                            />
                          </label>

                          <label className="geotag-field">
                            <span className="geotag-label">Height %</span>
                            <input
                              className="geotag-input"
                              inputMode="decimal"
                              min="0"
                              max="100"
                              onChange={(event) =>
                                setLandmarkField('height', event.target.value)
                              }
                              step="0.1"
                              type="number"
                              value={normalizedToPercentLabel(selectedLandmark.height ?? 0)}
                            />
                          </label>
                        </>
                      ) : null}
                    </div>

                    <p className="geotag-landmark-tip">
                      Drag the overlay on the photo. Box landmarks can be resized from the lower-right
                      corner.
                    </p>
                  </div>
                ) : (
                  <p className="geotag-status geotag-landmark-empty">
                    Select a landmark on the photo to rename it and adjust its position.
                  </p>
                )}
              </div>
            ) : (
              <p className="geotag-status geotag-landmark-empty">
                This photo has no landmark overlays in its AI description.
              </p>
            )}
          </section>
        </article>

        <section className="geotag-panel geotag-ai-panel">
          <div className="geotag-ai-header">
            <div>
              <p className="geotag-kicker">AI analysis</p>
              <h2 className="geotag-ai-title">Readable summary</h2>
            </div>
            <span className={`geotag-ai-badge geotag-ai-badge-${aiStatusTone}`}>
              {aiStatusLabel}
            </span>
          </div>

          <p className={`geotag-ai-status${aiDescriptionPreview.error ? ' geotag-ai-status-error' : ''}`}>
            {currentAiStatus}
          </p>
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
            <div>
              <p className="geotag-label">CC</p>
              <p className="geotag-value">
                {metadataDraft.locationCountryCode.trim() || '—'}
              </p>
            </div>
            <div>
              <p className="geotag-label">City</p>
              <p className="geotag-value">
                {metadataDraft.locationCityCode.trim() || '—'}
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
              <span className="geotag-label">CC</span>
              <input
                className="geotag-input"
                onChange={(event) => handleDraftChange('locationCountryCode', event.target.value)}
                type="text"
                value={metadataDraft.locationCountryCode}
              />
            </label>

            <label className="geotag-field">
              <span className="geotag-label">City</span>
              <input
                className="geotag-input"
                onChange={(event) => handleDraftChange('locationCityCode', event.target.value)}
                type="text"
                value={metadataDraft.locationCityCode}
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
                disabled={isSaving || isFetchingAltitude || isFetchingLocationCodes}
                onClick={handleFetchLocationCodes}
                type="button"
              >
                {isFetchingLocationCodes ? 'Fetching CC / City…' : 'Fetch CC / City'}
              </button>
              <button
                className="geotag-button"
                disabled={isSaving || isFetchingAltitude || isFetchingLocationCodes}
                onClick={handleFetchAltitude}
                type="button"
              >
                {isFetchingAltitude ? 'Fetching altitude…' : 'Fetch altitude'}
              </button>
              <button
                className="geotag-button"
                disabled={
                  isSaving ||
                  isFetchingAltitude ||
                  isFetchingLocationCodes ||
                  !isDestructiveUnlocked
                }
                onClick={clearGpsFields}
                type="button"
              >
                Clear GPS fields
              </button>
            </div>
          </div>
        </article>

        <form
          id="geotag-editor-form"
          className="geotag-panel geotag-editor-panel"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <div className="geotag-editor-grid">
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
            {!saveError && !saveMessage ? (
              <p className="geotag-status">
                {isSaving ? 'Saving changes…' : hasPendingChanges ? 'Unsaved changes queued…' : 'Auto-save is on.'}
              </p>
            ) : null}
          </div>

          <div className="geotag-form-actions">
            <button
              className="geotag-button"
              disabled={isSaving || !isDestructiveUnlocked}
              onClick={handleReset}
              type="button"
            >
              Reset fields
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
