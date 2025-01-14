// First, install Express by running: npm install express
const express = require("express");
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to your Node.js server!" });
});

// Example route with parameters
app.get("/users/:id", (req, res) => {
  const userId = req.params.id;
  res.json({ message: `Fetching user with ID: ${userId}` });
});

// Example POST route
app.post("/users", (req, res) => {
  const userData = req.body;
  res.json({
    message: "User created successfully",
    user: userData,
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
