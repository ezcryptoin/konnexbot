import axios from 'axios';
import cfonts from 'cfonts';
import gradient from 'gradient-string';
import chalk from 'chalk';
import fs from 'fs/promises';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const config = require('./config.json');
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import ora from 'ora';
import { ethers } from 'ethers';
import { TwitterApi } from 'twitter-api-v2';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import Table from 'cli-table3';

const logger = {
    info: (msg, context) => {
        const ctx = (typeof context === 'string' ? context : 'Info');
        console.log(chalk.cyan(`[${ctx}] `) + chalk.white(msg));
    },
    success: (msg, context) => {
        const ctx = (typeof context === 'string' ? context : 'Success');
        console.log(chalk.green(`[${ctx}] ${msg} SUCCESS`));
    },
    warn: (msg, context) => {
        const ctx = (typeof context === 'string' ? context : 'Warn');
        console.log(chalk.yellow(`[${ctx}] ${msg}`));
    },
    error: (msg, context) => {
        const ctx = (typeof context === 'string' ? context : 'Error');
        console.log(chalk.red(`[${ctx}] FAILED: ${msg}`));
    },
    debug: (msg, context) => {
        const ctx = (typeof context === 'string' ? context : 'Debug');
        console.log(chalk.blue(`[${ctx}] ${msg}`));
    }
};

function delay(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

// Session results tracking
let sessionResults = {
    accounts: [],
    startTime: null,
    endTime: null
};

// ============================================
// SCHEDULING HELPER FUNCTIONS
// ============================================

function getNextScheduledTime(hour = 7, minute = 30) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (now >= next) {
        next.setDate(next.getDate() + 1);
    }
    return next;
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

async function displayCountdown(msUntilNextRun, targetTime) {
    const targetTimeStr = targetTime.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    console.log(chalk.bold.cyan(`⏰ Next cycle scheduled at: ${targetTimeStr} WIB`));
    console.log('');

    return new Promise((resolve) => {
        const startTime = Date.now();
        const endTime = targetTime.getTime();

        if (endTime <= startTime) {
            console.log(chalk.green('🚀 Starting new cycle immediately (scheduled time reached)...'));
            console.log('');
            resolve();
            return;
        }

        let intervalId = null;
        let timeoutId = null;
        let hourlyCheckId = null;

        const finish = () => {
            if (intervalId) clearInterval(intervalId);
            if (timeoutId) clearTimeout(timeoutId);
            if (hourlyCheckId) clearInterval(hourlyCheckId);
            process.stdout.clearLine?.();
            process.stdout.cursorTo?.(0);
            console.log(chalk.green('🚀 Starting new cycle...'));
            console.log('');
            resolve();
        };

        const waitMs = endTime - Date.now();
        timeoutId = setTimeout(finish, waitMs);

        const updateCountdown = () => {
            const now = Date.now();
            const remaining = endTime - now;
            if (remaining <= 0) {
                finish();
                return;
            }
            try {
                process.stdout.clearLine?.();
                process.stdout.cursorTo?.(0);
                process.stdout.write(chalk.yellow(`⏳ Countdown: ${formatTime(remaining)} remaining...`));
            } catch (e) { }
        };

        updateCountdown();
        intervalId = setInterval(updateCountdown, 1000);

        hourlyCheckId = setInterval(() => {
            const remaining = endTime - Date.now();
            if (remaining > 0) {
                logger.info(`Bot still waiting... ${formatTime(remaining)} until next cycle`, 'System');
            }
        }, 3600000);
    });
}

async function waitUntilScheduledTime(hour = 7, minute = 30) {
    const nextRun = getNextScheduledTime(hour, minute);
    const msUntilNextRun = nextRun.getTime() - Date.now();
    await displayCountdown(msUntilNextRun, nextRun);
}

function stripAnsi(str) {
    return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function centerText(text, width) {
    const cleanText = stripAnsi(text);
    const textLength = cleanText.length;
    const totalPadding = Math.max(0, width - textLength);
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function printHeader(title) {
    const width = 80;
    console.log(gradient.morning(`┬${'─'.repeat(width - 2)}┬`));
    console.log(gradient.morning(`│ ${title.padEnd(width - 4)} │`));
    console.log(gradient.morning(`┴${'─'.repeat(width - 2)}┴`));
}

function printInfo(label, value, context) {
    logger.info(`${label.padEnd(15)}: ${chalk.cyan(value)}`, context);
}

const userAgents = config.userAgents;

function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getAxiosConfig(proxy, additionalHeaders = {}) {
    const headers = {
        'accept': '*/*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7,fr;q=0.6,ru;q=0.5,zh-CN;q=0.4,zh;q=0.3',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': `${config.baseUrl}/points`,
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Opera";v="124"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': getRandomUserAgent(),
        ...additionalHeaders
    };
    const axiosConfig = {
        headers,
        timeout: 60000
    };
    if (proxy) {
        axiosConfig.httpsAgent = newAgent(proxy);
        axiosConfig.proxy = false;
    }
    return axiosConfig;
}

function newAgent(proxy) {
    if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
        return new HttpsProxyAgent(proxy);
    } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
        return new SocksProxyAgent(proxy);
    } else {
        logger.warn(`Unsupported proxy: ${proxy}`, 'System');
        return null;
    }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 3, backoff = 2000, context) {
    for (let i = 0; i < retries; i++) {
        try {
            let response;
            if (method.toLowerCase() === 'get') {
                response = await axios.get(url, config);
            } else if (method.toLowerCase() === 'post') {
                response = await axios.post(url, payload, config);
            } else {
                throw new Error(`Method ${method} not supported`);
            }
            return response;
        } catch (error) {
            if (error.response && error.response.status >= 500 && i < retries - 1) {
                logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries}) due to server error`, context);
                await delay(backoff / 1000);
                backoff *= 1.5;
                continue;
            }
            if (i < retries - 1) {
                logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries})`, context);
                await delay(backoff / 1000);
                backoff *= 1.5;
                continue;
            }
            throw error;
        }
    }
}

async function readAccounts() {
    try {
        const data = await fs.readFile('accounts.json', 'utf-8');
        const accounts = JSON.parse(data);
        if (!Array.isArray(accounts)) {
            throw new Error('accounts.json must be an array of objects');
        }
        logger.info(`Loaded ${accounts.length} account${accounts.length === 1 ? '' : 's'}`, 'System');
        return accounts;
    } catch (error) {
        logger.error(`Failed to read accounts.json: ${error.message}`, 'System');
        return [];
    }
}

function maskAddress(address) {
    return address ? `${address.slice(0, 6)}${'*'.repeat(6)}${address.slice(-6)}` : 'N/A';
}

function deriveWalletAddress(privateKey) {
    try {
        const wallet = new ethers.Wallet(privateKey);
        return wallet.address;
    } catch (error) {
        logger.error(`Failed to derive address: ${error.message}`);
        return null;
    }
}

async function createSignedPayload(privateKey, address, nonce) {
    try {
        const wallet = new ethers.Wallet(privateKey);
        const issuedAt = new Date().toISOString();
        // Use correct domain and chainId for Konnex
        const domain = "hub.konnex.world";
        const chainId = 1; // Assuming Mainnet based on inspection

        const messageObj = {
            domain: domain,
            address: address,
            statement: "Sign in to the app. Powered by Snag Solutions.",
            uri: config.baseUrl,
            version: "1",
            chainId: chainId,
            nonce: nonce,
            issuedAt: issuedAt
        };
        const rawMessage = JSON.stringify(messageObj, null, 0);

        const fullMessage = `${domain} wants you to sign in with your Ethereum account:\n` +
            `${address}\n\n` +
            `Sign in to the app. Powered by Snag Solutions.\n\n` +
            `URI: ${config.baseUrl}\n` +
            `Version: 1\n` +
            `Chain ID: ${chainId}\n` +
            `Nonce: ${nonce}\n` +
            `Issued At: ${issuedAt}`;

        const signedMessage = await wallet.signMessage(fullMessage);

        return {
            message: rawMessage,
            accessToken: signedMessage,
            signature: signedMessage,
            walletConnectorName: "MetaMask",
            walletAddress: address,
            redirect: "false",
            callbackUrl: "/protected",
            chainType: "evm",
            walletProvider: "undefined",
            csrfToken: nonce,
            json: "true"
        };
    } catch (error) {
        throw new Error(`Failed to create signed payload: ${error.message}`);
    }
}

async function fetchNonce(address, proxy, context, refCode = config.referralCode) {
    const url = `${config.baseUrl}/api/auth/csrf`;
    const axiosConfig = getAxiosConfig(proxy, {
        'Content-Type': 'application/json',
        'Cookie': `referral_code=${refCode}`
    });
    const spinner = ora({ text: 'Fetching nonce...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('get', url, null, axiosConfig, 3, 2000, context);
        spinner.stop();
        if (response.data.csrfToken) {
            return { csrfToken: response.data.csrfToken, setCookie: response.headers['set-cookie'] || [] };
        } else {
            throw new Error('Failed to fetch nonce');
        }
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to fetch nonce: ${error.message}`));
        return null;
    }
}

async function executeLogin(privateKey, address, nonce, proxy, context, cookies) {
    const url = `${config.baseUrl}/api/auth/callback/credentials`;
    const payload = await createSignedPayload(privateKey, address, nonce);
    const axiosConfig = getAxiosConfig(proxy, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies.join('; ')
    });
    const spinner = ora({ text: 'Executing login...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('post', url, new URLSearchParams(payload).toString(), axiosConfig, 3, 2000, context);
        spinner.stop();
        const sessionCookies = response.headers['set-cookie'] || [];
        const hasSession = sessionCookies.some(ck => ck.includes('__Secure-next-auth.session-token='));
        if (hasSession) {
            return { success: true, sessionCookies };
        } else {
            throw new Error('Login failed (No session token)');
        }
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to execute login: ${error.message}`));
        return null;
    }
}

async function retrieveBalance(address, proxy, context, cookies, webId = config.websiteId, orgId = config.organizationId) {
    const url = `${config.baseUrl}/api/loyalty/accounts?limit=100&websiteId=${webId}&organizationId=${orgId}&walletAddress=${address}`;
    const axiosConfig = getAxiosConfig(proxy, { 'Cookie': cookies.join('; ') });
    const spinner = ora({ text: 'Retrieving balance...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('get', url, null, axiosConfig, 3, 2000, context);
        spinner.stop();
        if (response.data.data && response.data.data.length > 0) {
            const amount = response.data.data[0].amount || 0;
            return amount;
        } else {
            return 0;
        }
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to retrieve balance: ${error.message}`));
        return null;
    }
}

async function executeDailyCheckin(address, proxy, context, cookies) {
    const url = `${config.baseUrl}/api/loyalty/rules/${config.dailyCheckInRuleId}/complete`;
    const axiosConfig = getAxiosConfig(proxy, {
        'Content-Type': 'application/json',
        'Content-Length': '2',
        'Cookie': cookies.join('; ')
    });
    axiosConfig.validateStatus = (status) => status >= 200 && status < 500;
    const spinner = ora({ text: 'Executing daily check-in...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('post', url, {}, axiosConfig, 3, 2000, context);
        if (response.status === 400) {
            spinner.warn(chalk.bold.yellowBright(` ${response.data.message || 'Already checked in today'}`));
            return { success: true, message: 'Done' };
        }
        spinner.succeed(chalk.bold.greenBright(` Check-In Successfully!`));
        return { success: true, message: 'Success' };
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to execute check-in: ${error.message}`));
        return null;
    }
}

async function getPublicIP(proxy, context) {
    try {
        const axiosConfig = getAxiosConfig(proxy);
        const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, axiosConfig, 3, 2000, context);
        return response.data.ip || 'Unknown';
    } catch (error) {
        logger.error(`Failed to get IP: ${error.message}`, context);
        return 'Error retrieving IP';
    }
}

async function getUserSession(proxy, context, cookies) {
    const url = `${config.baseUrl}/api/auth/session`;
    const axiosConfig = getAxiosConfig(proxy, { 'Cookie': cookies.join('; ') });
    const spinner = ora({ text: 'Fetching user session...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('get', url, null, axiosConfig, 3, 2000, context);
        spinner.stop();
        return response.data.user ? response.data.user.id : null;
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to fetch user session: ${error.message}`));
        return null;
    }
}

async function fetchPostRuleId(proxy, context, cookies, webId = config.websiteId, orgId = config.organizationId) {
    // Fetch rules in the post rule group
    const url = `${config.baseUrl}/api/loyalty/rules?limit=50&websiteId=${webId}&organizationId=${orgId}&excludeHidden=true&excludeExpired=true&isActive=true&loyaltyRuleGroupId=${config.postRuleGroupId}&isSpecial=false`;
    const axiosConfig = getAxiosConfig(proxy, { 'Cookie': cookies.join('; ') });
    const spinner = ora({ text: 'Fetching post rule ID...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('get', url, null, axiosConfig, 3, 2000, context);
        spinner.stop();
        // Look for "Post about Konnex" or similar
        const rule = response.data.data.find(r => r.name.toLowerCase().includes('post about konnex'));
        return rule ? rule.id : null;
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to fetch post rule ID: ${error.message}`));
        return null;
    }
}

async function completePostTask(ruleId, postUrl, proxy, context, cookies) {
    const url = `${config.baseUrl}/api/loyalty/rules/${ruleId}/complete`;
    const payload = { contentUrl: postUrl };
    const axiosConfig = getAxiosConfig(proxy, {
        'Content-Type': 'application/json',
        'Cookie': cookies.join('; ')
    });
    const spinner = ora({ text: 'Completing post task...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('post', url, payload, axiosConfig, 3, 2000, context);
        spinner.succeed(chalk.bold.greenBright(` Post task completion queued`));
        return response.data;
    } catch (error) {
        if (error.message.includes('429') || (error.response && error.response.status === 429)) {
            spinner.succeed(chalk.bold.greenBright(` Post task accepted (Rate Limit)`));
            return { success: true };
        }
        spinner.fail(chalk.bold.redBright(` Failed to complete post task: ${error.message}`));
        return null;
    }
}

async function checkTaskStatus(userId, proxy, context, cookies, webId = config.websiteId, orgId = config.organizationId) {
    const url = `${config.baseUrl}/api/loyalty/rules/status?websiteId=${webId}&organizationId=${orgId}&userId=${userId}`;
    const axiosConfig = getAxiosConfig(proxy, { 'Cookie': cookies.join('; ') });
    const spinner = ora({ text: 'Checking task status...', spinner: 'dots' }).start();
    try {
        const response = await requestWithRetry('get', url, null, axiosConfig, 3, 2000, context);
        spinner.stop();
        return response.data.data;
    } catch (error) {
        spinner.fail(chalk.bold.redBright(` Failed to check task status: ${error.message}`));
        return null;
    }
}

const tweetVariations = [
    "Building the future of Autonomous Systems with @konnex_world! 🤖 Excited to see robots and drones coordinating seamlessly. #Konnex #DePIN",
    "Just read about Proof-of-Physical-Work on @konnex_world. Verification for real-world tasks is a game changer! 🌍 #PoPW #Web3",
    "@konnex_world is revolutionizing decentralized logistics. Imagine drones delivering your lunch autonomously! 🍕🚁 #Logistics #AI",
    "The Robo-Kitchen concept by @konnex_world is mind-blowing. Chef bots earning stablecoins? Yes please! 👨‍🍳💸 #Robotics #Future",
    "Responsive Agriculture by @konnex_world means smarter farming with verified data. 🚜 Say hello to sustainable tech! #AgriTech #Konnex",
    "Connecting the physical and digital worlds like never before. @konnex_world is the bridge we needed. 🌉 #DePIN #IoT",
    "Earning rewards for physical work verified on-chain. @konnex_world is creating a new economy. 💰 #WorkFi #Crypto",
    "Autonomous agents collaborating on @konnex_world network. The future of work is automated and decentralized. 🤝 #AI #Automation",
    "Security and transparency in logistics? @konnex_world has solved it with blockchain verification. 📦🔒 #SupplyChain #Blockchain",
    "Checking out the @konnex_world whitepaper. The tech stack for autonomous coordination is impressive! 📄✨ #Research #DeepTech",
    "Can't wait to see @konnex_world drones in action in my city! 🏙️ Decentralized delivery is the way forward. #SmartCities #Konnex",
    "Why trust a single entity when you can trust the @konnex_world protocol? Decentralization wins. 🏆 #Trustless #Web3",
    "My robot arm is ready to work on the @konnex_world network! Monetizing hardware has never been cooler. 🦾💵 #Hardware #DePIN",
    "Data integrity is key for autonomous systems. @konnex_world ensures every byte is verified. ✅ #Data #Security",
    "Joining the revolution of physical work intelligence with @konnex_world. It's time to build! 🛠️ #Builder #Konnex",
    "From recipe to motion, @konnex_world handles the intelligence transfer perfectly. 🧠➡️🦾 #AI #Robotics",
    "Optimizing waste reduction in agriculture with @konnex_world's monitoring drones. 🍃 Green tech ftw! #Sustainability #Konnex",
    "The @konnex_world ecosystem is growing fast. Don't miss the wave of decentralized physical infrastructure networks! 🌊 #DePINSummer",
    "Smart contracts meeting real-world physics. @konnex_world is where the magic happens. ✨🧱 #SmartContracts #Physics",
    "Verifying torque and temperature on-chain? Only @konnex_world does it right. 🌡️🔧 #IoT #Tech",
    "Escrow payments unlocked automatically upon task completion. @konnex_world makes payments frictionless. 💸🔓 #DeFi #Payments",
    "Scaling autonomous fleets with @konnex_world. The coordination layer for the machine economy. 🤖🌐 #MachineEconomy",
    "Global market for physical work? @konnex_world is opening doors for everyone. 🌍🚪 #GlobalEconomy #Konnex",
    "Publish policies to compete and get paid on @konnex_world. Meritocracy in automation! 🏅 #Competition #Konnex",
    "Decentralized delivery is cheaper, faster, and fairer with @konnex_world. 📦⚡ #Delivery #Logistics",
    "Proof-of-Physical-Work is the consensus mechanism we didn't know we needed. Thanks @konnex_world! 🧱👷 #Consensus #Crypto",
    "Interoperability between different robot brands via @konnex_world. Finally, they can talk to each other! 🗣️🤖 #Interoperability",
    "Privacy in physical tasks is respected on @konnex_world. Your data, your rules. 🛡️ #Privacy #Web3",
    "Monitoring crop health with @konnex_world precision. Agriculture 4.0 is here. 🌾🤖 #AgriTech #Konnex",
    "Reducing carbon footprint with optimized logistics on @konnex_world. 🌿🚚 #GreenTech #Logistics",
    "The sheer potential of @konnex_world in industrial automation is staggering. 🏭📈 #Industry40 #Automation",
    "Building a decentralized map of physical work with @konnex_world. 🗺️📍 #Mapping #DePIN",
    "Every drone flight verified on @konnex_world. Accountability on the blockchain. 🚁🔗 #Drones #Blockchain",
    "Get verified, get paid. The simple promise of @konnex_world. 🤝💰 #Konnex #Earn",
    "Leveraging AI for smarter physical task distribution on @konnex_world. 🧠📦 #AI #Logistics",
    "Who needs a middleman when you have @konnex_world? Peer-to-peer physical services are here. 👥 #P2P #Services",
    "The @konnex_world community is building the infrastructure of tomorrow. Proud to be part of it! 🏗️💙 #Community #Konnex",
    "Swarm intelligence powered by @konnex_world. Drones working together flawlessly. 🐝🤖 #Swarm #Tech",
    "Imagine ordering a coffee and a @konnex_world bot delivers it. The future is tasty! ☕🤖 #FutureLife",
    "Validating physical outcomes on-chain is the holy grail. @konnex_world found it. 🏆🕍 #Innovation #Web3",
    "Stablecoin settlements for real work. @konnex_world brings stability to the gig economy. 💵👷 #GigEconomy #Stablecoins",
    "License your robot's skills on @konnex_world. Knowledge economy meets robotics! 🧠🦾 #Skills #Konnex",
    "Transparency in every step of the supply chain with @konnex_world. No more black boxes. 📦🔦 #Transparency",
    "Empowering local communities with decentralized logistics tools from @konnex_world. 🏘️🚚 #Local #Konnex",
    "The @konnex_world protocol handles the complexity so you can focus on the task. 🧩✨ #UserFriendly #Tech",
    "Bridging the gap between digital intelligence and physical action. @konnex_world is the missing link. 🔗🌐 #AI #Robotics",
    "Secure communication for autonomous fleets. @konnex_world sets the standard. 📡🔐 #Security #Konnex",
    "Reducing inefficiencies in last-mile delivery with @konnex_world. 📉📦 #Efficiency #Logistics",
    "The tokenomics of @konnex_world incentivize honest work and verification. 🪙✅ #Tokenomics #DePIN",
    "Bringing the blockchain to the factory floor with @konnex_world. 🏭🔗 #Manufacturing #Blockchain",
    "Real-time coordination of heterogeneous robot fleets. @konnex_world is the conductor. 🎼🤖 #Orchestration",
    "Say goodbye to centralized bottlenecks in logistics. @konnex_world is distributing the load. ⚖️🚚 #Decentralization",
    "Farming data monetization via @konnex_world. Farmers get paid for their insights! 👩‍🌾💰 #DataEconomy #Agriculture",
    "The precision of @konnex_world's verification system is unmatched. 🎯✅ #Tech #Quality",
    "Imagine a city run by decentralized autonomous services. @konnex_world is building the foundation. 🏙️🏗️ #SmartCity",
    "Cross-chain compatibility for physical assets? @konnex_world is exploring new frontiers. ⛓️📦 #CrossChain",
    "Low latency coordination for high-speed drones. @konnex_world is fast! ⚡🚁 #Speed #Tech",
    "Open source innovation driving the physical web. @konnex_world is leading the charge. 🐧🌍 #OpenSource",
    "Collaborative robotics at a global scale. Only on @konnex_world. 🤝🌍 #Robotics #Global",
    "Ensuring fair pay for autonomous work units. @konnex_world is the fair labor automated. ⚖️🤖 #Fairness",
    "The API for the physical world. Developers, check out @konnex_world! 👨‍💻🌍 #Devs #API",
    "Seamless integration of IoT sensors with @konnex_world blockchain. 🌡️🔗 #IoT #Integration",
    "Trust but verify. @konnex_world automates the verification. 🤝✅ #Trust #Automation",
    "A new era of machine-to-machine commerce powered by @konnex_world. 🤖💰🤖 #M2M #Commerce",
    "Reducing food waste with timely harvesting alerts from @konnex_world systems. 🍎📉 #FoodSecurity",
    "Safety first! @konnex_world protocols ensure safe robot operations. 🦺🤖 #Safety #Robotics",
    "Democratizing access to advanced robotics capabilities via @konnex_world. 🗳️🦾 #Democracy #Tech",
    "The network effect of physical work. @konnex_world grows stronger with every node. 🕸️💪 #NetworkEffect",
    "Smart logistics for a smarter planet. Go @konnex_world! 🌍🧠 #SmartPlanet",
    "Solving the 'oracle problem' for physical events. @konnex_world is the solution. 🔮✅ #Oracle #Blockchain",
    "Dynamic pricing for physical services based on demand. @konnex_world markets are efficient. 📊💰 #Markets",
    "Identity for machines. @konnex_world gives every robot a verifiable ID. 🆔🤖 #Identity #Web3",
    "Resilient infrastructure that can't be shut down. @konnex_world is robust. 🛡️🦾 #Resilience",
    "Participate in the @konnex_world network and earn passive income from your hardware. 💵💤 #PassiveIncome",
    "The ultimate coordination layer for disaster relief drones. @konnex_world can save lives. 🚑🚁 #TechForGood",
    "Streamlining supply chains one block at a time. @konnex_world 🧱📦 #SupplyChain",
    "The interface for the robot economy. deeply impressed by @konnex_world. 🖥️🤖 #UX #Konnex",
    "Programmable money meeting programmable matter. @konnex_world is the nexus. 💸🧱 #Future",
    "Verifiable computation for robotics. @konnex_world ensures the code ran correctly. 💻✅ #Compute",
    "The energy efficiency of @konnex_world's PoPW is a breath of fresh air. 🍃⚡ #EcoFriendly",
    "Connecting creators, operators, and users in the @konnex_world ecosystem. 🎨🔧👥 #Ecosystem",
    "Automating the mundane so we can focus on the creative. Thanks @konnex_world! 🎨🤖 #Creativity",
    "From 1 to 1000 drones, @konnex_world scales effortlessly. 📈🚁 #Scalability",
    "The documentation for @konnex_world is top notch. Easy to get started! 📚👍 #Docs",
    "Supporting the next generation of hardware entrepreneurs. @konnex_world 🚀🦾 #Startups",
    "A standardized language for physical work. @konnex_world speaks robot. 🗣️🤖 #Standards",
    "Decentralized Uber for robots? That's basically @konnex_world. 🚗🤖 #Disruption",
    "Secure your spot in the @konnex_world network today. Early adopters win! 🥇🏃 #EarlyAdopter",
    "Governance by the community, for the community. @konnex_world DAO. 🏛️👥 #DAO",
    "The reliability of @konnex_world network is key for mission-critical tasks. 🛡️✅ #Reliability",
    "Unlocking liquidity for real-world assets. @konnex_world RWA. 🏘️💧 #RWA #DeFi",
    "Seamless payments across borders for physical services. @konnex_world knows no boundaries. 🌍💸 #Borderless",
    "AI models training on @konnex_world verified data. Better data, better AI. 🧠📈 #AI #Data",
    "The machine economy is here, and it runs on @konnex_world. 🤖🌏 #Konnex",
    "Just set up my first @konnex_world node! Contributing to the physical web. 🖥️🌍 #Node #Konnex",
    "Watching the @konnex_world transaction explorer. Real work happening in real time! 🔍⏱️ #Explorer",
    "The partnership announcements from @konnex_world are bullish! 🐂🤝 #Partnerships",
    "Can't spell Connectivity without Konnex. @konnex_world connecting everything. 🔗😉 #Konnex",
    "The viral potential of autonomous delivery videos on @konnex_world is huge. 📹🚀 #Viral",
    "HODLing my @konnex_world tokens for the long term. The utility is real. 💎🙌 #HODL"
];

function getRandomTweet() {
    return tweetVariations[Math.floor(Math.random() * tweetVariations.length)];
}

async function performAutoPostTwitter(account, proxy, context, cookies, userId, ruleId) {
    const { AppKey: appKey, AppKeySecret: appKeySecret, AccessToken: accessToken, AccessTokenSecret: accessTokenSecret } = account;
    if (!appKey || !appKeySecret || !accessToken || !accessTokenSecret) {
        logger.warn('Twitter credentials missing or empty. Skipping auto post Twitter.', context);
        return;
    }

    logger.info('Starting auto post Twitter process...', context);

    const MAX_RETRIES = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 1) {
                logger.debug(`Retry attempt ${attempt}/${MAX_RETRIES}...`, context);
                await delay(2);
            }

            const oauth = new OAuth({
                consumer: { key: appKey, secret: appKeySecret },
                signature_method: 'HMAC-SHA1',
                hash_function(base_string, key) {
                    return crypto
                        .createHmac('sha1', key)
                        .update(base_string)
                        .digest('base64');
                },
            });

            const oauthCredentials = {
                key: accessToken,
                secret: accessTokenSecret,
            };

            const axiosConfig = proxy ? { httpsAgent: newAgent(proxy), proxy: false } : {};

            const userRequestData = {
                url: 'https://api.twitter.com/2/users/me',
                method: 'GET',
            };

            const userHeaders = oauth.toHeader(oauth.authorize(userRequestData, oauthCredentials));
            const userResponse = await Promise.race([
                axios.get(userRequestData.url, {
                    headers: { ...userHeaders, 'User-Agent': 'Konnex-Bot/1.0' },
                    timeout: 10000,
                    ...axiosConfig
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Twitter API timeout')), 10000))
            ]);

            const username = userResponse.data.data.username;
            logger.debug(`Twitter username: @${username}`, context);

            const tweetText = getRandomTweet();
            logger.debug('Posting tweet...', context);

            const tweetRequestData = {
                url: 'https://api.twitter.com/2/tweets',
                method: 'POST',
            };

            const tweetHeaders = oauth.toHeader(oauth.authorize(tweetRequestData, oauthCredentials));
            const tweetResponse = await Promise.race([
                axios.post(
                    tweetRequestData.url,
                    { text: tweetText },
                    {
                        headers: { ...tweetHeaders, 'Content-Type': 'application/json', 'User-Agent': 'Konnex-Bot/1.0' },
                        timeout: 10000,
                        ...axiosConfig
                    }
                ),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tweet posting timeout')), 10000))
            ]);

            const postId = tweetResponse.data.data.id;
            const postUrl = `https://x.com/${username}/status/${postId}`;

            logger.info(`Posted tweet: ${tweetText}`, context);
            logger.info(`Post URL: ${postUrl}`, context);

            // Complete task and check status
            try {
                await completePostTask(ruleId, postUrl, proxy, context, cookies);

                // Polling for task completion
                logger.info('Verifying task completion...', context);
                let taskCompleted = false;
                const POLLING_ATTEMPTS = 12; // 12 * 10s = 2 minutes
                const POLLING_INTERVAL = 10000;

                for (let i = 0; i < POLLING_ATTEMPTS; i++) {
                    await delay(POLLING_INTERVAL / 1000);
                    const status = await checkTaskStatus(userId, proxy, context, cookies);
                    const postStatus = status.find(s => s.loyaltyRuleId === ruleId);

                    if (postStatus && postStatus.status === 'completed') {
                        taskCompleted = true;
                        logger.success('Post task completed successfully.', context);
                        break;
                    } else {
                        logger.debug(`Task status: ${postStatus ? postStatus.status : 'unknown'}... waiting (${i + 1}/${POLLING_ATTEMPTS})`, context);
                    }
                }

                if (!taskCompleted) {
                    logger.warn('Post task verification timed out (it might still complete later).', context);
                }

            } catch (taskError) {
                logger.warn(`Task completion error: ${taskError.message}`, context);
            }

            // Cleanup tweet
            await deleteTweet(postId, oauth, oauthCredentials, axiosConfig, context);
            return;

        } catch (error) {
            lastError = error;
            logger.error(`Failed to post Twitter: ${error.message}`, context);
            // Logic for retry usually goes here
        }
    }
}

async function deleteTweet(postId, oauth, oauthCredentials, axiosConfig, context) {
    try {
        logger.debug(`Deleting tweet...`, context);
        const deleteRequestData = {
            url: `https://api.twitter.com/2/tweets/${postId}`,
            method: 'DELETE',
        };
        const deleteHeaders = oauth.toHeader(oauth.authorize(deleteRequestData, oauthCredentials));
        await axios.delete(deleteRequestData.url, {
            headers: { ...deleteHeaders, 'User-Agent': 'Konnex-Bot/1.0' },
            timeout: 15000,
            ...axiosConfig
        });
        logger.info('Deleted the tweet to avoid spam.', context);
    } catch (error) {
        logger.error(`Failed to delete tweet: ${error.message}`, context);
    }
}

async function processAccount(account, index, total, proxy) {
    const context = `Acc ${index + 1}`;
    logger.info(`Starting process for ${maskAddress(deriveWalletAddress(account.privateKey))}`, context);

    const { privateKey } = account;
    const address = deriveWalletAddress(privateKey);

    const result = {
        maskedAddress: maskAddress(address),
        success: false,
        checkin: { success: false, message: '' },
        twitter: { success: false, message: '' },
        points: 0,
        error: null
    };

    if (!address) {
        result.error = 'Invalid private key';
        return result;
    }

    const ip = await getPublicIP(proxy, context);
    logger.info(`IP: ${ip}`, context);

    try {
        logger.info('Login...', context);
        const nonceData = await fetchNonce(address, proxy, context);
        if (!nonceData) {
            result.error = 'Failed to fetch nonce';
            return result;
        }

        let currentCookies = [`referral_code=${config.referralCode}`, ...nonceData.setCookie.map(ck => ck.split('; ')[0])];

        const loginResult = await executeLogin(privateKey, address, nonceData.csrfToken, proxy, context, currentCookies);
        if (!loginResult) {
            result.error = 'Login failed';
            return result;
        }

        currentCookies = [...currentCookies, ...loginResult.sessionCookies.map(ck => ck.split('; ')[0])];
        logger.success('Login', context);

        const userId = await getUserSession(proxy, context, currentCookies);
        if (!userId) {
            result.error = 'Failed to retrieve userId';
            return result;
        }

        const initialPoints = await retrieveBalance(address, proxy, context, currentCookies);
        result.points = initialPoints || 0;

        const postRuleId = await fetchPostRuleId(proxy, context, currentCookies);

        logger.info('Checking Daily Claim...', context);
        const checkinResult = await executeDailyCheckin(address, proxy, context, currentCookies);
        if (checkinResult.success) {
            result.checkin = { success: true, message: 'Success' };
        } else {
            result.checkin = { success: false, message: checkinResult.message };
        }

        if (postRuleId) {
            logger.info('Checking Daily Post Task...', context);
            const status = await checkTaskStatus(userId, proxy, context, currentCookies);
            const postStatus = status.find(s => s.loyaltyRuleId === postRuleId);

            if (postStatus && postStatus.status === 'completed') {
                logger.success('Post task already completed.', context);
                result.twitter = { success: true, message: 'Already Done' };
            } else {
                await performAutoPostTwitter(account, proxy, context, currentCookies, userId, postRuleId);
                // Re-check status after attempt
                const finalStatus = await checkTaskStatus(userId, proxy, context, currentCookies);
                const finalPostStatus = finalStatus.find(s => s.loyaltyRuleId === postRuleId);
                if (finalPostStatus && finalPostStatus.status === 'completed') {
                    result.twitter = { success: true, message: 'Success' };
                } else {
                    result.twitter = { success: false, message: 'Failed/Timeout' };
                }
            }
        } else {
            logger.warn("Post rule not found (maybe completed or different name)", context);
            result.twitter = { success: false, message: 'Rule Not Found' };
        }

        // Refresh balance
        result.points = await retrieveBalance(address, proxy, context, currentCookies);
        result.success = true;

    } catch (error) {
        logger.error(`Account processing failed: ${error.message}`, context);
        result.error = error.message;
    }

    return result;
}

function initializeConfig(accounts) {
    // Can be used to validate accounts
}

async function runCycle() {
    const accounts = await readAccounts();
    if (accounts.length === 0) return;

    sessionResults.startTime = new Date();
    sessionResults.accounts = [];

    console.log(chalk.bold.blue(`\n  EZCRYPTOIN KONNEX BOT V1.0`));
    console.log(chalk.cyan(`  =====================`));

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const proxy = account.proxy;
        const result = await processAccount(account, i, accounts.length, proxy);
        sessionResults.accounts.push(result);
    }

    sessionResults.endTime = new Date();
    printSessionSummary();
}

function printSessionSummary() {
    console.log(chalk.cyan.bold('\n=================================================================='));
    console.log(chalk.cyan.bold('                     💎 EZCRYPTOIN KONNEX V1.0 💎                     '));
    console.log(chalk.cyan.bold('=================================================================='));

    const table = new Table({
        head: [
            chalk.cyan('Account'),
            chalk.cyan('Check-In'),
            chalk.cyan('Twitter'),
            chalk.cyan('Points'),
            chalk.cyan('Status')
        ],
        style: {
            head: [],
            border: ['blue']
        }
    });

    let totalPoints = 0;
    let totalCheckins = 0;
    let totalTweets = 0;

    sessionResults.accounts.forEach((res, index) => {
        totalPoints += parseInt(res.points) || 0;
        if (res.checkin.success) totalCheckins++;
        if (res.twitter.success) totalTweets++;

        table.push([
            chalk.white(`Acc ${index + 1}`),
            res.checkin.success ? chalk.green('Success') : chalk.red('Failed'),
            res.twitter.success ? chalk.green('Posted') : chalk.red('Failed'),
            chalk.green(res.points),
            res.success ? chalk.green('Done') : chalk.red('Error')
        ]);
    });

    console.log(table.toString());

    console.log(chalk.cyan('💎 TOTAL: ') +
        chalk.white(`${sessionResults.accounts.length} accounts`) + ' | ' +
        chalk.green(`${totalCheckins} check-in`) + ' | ' +
        chalk.green(`${totalTweets} tweet`) + ' | ' +
        chalk.cyan(`${totalPoints} pts`)
    );
    console.log(chalk.cyan.bold('=================================================================='));
    console.log('');
    logger.info('Cycle completed!', 'Info');
}

// ============================================
// MAIN PROCESS
// ============================================

async function run() {
    console.log(chalk.blue(`
               / \\
              /   \\
             |  |  |
             |  |  |
              \\  \\
             |  |  |
             |  |  |
              \\   /
               \\ /
`));
    console.log(chalk.bold.cyan('    ======EZCRYPTOIN======'));
    console.log(chalk.bold.cyan('  ======EZCRYPTOIN BOT KONNEX V1.0======'));

    const SCHEDULED_HOUR = 7;    // Jam (07:00)
    const SCHEDULED_MINUTE = 30; // Menit (07:30)

    while (true) {
        try {
            await runCycle();
            console.log('');
            // Wait for next schedule
            await waitUntilScheduledTime(SCHEDULED_HOUR, SCHEDULED_MINUTE);
        } catch (cycleError) {
            logger.error(`Cycle error: ${cycleError.message}. Will retry at next scheduled time.`, 'System');
            await waitUntilScheduledTime(SCHEDULED_HOUR, SCHEDULED_MINUTE);
        }
    }
}

// Start the bot
run().catch(error => logger.error(`Fatal error: ${error.message}`, 'System'));
