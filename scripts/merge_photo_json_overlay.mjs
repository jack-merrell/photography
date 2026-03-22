import path from 'node:path'
import process from 'node:process'
import {
  createProjectPaths,
  mergeJsonOverlayRows,
  readMergeablePhotoRows,
  writeJsonFile,
} from './photo_ai_description_helpers.mjs'

const projectPaths = createProjectPaths(process.cwd())

function printHelp() {
  console.log(`Usage: npm run photo:merge:overlay -- --overlay=<path> [--base=<path>] [--out=<path>] [--report=<path>]

Safely overlays one JSON photo array onto another without overwriting populated base values.

Defaults:
  --base=${path.relative(projectPaths.rootDir, projectPaths.photoIndexPath)}
  --out=<same as --base>
  --report=${path.relative(projectPaths.rootDir, projectPaths.overlayMergeReportPath)}`)
}

function parseArgs(args) {
  const parsed = {}
  const allowedKeys = new Set(['base', 'overlay', 'out', 'report'])

  for (const arg of args) {
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    const [rawKey, ...rawValueParts] = arg.slice(2).split('=')
    const value = rawValueParts.join('=')
    if (!value) {
      throw new Error(`Argument "${arg}" must use the form --name=value`)
    }
    if (!allowedKeys.has(rawKey)) {
      throw new Error(`Unknown argument: --${rawKey}`)
    }

    parsed[rawKey] = value
  }

  return parsed
}

function resolvePath(rootDir, providedPath, fallbackPath) {
  const candidate = providedPath ?? fallbackPath
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate)
}

function formatRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath) || '.'
}

function buildSummary(report) {
  return [
    `merged rows: ${report.summary.mergedRowCount}`,
    `filled fields: ${report.summary.filledFieldCount}`,
    `conflicts skipped: ${report.summary.skippedConflictCount}`,
    `unmatched rows: ${report.summary.unmatchedRowCount}`,
    `id mismatches: ${report.summary.idMismatchCount}`,
    `duplicate keys: ${report.summary.duplicateKeyCount}`,
  ].join(', ')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    printHelp()
    return
  }

  const parsedArgs = parseArgs(args)
  if (!parsedArgs.overlay) {
    throw new Error('An overlay file is required. Use --overlay=<path>.')
  }

  const basePath = resolvePath(projectPaths.rootDir, parsedArgs.base, projectPaths.photoIndexPath)
  const overlayPath = resolvePath(projectPaths.rootDir, parsedArgs.overlay)
  const outputPath = resolvePath(projectPaths.rootDir, parsedArgs.out, basePath)
  const reportPath = resolvePath(
    projectPaths.rootDir,
    parsedArgs.report,
    projectPaths.overlayMergeReportPath,
  )

  const baseRows = readMergeablePhotoRows(basePath)
  const overlayRows = readMergeablePhotoRows(overlayPath)
  const mergeResult = mergeJsonOverlayRows(baseRows, overlayRows)

  writeJsonFile(reportPath, mergeResult.report)

  if (mergeResult.hasBlockingIssues) {
    throw new Error(
      `Merge aborted because duplicate filename keys were found. Review ${formatRelative(projectPaths.rootDir, reportPath)}.`,
    )
  }

  writeJsonFile(outputPath, mergeResult.mergedRows)

  console.log(`Overlay merge complete: ${buildSummary(mergeResult.report)}.`)
  console.log(`Output: ${formatRelative(projectPaths.rootDir, outputPath)}`)
  console.log(`Report: ${formatRelative(projectPaths.rootDir, reportPath)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
