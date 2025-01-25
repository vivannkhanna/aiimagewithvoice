const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

console.log(process.env);

const app = express();
const port = 8080;

const openai = new OpenAI({
  apiKey: process.env.API_KEY,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// sql database
const db = new sqlite3.Database('./usage.db', (err) => {
  if (err) console.error('Failed to connect to database:', err.message);
  else console.log('Connected to SQLite database.');
});

// man
db.run(`
  CREATE TABLE IF NOT EXISTS api_usage (
    user_id TEXT PRIMARY KEY,
    usage_count INTEGER DEFAULT 0,
    reset_time INTEGER
  )
`);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, 'input.wav'),
});

const upload = multer({ storage });

const retryOperation = async (operation, retries = 3, delay = 1000) => {
  try {
    return await operation();
  } catch (error) {
    if (retries === 0) throw error;
    console.log(`Retrying... ${retries} retries left`);
    await new Promise((res) => setTimeout(res, delay));
    return retryOperation(operation, retries - 1, delay);
  }
};

const limit = (req, res, next) => {
  const userId = req.query.userId || uuidv4();
  const MAX_REQUESTS = 25;
  const now = Date.now();

  db.get('SELECT * FROM api_usage WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!row) {
      const resetTime = now + 24 * 60 * 60 * 1000;
      db.run(
        'INSERT INTO api_usage (user_id, usage_count, reset_time) VALUES (?, ?, ?)',
        [userId, 1, resetTime],
        (err) => {
          if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ message: 'Internal server error' });
          }
          req.userId = userId;
          next();
        }
      );
    } else {
      if (now > row.reset_time) {
        db.run(
          'UPDATE api_usage SET usage_count = ?, reset_time = ? WHERE user_id = ?',
          [1, now + 24 * 60 * 60 * 1000, userId],
          (err) => {
            if (err) {
              console.error('Database error:', err.message);
              return res.status(500).json({ message: 'Internal server error' });
            }
            req.userId = userId;
            next();
          }
        );
      } else if (row.usage_count >= MAX_REQUESTS) {
        res.status(429).json({
          message: 'API usage limit exceeded. Please wait until your limit resets.',
        });
      } else {
        db.run(
          'UPDATE api_usage SET usage_count = usage_count + 1 WHERE user_id = ?',
          [userId],
          (err) => {
            if (err) {
              console.error('Database error:', err.message);
              return res.status(500).json({ message: 'Internal server error' });
            }
            req.userId = userId;
            next();
          }
        );
      }
    }
  });
};

app.post('/upload', limit, upload.single('audio'), async (req, res) => {
  const inputPath = path.join('uploads', 'input.wav');
  console.log('Received file:', inputPath);

  try {
    if (fs.existsSync(inputPath)) {
      const audioFile = fs.createReadStream(inputPath);

      const transcriptionResponse = await retryOperation(() =>
        openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: audioFile,
          response_format: 'text',
        })
      );

      const transcriptionText = transcriptionResponse;

      const dalleResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openai.apiKey}`,
        },
        body: JSON.stringify({
          prompt: transcriptionText,
          n: 1,
          size: '1024x1024',
        }),
      });

      const dalleData = await dalleResponse.json();

      if (!dalleData.data || !dalleData.data.length) {
        throw new Error('Image generation failed');
      }

      const imageUrl = dalleData.data[0].url;

      fs.unlinkSync(inputPath);

      res.json({
        message: 'File uploaded, transcribed, and image generated successfully',
        transcription: transcriptionText,
        imageUrl: imageUrl,
      });
    } else {
      res.status(400).send('File not found.');
    }
  } catch (error) {
    console.error('Error during transcription or image generation:', error);
    res.status(500).json({
      message: 'Error during transcription or image generation.',
      error: error.message,
      stack: error.stack,
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});