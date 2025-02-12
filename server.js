import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { getTokenEmmiter } from "./components/util.js"; // Note the .js extension

const app = express();
const port = 3001; // You can change this as needed

// CORS configuration
const corsOptions = {
  origin: "*", // Allow all origins
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204,
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Add OPTIONS handling for preflight requests
app.options("*", cors(corsOptions));

// Middleware to parse raw JSON
app.use(bodyParser.raw({ type: "application/json" }));

app.get("/", (req, res) => {
  res.json({ message: "Welcome to your Node.js server!" });
});

// Endpoint for handling streaming
app.post("/stream", async (req, res) => {
  // Set headers for Server-Sent Events (SSE) and CORS
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",

    Connection: "keep-alive",
  });

  const sendData = (data) => {
    res.write(`data: ${data}\n\n`);
  };

  const sendTokenToClient = (token) => {
    console.log({ token });
    sendData(JSON.stringify({ data: token }));
  };

  // Parse body manually (just like in Next.js)
  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch (error) {
    console.error("Error parsing request body:", error);
    sendData(JSON.stringify({ error: "Invalid request body" }));
    res.end();
    return;
  }

  // Create TokenEmitter and handle streaming
  const tokenEmmitter = await getTokenEmmiter(
    sendTokenToClient,
    body.chatMode,
    body.option2,
    body.option3,
    body.option4
  );

  try {
    const result = await Promise.race([
      tokenEmmitter.call({
        question: body.question,
        chat_history: body.history,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Operation timed out")), 290000)
      ),
    ]);

    if (result instanceof Error) {
      throw result;
    }
  } catch (err) {
    console.error(err);
    sendData(
      JSON.stringify({
        error: err instanceof Error ? err.message : "An error occurred",
      })
    );
  } finally {
    sendData("[DONE]");
    res.end();
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
