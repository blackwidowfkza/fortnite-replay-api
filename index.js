// index.js

const express     = require('express');
const multer      = require('multer');
const fs          = require('fs');
const path        = require('path');
const parseReplay = require('fortnite-replay-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve a one‐page HTML form to upload .replay
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Upload Fortnite .replay</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 2rem; }
        h1 { margin-bottom: 1rem; }
        label, input, button { font-size: 1rem; }
      </style>
    </head>
    <body>
      <h1>Upload a Fortnite Replay File</h1>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <label for="replayFile">Select a <strong>.replay</strong> file:</label><br/>
        <input type="file" id="replayFile" name="replayFile" accept=".replay" required/><br/><br/>
        <button type="submit">Upload & Parse</button>
      </form>
      <p>After you upload, you’ll see the parsed header‐only JSON or an error message.</p>
    </body>
    </html>
  `);
});

// Handle the upload & parse with parseLevel: 1 (header‐only)
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No replay file provided.' });
  }

  const replayPath = path.join(__dirname, req.file.path);

  try {
    const replayBuffer = fs.readFileSync(replayPath);

    // parseLevel: 1 → header & metadata only, no deep playback packets
    const config = { parseLevel: 1, debug: false };
    const parsedData = await parseReplay(replayBuffer, config);

    fs.unlinkSync(replayPath);
    return res.json(parsedData);

  } catch (err) {
    try { fs.unlinkSync(replayPath); } catch (_){/*ignore*/}

    console.error('Error parsing replay:', err);
    return res.status(500).json({
      error: 'Failed to parse replay file.',
      message: err.message
    });
  }
});

// Health‐check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
