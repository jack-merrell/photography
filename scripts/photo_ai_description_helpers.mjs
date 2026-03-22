import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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
export const AI_DESCRIPTION_PRESENCE_VALUES = [
  'person',
  'group',
  'animal',
  'no_people',
]
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

export const PhotoIndexRowSchema = z
  .object({
    id: z.string().trim().min(1),
    filename: z.string().trim().min(1),
    src: z.string().trim().min(1),
    captureTimestamp: z.string().trim().min(1),
    camera: z.string().trim().min(1).nullable().optional(),
    aiDescription: AiDescriptionSchema.nullable().optional(),
  })
  .passthrough()

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

export function mergeApprovedAiDescriptions(indexRows, draftRows) {
  assertDraftRowsMatchIndex(indexRows, draftRows)

  const draftByFilename = buildFilenameMap(draftRows, 'draft')
  let mergedCount = 0
  let skippedDraftCount = 0

  const mergedRows = indexRows.map((row) => {
    const draftRow = draftByFilename.get(row.filename)
    if (!draftRow) {
      return row
    }

    if (!isFinalizedAiDescription(draftRow.aiDescription)) {
      skippedDraftCount += 1
      return row
    }

    mergedCount += 1
    return {
      ...row,
      aiDescription: draftRow.aiDescription,
    }
  })

  return {
    mergedRows,
    mergedCount,
    skippedDraftCount,
  }
}
