const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DEMO = process.env.DEMO === "1";

const HAFAS_URL = "https://auskunft.avv.de/bin/mgate.exe";
const HAFAS_BODY = JSON.stringify({
  svcReqL: [
    {
      meth: "StationBoard",
      req: {
        type: "DEP",
        stbLoc: { lid: "A=1@L=1001@" },
        maxJny: 50,
      },
    },
  ],
  client: { type: "WEB", id: "AVV_AACHEN", name: "webapp" },
  ver: "1.26",
  lang: "deu",
  auth: { type: "AID", aid: "4vV1AcH3N511icH" },
});

let cachedResponse = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 15000;

function generateDemoData() {
  const now = Date.now();
  const lines = [
    { line: "11", destination: "Siegel", platform: "H.10" },
    { line: "2", destination: "Eilendorf Schubertstraße", platform: "H.12" },
    { line: "44", destination: "Driescher Hof - Brand", platform: "H.12" },
    { line: "45", destination: "Uniklinik", platform: "H.11" },
    { line: "25", destination: "Vaals Busstation", platform: "H.14" },
    { line: "51", destination: "Aachen Schanz", platform: "H.13" },
    { line: "73", destination: "Alsdorf Markt", platform: "H.13" },
    { line: "5", destination: "Uniklinik", platform: "H.11" },
    { line: "35", destination: "Driescher Hof", platform: "H.12" },
    { line: "12", destination: "Technologiepark", platform: "H.10" },
    { line: "33", destination: "Brand", platform: "H.12" },
    { line: "7", destination: "Eilendorf Karlstraße", platform: "H.13" },
    { line: "SB63", destination: "Merkstein", platform: "H.14" },
    { line: "14", destination: "Hörn", platform: "H.10" },
    { line: "47", destination: "Hoengen", platform: "H.13" },
  ];
  const departures = lines.map((l, i) => ({
    line: l.line,
    destination: l.destination,
    platform: l.platform,
    departureTimeMs:
      now + (i * 2 + 1) * 60000 + Math.floor(Math.random() * 30000),
    scheduledTimeMs: now + (i * 2 + 1) * 60000,
    isRealtime: Math.random() > 0.3,
    isCancelled: i === 3 || i === 9,
  }));
  departures.sort((a, b) => a.departureTimeMs - b.departureTimeMs);
  return departures;
}

function parseHafasResponse(data) {
  const result = JSON.parse(data);

  if (result.err !== "OK") {
    throw new Error("HAFAS error: " + (result.errTxt || result.err));
  }

  const svcRes = result.svcResL[0];
  if (svcRes.err !== "OK") {
    throw new Error("StationBoard error: " + (svcRes.errTxt || svcRes.err));
  }

  const res = svcRes.res;
  const prodL = res.common.prodL;
  const jnyL = res.jnyL || [];

  // The date for the timetable is in res.sD (format YYYYMMDD)
  const baseDate = res.sD || jnyL[0]?.date;

  const departures = [];
  for (const jny of jnyL) {
    const prodIdx = jny.stbStop?.dProdX ?? jny.prodX;
    const prod = prodL[prodIdx];
    const line = prod?.nameS || prod?.name || "?";

    const destination = jny.dirTxt || "?";
    const platform = jny.stbStop?.dPltfR?.txt || jny.stbStop?.dPltfS?.txt || "";

    // Parse time: dTimeR (realtime) or dTimeS (scheduled), format HHMMSS
    const timeR = jny.stbStop?.dTimeR;
    const timeS = jny.stbStop?.dTimeS;
    const dateStr = jny.date || baseDate;

    const scheduledMs = hafasTimeToMs(dateStr, timeS);
    const realtimeMs = timeR ? hafasTimeToMs(dateStr, timeR) : scheduledMs;
    const isRealtime = jny.stbStop?.dProgType === "PROGNOSED" && !!timeR;
    const isCancelled = !!jny.stbStop?.dCncl;

    departures.push({
      line,
      destination,
      platform,
      departureTimeMs: realtimeMs,
      scheduledTimeMs: scheduledMs,
      isRealtime,
      isCancelled,
    });
  }

  departures.sort((a, b) => a.departureTimeMs - b.departureTimeMs);
  return departures;
}

function hafasTimeToMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return 0;
  // dateStr: YYYYMMDD, timeStr: HHMMSS (can exceed 24h for next-day trips)
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6));
  const day = parseInt(dateStr.slice(6, 8));
  const hours = parseInt(timeStr.slice(0, timeStr.length - 4));
  const minutes = parseInt(timeStr.slice(-4, -2));
  const seconds = parseInt(timeStr.slice(-2));

  // HAFAS times are in Europe/Berlin.
  // Treat input as UTC first, then compute the Berlin offset to correct it.
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(asUtc))) {
    parts[p.type] = p.value;
  }
  const berlinShowsUtc = Date.UTC(
    parseInt(parts.year),
    parseInt(parts.month) - 1,
    parseInt(parts.day),
    parseInt(parts.hour === "24" ? "0" : parts.hour),
    parseInt(parts.minute),
    parseInt(parts.second),
  );
  const offsetMs = berlinShowsUtc - asUtc;
  return asUtc - offsetMs;
}

function fetchHafas() {
  return new Promise((resolve, reject) => {
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const req = https.request(HAFAS_URL, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(HAFAS_BODY);
    req.end();
  });
}

async function handleApiRequest(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (DEMO) {
    const departures = generateDemoData();
    res.end(JSON.stringify({ departures, fetchedAt: Date.now(), error: null }));
    return;
  }

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL_MS) {
    res.end(JSON.stringify(cachedResponse));
    return;
  }

  try {
    const raw = await fetchHafas();
    const departures = parseHafasResponse(raw);
    cachedResponse = { departures, fetchedAt: now, error: null };
    cacheTimestamp = now;
    res.end(JSON.stringify(cachedResponse));
  } catch (err) {
    console.error("API fetch error:", err.message);
    if (cachedResponse) {
      cachedResponse.error = "API unreachable, showing cached data";
      res.end(JSON.stringify(cachedResponse));
    } else {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          departures: [],
          fetchedAt: now,
          error: "API unreachable: " + err.message,
        }),
      );
    }
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

function handleStaticRequest(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/departures") {
    handleApiRequest(req, res);
  } else {
    // Serve static files from public/
    let safePath = url.pathname === "/" ? "/index.html" : url.pathname;
    safePath = safePath.replace(/\.\./g, ""); // Prevent path traversal
    const filePath = path.join(__dirname, "public", safePath);
    handleStaticRequest(req, res, filePath);
  }
});

server.listen(PORT, () => {
  console.log(`Bus monitor running at http://localhost:${PORT}`);
  if (DEMO) console.log("DEMO mode active — serving fake data");
});
