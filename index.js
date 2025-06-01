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
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.replay') {
      cb(null, true);
    } else {
      cb(new Error('Only .replay files are allowed'), false);
    }
  }
});

// Serve static files
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
        .upload-container {
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
          transition: background 0.3s;
        }
        button:hover {
          background: #2980b9;
        }
        .loading {
          display: none;
          text-align: center;
          margin: 15px 0;
        }
        .error {
          color: #e74c3c;
          margin: 15px 0;
          padding: 10px;
          background: #fdecea;
          border-radius: 4px;
        }
        .result {
          margin-top: 20px;
          padding: 15px;
          background: #f0f0f0;
          border-radius: 4px;
          display: none;
        }
        pre {
          white-space: pre-wrap;
          word-wrap: break-word;
        }
      </style>
    </head>
    <body>
      <h1>Fortnite Replay Parser</h1>
      
      <div class="upload-container">
        <form id="uploadForm">
          <div class="form-group">
            <label for="replayFile">Select a .replay file:</label>
            <input type="file" id="replayFile" name="replayFile" accept=".replay" required>
          </div>
          <button type="submit">Upload & Parse</button>
        </form>
        
        <div class="loading" id="loading">
          <p>Parsing replay file, please wait...</p>
        </div>
        
        <div class="error" id="error"></div>
        
        <div class="result" id="result">
          <h3>Parsed Replay Data:</h3>
          <pre id="resultData"></pre>
        </div>
      </div>

      <script>
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const fileInput = document.getElementById('replayFile');
          const loadingElement = document.getElementById('loading');
          const errorElement = document.getElementById('error');
          const resultElement = document.getElementById('result');
          const resultDataElement = document.getElementById('resultData');
          
          // Reset UI
          errorElement.textContent = '';
          errorElement.style.display = 'none';
          resultElement.style.display = 'none';
          loadingElement.style.display = 'block';
          
          const formData = new FormData();
          formData.append('replayFile', fileInput.files[0]);
          
          try {
            const response = await fetch('/upload', {
              method: 'POST',
              body: formData
            });
            
            const data = await response.json();
            
            if (!response.ok) {
              throw new Error(data.error || 'Failed to parse replay');
            }
            
            // Display results
            resultDataElement.textContent = JSON.stringify(data.data, null, 2);
            resultElement.style.display = 'block';
            
          } catch (err) {
            errorElement.textContent = err.message;
            errorElement.style.display = 'block';
          } finally {
            loadingElement.style.display = 'none';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Enhanced replay parser with multiple fallback strategies
async function safeParseReplay(buffer) {
  const parseAttempts = [
    { parseLevel: 0 }, // Most basic parsing
    { 
      parseLevel: 1,
      skipChunkErrors: true,
      failOnChunkError: false,
      debug: false
    },
    {
      parseLevel: 1,
      skipChunkErrors: true,
      failOnChunkError: false,
      debug: true
    }
  ];

  let lastError;
  
  for (const config of parseAttempts) {
    try {
      console.log(`Attempting parse with config: ${JSON.stringify(config)}`);
      const result = await parseReplay(buffer, config);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`Parse attempt failed: ${error.message}`);
    }
  }
  
  throw lastError || new Error('All parse attempts failed');
}

// Handle file upload and parsing
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const replayPath = req.file.path;

  try {
    // Validate file
    const replayBuffer = await fs.readFile(replayPath);
    if (replayBuffer.length < 100) {
      throw new Error('File is too small to be a valid replay');
    }

    // Parse with multiple fallback attempts
    const parsedData = await safeParseReplay(replayBuffer);

    // Clean up
    await fs.unlink(replayPath);

    return res.json({
      success: true,
      data: parsedData
    });

  } catch (err) {
    // Clean up
    await fs.unlink(replayPath).catch(() => {});

    console.error('Replay parsing error:', {
      message: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      error: 'Failed to parse replay file',
      details: {
        message: err.message,
        possibleCauses: [
          'The replay file might be corrupted',
          'Unsupported Fortnite version',
          'Parser limitation with this replay type'
        ],
        solutions: [
          'Try a different replay file',
          'Check for updates to fortnite-replay-parser',
          'Contact support with this replay file'
        ]
      }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    parserVersion: require('fortnite-replay-parser/package.json').version
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Fortnite Replay Parser version: ${require('fortnite-replay-parser/package.json').version}`);
});
