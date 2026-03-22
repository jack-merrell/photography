import path from 'node:path'
import process from 'node:process'
import {
  createProjectPaths,
  mergeApprovedAiDescriptions,
  readDraftPhotoDescriptions,
  readPhotoIndex,
  writeJsonFile,
} from './photo_ai_description_helpers.mjs'

const paths = createProjectPaths(process.cwd())

function printHelp() {
  console.log(`Usage: npm run photo:describe:merge

Merges approved or edited AI descriptions from the draft file into src/data/photoIndex.json.`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    printHelp()
    return
  }

  if (args.length > 0) {
    throw new Error(`Unknown argument: ${args[0]}`)
  }

  const photoIndex = readPhotoIndex(paths.photoIndexPath)
  const draftRows = readDraftPhotoDescriptions(paths.draftPath)

  if (draftRows.length === 0) {
    console.log('No draft rows found to merge.')
    return
  }

  const mergeResult = mergeApprovedAiDescriptions(photoIndex, draftRows)

  if (mergeResult.hasBlockingIssues) {
    throw new Error('Merge aborted because duplicate filename keys were found in the base or draft rows.')
  }

  if (mergeResult.mergedCount === 0) {
    console.log(
      `No approved or edited draft rows were found. Skipped ${mergeResult.skippedDraftCount} draft rows.`,
    )
    return
  }

  writeJsonFile(paths.photoIndexPath, mergeResult.mergedRows)

  console.log(
    `Merged ${mergeResult.mergedCount} AI descriptions into ${path.relative(paths.rootDir, paths.photoIndexPath)}. Skipped ${mergeResult.skippedDraftCount} draft rows that are still pending review. Preserved ${mergeResult.report.skippedConflicts.length} conflicting existing values.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
