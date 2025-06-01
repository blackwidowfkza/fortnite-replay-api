const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const parseReplay = require('fortnite-replay-parser');

const app = express();

// ----------------------
// Multer configuration
// ----------------------
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

// Serve static assets (if any) from /public
app.use(express.static('public'));

// ----------------------
// GET "/"
// Simple upload form
// ----------------------
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fortnite Replay Parser</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1 {
      color: #2c3e50;
      text-align: center;
    }
    .upload-form {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .form-group {
      margin-bottom: 15px;
    }
    input[type="file"] {
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      width: 100%;
    }
    button {
      background: #3498db;
      color: white;
      border: none;
      padding: 10px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      background: #2980b9;
    }
    .error {
      color: #e74c3c;
      margin-top: 10px;
    }
    .result {
      margin-top: 20px;
      padding: 15px;
      background: #f0f0f0;
      border-radius: 4px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>Fortnite Replay Parser</h1>
  <div class="upload-form">
    <form id="uploadForm" action="/upload" method="post" enctype="multipart/form-data">
      <div class="form-group">
        <label for="replayFile">Select a .replay file:</label>
        <input type="file" id="replayFile" name="replayFile" accept=".replay" required />
      </div>
      <button type="submit">Upload & Parse</button>
    </form>

    <div id="error" class="error"></div>

    <div id="result" class="result" style="display: none;">
      <h3>Parsed Replay Data:</h3>
      <pre id="resultData"></pre>
    </div>
  </div>

  <script>
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const errorEl = document.getElementById('error');
      const resultEl = document.getElementById('result');
      const dataEl = document.getElementById('resultData');
      errorEl.textContent = '';
      resultEl.style.display = 'none';

      try {
        const response = await fetch('/upload' + (location.search || ''), {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error || 'Failed to parse replay');
        }
        const json = await response.json();
        dataEl.textContent = JSON.stringify(json, null, 2);
        resultEl.style.display = 'block';
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  </script>
</body>
</html>
  `;
  res.send(html);
});

// ----------------------
// POST "/upload"
// Handle file upload and parsing
// ----------------------
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { path: replayPath, originalname } = req.file;
  const ext = path.extname(originalname).toLowerCase();

  // 1) Reject non-.replay immediately
  if (ext !== '.replay') {
    await fs.unlink(replayPath).catch(() => {});
    return res.status(400).json({ error: 'Only .replay files are allowed.' });
  }

  try {
    // 2) Read entire file into Buffer
    const replayBuffer = await fs.readFile(replayPath);

    // 3) Minimal size check
    if (replayBuffer.length < 9) {
      throw new Error('File is too small to be a valid .replay.');
    }

    // 4) Manually extract magic + version from first 9 bytes
    const magic = replayBuffer.slice(0, 5).toString('utf8');
    const version = replayBuffer.readUInt32LE(5);
    const minimalHeader = {
      magic,
      version,
      note: 'Minimal header extracted from first 9 bytes.',
    };

    // 5) If magic isn't "ubulk", return 400 immediately
    if (magic !== 'ubulk') {
      await fs.unlink(replayPath).catch(() => {});
      return res.status(400).json({ error: 'Not a valid .replay (magic mismatch).' });
    }

    // 6) Attempt a "light" parse (parseLevel: 0)
    let headerData = minimalHeader;
    try {
      const result0 = await parseReplay(replayBuffer, {
        parseLevel: 0, // header/metadata only
        debug: false,
      });
      headerData = result0; // full header metadata
    } catch (lightErr) {
      console.warn('parseLevel:0 (light) failed—using minimal header:', lightErr);
    }

    // 7) If client did NOT ask for full parse, return header now
    const wantFullParse = req.query.full === 'true';
    if (!wantFullParse) {
      await fs.unlink(replayPath).catch(() => {});
      return res.json({
        success: true,
        type: headerData.numChunks != null ? 'HEADER_FULL' : 'HEADER_MINIMAL',
        header: headerData,
        message: 'Header parsed. To attempt a full/chunk parse, re-upload with "?full=true".',
      });
    }

    // 8) Client wants full parse ➔ attempt parseLevel: 1 with fallback
    let fullData;
    try {
      fullData = await parseReplay(replayBuffer, {
        parseLevel: 1,
        debug: false,
      });
    } catch (firstErr) {
      console.warn('First parseLevel:1 failed, retrying with skipChunkErrors:', firstErr);
      try {
        fullData = await parseReplay(replayBuffer, {
          parseLevel: 1,
          debug: false,
          skipChunkErrors: true,
          failOnChunkError: false,
        });
      } catch (secondErr) {
        console.warn('Fallback parseLevel:1 also failed:', secondErr);
        throw new Error(
          'Full parse failed. Replay may be from a newer Fortnite version or have corrupted chunks.'
        );
      }
    }

    // 9) Cleanup & return full result
    await fs.unlink(replayPath).catch(() => {});
    return res.json({
      success: true,
      type: 'FULL',
      header: headerData,
      data: fullData,
    });
  } catch (err) {
    // Always clean up
    await fs.unlink(replayPath).catch(() => {});
    console.error('Error parsing replay:', err);
    return res.status(500).json({
      error: err.message || 'Failed to parse replay file.',
      ...(process.env.NODE_ENV === 'development' ? { details: err.stack } : {}),
    });
  }
});

// ----------------------
// GET "/health"
// Simple health-check
// ----------------------
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ----------------------
// Start server
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  try {
    const version = require('fortnite-replay-parser/package.json').version;
    console.log(`fortnite-replay-parser version: ${version}`);
  } catch {
    console.log('Could not read fortnite-replay-parser version.');
  }
});
