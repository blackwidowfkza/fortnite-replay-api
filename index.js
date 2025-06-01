const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const parseReplay = require('fortnite-replay-parser');

const app = express();

// ----------------------
// Improved Multer configuration
// ----------------------
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.replay') {
      return cb(new Error('Only .replay files are allowed'));
    }
    cb(null, true);
  }
}).single('replayFile');

// Serve static assets from /public
app.use(express.static('public'));

// ----------------------
// GET "/" - Upload form
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
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1 { color: #2c3e50; text-align: center; }
    .upload-form { background: #f9f9f9; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .form-group { margin-bottom: 15px; }
    input[type="file"] { padding: 10px; border: 1px solid #ddd; border-radius: 4px; width: 100%; }
    button { background: #3498db; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; font-size: 16px; }
    button:hover { background: #2980b9; }
    .error { color: #e74c3c; margin-top: 10px; }
    .result { margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 4px; white-space: pre-wrap; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>Fortnite Replay Parser</h1>
  <div class="upload-form">
    <form id="uploadForm">
      <div class="form-group">
        <label for="replayFile">Select a .replay file:</label>
        <input type="file" id="replayFile" name="replayFile" accept=".replay" required />
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" id="fullParse"> Full parse (includes detailed chunk data)
        </label>
      </div>
      <button type="submit">Upload & Parse</button>
    </form>

    <div id="error" class="error hidden"></div>
    <div id="loading" class="hidden">Processing replay file...</div>

    <div id="result" class="result hidden">
      <h3>Parsed Replay Data:</h3>
      <pre id="resultData"></pre>
    </div>
  </div>

  <script>
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const fileInput = document.getElementById('replayFile');
      const fullParse = document.getElementById('fullParse').checked;
      const errorEl = document.getElementById('error');
      const resultEl = document.getElementById('result');
      const dataEl = document.getElementById('resultData');
      const loadingEl = document.getElementById('loading');
      
      // Reset UI
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
      resultEl.classList.add('hidden');
      loadingEl.classList.remove('hidden');
      
      try {
        const formData = new FormData();
        formData.append('replayFile', fileInput.files[0]);
        
        const response = await fetch('/upload?full=' + fullParse, {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to parse replay');
        }
        
        dataEl.textContent = JSON.stringify(data, null, 2);
        resultEl.classList.remove('hidden');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        console.error('Upload error:', err);
      } finally {
        loadingEl.classList.add('hidden');
      }
    });
  </script>
</body>
</html>
  `;
  res.send(html);
});

// ----------------------
// Improved POST "/upload" handler
// ----------------------
app.post('/upload', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ 
        success: false,
        error: err.message 
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded.' 
      });
    }

    try {
      const replayBuffer = await fs.readFile(req.file.path);
      
      // Validate minimum file size
      if (replayBuffer.length < 9) {
        throw new Error('File is too small to be a valid replay (minimum 9 bytes required)');
      }

      // Check magic number
      const magic = replayBuffer.slice(0, 5).toString('utf8');
      const version = replayBuffer.readUInt32LE(5);
      
      if (magic !== 'ubulk') {
        throw new Error(`Invalid replay file: Expected magic number "ubulk", got "${magic}"`);
      }

      const wantFullParse = req.query.full === 'true';
      let result;

      try {
        result = await parseReplay(replayBuffer, {
          parseLevel: wantFullParse ? 1 : 0,
          debug: false,
          skipChunkErrors: wantFullParse,
          failOnChunkError: !wantFullParse
        });
      } catch (parseErr) {
        console.warn('Parse error:', parseErr);
        if (wantFullParse) {
          throw new Error('Full parse failed. The replay may be corrupted or from an unsupported version.');
        }
        // For header-only parse, fall back to minimal data
        result = {
          magic,
          version,
          note: 'Only minimal header could be extracted'
        };
      }

      await fs.unlink(req.file.path);
      
      return res.json({
        success: true,
        type: wantFullParse ? 'FULL' : 'HEADER',
        data: result
      });

    } catch (err) {
      // Clean up file if it exists
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      
      return res.status(400).json({
        success: false,
        error: err.message,
        ...(process.env.NODE_ENV === 'development' ? { details: err.stack } : {})
      });
    }
  });
});

// ----------------------
// Health check endpoint
// ----------------------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ----------------------
// Error handling middleware
// ----------------------
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error' 
  });
});

// ----------------------
// Start server
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});
