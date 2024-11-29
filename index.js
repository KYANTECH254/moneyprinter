require("dotenv").config(); // Load environment variables

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const initializeDerivWebSocket = require("./socket");
const bodyParser = require("body-parser");

const app = express();
const prisma = require("./prisma");

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Route to fetch all bets from Prisma
app.get("/api/bets", async (req, res) => {
  try {
    const bets = await prisma.bet.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
    return res.json(bets); // Respond with the bets in JSON
  } catch (error) {
    console.error("Error fetching bets:", error);
    return res.status(200).json({ error: "Failed to fetch bets" });
  }
});

app.get("/api/getstake", async (req, res) => {
  try {
    const Stake = await prisma.stakeDetails.findFirst({
      orderBy: {
        createdAt: "desc",
      },
    });
    return res.json(Stake);
  } catch (error) {
    console.error("Error getting stake:", error);
    return res.status(200).json({ error: "Failed to get stake" });
  }
});

app.post("/api/stake", async (req, res) => {
  const { stake, currency, appId } = req.body;

  try {
    const newStake = await prisma.stakeDetails.create({
      data: {
        stake,
        currency,
        appId,
      },
    });
    return res.json(newStake);
  } catch (error) {
    console.error("Error creating stake:", error);
    return res.status(200).json({ error: "Failed to create stake" });
  }
});

// Route to update stake details by ID (ID in the body)
app.put("/api/updatestake", async (req, res) => {
  const { id, stake, currency, appId, status } = req.body;

  if (!id || !stake || !currency || !appId || !status) {
    return res.status(200).json({
      error: "Missing required fields: id, stake, currency, or appId",
    });
  }

  try {
    const updatedStake = await prisma.stakeDetails.update({
      where: {
        id: id, // Find the record by the ID in the body
      },
      data: {
        stake, // Update the stake amount
        currency, // Update the currency
        appId, // Update the application ID
        status
      },
    });
    return res.json(updatedStake);
  } catch (error) {
    console.error("Error updating stake:", error);
    return res.status(200).json({ error: "Failed to update stake details" }); // Error handling
  }
});

// Serve the index.html only on the root route "/"
app.get("/", async (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");

  try {
    await fs.promises.access(indexPath, fs.constants.F_OK);
    res.sendFile(indexPath); // Serve the HTML file only for the root route
  } catch (error) {
    res.status(404).json({ error: "Index file not found" });
  }
});

// Serve the index.html only on the root route "/"
app.get("/create", async (req, res) => {
  const indexPath = path.join(__dirname, "public", "create.html");

  try {
    await fs.promises.access(indexPath, fs.constants.F_OK);
    res.sendFile(indexPath); // Serve the HTML file only for the root route
  } catch (error) {
    res.status(404).json({ error: "Index file not found" });
  }
});

// prisma.bet.deleteMany().then(() => {
//   console.log("All bets deleted");
// });

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`> Server running at PORT:${PORT}`);
});


// Initialize WebSocket
initializeDerivWebSocket(server);
