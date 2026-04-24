
import express from 'express';
import { downloadMedia } from './video-service';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. Health-check endpoint: REQUIRED for Railway zero-downtime deployments [citation:5]
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 2. Download endpoint: triggers the yt-dlp process
app.post('/download', async (req, res) => {
  try {
    const { url, formatId, audioOnly } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL required' });

    const result = await downloadMedia(url, formatId || null, audioOnly);

    // Return the filename so the Next.js server can ask for it
    res.json({
      success: true,
      filename: result.filename,
      originalFilename: result.originalFilename,
      mimeType: result.mimeType,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Download failed";
    res.status(500).json({ success: false, error: message });
  }
});

// 3. File streaming endpoint: streams the downloaded file back
app.get('/stream/:filename', (req, res) => {
  try {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(process.env.DOWNLOAD_DIR || './downloads', safeFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: "Streaming failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Extraction worker running on port ${PORT}`);
});
