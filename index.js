const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const parseReplay = require('fortnite-replay-parser');

// Initialize Express app
const app = express();

// Configure multer for file uploads
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

// HTML upload form (unchanged from your original)
app.get('/', (req, res) => {
  res.send(/* your HTML form */);
});

// Upload and parse endpoint
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No replay file provided.' });
  }

  const replayPath = path.join(__dirname, req.file.path);

  try {
    const replayBuffer = await fs.readFile(replayPath);
    const config = { 
      parseLevel: 1,
      debug: false,
      skipChunkErrors: true
    };
    
    const parsedData = await parseReplay(replayBuffer, config);
    await fs.unlink(replayPath);
    
    return res.json({
      success: true,
      data: parsedData
    });
  } catch (err) {
    try { await fs.unlink(replayPath); } catch (_) {}
    
    console.error('Replay parsing error:', err);
    return res.status(500).json({
      error: 'Replay parsing failed',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Get port from environment or default
const PORT = process.env.PORT || 3000;

// Start server with proper error handling
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
