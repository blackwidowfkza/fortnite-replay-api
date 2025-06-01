const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const parseReplay = require('fortnite-replay-parser');

const app = express();

// Configure file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Serve static files (CSS, JS, etc.)
app.use(express.static('public'));

// Homepage with upload form
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            <input type="file" id="replayFile" name="replayFile" accept=".replay" required>
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
              body: formData
            });
            
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.error || 'Failed to parse replay');
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

// Handle file upload and parsing
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const replayPath = req.file.path;

  try {
    // Verify file extension
    if (path.extname(req.file.originalname).toLowerCase() !== '.replay') {
      throw new Error('Only .replay files are allowed');
    }

    // Read and verify file
    const replayBuffer = await fs.readFile(replayPath);
    if (replayBuffer.length < 100) {
      throw new Error('File is too small to be a valid replay');
    }

    // Parse with fallback options
    let parsedData;
    try {
      parsedData = await parseReplay(replayBuffer, {
        parseLevel: 1,
        debug: false
      });
    } catch (parseError) {
      console.warn('First parse attempt failed, trying fallback:', parseError);
      parsedData = await parseReplay(replayBuffer, {
        parseLevel: 1,
        debug: false,
        skipChunkErrors: true,
        failOnChunkError: false
      });
    }

    // Clean up
    await fs.unlink(replayPath);

    return res.json({
      success: true,
      data: parsedData
    });

  } catch (err) {
    // Clean up and handle errors
    await fs.unlink(replayPath).catch(() => {});
    console.error('Error parsing replay:', err);
    
    return res.status(500).json({ 
      error: err.message || 'Failed to parse replay file',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Parser version: ${require('fortnite-replay-parser/package.json').version}`);
});
