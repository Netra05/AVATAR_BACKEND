import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import express from "express";
import voice from "elevenlabs-node";
import path from "path";
import fs from "fs"; // Standard fs module
import { promises as fsPromises } from "fs"; // Promises API
import OpenAI from "openai";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "9BWtsMINqrJLrRacOk9x"; //Change voice ID as your wish, Previous voice id is not available anymore

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${stderr}`);
        reject(error);
      }
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (index) => {
  try {
    const time = Date.now();
    const mp3File = `audios/message_${index}.mp3`;
    const wavFile = `audios/message_${index}.wav`;
    const jsonFile = `audios/message_${index}.json`;

    console.log(`Converting ${mp3File} to WAV...`);
    await execCommand(`ffmpeg -y -i ${mp3File} ${wavFile}`);
    console.log(`Conversion completed in ${Date.now() - time}ms.`);
    
    //hard coded rhubarbPath , Change to your bin location by creating new bin
    const rhubarbPath = '/home/kirubhakaran-d/r3f-virtual-girlfriend-backend/bin/Rhubarb-Lip-Sync-1.13.0-Linux/rhubarb';  // Use the full path
    console.log(`Generating lip-sync data for ${wavFile}...`);
    await execCommand(`${rhubarbPath} -f json -o ${jsonFile} ${wavFile} -r phonetic`);
    console.log(`Lip-sync generation completed in ${Date.now() - time}ms.`);
  } catch (error) {
    console.error(`Error during lip-sync generation: ${error.message}`);
    throw error;
  }
};


const textToSpeech = async (text, fileName) => {
  try {
    console.log(text)
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}`,
      { text },
      {
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": elevenLabsApiKey,
        },
        responseType: "stream",
      }
    );

    const writer = fs.createWriteStream(fileName);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`Error during text-to-speech: ${error.response?.data || error.message}`);
    throw error;
  }
};

const audioFileToBase64 = async (file) => {
  try {
    const absolutePath = path.resolve(file);
    console.log(`Reading file: ${absolutePath}`);
    await fsPromises.access(absolutePath);
    const data = await fsPromises.readFile(absolutePath);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error reading audio file: ${error.message}`);
    throw error;
  }
};


const readJsonTranscript = async (file) => {
  try {
    const data = await fsPromises.readFile(file, "utf8"); // Use fsPromises.readFile
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading JSON transcript: ${error.message}`);
    throw error;
  }
};

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      res.send({
        messages: [
          {
            text: "Hey dear... How was your day?",
            audio: await audioFileToBase64("audios/intro_0.wav"),
            lipsync: await readJsonTranscript("audios/intro_0.json"),
            facialExpression: "smile",
            animation: "Talking_1",
          },
        ],
      });
      return;
    }

    if (!elevenLabsApiKey || openai.apiKey === "-") {
      res.send({
        messages: [
          {
            text: "Please add your API keys!",
            audio: await audioFileToBase64("audios/api_0.wav"),
            lipsync: await readJsonTranscript("audios/api_0.json"),
            facialExpression: "angry",
            animation: "Angry",
          },
        ],
      });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1000,
      temperature: 0.6,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: `
          You are a virtual girlfriend.
          You will always reply with a JSON array of messages. With a maximum of 3 messages.
          Each message has a text, facialExpression, and animation property.
          The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
          The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
          `,
        },
        {
          role: "user",
          content: userMessage || "Hello",
        },
      ],
    });

    let messages = JSON.parse(completion.choices[0].message.content);
    if (messages.messages) {
      messages = messages.messages; // Handle inconsistent responses
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;

      // Generate audio
      await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, message.text);

      // Generate lipsync
      await lipSyncMessage(i);

      // Enrich the message with audio and lipsync
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
    }

    res.send({ messages });
  } catch (error) {
    console.error(`Error in /chat endpoint: ${error.message}`);
    res.status(500).send({ error: "Internal Server Error" });
  }
});



app.listen(port, () => {
  console.log(`Virtual Girlfriend listening on port ${port}`);
});
