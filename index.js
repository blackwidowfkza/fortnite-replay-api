const express = require('express');
const multer = require('multer');
const fs = require('fs').promises; // Using promise-based FS
const path = require('path');
const parseReplay = require('fortnite-replay-parser');

const app = express();
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024 // Limit to 50MB
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.replay') {
      return cb(new Error('Only .replay files are allowed'));
    }
    cb(null, true);
  }
});

// ... (keep your HTML route the same) ...

app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No replay file provided.' });
  }

  const replayPath = path.join(__dirname, req.file.path);

  try {
    // Read file asynchronously
    const replayBuffer = await fs.readFile(replayPath);
    
    // More robust parsing configuration
    const config = {
      parseLevel: 1, // Header only
      debug: false,
      skipChunkErrors: true, // Skip problematic chunks
      failOnChunkError: false // Don't fail entire parse on chunk errors
    };

    // Add timeout for parsing
    const parsedData = await Promise.race([
      parseReplay(replayBuffer, config),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Parsing timeout')), 10000)
      )
    ]);

    await fs.unlink(replayPath);
    return res.json({
      success: true,
      data: parsedData
    });

  } catch (err) {
    // Clean up file
    try { await fs.unlink(replayPath); } catch (_) { /* ignore */ }

    console.error('Error parsing replay:', err);
    
    // More detailed error response
    return res.status(500).json({
      error: 'Failed to parse replay file',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      suggestions: [
        'Try a different replay file',
        'The replay might be from an unsupported Fortnite version',
        'The file might be corrupted'
      ]
    });
  }
});

// ... (keep health check and server start the same) ...
