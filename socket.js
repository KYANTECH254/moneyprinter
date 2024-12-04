const WebSocket = require("ws");
const prisma = require("./prisma");

async function initializeDerivWebSocket(server, user) {
    let stake, currency, appId, bot_status, originalStake, dt, sl, tp, token;
    const betHistory = []; // Array to track the last 4 bets (win or loss)

    async function fetchPlayDataWithTimeout() {
        try {
            // Create a promise for the fetch operation
            const fetchPlayData = new Promise(async (resolve, reject) => {
                const play_data = await prisma.stakeDetails.findFirst({
                    where: { id: user.id },
                    orderBy: {
                        createdAt: "desc",
                    },
                });
    
                if (!play_data) {
                    reject("No play data found.");
                } else {
                    resolve(play_data);
                    // console.log("All data:",play_data)
                }
            });
    
            // Set timeout for 5 seconds (adjust as needed)
            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject("Timeout: Database fetch operation took too long."), 5000)
            );
    
            // Use Promise.race to handle the fetch and the timeout together
            const play_data = await Promise.race([fetchPlayData, timeout]);
    
            // Return the data to be used outside the function
            return {
                stake: play_data.stake,
                originalStake: play_data.stake,
                currency: play_data.currency,
                appId: play_data.appId,
                bot_status: play_data.status,
                sl: play_data.sl,
                tp: play_data.tp,
                token: play_data.token,
                dt: play_data.dt,
            };
    
        } catch (err) {
            console.log("Error fetching play data:", err);
            return null;
        }
    }
    
    // Fetch data when the app is launched and set variables globally
    async function initializeData() {
        const playData = await fetchPlayDataWithTimeout();
        if (playData) {
            stake = playData.stake;
            originalStake = playData.originalStake;
            currency = playData.currency;
            appId = playData.appId;
            bot_status = playData.bot_status;
            sl = playData.sl;
            tp = playData.tp;
            token = playData.token;
            dt = playData.dt;
    
            console.log("One",stake, currency, appId, bot_status, originalStake, token);
        }
    }
    
    // First fetch when the app is launched
    initializeData();
    
    // Set interval to refetch data every 5 seconds
    setInterval(async () => {
        const playData = await fetchPlayDataWithTimeout();
        if (playData) {
            stake = playData.stake;
            originalStake = playData.originalStake;
            currency = playData.currency;
            appId = playData.appId;
            bot_status = playData.bot_status;
            sl = playData.sl;
            tp = playData.tp;
            token = playData.token;
            dt = playData.dt;
    
            console.log("Two",stake, currency, appId, bot_status, originalStake, token);
        }
    }, 5000);
    

    if (bot_status === "stopped") return;

    const socketUrl = process.env.SOCKET_URL;
    const derivId = process.env.DERIV_ID;
    const dtoken = process.env.TOKEN;

    if (!socketUrl || !derivId || !dtoken) {
        console.error(
            "Missing environment variables: SOCKET_URL, DERIV_ID, or TOKEN."
        );
        return;
    }
    if (!appId) {
        appId = derivId;
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
        }, 7000);

        setInterval(() => {
            derivWs.send(JSON.stringify({ ping: 1 }));
        }, 1000);
    });

    derivWs.on("message", (event) => {
        const message = JSON.parse(event);
        console.log("Message Event:", message);
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
        if (message.tick && message.tick.symbol === currency) {
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
                    }, dt);

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
        if (betPlaced && dontTrade === true) return;

        if (betHistory.length === 3) {
            betHistory.shift(); // Remove oldest bet result
        }
        
        // Check for two consecutive wins ('w w')
        if (betHistory.length >= 2 && betHistory.slice(-2).every(entry => entry === 'w')) {
            betHistory.length = 0; // Clear the array
            betHistory.push('w'); // Add one 'w' to the array for the next round
        }
        
        const lastResult = betHistory[betHistory.length - 1];
        
        // Initialize the stake based on the result of the last bet
        let consecutiveWins = 0;
        for (let i = betHistory.length - 1; i >= 0; i--) {
            if (betHistory[i] === 'w') {
                consecutiveWins++;
            } else {
                break; 
            }
        }
        
        // Adjust stake based on consecutive wins or loss
        if (lastResult === 'w' && consecutiveWins === 1) {
            // First win: Double the stake
            stake = originalStake * 2;
        } else if (lastResult === 'w' && consecutiveWins === 2) {
            // Second win: Double the stake again
            stake = originalStake * 4;
        } else if (lastResult === 'l') {
            // Loss: Keep the original stake
            stake = originalStake;
        }
        
        // If two wins in a row ('w w'), reset stake to original for the next bet
        if (betHistory.slice(-2).every(entry => entry === 'w')) {
            stake = originalStake;
        }

        const canContinueTrading = await checkTpAndTotalProfit();
        if (!canContinueTrading) {
            console.log("Stopping further trades.");
            return; 
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
            symbol: "R_100",
        };

        derivWs.send(JSON.stringify(proposalMsg));
        console.log("Bet:",proposalMsg)
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
                                token:token,
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

    async function checkTpAndTotalProfit() {
        try {
            // Fetch the latest StakeDetails to get tp, sl, and updatedAt
            const stakeDetails = await prisma.stakeDetails.findFirst({
                where: { status: 'active' },
                orderBy: { updatedAt: 'desc' }, // Get the most recent active stake
            });
    
            if (!stakeDetails) {
                console.log("No active stake details found.");
                return true; // Continue placing trades if no active stake is found
            }
    
            // Convert tp and sl to numbers
            const tpValue = Number(stakeDetails.tp); // Convert tp to number
            const slValue = Number(stakeDetails.sl); // Convert sl to number
    
            // If tp or sl are empty (not provided), continue trading
            if (!tpValue && !slValue) {
                console.log("TP and SL are empty, continuing to place trades.");
                return true; // Continue trading
            }
    
            // Fetch the total profit since the last stake update
            const totalProfit = await calculateTotalProfit(stakeDetails.updatedAt);
    
            // Check if tp or sl is exceeded
            if ((tpValue && totalProfit >= tpValue) || (slValue && totalProfit <= -slValue)) {
                console.log(`TP or SL condition met. Total profit: ${totalProfit}`);
                return false; // Stop trading as TP or SL condition is met
            } else {
                console.log(`Continuing to place trades. Total profit: ${totalProfit}`);
                return true; // Continue trading
            }
        } catch (err) {
            console.error("Error in checking TP or SL or calculating total profit:", err);
            return true; // Continue trading in case of an error
        }
    }
    
    async function calculateTotalProfit(updatedAtTimestamp) {
        try {
            const bets = await prisma.bet.findMany({
                where: {
                    createdAt: { gte: updatedAtTimestamp }, // Filter bets after the updatedAt timestamp
                },
            });
    
            const totalProfit = bets.reduce((acc, bet) => acc + bet.profit, 0); // Sum the profits of all bets
            return totalProfit;
        } catch (err) {
            console.error("Error calculating total profit:", err);
            return 0; // If there's an error, assume no profit
        }
    }
    
}



module.exports = initializeDerivWebSocket;
