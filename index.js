// index.js

const express       = require('express');
const multer        = require('multer');
const fs            = require('fs');
const path          = require('path');
const parseReplay   = require('fortnite-replay-parser');

const app = express();
// Upload into "uploads/" folder
const upload = multer({ dest: 'uploads/' });

/**
 * GET "/" → Return a simple HTML form that lets you pick & upload a .replay file.
 */
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
        pre { background: #f4f4f4; padding: 1rem; overflow: auto; max-height: 400px; }
      </style>
    </head>
    <body>
      <h1>Upload a Fortnite Replay File</h1>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <label for="replayFile">Select a <strong>.replay</strong> file:</label><br/>
        <input type="file" id="replayFile" name="replayFile" accept=".replay" required/><br/><br/>
        <button type="submit">Upload & Parse</button>
      </form>
      <p>Once you upload, you’ll either see parsed JSON (header-level stats) or a JSON error message below.</p>
    </body>
    </html>
  `);
});

/**
 * POST "/upload" → Accepts a single field named "replayFile".
 * Reads it into a Buffer, calls parseReplay(buffer, config), then returns JSON.
 * parseLevel is set to 3 so we only parse header and basic stats—skipping full playback data.
 */
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No replay file provided.' });
  }

  const replayPath = path.join(__dirname, req.file.path);

  try {
    // Read entire .replay into memory
    const replayBuffer = fs.readFileSync(replayPath);

    // ↓ Lower parseLevel (0–10). 
    //    Using parseLevel: 3 means: parse header, metadata, player info, match results, but skip deep playback.
    const config = { parseLevel: 3, debug: false };
    const parsedData = await parseReplay(replayBuffer, config);

    // Cleanup temporary file
    fs.unlinkSync(replayPath);

    // Return parsed header-level JSON
    return res.json(parsedData);

  } catch (err) {
    // Attempt to delete temp file even if parsing failed
    try { fs.unlinkSync(replayPath); } catch (e) { /* ignore */ }

    console.error('Error parsing replay:', err);

    return res.status(500).json({
      error: 'Failed to parse replay file.',
      message: err.message
    });
  }
});

/**
 * GET "/health" → Simple health-check endpoint
 */
app.get('/health', (req, res) => {
  res.send('OK');
});

// Listen on the port provided by Render, or fallback to 3000 for local testing
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
