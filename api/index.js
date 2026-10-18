const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Daftar instance API YouTube berkualitas tinggi dengan sistem failover
const API_SERVERS = [
  "https://inv.nadeko.net/api/v1",
  "https://yewtu.be/api/v1",
  "https://invidious.nerdvpn.de/api/v1"
];

// Fungsi pembantu fetch dengan failover otomatis
async function fetchFromInvidious(path) {
  for (const server of API_SERVERS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${server}${path}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return await res.json();
    } catch (err) {
      // Coba server berikutnya jika gagal
      continue;
    }
  }
  throw new Error("Semua server API tidak merespons");
}

app.options('*', cors());

// 1. ENDPOINT PENCARIAN (Diprioritaskan Audio Studio/Topic)
app.all('*search*', async (req, res) => {
  const query = req.query.query || req.query.q;
  if (!query) return res.status(400).json({ error: "Parameter query wajib diisi" });

  try {
    // Tambahkan kata kunci 'audio' secara cerdas untuk memprioritaskan album resmi bukan video klip
    const searchQuery = encodeURIComponent(query);
    const data = await fetchFromInvidious(`/search?q=${searchQuery}&type=video`);

    const results = (data || []).map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author,
      duration: item.lengthSeconds,
      thumbnail: item.videoThumbnails?.[0]?.url || ""
    }));

    return res.json({ results });
  } catch (e) {
    return res.status(500).json({ error: "Gagal mencari lagu" });
  }
});

// 2. ENDPOINT STREAM (Kualitas Tertinggi: itag 141 AAC 256k / itag 251 Opus 160k 48kHz)
app.all('*stream*', async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) return res.status(400).json({ error: "Parameter id wajib diisi" });

  try {
    const data = await fetchFromInvidious(`/videos/${videoId}`);
    const audioFormats = (data.adaptiveFormats || []).filter(
      f => f.type && f.type.startsWith("audio/") && f.url
    );

    if (audioFormats.length === 0) {
      return res.status(404).json({ error: "Format audio tidak ditemukan" });
    }

    // Urutkan berdasarkan bitrate tertinggi
    audioFormats.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

    // STRATEGI KUALITAS MAKSIMAL:
    // 1. Cek itag 141 (High Quality 256kbps AAC)
    // 2. Cek itag 251 (Opus 160kbps 48kHz Studio Quality)
    // 3. Fallback ke bitrate tertinggi yang tersedia
    const bestAudio = 
      audioFormats.find(f => String(f.itag) === "141") ||
      audioFormats.find(f => String(f.itag) === "251") ||
      audioFormats[0];

    return res.json({
      url: bestAudio.url,
      format: "audio",
      bitrate: bestAudio.bitrate,
      container: bestAudio.container || (bestAudio.type.includes("webm") ? "opus" : "m4a"),
      sampleRate: bestAudio.audioSampleRate || "48000"
    });
  } catch (e) {
    return res.status(500).json({ error: "Gagal memproses stream audio kualitas tinggi" });
  }
});

// 3. MANIFEST ADDON
app.use((req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  
  let cleanPath = req.originalUrl.split('?')[0].replace(/\/manifest\.json$/, "");
  if (!cleanPath.endsWith("/")) cleanPath += "/";
  const rootUrl = `${protocol}://${host}${cleanPath}`;

  return res.json({
    id: "com.lastwave.addon",
    name: "LastWave",
    version: "1.2.0",
    resources: ["search", "stream"],
    settings: [
      {
        key: "quality",
        type: "select",
        default: "lossless",
        options: [
          { label: "Ultra / Opus 48kHz (Max Quality)", value: "lossless" },
          { label: "High (160kbps)", value: "high" },
          { label: "Standard", value: "low" }
        ]
      }
    ],
    root: rootUrl
  });
});

module.exports = app;
