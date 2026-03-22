import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Link } from 'react-router-dom'
import photoIndex from '../data/photoIndex.json'
import {
  formatAperture,
  formatCamera,
  formatDate,
  formatDimensions,
  formatExposure,
  formatFileSize,
  formatFlash,
  formatFocalLength,
  formatGps,
  formatIso,
  formatLens,
  formatTime,
} from '../lib/photoFormatters'
import '../App.css'

const MotionButton = motion.button
const MotionAside = motion.aside
const MotionTableRow = motion.tr

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getDesktopPreviewStyle(photo, rowRect, viewport) {
  const framePadding = 8
  const gap = 16
  const maxFrameWidth = Math.min(viewport.width * 0.36, 560)
  const maxFrameHeight = viewport.height - 32
  const maxImageWidth = maxFrameWidth - framePadding * 2
  const maxImageHeight = maxFrameHeight - framePadding * 2
  const aspectRatio = photo.width / photo.height

  const imageWidth = Math.min(maxImageWidth, maxImageHeight * aspectRatio)
  const imageHeight = imageWidth / aspectRatio
  const frameWidth = imageWidth + framePadding * 2
  const frameHeight = imageHeight + framePadding * 2

  const topSpace = rowRect.top - gap - 16
  const bottomSpace = viewport.height - rowRect.bottom - gap - 16
  const centeredLeft = clamp(
    viewport.width / 2 - frameWidth / 2,
    16,
    viewport.width - frameWidth - 16,
  )

  if (bottomSpace >= frameHeight) {
    return {
      left: centeredLeft,
      top: rowRect.bottom + gap,
      width: frameWidth,
      maxHeight: frameHeight,
    }
  }

  if (topSpace >= frameHeight) {
    return {
      left: centeredLeft,
      top: rowRect.top - frameHeight - gap,
      width: frameWidth,
      maxHeight: frameHeight,
    }
  }

  return {
    left: centeredLeft,
    top: clamp(
      viewport.height / 2 - frameHeight / 2,
      16,
      viewport.height - frameHeight - 16,
    ),
    width: frameWidth,
    maxHeight: frameHeight,
  }
}

function MobileDetailSheet({ canGoNext, canGoPrevious, onClose, onNext, onPrevious, photo }) {
  if (!photo) {
    return null
  }

  return (
    <>
      <MotionButton
        aria-label="Close photo details"
        className="mobile-detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.18 } }}
        exit={{ opacity: 0, transition: { duration: 0.22 } }}
        onClick={onClose}
        type="button"
      />
      <MotionAside
        aria-label="Selected photo details"
        className="mobile-detail-sheet"
        initial={{ opacity: 0, y: 32 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.24,
            ease: [0.16, 1, 0.3, 1],
          },
        }}
        exit={{
          opacity: 0,
          y: 24,
          transition: {
            duration: 0.24,
            ease: [0.22, 1, 0.36, 1],
          },
        }}
      >
        <div className="mobile-detail-head">
          <div>
            <p className="mobile-detail-kicker">{photo.id}</p>
            <h2 className="mobile-detail-title">{formatCamera(photo.camera)}</h2>
            <p className="mobile-detail-date">{formatDate(photo.captureTimestamp)}</p>
          </div>
          <button className="mobile-detail-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="mobile-detail-preview">
          <img
            src={`/previews/${photo.filename}`}
            alt=""
            className="mobile-detail-image"
          />
        </div>

        <div className="mobile-detail-nav">
          <button
            className="mobile-detail-nav-button"
            disabled={!canGoPrevious}
            onClick={onPrevious}
            type="button"
          >
            Previous
          </button>
          <button
            className="mobile-detail-nav-button"
            disabled={!canGoNext}
            onClick={onNext}
            type="button"
          >
            Next
          </button>
        </div>

        <dl className="mobile-detail-grid">
          <div>
            <dt>Time</dt>
            <dd>{formatTime(photo.captureTimestamp)}</dd>
          </div>
          <div>
            <dt>GPS</dt>
            <dd>{formatGps(photo.latitude, photo.longitude)}</dd>
          </div>
          <div>
            <dt>Lens</dt>
            <dd>{formatLens(photo.lens)}</dd>
          </div>
          <div>
            <dt>Focal</dt>
            <dd>{formatFocalLength(photo.focalLength, photo.focalLength35mm)}</dd>
          </div>
          <div>
            <dt>Shutter</dt>
            <dd>{formatExposure(photo.exposureTimeSeconds)}</dd>
          </div>
          <div>
            <dt>Aperture</dt>
            <dd>{formatAperture(photo.aperture)}</dd>
          </div>
          <div>
            <dt>ISO</dt>
            <dd>{formatIso(photo.iso)}</dd>
          </div>
          <div>
            <dt>Flash</dt>
            <dd>{formatFlash(photo.flashOn)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatFileSize(photo.fileSizeBytes)}</dd>
          </div>
          <div>
            <dt>Dimensions</dt>
            <dd>{formatDimensions(photo.width, photo.height)}</dd>
          </div>
          <div>
            <dt>Filename</dt>
            <dd>{photo.filename}</dd>
          </div>
        </dl>
      </MotionAside>
    </>
  )
}

function AssetRow({ photo, onPreviewChange, onSelectPhoto }) {
  const controls = useAnimationControls()

  const activate = (element) => {
    const rowRect = element.getBoundingClientRect()
    onPreviewChange({ photo, rowRect })
    controls.start({
      backgroundColor: 'rgba(243, 241, 236, 0.08)',
      transition: {
        duration: 0.14,
        ease: [0.16, 1, 0.3, 1],
      },
    })
  }

  const deactivate = () => {
    onPreviewChange((current) =>
      current?.photo.filename === photo.filename ? null : current,
    )
    controls.start({
      backgroundColor: 'rgba(243, 241, 236, 0)',
      transition: {
        duration: 0.9,
        ease: [0.22, 1, 0.36, 1],
      },
    })
  }

  return (
    <MotionTableRow
      animate={controls}
      initial={{ backgroundColor: 'rgba(243, 241, 236, 0)' }}
      tabIndex={0}
      onClick={onSelectPhoto}
      onMouseEnter={(event) => activate(event.currentTarget)}
      onMouseLeave={deactivate}
      onFocus={(event) => activate(event.currentTarget)}
      onBlur={deactivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelectPhoto()
        }
      }}
    >
      <td>{photo.id}</td>
      <td>{formatDate(photo.captureTimestamp)}</td>
      <td>{formatTime(photo.captureTimestamp)}</td>
      <td>{formatGps(photo.latitude, photo.longitude)}</td>
      <td>{formatCamera(photo.camera)}</td>
      <td>{formatLens(photo.lens)}</td>
      <td>{formatFocalLength(photo.focalLength, photo.focalLength35mm)}</td>
      <td>{formatExposure(photo.exposureTimeSeconds)}</td>
      <td>{formatAperture(photo.aperture)}</td>
      <td>{formatIso(photo.iso)}</td>
      <td>{formatFlash(photo.flashOn)}</td>
      <td>{formatFileSize(photo.fileSizeBytes)}</td>
      <td>{formatDimensions(photo.width, photo.height)}</td>
    </MotionTableRow>
  )
}

export default function ArchivePage() {
  const [photos, setPhotos] = useState(() => photoIndex)
  const [desktopPreview, setDesktopPreview] = useState(null)
  const [activeMobileIndex, setActiveMobileIndex] = useState(null)
  const activeMobilePhoto =
    activeMobileIndex == null ? null : photos[activeMobileIndex]
  const [viewport, setViewport] = useState({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  })

  useEffect(() => {
    let isActive = true

    const loadPhotos = async () => {
      try {
        const response = await fetch('/api/photoindex', { cache: 'no-store' })
        const responseBody = await response.json().catch(() => null)

        if (!response.ok || !Array.isArray(responseBody?.photos) || !isActive) {
          return
        }

        setPhotos(responseBody.photos)
      } catch {
        // Fall back to the bundled photoIndex import when the dev API is unavailable.
      }
    }

    void loadPhotos()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    return () => {
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  return (
    <main className="archive-page">
      <header className="archive-header">
        <div>
          <p className="archive-title">Mac Keller Jr.</p>
          <p className="archive-subtitle">
            Photography asset index sorted by capture date
          </p>
        </div>
        <div className="archive-header-actions">
          <p className="archive-count">{photos.length} assets</p>
          <Link className="archive-link" to="/people">
            Open people collage
          </Link>
          <Link className="archive-link" to="/metadata">
            Open metadata editor
          </Link>
        </div>
      </header>

      <section className="archive-table-wrap" aria-label="Photography asset index">
        <table className="archive-table">
          <thead>
            <tr>
              <th scope="col">Index</th>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">GPS</th>
              <th scope="col">Camera</th>
              <th scope="col">Lens</th>
              <th scope="col">Focal</th>
              <th scope="col">Shutter</th>
              <th scope="col">Aperture</th>
              <th scope="col">ISO</th>
              <th scope="col">Flash</th>
              <th scope="col">File size</th>
              <th scope="col">Dimensions</th>
            </tr>
          </thead>
          <tbody>
            {photos.map((photo, index) => (
              <AssetRow
                key={photo.filename}
                photo={photo}
                onPreviewChange={setDesktopPreview}
                onSelectPhoto={() => setActiveMobileIndex(index)}
              />
            ))}
          </tbody>
        </table>
      </section>

      <AnimatePresence>
        {desktopPreview ? (
          <MotionAside
            key={desktopPreview.photo.filename}
            className="hover-preview"
            style={getDesktopPreviewStyle(
              desktopPreview.photo,
              desktopPreview.rowRect,
              viewport,
            )}
            initial={{ opacity: 0, y: 22, scale: 0.975 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: {
                duration: 0.18,
                ease: [0.16, 1, 0.3, 1],
              },
            }}
            exit={{
              opacity: 0,
              y: 10,
              scale: 0.99,
              transition: {
                duration: 0.72,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
          >
            <img
              src={`/previews/${desktopPreview.photo.filename}`}
              alt=""
              className="hover-preview-image"
            />
          </MotionAside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {activeMobilePhoto ? (
          <MobileDetailSheet
            canGoNext={activeMobileIndex < photos.length - 1}
            canGoPrevious={activeMobileIndex > 0}
            onClose={() => setActiveMobileIndex(null)}
            onNext={() =>
              setActiveMobileIndex((current) =>
                current == null ? current : Math.min(current + 1, photos.length - 1),
              )
            }
            onPrevious={() =>
              setActiveMobileIndex((current) =>
                current == null ? current : Math.max(current - 1, 0),
              )
            }
            photo={activeMobilePhoto}
          />
        ) : null}
      </AnimatePresence>
    </main>
  )
}
