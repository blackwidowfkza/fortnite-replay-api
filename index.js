// index.js

const express       = require('express');
const multer        = require('multer');
const fs            = require('fs');
const path          = require('path');
const parseReplay   = require('fortnite-replay-parser');

const app = express();

// Configure multer to write uploads into the "uploads/" folder
const upload = multer({ dest: 'uploads/' });

// GET "/" → Serve a minimal HTML form for uploading a .replay file
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
        input[type="file"] { margin-bottom: 1rem; }
        button { padding: 0.5rem 1rem; }
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
      <p>After submitting, you’ll see the parsed JSON or an error message below.</p>
    </body>
    </html>
  `);
});

// POST "/upload" → Handle file upload and parsing
app.post('/upload', upload.single('replayFile'), async (req, res) => {
  // If no file was provided, return a 400
  if (!req.file) {
    return res.status(400).json({ error: 'No replay file provided.' });
  }

  const replayPath = path.join(__dirname, req.file.path);

  try {
    // Read the entire .replay into memory
    const replayBuffer = fs.readFileSync(replayPath);

    // Attempt to parse with maximum detail
    // If this fails (e.g. "offset is larger than buffer"), it will jump to catch{}
    const config = { parseLevel: 10, debug: false };
    const parsedData = await parseReplay(replayBuffer, config);

    // Delete the temporary file now that we've parsed it
    fs.unlinkSync(replayPath);

    // Return the full JSON of parsed stats
    return res.json(parsedData);

  } catch (err) {
    // Always attempt to delete the temp file, even if parsing fails
    try { fs.unlinkSync(replayPath); } catch (e) { /* ignore */ }

    // Log to the server console for debugging
    console.error('Error parsing replay:', err);

    // Send back a JSON error with details (but don’t include stack trace)
    return res.status(500).json({
      error: 'Failed to parse replay file.',
      message: err.message
    });
  }
});

// GET "/health" → Simple health-check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Listen on the port Render (or your environment) provides, fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
