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

## AI description workflow

Generate draft descriptions for photos that do not already have approved or edited descriptions:

```sh
npm run photo:describe:draft
```

Useful targeting flags:

```sh
npm run photo:describe:draft -- --limit=2
npm run photo:describe:draft -- --only=0001,mkjr_20231109_sony-ilce-7cm2_001.jpg
```

Drafts are written to `tmp/photo-ai-descriptions.draft.json`.

## Review and approval

Open `tmp/photo-ai-descriptions.draft.json` and review each generated `aiDescription`.

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

## Build check

After merging, confirm the site still bundles correctly:

```sh
npm run build
```
