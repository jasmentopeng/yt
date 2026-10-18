const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const INVIDIOUS_API = "https://inv.nadeko.net/api/v1";

app.options('*', cors());

// 1. ENDPOINT PENCARIAN
app.all('*search*', async (req, res) => {
  const query = req.query.query || req.query.q;
  if (!query) return res.status(400).json({ error: "Parameter query wajib diisi" });

  try {
    const resp = await fetch(`${INVIDIOUS_API}/search?q=${encodeURIComponent(query)}&type=video`);
    const data = await resp.json();
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

// 2. ENDPOINT STREAM AUDIO (Kualitas Maksimal Opus)
app.all('*stream*', async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) return res.status(400).json({ error: "Parameter id wajib diisi" });

  try {
    const resp = await fetch(`${INVIDIOUS_API}/videos/${videoId}`);
    const data = await resp.json();
    const audioFormats = (data.adaptiveFormats || []).filter(
      f => f.type && f.type.startsWith("audio/") && f.url
    );

    if (audioFormats.length === 0) {
      return res.status(404).json({ error: "Format audio tidak ditemukan" });
    }

    audioFormats.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
    const bestAudio = audioFormats.find(f => String(f.itag) === "251") || audioFormats[0];

    return res.json({
      url: bestAudio.url,
      format: "audio",
      bitrate: bestAudio.bitrate,
      container: bestAudio.container || "opus"
    });
  } catch (e) {
    return res.status(500).json({ error: "Gagal memproses stream audio" });
  }
});

// 3. MANIFEST (Fallback untuk request root, /a/<token>/, dll)
app.use((req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  
  let cleanPath = req.originalUrl.split('?')[0].replace(/\/manifest\.json$/, "");
  if (!cleanPath.endsWith("/")) cleanPath += "/";
  const rootUrl = `${protocol}://${host}${cleanPath}`;

  return res.json({
    id: "com.lastwave.addon",
    name: "LastWave",
    version: "1.0.0",
    resources: ["search", "stream"],
    settings: [
      {
        key: "quality",
        type: "select",
        default: "lossless",
        options: [
          { label: "Lossless", value: "lossless" },
          { label: "Dolby Atmos", value: "atmos" },
          { label: "High", value: "high" },
          { label: "Low", value: "low" }
        ]
      }
    ],
    root: rootUrl
  });
});

module.exports = app;
