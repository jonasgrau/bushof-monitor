# Aachen Bushof — Abfahrtsmonitor

Real-time departure monitor for Aachen Bushof (central bus station), built with zero dependencies.

![Dark themed bus departure board showing live departures with colored line badges, countdown timers, and weather](https://img.shields.io/badge/status-live-brightgreen)

## Features

- **Live departures** — Real-time data from the AVV/ASEAG HAFAS API, refreshed every 30 seconds
- **Cancellation display** — Cancelled departures shown with strikethrough and "Fällt aus" badge
- **Line filter chips** — Tap bus lines to filter; selections persist across sessions
- **Weather widget** — Current temperature and conditions via Open-Meteo (no API key needed)
- **Progress bars** — Visual countdown on each row, color-shifting from green to red
- **Smooth animations** — Slide-in rows, minute-bump transitions, pulsing "jetzt" badges
- **Delay indicators** — Strikethrough scheduled time with realtime update and delay badge
- **PWA** — Installable on mobile and desktop, works offline with cached shell
- **Responsive** — Optimized for desktop, tablet, and mobile (4 breakpoints)
- **Dark theme** — GitHub-dark inspired design with animated header glow

## Tech Stack

- **Frontend**: Single HTML file with embedded CSS + JS (no build step, no framework)
- **Backend**: Node.js HTTP server / Vercel Serverless Function (zero npm dependencies)
- **API**: AVV HAFAS `mgate.exe` endpoint
- **Weather**: Open-Meteo free API
- **Hosting**: Vercel

## Getting Started

### Local Development

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000)

### Demo Mode

```bash
DEMO=1 node server.js
```

Runs with fake departure data — useful for development without API access.

### Deploy to Vercel

```bash
vercel
```

The project is pre-configured with `vercel.json` for routing and service worker headers.

## Project Structure

```
.
├── api/
│   └── departures.js    # Vercel serverless function (HAFAS proxy)
├── public/
│   ├── index.html        # Frontend (single-file SPA)
│   ├── favicon.svg        # Bus icon favicon
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service worker
├── server.js              # Local dev server (static files + HAFAS proxy)
├── vercel.json            # Vercel routing & headers config
└── package.json
```

## How It Works

1. The backend proxies requests to `https://auskunft.avv.de/bin/mgate.exe` (AVV HAFAS API)
2. HAFAS returns departure data for station `L=1001` (Aachen Bushof)
3. The backend parses the response, converts Berlin-timezone times to UTC, and returns clean JSON
4. The frontend fetches `/api/departures` every 30 seconds and renders a live departure board
5. Countdown timers update every second with in-place DOM diffing (no full re-renders)

## License

MIT
