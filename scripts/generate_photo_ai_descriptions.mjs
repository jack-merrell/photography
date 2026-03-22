import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import {
  AI_DESCRIPTION_IMAGE_VARIANT,
  AI_DESCRIPTION_GENRE_VALUES,
  AI_DESCRIPTION_MODEL,
  AI_DESCRIPTION_PRESENCE_VALUES,
  AI_DESCRIPTION_SETTING_TAG_VALUES,
  AI_DESCRIPTION_STYLE_TAG_VALUES,
  AI_DESCRIPTION_SUBJECT_TAG_VALUES,
  AiDescriptionEnvelopeSchema,
  assertDraftRowsMatchIndex,
  buildFilenameMap,
  createDraftPhotoDescriptionRow,
  createProjectPaths,
  isFinalizedAiDescription,
  readDraftPhotoDescriptions,
  readPhotoIndex,
  writeJsonFile,
} from './photo_ai_description_helpers.mjs'

const paths = createProjectPaths(process.cwd())

dotenv.config({ path: path.join(paths.rootDir, '.env.local'), quiet: true })
dotenv.config({ quiet: true })

function printHelp() {
  console.log(`Usage: npm run photo:describe:draft -- [--limit=<count>] [--only=<id-or-filename,...>]

Generates draft AI descriptions for photos that do not already have finalized descriptions.

Options:
  --limit=<count>            Generate at most this many new drafts
  --only=<items>             Comma-separated photo ids or filenames to target
  --help                     Show this help message`)
}

function parseArgs(argv) {
  const args = {
    limit: null,
    only: new Set(),
    help: false,
  }

  for (const arg of argv) {
    if (arg === '--help') {
      args.help = true
      continue
    }

    if (arg.startsWith('--limit=')) {
      const rawLimit = arg.slice('--limit='.length)
      const limit = Number.parseInt(rawLimit, 10)
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive integer. Received "${rawLimit}".`)
      }
      args.limit = limit
      continue
    }

    if (arg.startsWith('--only=')) {
      const values = arg
        .slice('--only='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)

      if (values.length === 0) {
        throw new Error('--only requires at least one id or filename.')
      }

      for (const value of values) {
        args.only.add(value)
      }
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function toDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const mimeType = extension === '.png' ? 'image/png' : 'image/jpeg'
  return `data:${mimeType};base64,${readFileSync(filePath).toString('base64')}`
}

function matchesOnlyFilter(photo, onlyFilter) {
  if (onlyFilter.size === 0) {
    return true
  }

  return onlyFilter.has(photo.id) || onlyFilter.has(photo.filename)
}

function sortDraftRows(draftRows, photoPositionByFilename) {
  return [...draftRows].sort(
    (left, right) =>
      (photoPositionByFilename.get(left.filename) ?? Number.MAX_SAFE_INTEGER) -
      (photoPositionByFilename.get(right.filename) ?? Number.MAX_SAFE_INTEGER),
  )
}

async function describePhoto(client, photo, imagePath) {
  const generatedAt = new Date().toISOString()
  const imageDataUrl = toDataUrl(imagePath)
  const genreList = AI_DESCRIPTION_GENRE_VALUES.join(', ')
  const presenceList = AI_DESCRIPTION_PRESENCE_VALUES.join(', ')
  const subjectTagList = AI_DESCRIPTION_SUBJECT_TAG_VALUES.join(', ')
  const settingTagList = AI_DESCRIPTION_SETTING_TAG_VALUES.join(', ')
  const styleTagList = AI_DESCRIPTION_STYLE_TAG_VALUES.join(', ')

  const response = await client.responses.parse({
    model: AI_DESCRIPTION_MODEL,
    instructions: `You are a meticulous photography archivist writing public-facing catalog descriptions.

Return only the requested JSON shape.
Stay grounded in visible evidence from the image.
Use a curatorial voice: vivid, restrained, and observant.
Never invent private facts, locations, names, or intentions.
If time of day is uncertain, use "indeterminate".
The description should be 90-140 words in polished prose.
Keep setting, mood, lighting, and composition concise noun or adjective phrases, not full sentences.
Keep subjects and notableDetails specific and concrete.
For tags, use only the allowed controlled vocabulary.
Choose 1-2 genres from: ${genreList}.
Choose 1-2 presence tags from: ${presenceList}. Use "no_people" only when there are no visible people or animals.
Choose up to 5 subjectTags from: ${subjectTagList}.
Choose up to 4 settingTags from: ${settingTagList}.
Choose up to 4 styleTags from: ${styleTagList}.
Only mark a famous landmark when the identification is strongly supported by visible evidence.
If landmark identification is uncertain or absent, set landmark.isFamousLandmark to false, landmark.name to null, landmark.confidence to 0, and landmark.reviewRequired to false.
If landmark.isFamousLandmark is true, provide a specific name, a confidence score, and set landmark.reviewRequired to true.
Set confidence to a number between 0 and 1.
Set reviewStatus to "draft".
Set provenance.model to "${AI_DESCRIPTION_MODEL}".
Set provenance.generatedAt to "${generatedAt}".
Set provenance.imageVariant to "${AI_DESCRIPTION_IMAGE_VARIANT}".`,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Analyze this photograph for a searchable archive entry.

Photo id: ${photo.id}
Filename: ${photo.filename}

Focus on:
- what is visibly in the frame
- the apparent time of day when supportable
- the emotional register created by the image
- any notable visual details that a human reviewer would care about
- the strongest applicable archival tags for genre, presence, subject matter, setting, style, and landmark status`,
          },
          {
            type: 'input_image',
            detail: 'high',
            image_url: imageDataUrl,
          },
        ],
      },
    ],
    max_output_tokens: 900,
    text: {
      format: zodTextFormat(AiDescriptionEnvelopeSchema, 'photo_ai_description', {
        description: 'Structured archive-ready description of a photograph.',
      }),
    },
  })

  if (!response.output_parsed) {
    throw new Error(`Model did not return a parsed description for "${photo.filename}".`)
  }

  return response.output_parsed.aiDescription
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is missing. Add it to your shell environment or .env.local before generating descriptions.',
    )
  }

  const photoIndex = readPhotoIndex(paths.photoIndexPath)
  const existingDraftRows = readDraftPhotoDescriptions(paths.draftPath)
  assertDraftRowsMatchIndex(photoIndex, existingDraftRows)

  const photoPositionByFilename = new Map(
    photoIndex.map((photo, index) => [photo.filename, index]),
  )
  const existingDraftByFilename = buildFilenameMap(existingDraftRows, 'draft')

  const selectedPhotos = photoIndex.filter((photo) => matchesOnlyFilter(photo, args.only))
  const photosToGenerate = selectedPhotos
    .filter((photo) => !isFinalizedAiDescription(photo.aiDescription))
    .filter((photo) => !existingDraftByFilename.has(photo.filename))
    .slice(0, args.limit ?? Number.MAX_SAFE_INTEGER)

  if (selectedPhotos.length === 0) {
    throw new Error('No photos matched the provided --only filter.')
  }

  if (photosToGenerate.length === 0) {
    console.log(
      `No new drafts needed. Existing draft rows: ${existingDraftRows.length}. Finalized index rows are skipped automatically.`,
    )
    return
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const draftRows = new Map(existingDraftByFilename)

  for (const [index, photo] of photosToGenerate.entries()) {
    const imagePath = path.join(paths.previewsDir, photo.filename)
    if (!existsSync(imagePath)) {
      throw new Error(`Preview image not found for "${photo.filename}" at ${imagePath}`)
    }

    console.log(
      `[${index + 1}/${photosToGenerate.length}] Generating draft for ${photo.filename}`,
    )

    const aiDescription = await describePhoto(client, photo, imagePath)
    draftRows.set(photo.filename, createDraftPhotoDescriptionRow(photo, aiDescription))

    writeJsonFile(
      paths.draftPath,
      sortDraftRows([...draftRows.values()], photoPositionByFilename),
    )
  }

  console.log(
    `Wrote ${draftRows.size} draft rows to ${path.relative(paths.rootDir, paths.draftPath)}`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
