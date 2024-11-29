const WebSocket = require("ws");
const prisma = require("./prisma");

async function initializeDerivWebSocket(server) {
    let stake, currency, appId, bot_status, originalStake;
    const betHistory = []; // Array to track the last 4 bets (win or loss)

    try {
        const play_data = await prisma.stakeDetails.findFirst({
            orderBy: {
                createdAt: "desc",
            },
        });

        if (!play_data) {
            console.log("No play data found.");
            return;
        }

        stake = play_data.stake;
        originalStake = play_data.stake;
        currency = play_data.currency;
        appId = play_data.appId;
        bot_status = play_data.status;
    } catch (err) {
        console.log("Error fetching play data:", err);
        return;
    }

    console.log(stake, currency, appId, bot_status, originalStake);

    if (bot_status === "stopped") return;

    const socketUrl = process.env.SOCKET_URL;
    const derivId = process.env.DERIV_ID;
    const token = process.env.TOKEN;

    if (!socketUrl || !derivId || !token) {
        console.error(
            "Missing environment variables: SOCKET_URL, DERIV_ID, or TOKEN."
        );
        return;
    }

    const derivWs = new WebSocket(`${socketUrl}${appId}`);
    let betPlaced = false;
    let ongoingContractId = null;

    derivWs.on("open", () => {
        console.log("Connected to Deriv WebSocket API");

        derivWs.send(JSON.stringify({ authorize: token }));
        derivWs.send(JSON.stringify({ subscribe: 1, ticks: currency }));

        setInterval(() => {
            if (ongoingContractId !== null) {
                derivWs.send(
                    JSON.stringify({
                        proposal_open_contract: 1,
                        contract_id: ongoingContractId,
                    })
                );
            }
        }, 2000);

        setInterval(() => {
            derivWs.send(JSON.stringify({ ping: 1 }));
        }, 1000);
    });

    derivWs.on("message", (event) => {
        const message = JSON.parse(event);
        handleTickData(message);
        handleContractStatus(message);
        handleBetPlacement(message);
    });

    derivWs.on("error", (error) => {
        console.error("Error with Deriv WebSocket:", error);
    });

    derivWs.on("close", () => {
        console.log("Deriv WebSocket closed.");
    });

    let previousPrice = null; // Keep track of the previous price across ticks
    let crashState = false;  // Track crash state
    let dontTrade = false;
    let isHandlingCrash = false;
    let statusChecked = false;

    async function handleTickData(message) {
        if (message.tick && message.tick.symbol === "R_100") {
            const newPrice = parseFloat(message.tick.quote);

            try {
                // If a crash is detected, we need to wait for 7 seconds before resetting
                if (crashState === true && !isHandlingCrash) {
                    console.log("Multiplier crashed. Waiting 7 seconds before resetting...");

                    isHandlingCrash = true;

                    // Use setTimeout to handle the reset after 7 seconds
                    setTimeout(() => {
                        try {
                            console.log("Crash handled. Ready for the next round.");
                            isHandlingCrash = false;
                            crashState = false;
                            dontTrade = false;
                            console.log("Everything okay. Placing a new bet...");
                            placeBet(stake);
                        } catch (error) {
                            console.error("Error resetting crash state:", error);
                        }
                    }, 2000);

                    return; // Skip further tick processing while handling crash state
                }

                if (!isHandlingCrash) {
                    // If previousPrice is null (i.e., first tick), just set it to the newPrice
                    if (previousPrice === null) {
                        previousPrice = newPrice;
                        return; // Exit early, since we need at least two ticks to calculate a change
                    }

                    // Calculate price change
                    const priceChangePercentage = ((newPrice - previousPrice) / previousPrice) * 100;
                    const priceChangeThreshold = 0.04863;

                    if (Math.abs(priceChangePercentage) <= priceChangeThreshold) {
                        // Price within threshold; no crash detected
                        console.log("Price within threshold. No crash detected.");
                    } else {
                        // Handle crash and place a new bet
                        if (crashState === false || betPlaced === false) {
                            crashState = true;
                        }
                    }
                    // Update the previousPrice after handling logic
                    previousPrice = newPrice;
                }

            } catch (error) {
                console.error("Error handling tick data:", error);
            }
        }
    }

    async function placeBet(stake) {
        if (betPlaced && dontTrade === true) return; // Prevent placing a bet if one is already placed

        // Modify stake based on the bet history
        if (betHistory.length === 4) {
            betHistory.shift(); // Remove oldest bet result
        }

        if (betHistory.length >= 3 && betHistory.slice(-3).every(entry => entry === 'w')) {
            betHistory.length = 0; // Clear the array
            betHistory.push(''); // Add one 'w' to the array
        }

        const lastResult = betHistory[betHistory.length - 1];

        let consecutiveWins = 0;
        for (let i = betHistory.length - 1; i >= 0; i--) {
            if (betHistory[i] === 'w') {
                consecutiveWins++;
            } else {
                break; 
            }
        }

        // Double the stake continuously for each win
        if (lastResult === 'w' && consecutiveWins <= 3) {
            stake = originalStake * Math.pow(2, consecutiveWins); // Double the stake
        } else if (lastResult === 'l') {
            stake = stake; // Reset to the original stake on loss
        }


        console.log("Array history:", betHistory)
        console.log("Placing bet with stake:", stake);

        const takeProfit = stake * 1.5 - stake;

        const proposalMsg = {
            proposal: 1,
            amount: stake,
            contract_type: "ACCU",
            currency: "USD",
            basis: "stake",
            growth_rate: 0.05,
            limit_order: {
                take_profit: takeProfit.toFixed(2),
            },
            duration_unit: "s",
            product_type: "basic",
            symbol: currency,
        };

        derivWs.send(JSON.stringify(proposalMsg));
        betPlaced = true;
    }

    async function handleBetPlacement(message) {
        switch (message.msg_type) {
            case "proposal":
                const proposalResp = message.proposal;
                if (proposalResp) {
                    const proposalId = proposalResp.id;
                    derivWs.send(
                        JSON.stringify({
                            buy: proposalId,
                            price: proposalResp.ask_price,
                        })
                    );
                }
                break;

            case "buy":
                const buyResp = message.buy;
                if (buyResp) {
                    console.log(
                        "Trade successfully placed! Contract ID:",
                        buyResp.contract_id
                    );
                    ongoingContractId = buyResp.contract_id;
                    statusChecked = false;
                }
                break;


            default:
                break;
        }
    }

    async function handleContractStatus(message) {
        if (dontTrade === true) return;
        if (message.msg_type === "proposal_open_contract") {
            const proposal = message.proposal_open_contract;
            if (!proposal) return;

            const { status, contract_id, profit, buy_price } = proposal;

            console.log(`Contract ID: ${contract_id}`);
            console.log(`Contract Status: ${status}`);
            console.log(`Profit: ${profit}`);
            console.log(`Bet Amount: ${buy_price}`);

            if (statusChecked === false) {
                if (status === "won" || status === "lost") {
                    betHistory.push(status === "won" ? 'w' : 'l');

                    const existingBet = await prisma.bet.findFirst({
                        where: { contractId: contract_id.toString() },
                    });

                    if (!existingBet) {
                        await prisma.bet.create({
                            data: {
                                contractId: contract_id.toString(),
                                status,
                                profit: parseFloat(profit),
                                betAmount: parseFloat(buy_price),
                                createdAt: new Date(),
                            },
                        });
                        console.log(`Bet ${status}, data saved.`);
                    } else {
                        console.log(`Bet with contractId ${contract_id} already exists. Skipping insertion.`);
                    }
                    dontTrade = true;
                    statusChecked = true;
                }
            }


            betPlaced = false;

        }
    }
}



module.exports = initializeDerivWebSocket;
