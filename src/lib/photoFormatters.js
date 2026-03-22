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

export function formatDate(timestamp) {
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

export function formatTime(timestamp) {
  const date = new Date(timestamp.replace(' +0000', 'Z'))
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date)
}

export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return `${(bytes / 1024).toFixed(0)} KB`
}

export function formatDimensions(width, height) {
  return `${width} × ${height}`
}

export function formatExposure(seconds) {
  if (!seconds) {
    return '—'
  }

  if (seconds >= 1) {
    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`
  }

  return `1/${Math.round(1 / seconds)}s`
}

export function formatAperture(aperture) {
  if (!aperture) {
    return '—'
  }

  return `f/${aperture.toFixed(1)}`
}

export function formatFocalLength(focalLength, focalLength35mm) {
  if (!focalLength) {
    return '—'
  }

  if (focalLength35mm && focalLength35mm !== focalLength) {
    return `${focalLength}mm (${focalLength35mm}mm eq.)`
  }

  return `${focalLength}mm`
}

export function formatCamera(camera) {
  return cameraLabels[camera] ?? camera
}

export function formatLens(lens) {
  return lens ?? '—'
}

export function formatIso(iso) {
  return iso ? `ISO ${iso}` : '—'
}

export function formatGps(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return '—'
  }

  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
}

export function formatWhiteBalance(value) {
  if (value == null) {
    return '—'
  }

  return whiteBalanceLabels[value] ?? String(value)
}

export function formatFlash(value) {
  if (value == null) {
    return '—'
  }

  return flashLabels[value] ?? String(value)
}
