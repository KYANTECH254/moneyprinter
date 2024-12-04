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


app.get("/acctokens", (req, res) => {
  const query = req.query;

  // Parse the tokens and account IDs
  const accounts = [];
  Object.keys(query).forEach((key) => {
    const match = key.match(/acct(\d+)/);
    if (match) {
      const index = match[1];
      accounts.push({
        account_id: query[`acct${index}`],
        token: query[`token${index}`],
      });
    }
  });

  // Return the extracted data as JSON
  res.json({ accounts });
});

// Route to fetch all bets from Prisma
app.get("/api/bets", async (req, res) => {
  const { appId, token } = req.query;

  try {
    const bets = await prisma.bet.findMany({
      where: {
        token: token,
      },
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
  const { appId, token } = req.query;

  try {
    const Stake = await prisma.stakeDetails.findFirst({
      where: {
        token: token,
        appId: appId
      },
    });
    return res.json(Stake);
  } catch (error) {
    console.error("Error getting stake:", error);
    return res.status(200).json({ error: "Failed to get stake" });
  }
});

app.post("/api/stake", async (req, res) => {
  const { stake, currency, appId, token, tp, sl, dt, code } = req.body;

  try {
    const findexc = await prisma.stakeDetails.findFirst({
      where: {
        code: code
      }
    })

    if (findexc) {
      return res.status(200).json({ error: "Code exists choose a different one!" });
    }

    const findex = await prisma.stakeDetails.findFirst({
      where: {
        appId: appId,
        token: token,
        code: code
      }
    })

    if (findex) {
      return res.json(findex);
    }

    const newStake = await prisma.stakeDetails.create({
      data: {
        stake,
        currency,
        appId,
        token,
        dt,
        tp,
        sl,
        code
      },
    });
    return res.json(newStake);
  } catch (error) {
    console.error("Error creating stake:", error);
    return res.status(200).json({ error: "Failed to create stake" });
  }
});

app.post("/api/codeinfo", async (req, res) => {
  const { code } = req.body;
console.log("code",code)
  try {
    const findex = await prisma.stakeDetails.findFirst({
      where: {
        code:code
      }
    })

    if (findex) {
      return res.json(findex);
    } 

    return res.status(200).json({ error: "Code Info not found!" });
  } catch (error) {
    console.error("Error getting code Info:", error);
    return res.status(200).json({ error: "Failed to get code Info" });
  }
});

// Route to update stake details by ID (ID in the body)
app.put("/api/updatestake", async (req, res) => {
  const { id, stake, currency,token, appId, status, dt, sl, tp } = req.body;

  if (!id || !stake || !currency || !appId || !status) {
    return res.status(200).json({
      error: "Missing required fields: id, stake, currency, or appId",
    });
  }

  try {
    const updatedStake = await prisma.stakeDetails.update({
      where: {
        id: id,
      },
      data: {
        stake, // Update the stake amount
        currency, // Update the currency
        appId, // Update the application ID
        status,
        token,
        dt,
        sl,
        tp
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

app.get("/tokens", async (req, res) => {
  const indexPath = path.join(__dirname, "public", "tokens.html");

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
let processedStakeIds = new Set(); // Track IDs of processed stake details

async function initializeNewStakeDetails() {
    try {
        // Fetch only stake details that haven't been processed
        const newStakeDetails = await prisma.stakeDetails.findMany({
            where: {
                id: { notIn: Array.from(processedStakeIds) }, 
                status: 'active'
            },
        });

        for (const stakeDetail of newStakeDetails) {
            // Initialize WebSocket for the new stake detail
            await initializeDerivWebSocket(server, stakeDetail);

            // Mark this stake detail as processed
            processedStakeIds.add(stakeDetail.id);
        }
    } catch (error) {
        console.error("Error checking for new stake details:", error);
    }
}

// Poll every 5 seconds
setInterval(initializeNewStakeDetails, 5000);

