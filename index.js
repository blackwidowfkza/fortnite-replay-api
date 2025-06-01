// index.js
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
    fileSize: 50 * 1024 * 1024, // 50 MB max
  },
});

// Serve any static assets under /public
app.use(express.static('public'));

// ----------------------
// GET “/”
// Simple HTML form to upload a .replay
// ----------------------
app.get('/', (req, res) => {
  res.send(`
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
            // By default, this will do a header-only parse.
            // To force a full-chunk parse, append ?full=true to the URL:
            // fetch('/upload?full=true', { ... })
            const response = await fetch('/upload', {
              method: 'POST',
              body: formData,
            });
            if (!response.ok) {
              const body = await response.json();
              throw new Error(body.error || 'Failed to parse replay');
            }
            const result = await response.json();
            dataEl.textContent = JSON.stringify(result, null, 2);
            resultEl.style.display = 'block';
          } catch (err) {
            errorEl.textContent = err.message;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ----------------------
// POST “/upload”
//  • Accepts a single .replay upload.
//  • First tries parseLevel: 0 (“light” header parse).
//  • If that fails, manually read magic + version.
//  • If ?full=true is set, then attempt parseLevel: 1 (whole‐chunk) with a fallback.
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
    // 2) Read entire file into a Buffer
    const replayBuffer = await fs.readFile(replayPath);

    // 3) Minimal size check
    if (replayBuffer.length < 100) {
      throw new Error('File is too small to be a valid replay.');
    }

    // 4) Try a “light” parse (parseLevel: 0)
    let headerData;
    try {
      headerData = await parseReplay(replayBuffer, {
        parseLevel: 0, // header/metadata only
        debug: false,
      });
    } catch (lightErr) {
      console.warn('Light parse failed:', lightErr);

      // FALLBACK: Manually read the first 9 bytes:
      //   • Bytes [0..4) == ASCII "ubulk"
      //   • Bytes [5..9) == version (UInt32LE)
      const magic = replayBuffer.slice(0, 5).toString('utf8');
      if (magic !== 'ubulk') {
        throw new Error('Not a valid .replay (magic mismatch).');
      }
      // read version as little-endian uint32 starting at byte offset 5
      const version = replayBuffer.readUInt32LE(5);
      headerData = {
        magic,
        version,
        note: 'Header extracted manually; full parser failed.',
      };
    }

    // 5) By default, return just the header. To get full-chunk parsing, client must pass “?full=true”
    const wantFullParse = req.query.full === 'true';

    if (!wantFullParse) {
      await fs.unlink(replayPath).catch(() => {});
      return res.json({
        success: true,
        type: 'HEADER_MINIMAL',
        header: headerData,
        message:
          'Header parsed (either fully or minimally). To attempt a full chunk parse, re-upload with “?full=true”.',
      });
    }

    // 6) If we reach here, user asked for full parse. Attempt parseLevel: 1 with fallback.
    let fullData;
    try {
      fullData = await parseReplay(replayBuffer, {
        parseLevel: 1, // include all chunks
        debug: false,
      });
    } catch (firstErr) {
      console.warn('First full-parse attempt failed, trying fallback:', firstErr);
      // Fallback option: skip chunk errors
      try {
        fullData = await parseReplay(replayBuffer, {
          parseLevel: 1,
          debug: false,
          skipChunkErrors: true,
          failOnChunkError: false,
        });
      } catch (secondErr) {
        console.warn('Fallback full-parse also failed:', secondErr);
        throw new Error(
          'Full parse failed. The replay is likely from a newer Fortnite build not yet supported or has malformed chunks.'
        );
      }
    }

    // 7) Cleanup & return full result
    await fs.unlink(replayPath).catch(() => {});
    return res.json({
      success: true,
      type: 'FULL',
      header: headerData,
      data: fullData,
    });
  } catch (err) {
    // Ensure we always delete the temporary file
    await fs.unlink(replayPath).catch(() => {});
    console.error('Error parsing replay:', err);
    return res.status(500).json({
      error: err.message || 'Failed to parse replay file.',
      ...(process.env.NODE_ENV === 'development' ? { details: err.stack } : {}),
    });
  }
});

// ----------------------
// GET “/health”
// Simple health‐check endpoint
// ----------------------
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ----------------------
// Start the server
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
