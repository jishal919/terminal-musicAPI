# 🎵 Intelligent Music Search & Streaming API

> A production-grade music API that **understands what you meant**, not just what you typed.  
> Built on JioSaavn's public API with a multi-layer validation + scoring pipeline.

---

## Architecture

```
src/
├── index.js                      # Express entry point
├── vercel.json                   # Serverless deployment config
├── src/
│   ├── routes/
│   │   └── index.js              # Route definitions
│   ├── controllers/
│   │   ├── searchController.js   # GET /api/search
│   │   ├── streamController.js   # GET /api/stream
│   │   └── metadataController.js # GET /api/metadata
│   ├── services/
│   │   ├── saavnService.js       # Saavn API adapter + response normaliser
│   │   └── scoringService.js     # ★ Multi-layer validation pipeline
│   ├── utils/
│   │   ├── fuzzy.js              # Levenshtein + Jaccard similarity
│   │   ├── normalizer.js         # Token normalisation + noise removal
│   │   └── cache.js              # Two-tier in-memory cache
│   └── middleware/
│       ├── rateLimiter.js        # 60 req/min sliding window
│       └── errorHandler.js       # Structured JSON error responses
```

---

## Scoring Pipeline

Every search goes through this pipeline **before** anything is returned:

```
raw API results (up to 10 candidates)
        │
        ▼
  [1] NORMALISE
        │   • lowercase
        │   • strip brackets: "(Official Video)", "[HD]"
        │   • remove noise words: official, audio, lyric, remix…
        │   • collapse whitespace
        ▼
  [2] SCORE  (weighted sum, 5 factors)
        │
        │   ┌─────────────────────────────────────────┬────────┐
        │   │ Factor                                  │ Weight │
        │   ├─────────────────────────────────────────┼────────┤
        │   │ Title similarity  (Lev + Jaccard)       │  40%   │
        │   │ Artist match      (Lev + Jaccard)       │  30%   │
        │   │ Keyword overlap   (exact token hits)    │  15%   │
        │   │ Duration proximity (±5s full, ±60s zero)│  10%   │
        │   │ Popularity heuristic (API result order) │   5%   │
        │   └─────────────────────────────────────────┴────────┘
        ▼
  [3] FILTER   — drop confidence < MIN_CONFIDENCE_SCORE (default 0.35)
        ▼
  [4] DEDUPLICATE — remove same id or near-identical title+artist
        ▼
  [5] RANK     — sort descending by confidence score
        ▼
  clean, ranked, high-confidence results ✓
```

### Why Best-of(Levenshtein, Jaccard)?

| Technique | Strength | Weakness |
|-----------|----------|----------|
| Levenshtein (char-level) | Handles typos: "Shakira" → "Shakera" | Fails on word reorder |
| Jaccard (token-level) | Handles reorder: "Drake God's Plan" → "God's Plan Drake" | Misses partial matches |
| **Best-of** | Covers both cases | — |

---

## Endpoints

### `GET /api/search`

| Parameter  | Type   | Required | Description                             |
|------------|--------|----------|-----------------------------------------|
| `query`    | string | ✅        | Song name, artist, or free-form text    |
| `limit`    | number | ❌        | Max results to return (default 5, max 20) |
| `minScore` | float  | ❌        | Override confidence threshold (0–1)     |
| `duration` | number | ❌        | Expected duration in seconds (boosts accuracy) |

**Example response:**
```json
{
  "success": true,
  "query": "Shape of You Ed Sheeran",
  "count": 1,
  "tracks": [
    {
      "id": "5WXAlMNt",
      "title": "Shape of You",
      "artist": "Ed Sheeran",
      "album": "÷ (Divide)",
      "duration": "3:54",
      "durationSec": 234,
      "thumbnail": "https://c.saavncdn.com/471/Shape-of-You-English-2017-20170116050550-500x500.jpg",
      "language": "english",
      "year": "2017",
      "confidence": 0.95,
      "scoreBreakdown": {
        "title": 1.0,
        "artist": 1.0,
        "keyword": 1.0,
        "duration": 0.5,
        "popularity": 1.0
      }
    }
  ],
  "meta": {
    "minScoreApplied": 0.35,
    "candidatesFetched": 10,
    "cached": false
  }
}
```

---

### `GET /api/stream`

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| `id`      | string | ✅        | JioSaavn song ID  |

**Example response:**
```json
{
  "success": true,
  "id": "5WXAlMNt",
  "title": "Shape of You",
  "artist": "Ed Sheeran",
  "streamUrl": "https://aac.saavncdn.com/471/Shape-of-You_320.mp4",
  "quality": "320kbps",
  "allQualities": [
    { "quality": "12kbps",  "url": "https://..." },
    { "quality": "48kbps",  "url": "https://..." },
    { "quality": "96kbps",  "url": "https://..." },
    { "quality": "160kbps", "url": "https://..." },
    { "quality": "320kbps", "url": "https://..." }
  ]
}
```

---

### `GET /api/metadata`

| Parameter | Type   | Required | Description      |
|-----------|--------|----------|------------------|
| `id`      | string | ✅        | JioSaavn song ID |

**Example response:**
```json
{
  "success": true,
  "metadata": {
    "id": "5WXAlMNt",
    "title": "Shape of You",
    "artist": "Ed Sheeran",
    "album": "÷ (Divide)",
    "coverImage": "https://c.saavncdn.com/471/Shape-of-You-English-2017-500x500.jpg",
    "duration": "3:54",
    "durationSec": 234,
    "releaseDate": "2017-01-06",
    "year": "2017",
    "language": "english",
    "label": "Atlantic Records UK",
    "hasLyrics": true,
    "playCount": 492000000,
    "copyright": "℗ 2017 Atlantic Records UK"
  }
}
```

---

## Error Responses

All errors follow this shape:

```json
{
  "success": false,
  "error": "Human-readable message",
  "upstream": "https://url.that.failed (if applicable)"
}
```

| Status | Scenario |
|--------|----------|
| 400 | Missing/invalid query params |
| 404 | Song not found / no stream available |
| 429 | Rate limit exceeded |
| 502 | Upstream API error |
| 504 | Upstream request timed out (>7s) |

---

## Running Locally

```bash
cp .env.example .env
npm install
npm run dev
```

## Deploying to Vercel

```bash
npm i -g vercel
vercel --prod
```

---

## Environment Variables

| Variable               | Default                          | Description                        |
|------------------------|----------------------------------|------------------------------------|
| `PORT`                 | `3000`                           | Server port                        |
| `SAAVN_BASE_URL`       | `https://saavn.sumit.co/api`     | JioSaavn API base URL              |
| `CACHE_TTL_SEARCH`     | `300`                            | Search cache TTL in seconds        |
| `CACHE_TTL_METADATA`   | `3600`                           | Metadata cache TTL in seconds      |
| `MIN_CONFIDENCE_SCORE` | `0.35`                           | Minimum confidence to return track |
| `MAX_SEARCH_CANDIDATES`| `10`                             | Raw candidates fetched for scoring |
| `REQUEST_TIMEOUT_MS`   | `7000`                           | Upstream timeout in ms             |
| `RATE_LIMIT_MAX`       | `60`                             | Max requests per window            |
| `RATE_LIMIT_WINDOW_MS` | `60000`                          | Rate limit window in ms            |
