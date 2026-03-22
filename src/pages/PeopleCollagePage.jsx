import { Link } from 'react-router-dom'
import photoIndex from '../data/photoIndex.json'
import './PeopleCollagePage.css'

const PERSON_LABEL_PATTERN =
  /\b(person|man|woman|child|children|girl|boy|crowd|pedestrian|worker|musician|group)\b/i
const EXCLUDED_LABEL_PATTERN = /\b(painted|mural|stencil|sculptural|statue)\b/i

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function isHumanAnnotation(annotation) {
  if (!annotation || annotation.kind !== 'box' || typeof annotation.label !== 'string') {
    return false
  }

  const label = annotation.label.trim()
  return PERSON_LABEL_PATTERN.test(label) && !EXCLUDED_LABEL_PATTERN.test(label)
}

function expandCrop(annotation) {
  const paddingX = clamp(annotation.width * 0.28, 0.04, 0.14)
  const paddingY = clamp(annotation.height * 0.22, 0.04, 0.14)
  const x = clamp(annotation.x - paddingX, 0, 1)
  const y = clamp(annotation.y - paddingY, 0, 1)
  const right = clamp(annotation.x + annotation.width + paddingX, 0, 1)
  const bottom = clamp(annotation.y + annotation.height + paddingY, 0, 1)

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function getCropAspectRatio(photo, crop) {
  if (!photo.width || !photo.height || !crop.width || !crop.height) {
    return 1
  }

  return (crop.width * photo.width) / (crop.height * photo.height)
}

function createCollageItems(photos) {
  const items = []

  for (const photo of photos) {
    const annotations = photo.aiDescription?.landmarkAnnotations ?? []
    const humanAnnotations = annotations.filter(isHumanAnnotation)

    humanAnnotations.forEach((annotation, annotationIndex) => {
      const crop = expandCrop(annotation)
      const aspectRatio = getCropAspectRatio(photo, crop)
      const hash = hashString(`${photo.filename}:${annotation.label}:${annotationIndex}`)
      const emphasis = hash % 6 === 0 ? 'hero' : hash % 4 === 0 ? 'wide' : 'standard'

      items.push({
        id: `${photo.filename}:${annotationIndex}`,
        filename: photo.filename,
        label: annotation.label,
        crop,
        aspectRatio,
        emphasis,
        photo,
      })
    })
  }

  return items.sort((left, right) => {
    const leftHash = hashString(left.id)
    const rightHash = hashString(right.id)
    return leftHash - rightHash
  })
}

function getTileStyle(item) {
  return {
    '--tile-aspect-ratio': String(item.aspectRatio),
    '--image-width': `${100 / item.crop.width}%`,
    '--image-height': `${100 / item.crop.height}%`,
    '--image-left': `${(-item.crop.x / item.crop.width) * 100}%`,
    '--image-top': `${(-item.crop.y / item.crop.height) * 100}%`,
  }
}

export default function PeopleCollagePage() {
  const collageItems = createCollageItems(photoIndex)
  const sourcePhotoCount = new Set(collageItems.map((item) => item.filename)).size

  return (
    <main className="people-collage-page">
      <header className="people-collage-header">
        <div>
          <p className="people-collage-kicker">Mac Keller Jr.</p>
          <h1 className="people-collage-title">Human Fragments</h1>
          <p className="people-collage-subtitle">
            A collage built only from the regions your AI annotations marked as people.
          </p>
        </div>

        <div className="people-collage-actions">
          <p className="people-collage-count">
            {collageItems.length} crops from {sourcePhotoCount} photographs
          </p>
          <Link className="people-collage-link" to="/">
            Back to archive
          </Link>
          <Link className="people-collage-link" to="/metadata">
            Open metadata editor
          </Link>
        </div>
      </header>

      <section className="people-collage-grid">
        {collageItems.map((item) => (
          <article
            className={`people-collage-tile people-collage-tile-${item.emphasis}`}
            key={item.id}
            style={getTileStyle(item)}
          >
            <div className="people-collage-frame">
              <img
                alt={`${item.label} crop from ${item.filename}`}
                className="people-collage-image"
                src={`/previews/${item.filename}`}
              />
            </div>
            <div className="people-collage-meta">
              <p className="people-collage-label">{item.label}</p>
              <p className="people-collage-file">{item.photo.id}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
