import { useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import photoIndex from './data/photoIndex.json'
import './App.css'

const cameraLabels = {
  'ILCE-7CM2': 'Sony ILCE-7CM2',
  'EZ Controller': 'Noritsu Scan',
  'QSS-32_33': 'Noritsu Scan',
}

const whiteBalanceLabels = {
  0: 'Auto',
  1: 'Manual',
}

const flashLabels = {
  0: 'Off',
  1: 'On',
}

function ordinal(day) {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) {
    return `${day}th`
  }

  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

function formatDate(timestamp) {
  const date = new Date(timestamp.replace(' +0000', 'Z'))
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
  const year = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  return `${ordinal(date.getUTCDate())} ${month} ${year}`
}

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatDimensions(width, height) {
  return `${width} × ${height}`
}

function formatExposure(seconds) {
  if (!seconds) {
    return '—'
  }

  if (seconds >= 1) {
    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`
  }

  return `1/${Math.round(1 / seconds)}s`
}

function formatAperture(aperture) {
  if (!aperture) {
    return '—'
  }

  return `f/${aperture.toFixed(1)}`
}

function formatFocalLength(focalLength, focalLength35mm) {
  if (!focalLength) {
    return '—'
  }

  if (focalLength35mm && focalLength35mm !== focalLength) {
    return `${focalLength}mm (${focalLength35mm}mm eq.)`
  }

  return `${focalLength}mm`
}

function formatCamera(camera) {
  return cameraLabels[camera] ?? camera
}

function formatLens(lens) {
  return lens ?? '—'
}

function formatIso(iso) {
  return iso ? `ISO ${iso}` : '—'
}

function formatWhiteBalance(value) {
  if (value == null) {
    return '—'
  }

  return whiteBalanceLabels[value] ?? String(value)
}

function formatFlash(value) {
  if (value == null) {
    return '—'
  }

  return flashLabels[value] ?? String(value)
}

function MobileAssetCard({ isActive, onToggle, photo }) {
  return (
    <article className="mobile-card">
      <button className="mobile-card-toggle" type="button" onClick={onToggle}>
        <span className="mobile-card-topline">
          <span>{photo.id}</span>
          <span>{formatDate(photo.captureTimestamp)}</span>
        </span>
        <span className="mobile-card-headline">
          <span>{formatCamera(photo.camera)}</span>
          <span>{isActive ? 'Hide preview' : 'Show preview'}</span>
        </span>
      </button>

      <div className="mobile-card-summary">
        <span>{formatLens(photo.lens)}</span>
        <span>{formatDimensions(photo.width, photo.height)}</span>
      </div>

      <AnimatePresence initial={false}>
        {isActive ? (
          <motion.div
            className="mobile-preview"
            initial={{ opacity: 0, height: 0 }}
            animate={{
              opacity: 1,
              height: 'auto',
              transition: {
                duration: 0.22,
                ease: [0.16, 1, 0.3, 1],
              },
            }}
            exit={{
              opacity: 0,
              height: 0,
              transition: {
                duration: 0.3,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
          >
            <img
              src={`/previews/${photo.filename}`}
              alt=""
              className="mobile-preview-image"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <dl className="mobile-meta">
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
          <dt>WB</dt>
          <dd>{formatWhiteBalance(photo.whiteBalance)}</dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>{formatFileSize(photo.fileSizeBytes)}</dd>
        </div>
        <div>
          <dt>Filename</dt>
          <dd>{photo.filename}</dd>
        </div>
      </dl>
    </article>
  )
}

function AssetRow({ photo, onPreviewChange }) {
  const controls = useAnimationControls()

  const activate = () => {
    onPreviewChange(photo)
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
      current?.filename === photo.filename ? null : current,
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
    <motion.tr
      animate={controls}
      initial={{ backgroundColor: 'rgba(243, 241, 236, 0)' }}
      tabIndex={0}
      onHoverStart={activate}
      onHoverEnd={deactivate}
      onFocus={activate}
      onBlur={deactivate}
    >
      <td>{photo.id}</td>
      <td>{formatDate(photo.captureTimestamp)}</td>
      <td>{formatCamera(photo.camera)}</td>
      <td>{formatLens(photo.lens)}</td>
      <td>{formatFocalLength(photo.focalLength, photo.focalLength35mm)}</td>
      <td>{formatExposure(photo.exposureTimeSeconds)}</td>
      <td>{formatAperture(photo.aperture)}</td>
      <td>{formatIso(photo.iso)}</td>
      <td>{formatFlash(photo.flashOn)}</td>
      <td>{formatWhiteBalance(photo.whiteBalance)}</td>
      <td>{formatFileSize(photo.fileSizeBytes)}</td>
      <td>{formatDimensions(photo.width, photo.height)}</td>
    </motion.tr>
  )
}

function App() {
  const [hoveredPhoto, setHoveredPhoto] = useState(null)
  const [activeMobilePhoto, setActiveMobilePhoto] = useState(null)

  return (
    <main className="archive-page">
      <header className="archive-header">
        <div>
          <p className="archive-title">Mac Keller Jr.</p>
          <p className="archive-subtitle">
            Photography asset index sorted by capture date
          </p>
        </div>
        <p className="archive-count">{photoIndex.length} assets</p>
      </header>

      <section
        className="archive-table-wrap archive-desktop"
        aria-label="Photography asset index"
      >
        <table className="archive-table">
          <thead>
            <tr>
              <th scope="col">Index</th>
              <th scope="col">Date</th>
              <th scope="col">Camera</th>
              <th scope="col">Lens</th>
              <th scope="col">Focal</th>
              <th scope="col">Shutter</th>
              <th scope="col">Aperture</th>
              <th scope="col">ISO</th>
              <th scope="col">Flash</th>
              <th scope="col">WB</th>
              <th scope="col">File size</th>
              <th scope="col">Dimensions</th>
            </tr>
          </thead>
          <tbody>
            {photoIndex.map((photo) => (
              <AssetRow
                key={photo.filename}
                photo={photo}
                onPreviewChange={setHoveredPhoto}
              />
            ))}
          </tbody>
        </table>
      </section>

      <section className="archive-mobile" aria-label="Mobile photography asset index">
        {photoIndex.map((photo) => (
          <MobileAssetCard
            key={photo.filename}
            photo={photo}
            isActive={activeMobilePhoto === photo.filename}
            onToggle={() =>
              setActiveMobilePhoto((current) =>
                current === photo.filename ? null : photo.filename,
              )
            }
          />
        ))}
      </section>

      <AnimatePresence>
        {hoveredPhoto ? (
          <motion.aside
            key={hoveredPhoto.filename}
            className="hover-preview"
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
              src={`/previews/${hoveredPhoto.filename}`}
              alt=""
              className="hover-preview-image"
            />
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </main>
  )
}

export default App
