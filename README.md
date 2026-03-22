# Photography Archive Workflow

## Setup

Install dependencies:

```sh
npm install
```

Add your OpenAI API key to `.env.local` or export it in the shell:

```sh
OPENAI_API_KEY=your_key_here
```

`.env.local` is already ignored by git.

## Existing photo scripts

Rebuild the metadata index:

```sh
npm run photo:index
```

Rebuild the preview images:

```sh
npm run photo:previews
```

`photo:index` preserves any existing `aiDescription` values by filename, so approved descriptions survive future metadata rebuilds.

`src/data/photoIndex.json` is the canonical source of truth for published photo metadata, including merged AI descriptions. Any draft files in `tmp/` are temporary review artifacts and can be deleted after merge.

## AI description staging workflow

If you want to generate a new review batch in the future, create temporary staged descriptions for photos that do not already have approved or edited descriptions:

```sh
npm run photo:describe:draft
```

Useful targeting flags:

```sh
npm run photo:describe:draft -- --limit=2
npm run photo:describe:draft -- --only=0001,mkjr_20231109_sony-ilce-7cm2_001.jpg
```

This creates a temporary review file at `tmp/photo-ai-descriptions.draft.json`. It is not a live source for the site, and you can delete it after merging.

## Review and approval

Open the temporary staging file and review each generated `aiDescription`.

Use these review states:

- `draft`: not ready to publish yet
- `approved`: model output is accepted as-is
- `edited`: manually revised text that is ready to publish

You can edit any part of the structured object before merging.

## Merge approved descriptions

Only rows marked `approved` or `edited` are merged into `src/data/photoIndex.json`:

```sh
npm run photo:describe:merge
```

Rows still marked `draft` remain only in the review artifact and are skipped during merge.

## Safe overlay merges

To combine another JSON photo array into the main index without overwriting populated values, use the overlay merge script:

```sh
npm run photo:merge:overlay -- --overlay=tmp/some-overlay.json --out=tmp/photoIndex.overlay-preview.json
```

Defaults:

- `--base=src/data/photoIndex.json`
- `--out=<same as base>`
- `--report=tmp/json-merge-report.json`

Rules:

- rows are matched by `filename`
- `id` must also match for a merge to happen
- existing populated base values are preserved
- missing or blank base values are filled
- unmatched rows, id mismatches, duplicate filenames, and skipped conflicts are written to the report

If you want a dry run, point `--out` at a temp file instead of the main index.

## Build check

After merging, confirm the site still bundles correctly:

```sh
npm run build
```
