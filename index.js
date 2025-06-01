// index.js

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const parseReplay = require('fortnite-replay-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve a single-page HTML form for uploading .replay files
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Upload Fortnite .replay</title>
    </head>
    <body>
      <h1>Upload a Fortnite Replay File</h1>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <label for="replayFile">Select .replay file:</label><br/>
        <input type="file" id="replayFile" name="replayFile" accept=".replay" required/><br/><br/>
        <button type="submit">Upload & Parse</button>
      </form>
    </body>
    </html>
  `);
});

// Handle upload and parsing at POST "/upload"
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No replay file provided.' });
    }

    // Read the uploaded file into a Buffer
    const replayPath = path.join(__dirname, req.file.path);
    const replayBuffer = fs.readFileSync(replayPath);

    // Parse with maximum detail (parseLevel: 10)
    const config = { parseLevel: 10, debug: false };
    const parsedData = await parseReplay(replayBuffer, config);

    // Delete temporary upload
    fs.unlinkSync(replayPath);

    // Return entire JSON of parsed stats
    return res.json(parsedData);

  } catch (err) {
    console.error('Error parsing replay:', err);
    return res.status(500).json({
      error: 'Failed to parse replay.',
      details: err.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
