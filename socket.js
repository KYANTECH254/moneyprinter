const WebSocket = require("ws");
const prisma = require("./prisma");
const userStates = new Map();

async function initializeDerivWebSocket(server, user) {
    userStates.set(user.id, {
        betPlaced: false, dontTrade: false, ongoingContractId: null, crashState: false, isHandlingCrash: false, statusChecked: false,
        previousPrice: null, crashDetected: false, betHistory: [], lastResult: '', stake: 0, currency: '', appId: '', bot_status: '', originalStake: 0, dt: 0, sl: 0,
        tp: 0, token: '', message: [], newPrice: null, consecutiveWins: 0, takeProfit: 0, ctotalProfit: 0
    });
    const state = userStates.get(user.id);

    async function fetchPlayDataWithTimeout() {
        try {
            // Create a promise for the fetch operation
            const fetchPlayData = new Promise(async (resolve, reject) => {
                const play_data = await prisma.stakeDetails.findFirst({
                    where: { id: user.id, status: "active", },
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
            state,dontTrade = true;
            state.stake = 0;
            state.crashState = true;
            state.ongoingContractId = 0;
            state.bot_status = "stopped";
            state.token = "";
            return null;
        }
    }

    // Fetch data when the app is launched and set variables globally
    async function initializeData() {
        const playData = await fetchPlayDataWithTimeout();
        if (playData) {
            state.stake = playData.stake;
            state.originalStake = playData.originalStake;
            state.currency = playData.currency;
            state.appId = playData.appId;
            state.bot_status = playData.bot_status;
            state.sl = playData.sl;
            state.tp = playData.tp;
            state.token = playData.token;
            state.dt = playData.dt;

            console.log("One", state.stake, state.currency, state.appId, state.bot_status, state.originalStake, state.token);
        }
    }

    // First fetch when the app is launched
    initializeData();

    // Set interval to refetch data every 5 seconds
    setInterval(async () => {
        const playData = await fetchPlayDataWithTimeout();
        if (playData) {
            state.stake = playData.stake;
            state.originalStake = playData.originalStake;
            state.currency = playData.currency;
            state.appId = playData.appId;
            state.bot_status = playData.bot_status;
            state.sl = playData.sl;
            state.tp = playData.tp;
            state.token = playData.token;
            state.dt = playData.dt;

            console.log("Two", state.stake, state.currency, state.appId, state.bot_status, state.originalStake, state.token);
        }
    }, 5000);

    if (state.bot_status === "stopped") return;

    const socketUrl = process.env.SOCKET_URL;
    const derivId = process.env.DERIV_ID;
    const dtoken = process.env.TOKEN;

    if (!socketUrl || !derivId || !dtoken) {
        console.error(
            "Missing environment variables: SOCKET_URL, DERIV_ID, or TOKEN."
        );
        return;
    }

    if (!state.appId) {
        state.appId = derivId;
    }

    const derivWs = new WebSocket(`${socketUrl}${user.appId}`);
    derivWs.on("open", () => {
        console.log(`WebSocket opened for stake ID: ${user.token}`);

        derivWs.send(JSON.stringify({ authorize: user.token }));
        derivWs.send(JSON.stringify({ subscribe: 1, ticks: user.currency }));

        setInterval(() => {
            if (state.ongoingContractId !== null) {
                derivWs.send(
                    JSON.stringify({
                        proposal_open_contract: 1,
                        contract_id: state.ongoingContractId,
                    })
                );
            }
        }, 7000);

        setInterval(() => {
            derivWs.send(JSON.stringify({ ping: 1 }));
        }, 1000);
    });

    derivWs.on("message", (event) => {
        state.message = JSON.parse(event);
        // console.log("Message Event:", message);
        handleTickData(state.message);
        handleContractStatus(state.message);
        handleBetPlacement(state.message);
    });

    derivWs.on("error", (error) => {
        console.error("Error with Deriv WebSocket:", error);
    });

    derivWs.on("close", () => {
        console.log("Deriv WebSocket closed.");
    });

    async function handleTickData(message) {
        if (message.tick && message.tick.symbol === state.currency) {
            state.newPrice = parseFloat(message.tick.quote);

            try {
                // If a crash is detected, we need to wait for 7 seconds before resetting
                if (state.crashState === true && !state.isHandlingCrash) {
                    console.log(`Multiplier crashed. Waiting ${state.dt} seconds before resetting...`);

                    state.isHandlingCrash = true;

                    // Use setTimeout to handle the reset after 7 seconds
                    setTimeout(() => {
                        try {
                            console.log("Crash handled. Ready for the next round.");
                            state.isHandlingCrash = false;
                            state.crashState = false;
                            state.dontTrade = false;
                            console.log("Everything okay. Placing a new bet...");
                            placeBet(state.stake);
                        } catch (error) {
                            console.error("Error resetting crash state:", error);
                        }
                    }, parseFloat(state.dt) * 1000);

                    return; 
                }

                if (!state.isHandlingCrash) {
                    // If previousPrice is null (i.e., first tick), just set it to the newPrice
                    if (state.previousPrice === null) {
                        state.previousPrice = state.newPrice;
                        return; // Exit early, since we need at least two ticks to calculate a change
                    }

                    // Calculate price change
                    const priceChangePercentage = ((state.newPrice - state.previousPrice) / state.previousPrice) * 100;
                    const priceChangeThreshold = 0.04863;

                    if (Math.abs(priceChangePercentage) <= priceChangeThreshold) {
                        // Price within threshold; no crash detected
                        console.log("Price within threshold. No crash detected.");
                    } else {
                        // Handle crash and place a new bet
                        if (state.crashState === false || state.betPlaced === false) {
                            state.crashState = true;
                        }
                    }
                    // Update the previousPrice after handling logic
                    state.previousPrice = state.newPrice;
                }

            } catch (error) {
                console.error("Error handling tick data:", error);
            }
        }
    }

    async function placeBet(stake) {
        if (state.betPlaced && state.dontTrade === true && state.bot_status === "stopped") return;

        if (state.betHistory.length === 3) {
            state.betHistory.shift(); // Remove oldest bet result
        }

        // Check for two consecutive wins ('w w')
        if (state.betHistory.length >= 2 && state.betHistory.slice(-2).every(entry => entry === 'w')) {
            state.betHistory.length = 0; // Clear the array
            state.betHistory.push('w'); // Add one 'w' to the array for the next round
        }

        state.lastResult = state.betHistory[state.betHistory.length - 1];

        for (let i = state.betHistory.length - 1; i >= 0; i--) {
            if (state.betHistory[i] === 'w') {
                state.consecutiveWins++;
            } else {
                break;
            }
        }

        // Adjust stake based on consecutive wins or loss
        if (state.lastResult === 'w' && state.consecutiveWins === 1) {
            // First win: Double the stake
            stake = state.originalStake * 2;
        } else if (state.lastResult === 'w' && state.consecutiveWins === 2) {
            // Second win: Double the stake again
            stake = state.originalStake * 4;
        } else if (state.lastResult === 'l') {
            // Loss: Keep the original stake
            stake = state.originalStake;
        }

        // If two wins in a row ('w w'), reset stake to original for the next bet
        if (state.betHistory.slice(-2).every(entry => entry === 'w')) {
            stake = state.originalStake;
        }

        const canContinueTrading = await checkTpAndTotalProfit();
        if (!canContinueTrading) {
            const checkstatus = await prisma.stakeDetails.findUnique({
                where: {
                    id: user.id,
                }
            })

            if (checkstatus.status === "active") {
                const updatedb = await prisma.stakeDetails.update({
                    where: {
                        id: user.id,
                    },
                    data: {
                        status: "stopped",
                    }
                })
            }

            console.log("Stopping further trades.");
            return;
        }

        console.log("Array history:", state.betHistory)
        console.log("Placing bet with stake:", stake, "Account:", state.token);

        if (state.bot_status === "active") {
            state.takeProfit = stake * 1.5 - stake;

            const proposalMsg = {
                proposal: 1,
                amount: stake,
                contract_type: "ACCU",
                currency: "USD",
                basis: "stake",
                growth_rate: 0.05,
                limit_order: {
                    take_profit: state.takeProfit.toFixed(2),
                },
                duration_unit: "s",
                product_type: "basic",
                symbol: state.currency,
            };

            derivWs.send(JSON.stringify(proposalMsg));
            console.log("Bet:", proposalMsg)
            state.betPlaced = true;
        }

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
                    state.ongoingContractId = buyResp.contract_id;
                    state.statusChecked = false;
                }
                break;

            default:
                break;
        }
    }

    async function handleContractStatus(message) {
        if (state.dontTrade === true) return;
        if (message.msg_type === "proposal_open_contract") {
            const proposal = message.proposal_open_contract;
            if (!proposal) return;

            const { status, contract_id, profit, buy_price } = proposal;

            console.log(`Contract ID: ${contract_id}`);
            console.log(`Contract Status: ${status}`);
            console.log(`Profit: ${profit}`);
            console.log(`Bet Amount: ${buy_price}`);

            if (state.statusChecked === false) {
                if (status === "won" || status === "lost") {
                    state.betHistory.push(status === "won" ? 'w' : 'l');

                    const existingBet = await prisma.bet.findFirst({
                        where: { contractId: contract_id.toString() },
                    });

                    if (!existingBet) {
                        await prisma.bet.create({
                            data: {
                                contractId: contract_id.toString(),
                                status,
                                token: state.token,
                                profit: parseFloat(profit),
                                betAmount: parseFloat(buy_price),
                                createdAt: new Date(),
                            },
                        });
                        console.log(`Bet ${status}, data saved.`);
                    } else {
                        console.log(`Bet with contractId ${contract_id} already exists. Skipping insertion.`);
                    }
                    state.dontTrade = true;
                    state.statusChecked = true;
                }
            }
            state.betPlaced = false;
        }
    }

    async function checkTpAndTotalProfit() {
        try {
            // Fetch the latest StakeDetails to get tp, sl, and updatedAt
            const stakeDetails = await prisma.stakeDetails.findFirst({

                where: { status: 'active', token: state.token },
                orderBy: { updatedAt: 'desc' }, // Get the most recent active stake
            });

            if (!stakeDetails) {
                console.log("No active stake details found.");
                return true; // Continue placing trades if no active stake is found
            }

            // Convert tp and sl to numbers
            state.tp = Number(stakeDetails.tp); // Convert tp to number
            state.sl = Number(stakeDetails.sl); // Convert sl to number

            // If tp or sl are empty (not provided), continue trading
            if (!state.tp && !state.sl) {
                console.log("TP and SL are empty, continuing to place trades.");
                return true; // Continue trading
            }

            // Fetch the total profit since the last stake update
            const totalProfit = await calculateTotalProfit(stakeDetails.updatedAt);

            // Check if tp or sl is exceeded
            if ((state.tp && totalProfit >= state.tp) || (state.sl && totalProfit <= -state.sl)) {
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
                    token: state.token,
                    createdAt: { gte: updatedAtTimestamp },
                },
            });

            state.ctotalProfit = bets.reduce((acc, bet) => acc + bet.profit, 0); // Sum the profits of all bets
            return state.ctotalProfit;
        } catch (err) {
            console.error("Error calculating total profit:", err);
            return 0; // If there's an error, assume no profit
        }
    }

}



module.exports = initializeDerivWebSocket;
