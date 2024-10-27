const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const OpenAI = require('openai');
const fetch = require('node-fetch');
require('dotenv').config();

console.log(process.env);

const app = express();
const port = 8080;

const openai = new OpenAI({
  apiKey: process.env.API_KEY
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, 'input.wav');
  }
});

const upload = multer({ storage: storage });

const retryOperation = async (operation, retries = 3, delay = 1000) => {
  try {
    return await operation();
  } catch (error) {
    if (retries === 0) throw error;
    console.log(`Retrying... ${retries} retries left`);
    await new Promise(res => setTimeout(res, delay));
    return retryOperation(operation, retries - 1, delay);
  }
};

app.post('/upload', upload.single('audio'), async (req, res) => {
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
        imageUrl: imageUrl 
      });
    } else {
      res.status(400).send('File not found.');
    }
  } catch (error) {
    console.error('Error during transcription or image generation:', error);
    res.status(500).json({
      message: 'Error during transcription or image generation.',
      error: error.message,
      stack: error.stack
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});