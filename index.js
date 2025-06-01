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
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

// Serve any static assets (if you have CSS/JS under /public)
app.use(express.static('public'));

// ----------------------
// GET “/”
// Serve a simple HTML page with an upload form
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
          const errorElement = document.getElementById('error');
          const resultElement = document.getElementById('result');
          const resultDataElement = document.getElementById('resultData');

          errorElement.textContent = '';
          resultElement.style.display = 'none';

          try {
            const response = await fetch('/upload', {
              method: 'POST',
              body: formData,
            });

            if (!response.ok) {
              const body = await response.json();
              throw new Error(body.error || 'Failed to parse replay');
            }

            const data = await response.json();
            resultDataElement.textContent = JSON.stringify(data, null, 2);
            resultElement.style.display = 'block';
          } catch (err) {
            errorElement.textContent = err.message;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// ----------------------
// POST “/upload”
// Handle file upload, perform a “light” parse (parseLevel: 0), and only do a full parse if requested
// ----------------------
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { path: replayPath, originalname } = req.file;
  const ext = path.extname(originalname).toLowerCase();

  // 1. Immediately reject anything that isn't .replay
  if (ext !== '.replay') {
    // cleanup
    await fs.unlink(replayPath).catch(() => {});
    return res.status(400).json({ error: 'Only .replay files are allowed.' });
  }

  try {
    // 2. Read the file into a Buffer
    const replayBuffer = await fs.readFile(replayPath);

    // 3. Check minimal size
    if (replayBuffer.length < 100) {
      throw new Error('File is too small to be a valid replay.');
    }

    // 4. Do a “light” parse (parseLevel: 0 returns header metadata only)
    let headerData;
    try {
      headerData = await parseReplay(replayBuffer, {
        parseLevel: 0,        // only header & basic info
        debug: false,
      });
    } catch (lightError) {
      console.warn('Light parse failed:', lightError);
      // If even light parse fails, bail out
      throw new Error(
        'Unable to read header. This file may be corrupted or from an unsupported Fortnite version.'
      );
    }

    // 5. By default, return header metadata and skip full parse.
    //    If you want a deep parse, the client can pass ?full=true
    const wantFullParse = Boolean(req.query.full);

    if (!wantFullParse) {
      // Clean up file
      await fs.unlink(replayPath).catch(() => {});
      return res.json({
        success: true,
        type: 'HEADER_ONLY',
        header: headerData,
        message:
          'Header metadata parsed successfully. To attempt a full/chunk parse, add ?full=true to the request URL.',
      });
    }

    // 6. Attempt a full/chunk parse, with fallback options for chunk errors
    let fullData;
    try {
      fullData = await parseReplay(replayBuffer, {
        parseLevel: 1,
        debug: false,
      });
    } catch (firstError) {
      console.warn('First full-parse attempt failed, trying fallback:', firstError);

      try {
        fullData = await parseReplay(replayBuffer, {
          parseLevel: 1,
          debug: false,
          skipChunkErrors: true,
          failOnChunkError: false,
        });
      } catch (secondError) {
        console.warn('Fallback full-parse also failed:', secondError);
        throw new Error(
          'Full parse failed. The replay may be from a newer Fortnite build not yet supported, or it has malformed chunks.'
        );
      }
    }

    // 7. Return full parse result
    await fs.unlink(replayPath).catch(() => {});
    return res.json({
      success: true,
      type: 'FULL',
      header: headerData,
      data: fullData,
    });
  } catch (err) {
    // Ensure cleanup
    await fs.unlink(replayPath).catch(() => {});
    console.error('Error parsing replay:', err);
    return res.status(500).json({
      error: err.message || 'Failed to parse replay file.',
      // Only send stack trace in development
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
  // Print parser version so you know which version is installed
  try {
    const version = require('fortnite-replay-parser/package.json').version;
    console.log(`fortnite-replay-parser version: ${version}`);
  } catch (e) {
    console.log('Could not read parser version.');
  }
});
