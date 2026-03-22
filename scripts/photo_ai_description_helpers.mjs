import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'

export const AI_DESCRIPTION_MODEL = 'gpt-5.4'
export const AI_DESCRIPTION_IMAGE_VARIANT = 'preview'
export const AI_DESCRIPTION_TIME_OF_DAY_VALUES = [
  'dawn',
  'morning',
  'midday',
  'afternoon',
  'golden_hour',
  'dusk',
  'night',
  'indeterminate',
]
export const AI_DESCRIPTION_REVIEW_STATUS_VALUES = ['draft', 'approved', 'edited']
export const AI_DESCRIPTION_GENRE_VALUES = [
  'portrait',
  'street',
  'documentary',
  'landscape',
  'still_life',
  'nature',
  'architecture',
  'travel',
  'event',
]
export const AI_DESCRIPTION_PRESENCE_VALUES = ['person', 'group', 'animal', 'no_people']
export const AI_DESCRIPTION_SUBJECT_TAG_VALUES = [
  'worker',
  'musician',
  'child',
  'instrument',
  'tree',
  'flower',
  'building',
  'bridge',
  'tower',
  'church',
  'vehicle',
  'water',
  'path',
  'fence',
  'bench',
  'skyline',
  'crowd',
  'dog',
  'cat',
  'bird',
]
export const AI_DESCRIPTION_SETTING_TAG_VALUES = [
  'indoor',
  'outdoor',
  'urban',
  'rural',
  'park',
  'public_space',
  'home',
  'studio_like',
  'landmark',
  'monument',
  'historic_site',
  'waterfront',
]
export const AI_DESCRIPTION_STYLE_TAG_VALUES = [
  'candid',
  'posed',
  'formal',
  'informal',
  'environmental_portrait',
  'close_up',
  'wide_frame',
  'minimal',
  'centered',
  'layered',
]
export const AI_DESCRIPTION_LANDMARK_ANNOTATION_KIND_VALUES = ['point', 'box']

const TimeOfDaySchema = z.enum(AI_DESCRIPTION_TIME_OF_DAY_VALUES)
const ReviewStatusSchema = z.enum(AI_DESCRIPTION_REVIEW_STATUS_VALUES)
const GenreSchema = z.enum(AI_DESCRIPTION_GENRE_VALUES)
const PresenceSchema = z.enum(AI_DESCRIPTION_PRESENCE_VALUES)
const SubjectTagSchema = z.enum(AI_DESCRIPTION_SUBJECT_TAG_VALUES)
const SettingTagSchema = z.enum(AI_DESCRIPTION_SETTING_TAG_VALUES)
const StyleTagSchema = z.enum(AI_DESCRIPTION_STYLE_TAG_VALUES)

const AiDescriptionProvenanceSchema = z
  .object({
    model: z.literal(AI_DESCRIPTION_MODEL),
    generatedAt: z.string().datetime({ offset: true }),
    imageVariant: z.literal(AI_DESCRIPTION_IMAGE_VARIANT),
  })
  .strict()

const AiDescriptionTagsSchema = z
  .object({
    genres: z.array(GenreSchema).min(1).max(2),
    presence: z.array(PresenceSchema).min(1).max(2),
    subjectTags: z.array(SubjectTagSchema).max(5),
    settingTags: z.array(SettingTagSchema).max(4),
    styleTags: z.array(StyleTagSchema).max(4),
  })
  .strict()

const AiDescriptionLandmarkSchema = z
  .object({
    isFamousLandmark: z.boolean(),
    name: z.string().trim().min(1).nullable(),
    confidence: z.number().min(0).max(1),
    reviewRequired: z.boolean(),
  })
  .strict()

const AiDescriptionLandmarkAnnotationSchema = z
  .object({
    label: z.string().trim().min(1),
    kind: z.enum(AI_DESCRIPTION_LANDMARK_ANNOTATION_KIND_VALUES),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1).nullable(),
    height: z.number().min(0).max(1).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict()

export const AiDescriptionSchema = z
  .object({
    description: z.string().trim().min(1),
    timeOfDay: TimeOfDaySchema,
    setting: z.string().trim().min(1),
    subjects: z.array(z.string().trim().min(1)).min(1).max(8),
    mood: z.string().trim().min(1),
    lighting: z.string().trim().min(1),
    composition: z.string().trim().min(1),
    notableDetails: z.array(z.string().trim().min(1)).min(1).max(10),
    tags: AiDescriptionTagsSchema,
    landmark: AiDescriptionLandmarkSchema,
    landmarkAnnotations: z.array(AiDescriptionLandmarkAnnotationSchema).max(8),
    confidence: z.number().min(0).max(1),
    reviewStatus: ReviewStatusSchema,
    provenance: AiDescriptionProvenanceSchema,
  })
  .strict()

export const AiDescriptionEnvelopeSchema = z
  .object({
    aiDescription: AiDescriptionSchema,
  })
  .strict()

export const MergeablePhotoRowSchema = z
  .object({
    id: z.string().trim().min(1),
    filename: z.string().trim().min(1),
  })
  .passthrough()

export const PhotoIndexRowSchema = MergeablePhotoRowSchema.extend({
  src: z.string().trim().min(1).optional(),
  captureTimestamp: z.string().trim().min(1).optional(),
  camera: z.string().trim().min(1).nullable().optional(),
  aiDescription: AiDescriptionSchema.nullable().optional(),
}).passthrough()

export const DraftPhotoDescriptionRowSchema = z
  .object({
    id: z.string().trim().min(1),
    filename: z.string().trim().min(1),
    src: z.string().trim().min(1),
    captureTimestamp: z.string().trim().min(1),
    camera: z.string().trim().min(1).nullable().optional(),
    aiDescription: AiDescriptionSchema,
  })
  .strict()

export const DraftPhotoDescriptionFileSchema = z.array(DraftPhotoDescriptionRowSchema)

export function createProjectPaths(rootDir = process.cwd()) {
  return {
    rootDir,
    photoIndexPath: path.join(rootDir, 'src', 'data', 'photoIndex.json'),
    previewsDir: path.join(rootDir, 'public', 'previews'),
    draftPath: path.join(rootDir, 'tmp', 'photo-ai-descriptions.draft.json'),
    overlayMergeReportPath: path.join(rootDir, 'tmp', 'json-merge-report.json'),
  }
}

export function readJsonFile(filePath, fallbackValue) {
  if (!existsSync(filePath)) {
    return fallbackValue
  }

  return JSON.parse(readFileSync(filePath, 'utf8'))
}

export function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function readPhotoIndex(photoIndexPath) {
  return z.array(PhotoIndexRowSchema).parse(readJsonFile(photoIndexPath, []))
}

export function readDraftPhotoDescriptions(draftPath) {
  return DraftPhotoDescriptionFileSchema.parse(readJsonFile(draftPath, []))
}

export function readMergeablePhotoRows(filePath) {
  return z.array(MergeablePhotoRowSchema).parse(readJsonFile(filePath, []))
}

export function createDraftPhotoDescriptionRow(photo, aiDescription) {
  return DraftPhotoDescriptionRowSchema.parse({
    id: photo.id,
    filename: photo.filename,
    src: photo.src,
    captureTimestamp: photo.captureTimestamp,
    camera: photo.camera ?? null,
    aiDescription,
  })
}

export function isFinalizedAiDescription(aiDescription) {
  return (
    aiDescription?.reviewStatus === 'approved' || aiDescription?.reviewStatus === 'edited'
  )
}

export function buildFilenameMap(items, label) {
  const byFilename = new Map()

  for (const item of items) {
    if (byFilename.has(item.filename)) {
      throw new Error(`Duplicate ${label} entry for filename "${item.filename}"`)
    }
    byFilename.set(item.filename, item)
  }

  return byFilename
}

export function assertDraftRowsMatchIndex(indexRows, draftRows) {
  const indexByFilename = buildFilenameMap(indexRows, 'photo index')

  for (const draftRow of draftRows) {
    const indexRow = indexByFilename.get(draftRow.filename)
    if (!indexRow) {
      throw new Error(
        `Draft row "${draftRow.filename}" does not exist in src/data/photoIndex.json`,
      )
    }

    if (draftRow.id !== indexRow.id) {
      throw new Error(
        `Draft row id "${draftRow.id}" does not match index id "${indexRow.id}" for "${draftRow.filename}"`,
      )
    }
  }
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function cloneJsonValue(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function isMissingScalarValue(value) {
  return value == null || value === ''
}

function createChangeRecord(row, pathSegments, action) {
  return {
    filename: row.filename,
    id: row.id,
    path: pathSegments.join('.'),
    action,
  }
}

function createConflictRecord(row, pathSegments, baseValue, overlayValue) {
  return {
    filename: row.filename,
    id: row.id,
    path: pathSegments.join('.'),
    baseValue,
    overlayValue,
  }
}

function collectDuplicateKeys(items, source) {
  const rowsByFilename = new Map()

  for (const item of items) {
    const existing = rowsByFilename.get(item.filename) ?? []
    existing.push(item)
    rowsByFilename.set(item.filename, existing)
  }

  return [...rowsByFilename.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([filename, rows]) => ({
      source,
      filename,
      ids: rows.map((row) => row.id),
    }))
}

function buildFirstSeenFilenameMap(items) {
  const byFilename = new Map()

  for (const item of items) {
    if (!byFilename.has(item.filename)) {
      byFilename.set(item.filename, item)
    }
  }

  return byFilename
}

export function createOverlayMergeReport() {
  return {
    summary: {
      baseRowCount: 0,
      overlayRowCount: 0,
      mergedRowCount: 0,
      filledFieldCount: 0,
      skippedConflictCount: 0,
      unmatchedRowCount: 0,
      idMismatchCount: 0,
      duplicateKeyCount: 0,
      blockingIssueCount: 0,
    },
    mergedRows: [],
    filledFields: [],
    skippedConflicts: [],
    unmatchedRows: [],
    idMismatches: [],
    duplicateKeys: [],
  }
}

export function finalizeOverlayMergeReport(report, { baseRowCount, overlayRowCount }) {
  report.summary = {
    baseRowCount,
    overlayRowCount,
    mergedRowCount: report.mergedRows.length,
    filledFieldCount: report.filledFields.length,
    skippedConflictCount: report.skippedConflicts.length,
    unmatchedRowCount: report.unmatchedRows.length,
    idMismatchCount: report.idMismatches.length,
    duplicateKeyCount: report.duplicateKeys.length,
    blockingIssueCount: report.duplicateKeys.length,
  }

  return report
}

export function analyzeOverlayRows(baseRows, overlayRows) {
  const report = createOverlayMergeReport()
  report.duplicateKeys.push(...collectDuplicateKeys(baseRows, 'base'))
  report.duplicateKeys.push(...collectDuplicateKeys(overlayRows, 'overlay'))

  const baseByFilename = buildFirstSeenFilenameMap(baseRows)
  const overlayByFilename = buildFirstSeenFilenameMap(overlayRows)
  const matchedRows = []

  for (const overlayRow of overlayRows) {
    const baseRow = baseByFilename.get(overlayRow.filename)
    if (!baseRow) {
      report.unmatchedRows.push({
        filename: overlayRow.filename,
        id: overlayRow.id,
      })
      continue
    }

    if (overlayRow.id !== baseRow.id) {
      report.idMismatches.push({
        filename: overlayRow.filename,
        baseId: baseRow.id,
        overlayId: overlayRow.id,
      })
      continue
    }

    matchedRows.push({
      baseRow,
      overlayRow,
    })
  }

  finalizeOverlayMergeReport(report, {
    baseRowCount: baseRows.length,
    overlayRowCount: overlayRows.length,
  })

  return {
    report,
    baseByFilename,
    overlayByFilename,
    matchedRows,
    hasBlockingIssues: report.duplicateKeys.length > 0,
  }
}

function shouldOverwritePath(pathSegments, overwritePaths) {
  if (!overwritePaths || overwritePaths.size === 0) {
    return false
  }

  return overwritePaths.has(pathSegments.join('.'))
}

function mergeOverlayValue(baseValue, overlayValue, rowIdentity, pathSegments, options, rowChanges, report) {
  const overwriteThisPath = shouldOverwritePath(pathSegments, options.overwritePaths)
  if (overwriteThisPath) {
    if (overlayValue === undefined || isDeepStrictEqual(baseValue, overlayValue)) {
      return baseValue
    }

    const action =
      baseValue === undefined ? 'added' : isMissingScalarValue(baseValue) ? 'filled' : 'overwritten'
    const change = createChangeRecord(rowIdentity, pathSegments, action)
    rowChanges.push(change)
    report.filledFields.push(change)
    return cloneJsonValue(overlayValue)
  }

  if (Array.isArray(overlayValue)) {
    if (baseValue === undefined) {
      const change = createChangeRecord(rowIdentity, pathSegments, 'added')
      rowChanges.push(change)
      report.filledFields.push(change)
      return cloneJsonValue(overlayValue)
    }

    if (!Array.isArray(baseValue)) {
      if (isMissingScalarValue(baseValue)) {
        const change = createChangeRecord(rowIdentity, pathSegments, 'filled')
        rowChanges.push(change)
        report.filledFields.push(change)
        return cloneJsonValue(overlayValue)
      }

      if (!isDeepStrictEqual(baseValue, overlayValue)) {
        report.skippedConflicts.push(
          createConflictRecord(rowIdentity, pathSegments, baseValue, overlayValue),
        )
      }
      return baseValue
    }

    if (baseValue.length === 0 && overlayValue.length > 0) {
      const change = createChangeRecord(rowIdentity, pathSegments, 'filled')
      rowChanges.push(change)
      report.filledFields.push(change)
      return cloneJsonValue(overlayValue)
    }

    if (baseValue.length > 0 && overlayValue.length > 0 && !isDeepStrictEqual(baseValue, overlayValue)) {
      report.skippedConflicts.push(
        createConflictRecord(rowIdentity, pathSegments, baseValue, overlayValue),
      )
    }

    return baseValue
  }

  if (isPlainObject(overlayValue)) {
    if (baseValue === undefined) {
      const change = createChangeRecord(rowIdentity, pathSegments, 'added')
      rowChanges.push(change)
      report.filledFields.push(change)
      return cloneJsonValue(overlayValue)
    }

    if (!isPlainObject(baseValue)) {
      if (isMissingScalarValue(baseValue)) {
        const change = createChangeRecord(rowIdentity, pathSegments, 'filled')
        rowChanges.push(change)
        report.filledFields.push(change)
        return cloneJsonValue(overlayValue)
      }

      if (!isDeepStrictEqual(baseValue, overlayValue)) {
        report.skippedConflicts.push(
          createConflictRecord(rowIdentity, pathSegments, baseValue, overlayValue),
        )
      }
      return baseValue
    }

    let nextObject = baseValue
    for (const [key, nestedOverlayValue] of Object.entries(overlayValue)) {
      const nestedBaseValue = baseValue[key]
      const nestedPath = [...pathSegments, key]
      const mergedNestedValue = mergeOverlayValue(
        nestedBaseValue,
        nestedOverlayValue,
        rowIdentity,
        nestedPath,
        options,
        rowChanges,
        report,
      )

      if (mergedNestedValue !== nestedBaseValue) {
        if (nextObject === baseValue) {
          nextObject = { ...baseValue }
        }
        nextObject[key] = mergedNestedValue
      }
    }

    return nextObject
  }

  if (baseValue === undefined) {
    const change = createChangeRecord(rowIdentity, pathSegments, 'added')
    rowChanges.push(change)
    report.filledFields.push(change)
    return cloneJsonValue(overlayValue)
  }

  if (isMissingScalarValue(baseValue)) {
    const change = createChangeRecord(rowIdentity, pathSegments, 'filled')
    rowChanges.push(change)
    report.filledFields.push(change)
    return cloneJsonValue(overlayValue)
  }

  if (
    overlayValue !== undefined &&
    !isMissingScalarValue(overlayValue) &&
    !isDeepStrictEqual(baseValue, overlayValue)
  ) {
    report.skippedConflicts.push(
      createConflictRecord(rowIdentity, pathSegments, baseValue, overlayValue),
    )
  }

  return baseValue
}

export function mergeJsonOverlayRows(baseRows, overlayRows, options = {}) {
  const normalizedOptions = {
    overwritePaths: new Set(options.overwritePaths ?? []),
  }

  const analysis = analyzeOverlayRows(baseRows, overlayRows)
  const report = analysis.report

  if (analysis.hasBlockingIssues) {
    return {
      mergedRows: baseRows,
      report,
      hasBlockingIssues: true,
    }
  }

  const nextRows = baseRows.map((baseRow) => {
    const overlayRow = analysis.overlayByFilename.get(baseRow.filename)
    if (!overlayRow || overlayRow.id !== baseRow.id) {
      return baseRow
    }

    let nextRow = baseRow
    const rowChanges = []

    for (const [key, overlayValue] of Object.entries(overlayRow)) {
      if (key === 'id' || key === 'filename') {
        continue
      }

      const mergedValue = mergeOverlayValue(
        baseRow[key],
        overlayValue,
        baseRow,
        [key],
        normalizedOptions,
        rowChanges,
        report,
      )

      if (mergedValue !== baseRow[key]) {
        if (nextRow === baseRow) {
          nextRow = { ...baseRow }
        }
        nextRow[key] = mergedValue
      }
    }

    if (rowChanges.length > 0) {
      report.mergedRows.push({
        filename: baseRow.filename,
        id: baseRow.id,
        fieldCount: rowChanges.length,
        fields: rowChanges.map(({ path, action }) => ({ path, action })),
      })
    }

    return nextRow
  })

  finalizeOverlayMergeReport(report, {
    baseRowCount: baseRows.length,
    overlayRowCount: overlayRows.length,
  })

  return {
    mergedRows: nextRows,
    report,
    hasBlockingIssues: false,
  }
}

export function mergeApprovedAiDescriptions(indexRows, draftRows) {
  const finalizedDraftRows = draftRows
    .filter((row) => isFinalizedAiDescription(row.aiDescription))
    .map((row) => ({
      id: row.id,
      filename: row.filename,
      aiDescription: row.aiDescription,
    }))

  const pendingDraftCount = draftRows.length - finalizedDraftRows.length
  const overlayMerge = mergeJsonOverlayRows(indexRows, finalizedDraftRows, {
    overwritePaths: ['aiDescription'],
  })

  return {
    mergedRows: overlayMerge.mergedRows,
    mergedCount: overlayMerge.report.mergedRows.length,
    skippedDraftCount: pendingDraftCount,
    report: overlayMerge.report,
    hasBlockingIssues: overlayMerge.hasBlockingIssues,
  }
}
