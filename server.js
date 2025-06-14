const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require("cheerio");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { ref, set, push, update, get } = require("firebase/database");
const database = require("./firebase");
const fs = require("fs");
const path = require("path");
const rateLimit = require('express-rate-limit');

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const app = express();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(limiter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "http://localhost:3000" } });

const URL = "https://www.my11circle.com/mecspa/lobby";
const SESSION_PATH = path.join(__dirname, "session_data");
let browser, page;
let isScraping = false;

// Firebase Paths
const FIREBASE_PATHS = {
  MATCHES: 'matches',
  LIVE_MATCHES: 'live_matches',
  COMPLETED_MATCHES: 'completed_matches',
  PLAYER_DATA: 'player_data',
  CONTESTS: 'contests',
  SCOREBOARDS: 'scoreboards',
  TEAMS: 'teams',
  FIXTURES: 'fixtures'
};

// Enhanced Firebase Operations with retries
const firebase = {
  set: async (path, data, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await set(ref(database, path), {
          ...data,
          lastUpdated: new Date().toISOString()
        });
        console.log(`✅ Firebase set: ${path}`);
        return true;
      } catch (error) {
        console.error(`🔥 Firebase error (${path}) attempt ${attempt}:`, error.message);
        if (attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  },
  
  push: async (path, data, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const newRef = push(ref(database, path));
        await set(newRef, {
          ...data,
          createdAt: new Date().toISOString()
        });
        console.log(`✅ Firebase push: ${path}`);
        return newRef.key;
      } catch (error) {
        console.error(`🔥 Firebase error (${path}) attempt ${attempt}:`, error.message);
        if (attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  },
  
  update: async (path, updates, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await update(ref(database, path), {
          ...updates,
          lastUpdated: new Date().toISOString()
        });
        console.log(`✅ Firebase update: ${path}`);
        return true;
      } catch (error) {
        console.error(`🔥 Firebase error (${path}) attempt ${attempt}:`, error.message);
        if (attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  },
  
  get: async (path, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const snapshot = await get(ref(database, path));
        return snapshot.exists() ? snapshot.val() : null;
      } catch (error) {
        console.error(`🔥 Firebase get error (${path}) attempt ${attempt}:`, error.message);
        if (attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
};

// Utility Functions
async function dismissPopups(page) {
  try {
    await page.waitForSelector('.close-button, .modal-close', { timeout: 5000 });
    await page.click('.close-button, .modal-close');
    console.log('Dismissed popup');
  } catch (e) {
    // No popup found
  }
}

async function verifyPageContent(page, expectedText) {
  await page.waitForFunction((text) => {
    return document.body.textContent.includes(text);
  }, { timeout: 30000 }, expectedText);
}

async function waitForContestCards(page) {
  const selectors = [
    'div[id="ft-contest-card"]',
    'div[class*="contest-card"]',
    'div[testid*="contest-card"]'
  ];
  
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 30000 });
      return true;
    } catch (e) {
      continue;
    }
  }
  throw new Error('No contest cards found');
}

async function waitForScorebook(page) {
  const selectors = [
    '.score-book',
    '.score-container',
    '.match-score'
  ];
  
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 30000 });
      return true;
    } catch (e) {
      continue;
    }
  }
  throw new Error('No scorebook elements found');
}

// Browser Management with enhanced error handling and retries
const launchBrowser = async (forLogin = false, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!fs.existsSync(SESSION_PATH)) {
        fs.mkdirSync(SESSION_PATH, { recursive: true });
      }

      const browserOptions = {
        headless: forLogin ? false : "new",
        userDataDir: SESSION_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-blink-features=AutomationControlled"
        ],
        defaultViewport: null,
        ignoreHTTPSErrors: true
      };

      browser = await puppeteer.launch(browserOptions);
      page = await browser.newPage();

      // Randomize user agent
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      ];
      const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      
      await page.setUserAgent(randomUserAgent);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      });

      // Block unnecessary resources
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(URL, { 
        waitUntil: "networkidle2", 
        timeout: 60000,
        referer: 'https://www.my11circle.com/'
      });

      return true;
    } catch (error) {
      console.error(`🚨 Browser launch attempt ${attempt} failed:`, error);
      if (browser) await browser.close();
      if (attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
};

const checkBrowser = async (retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!browser || !browser.isConnected()) {
        console.log("🔄 Relaunching Browser...");
        if (browser) await browser.close();
        await launchBrowser();
      }
      
      if (!page || page.isClosed()) {
        page = await browser.newPage();
      }
      
      return true;
    } catch (error) {
      console.error(`Browser check attempt ${attempt} failed:`, error);
      if (attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
    }
  }
};

const isLoggedIn = async (retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await checkBrowser();
      await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector("div[testid='ft_Tabs_Upcoming']", { timeout: 30000 });
      return true;
    } catch (error) {
      console.log(`Login check attempt ${attempt} failed:`, error.message);
      if (attempt >= retries) return false;
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
};

// Enhanced Scraping Functions with retry logic and proper error handling
const scrapeMatches = async (tabTestId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await checkBrowser();
      const tabSelector = `div[testid='${tabTestId}']`;
      
      const isTabInactive = await page.evaluate((selector) => {
        const tab = document.querySelector(selector);
        return tab && tab.classList.contains("ft-tab-inactive");
      }, tabSelector);

      if (isTabInactive) {
        await Promise.all([
          page.click(tabSelector),
          page.waitForFunction((selector) => 
            !document.querySelector(selector)?.classList.contains('ft-tab-inactive'), 
            {}, tabSelector
          ),
          page.waitForSelector("div[id^='ft-fixture-card-new']", { timeout: 30000 }),
        ]);
      }

      await page.waitForSelector("div[id^='ft-fixture-card-new']", { timeout: 30000 });
      const html = await page.content();
      const $ = cheerio.load(html);
      const matches = [];

      $("div[id^='ft-fixture-card-new']").each((_, el) => {
        try {
          const matchId = $(el).attr("matchid");
          const seriesName = $(el).find(".fixture-card-header").text().trim();
          const teamAName = $(el).find("span[testid^='team-a']").text().trim();
          const teamALogo = $(el).find("div#ft-team-badge .flag-containerNew img").first().attr("src");
          const teamBName = $(el).find("span[testid^='team-b']").text().trim();
          const teamBLogo = $(el).find("div#ft-team-badge .flag-containerNew img").last().attr("src");
          const matchTime = $(el).find("div[testid^='match-status']").text().trim();
          const matchStatus = tabTestId.replace('ft_Tabs_', '').toLowerCase();

          const matchData = { 
            matchId, 
            seriesName, 
            teams: {
              A: { name: teamAName, logo: teamALogo },
              B: { name: teamBName, logo: teamBLogo }
            },
            matchTime,
            status: matchStatus,
            lastUpdated: new Date().toISOString()
          };

          matches.push(matchData);
        } catch (error) {
          console.error('Error parsing match card:', error);
        }
      });

      if (!matches.length) throw new Error('No matches found');

      const statusPath = tabTestId.replace('ft_Tabs_', '').toLowerCase();
      await firebase.set(`${FIREBASE_PATHS.FIXTURES}/${statusPath}`, matches);
      
      return matches;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${tabTestId}:`, error.message);
      if (attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
      await page.reload();
    }
  }
};

const scrapeLiveMatchDetails = async (matchId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const detailPage = await browser.newPage();
    try {
      await detailPage.goto(`https://www.my11circle.com/mecspa/lobby/live-contests/${matchId}`, {
        waitUntil: "networkidle2",
        timeout: 40000
      });
      
      await dismissPopups(detailPage);
      await waitForScorebook(detailPage);
      
      const content = await detailPage.content();
      const $ = cheerio.load(content);

      // Extract match details
      const teamA = $(".sc-headTeamInfo .sc-teamInfoName").first().text().trim();
      const teamB = $(".sc-headTeamInfo .sc-teamInfoName").last().text().trim();
      const matchTitle = $(".sc-headTeamInfo .sc-match-title").text().trim();

      // Extract batsmen data
      const batsmen = [];
      $(".batsmen .batsman").each((i, el) => {
        try {
          batsmen.push({
            name: $(el).find(".name").text().trim(),
            runs: $(el).find(".runs").text().trim() || '0',
            balls: $(el).find(".ball").text().trim() || '0',
            fours: $(el).find(".fours").text().trim() || '0',
            sixes: $(el).find(".sixes").text().trim() || '0',
            strike: $(el).hasClass('strike')
          });
        } catch (error) {
          console.error('Error parsing batsman:', error);
        }
      });

      // Extract bowlers data
      const bowlers = [];
      $(".bowlers .bowler").each((i, el) => {
        try {
          bowlers.push({
            name: $(el).find(".name").text().trim(),
            wickets: $(el).find(".wickets").text().trim() || '0',
            overs: $(el).find(".ball").text().trim() || '0',
            runs: $(el).find(".runs").text().trim() || '0',
            maidens: $(el).find(".maidens").text().trim() || '0'
          });
        } catch (error) {
          console.error('Error parsing bowler:', error);
        }
      });

      // Current over data
      const thisOver = [];
      $(".score-book .delivery").each((i, el) => {
        thisOver.push($(el).text().trim());
      });

      // Match summary
      const summary = {
        score: $(".match-summary .score").text().trim() || '0/0',
        overs: $(".match-summary .overs").text().trim() || '0.0',
        runRate: $(".match-summary .run-rate").text().trim() || '0.00'
      };

      const result = {
        matchId,
        title: matchTitle,
        teams: { A: teamA, B: teamB },
        isLive: true,
        batsmen,
        bowlers,
        thisOver,
        summary,
        timestamp: new Date().toISOString()
      };

      await firebase.set(`${FIREBASE_PATHS.LIVE_MATCHES}/${matchId}`, result);
      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for live match ${matchId}:`, error.message);
      if (attempt >= retries) throw error;
    } finally {
      await detailPage.close();
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
};

const scrapeContests = async (matchId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const contestPage = await browser.newPage();
    try {
      await contestPage.goto(`https://www.my11circle.com/mecspa/lobby/contests/${matchId}`, {
        waitUntil: "networkidle2",
        timeout: 40000
      });
      
      await dismissPopups(contestPage);
      await verifyPageContent(contestPage, 'Contests');
      await waitForContestCards(contestPage);
      
      const content = await contestPage.content();
      const $ = cheerio.load(content);
      const contests = [];

      $('div[id="ft-contest-card"]').each((_, el) => {
        try {
          const contestId = $(el).attr('id').replace('ft-contest-card-', '');
          const name = $(el).find('.contestRewampLeftHeader').text().trim() || "Unnamed Contest";
          const totalPrize = $(el).find('[testid^="newContestCardPrizeAmount"]').text().trim() || "0";
          
          const entryText = $(el).find('[testid^="entry-fee"]').text().trim();
          const entryFee = entryText === "Free" ? "0" : entryText;
          
          const winnersText = $(el).find('[testid^="newContestnoOfWinners"]').text().replace('Winners :', '').trim();
          const winners = winnersText || "0";
          
          const teamsText = $(el).find('[testid^="wc-ps-teams-joined-count"]').text();
          const teamsJoined = {
            current: teamsText.match(/\d+/g)?.[0]?.replace(/,/g, '') || "0",
            max: teamsText.match(/\d+/g)?.[1]?.replace(/,/g, '') || "0"
          };
          
          const progress = $(el).find('.progress-bar').attr('style')?.match(/\d+\.?\d*/)?.[0] || "0";
          const type = entryText === "Free" ? "PRACTICE" : "CASH";

          const contest = {
            contestId,
            matchId,
            name,
            totalPrize: type === "PRACTICE" ? "Practice Contest" : totalPrize,
            entryFee,
            winners,
            teamsJoined,
            progress,
            type,
            timestamp: new Date().toISOString()
          };

          contests.push(contest);
        } catch (error) {
          console.error('Error parsing contest:', error);
        }
      });

      if (!contests.length) throw new Error('No contests found');

      const result = { matchId, contests, timestamp: new Date().toISOString() };
      await firebase.set(`${FIREBASE_PATHS.CONTESTS}/${matchId}`, result);
      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for contests ${matchId}:`, error.message);
      if (attempt >= retries) throw error;
    } finally {
      await contestPage.close();
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
};

const scrapeScoreboard = async (matchId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const detailPage = await browser.newPage();
    try {
      await detailPage.goto(`https://www.my11circle.com/mecspa/lobby/scoreboard/${matchId}`, {
        waitUntil: "networkidle2",
        timeout: 40000
      });
      
      await detailPage.waitForSelector(".page_coninner_autoheight", { timeout: 30000 });
      const content = await detailPage.content();
      const $ = cheerio.load(content);
      const container = $('.page_coninner_autoheight');

      const matchDetails = {
        matchId,
        teams: {
          A: container.find(".sc-headTeamInfo .sc-teamInfoName").first().text().trim(),
          B: container.find(".sc-headTeamInfo .sc-teamInfoName").last().text().trim()
        },
        currentScore: container.find(".text-black-50.small.text-center").text().trim(),
        innings: [],
        timestamp: new Date().toISOString()
      };

      // Scrape Each Innings
      container.find(".inning-banner").each((i, el) => {
        try {
          const innings = {
            teamName: $(el).find(".team-name").text().trim(),
            score: $(el).find(".inning-score .score").text().trim(),
            runRate: $(el).find(".inning-run-rate").text().trim(),
            batsmen: [],
            bowlers: [],
            extras: $(el).next(".innings-card").find(".row.header .col-2").text().trim() || '0',
            total: $(el).next(".innings-card").find(".row.total .col-5 span").text().trim() || '0/0',
          };

          // Batsmen
          $(el).next(".innings-card").find(".score-table .row:not(.header)").each((j, row) => {
            try {
              const batsman = {
                name: $(row).find(".col-6 div").first().text().trim(),
                status: $(row).find(".col-6 .status").text().trim() || 'Not out',
                runs: $(row).find(".col-1.runs").text().trim() || '0',
                balls: $(row).find(".col-1").eq(1).text().trim() || '0',
                fours: $(row).find(".col-1").eq(2).text().trim() || '0',
                sixes: $(row).find(".col-1").eq(3).text().trim() || '0',
                strikeRate: $(row).find(".col-2").text().trim() || '0.00',
              };
              innings.batsmen.push(batsman);
            } catch (error) {
              console.error('Error parsing batsman:', error);
            }
          });

          // Bowlers
          $(el).next(".innings-card").find(".score-table:last .row:not(.header)").each((j, row) => {
            try {
              const bowler = {
                name: $(row).find(".col-6 div").first().text().trim(),
                overs: $(row).find(".col-1").eq(0).text().trim() || '0',
                maidens: $(row).find(".col-1").eq(1).text().trim() || '0',
                runs: $(row).find(".col-1").eq(2).text().trim() || '0',
                wickets: $(row).find(".col-1").eq(3).text().trim() || '0',
                economy: $(row).find(".col-2").text().trim() || '0.00',
              };
              innings.bowlers.push(bowler);
            } catch (error) {
              console.error('Error parsing bowler:', error);
            }
          });

          matchDetails.innings.push(innings);
        } catch (error) {
          console.error('Error parsing innings:', error);
        }
      });

      if (!matchDetails.innings.length) throw new Error('No innings data found');

      await firebase.set(`${FIREBASE_PATHS.SCOREBOARDS}/${matchId}`, matchDetails);
      return matchDetails;
    } catch (error) {
      console.error(`Attempt ${attempt} failed for scoreboard ${matchId}:`, error.message);
      if (attempt >= retries) throw error;
    } finally {
      await detailPage.close();
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
};

const scrapeTeamPlayers = async (matchId, contestId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const playerPage = await browser.newPage();
    try {
      // Optimize performance
      await playerPage.setRequestInterception(true);
      playerPage.on('request', (req) => {
        const blocked = ['image', 'stylesheet', 'font', 'script'];
        blocked.includes(req.resourceType()) ? req.abort() : req.continue();
      });

      await playerPage.setViewport({ width: 1366, height: 768 });
      await playerPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      );

      const url = `https://www.my11circle.com/mecspa/lobby/create-team-new/${matchId}/${contestId}`;
      console.log(`🌐 Navigating to: ${url}`);

      await playerPage.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
        referer: 'https://www.my11circle.com/',
      });

      // Check if login is needed
      const loginRequired = await playerPage.evaluate(() => {
        return !!document.querySelector('input[name="mobile"]');
      });
      if (loginRequired) throw new Error('Login required. Open browser and login manually.');

      // Wait for category tabs and first player card
      await playerPage.waitForFunction(() => {
        return document.querySelector('.player-category-tabs') && document.querySelector('.player-box');
      }, { timeout: 30000 });

      const categories = await playerPage.$$eval('.player-category-tabs .nav-item', (tabs) =>
        tabs.map((tab) => tab.dataset.filter)
      );

      const allPlayers = [];

      for (const category of categories) {
        try {
          console.log(`🔄 Extracting category: ${category}`);
          await playerPage.click(`.player-category-tabs [data-filter="${category}"]`);
          await playerPage.waitForTimeout(1000);

          // Scroll down to load all players
          await playerPage.evaluate(async () => {
            await new Promise((resolve) => {
              let totalHeight = 0;
              const distance = 300;
              const interval = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= document.body.scrollHeight) {
                  clearInterval(interval);
                  resolve();
                }
              }, 100);
            });
          });

          // Extract player details
          const players = await playerPage.$$eval('.player-box', (boxes, cat) => {
            return boxes.map((player) => {
              const getText = (selector) => player.querySelector(selector)?.textContent.trim() || '';
              const imgSrc = player.querySelector('.player-img img')?.src || '';
              const playerId = imgSrc.match(/players\/(\d+)/)?.[1] || '';

              return {
                playerId,
                name: getText('.player-name'),
                team: getText('.team-name').replace('Team:', '').trim(),
                role: cat.replace('ft_', '').toUpperCase(),
                credits: parseFloat(getText('.player-credits')) || 0,
                points: parseFloat(getText('.player-points')) || 0,
                selectedBy: getText('.selected-by'),
                recentPerformance: Array.from(player.querySelectorAll('.recent-performance span'))
                  .map((span) => span.textContent.trim())
                  .filter(Boolean),
                isSelected: player.classList.contains('selected'),
              };
            });
          }, category);

          console.log(`✅ Found ${players.length} in ${category}`);
          allPlayers.push(...players);
        } catch (err) {
          console.warn(`⚠️ Failed category: ${category}`, err.message);
        }
      }

      if (!allPlayers.length) throw new Error('No players found. Possibly blocked or not logged in.');

      const categorizedPlayers = {
        WK: allPlayers.filter((p) => p.role === 'WK'),
        BAT: allPlayers.filter((p) => p.role === 'BAT'),
        ALL: allPlayers.filter((p) => ['ALLR', 'ALL-R', 'ALL'].includes(p.role)),
        BOWL: allPlayers.filter((p) => p.role === 'BOWL'),
      };

      const result = {
        matchId,
        contestId,
        players: categorizedPlayers,
        totalPlayers: allPlayers.length,
        timestamp: new Date().toISOString(),
      };

      await firebase.set(`${FIREBASE_PATHS.PLAYER_DATA}/${matchId}/${contestId}`, result);
      return result;
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed: ${error.message}`);
      if (attempt >= retries) throw error;
      await playerPage.screenshot({ path: `error_${Date.now()}.png` });
    } finally {
      playerPage.off('request');
      await playerPage.close();
      await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
    }
  }
};

// API Endpoints with proper error handling
app.get("/api/match/:matchId/:contestId", async (req, res) => {
  try {
    const { matchId, contestId } = req.params;
    const cachedData = await firebase.get(`${FIREBASE_PATHS.PLAYER_DATA}/${matchId}/${contestId}`);
    
    if (cachedData && (new Date() - new Date(cachedData.timestamp)) < 300000) {
      return res.json(cachedData);
    }

    const data = await scrapeTeamPlayers(matchId, contestId);
    res.json(data);
  } catch (err) {
    console.error("❌ Player Data Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch player data. Please ensure you're logged in."
    });
  }
});

app.get("/live-matches/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const cachedData = await firebase.get(`${FIREBASE_PATHS.LIVE_MATCHES}/${matchId}`);
    
    if (cachedData && (new Date() - new Date(cachedData.timestamp)) < 60000) {
      return res.json(cachedData);
    }
    
    const data = await scrapeLiveMatchDetails(matchId);
    res.json(data);
  } catch (err) {
    console.error("❌ Live Match Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch live match data" 
    });
  }
});

app.get("/contests/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const cachedData = await firebase.get(`${FIREBASE_PATHS.CONTESTS}/${matchId}`);
    
    if (cachedData && (new Date() - new Date(cachedData.timestamp)) < 300000) {
      return res.json(cachedData);
    }
    
    const data = await scrapeContests(matchId);
    res.json(data);
  } catch (err) {
    console.error("❌ Contest Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch contest data" 
    });
  }
});

app.get("/scoreboard/:matchId", async (req, res) => {
  try {
    const { matchId } = req.params;
    const cachedData = await firebase.get(`${FIREBASE_PATHS.SCOREBOARDS}/${matchId}`);
    
    if (cachedData && (new Date() - new Date(cachedData.timestamp)) < 300000) {
      return res.json(cachedData);
    }
    
    const data = await scrapeScoreboard(matchId);
    res.json(data);
  } catch (err) {
    console.error("❌ Scoreboard Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch scoreboard data" 
    });
  }
});

app.get("/upcoming-matches", async (req, res) => {
  try {
    const cachedData = await firebase.get(`${FIREBASE_PATHS.FIXTURES}/upcoming`);
    
    if (cachedData && (new Date() - new Date(cachedData[0]?.timestamp)) < 300000) {
      return res.json(cachedData);
    }
    
    const data = await scrapeMatches("ft_Tabs_Upcoming");
    res.json(data);
  } catch (err) {
    console.error("❌ Upcoming Matches Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch upcoming matches" 
    });
  }
});

app.get("/live-matches", async (req, res) => {
  try {
    const cachedData = await firebase.get(`${FIREBASE_PATHS.FIXTURES}/live`);
    
    if (cachedData && (new Date() - new Date(cachedData[0]?.timestamp)) < 60000) {
      return res.json(cachedData);
    }
    
    const data = await scrapeMatches("ft_Tabs_Live");
    res.json(data);
  } catch (err) {
    console.error("❌ Live Matches Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch live matches" 
    });
  }
});

app.get("/completed-matches", async (req, res) => {
  try {
    const cachedData = await firebase.get(`${FIREBASE_PATHS.FIXTURES}/completed`);
    
    if (cachedData && (new Date() - new Date(cachedData[0]?.timestamp)) < 3600000) {
      return res.json(cachedData);
    }
    
    const data = await scrapeMatches("ft_Tabs_Completed");
    res.json(data);
  } catch (err) {
    console.error("❌ Completed Matches Error:", err.message);
    res.status(500).json({ 
      error: err.message,
      message: "Failed to fetch completed matches" 
    });
  }
});

// Background Scraping with better scheduling and error handling
const startScraping = () => {
  if (isScraping) return;
  isScraping = true;
  
  const scrapeAll = async () => {
    try {
      console.log('🔄 Starting background scraping cycle...');
      await checkBrowser();
      
      // Scrape matches in parallel
      const [upcoming, live, completed] = await Promise.all([
        scrapeMatches("ft_Tabs_Upcoming").catch(e => {
          console.error('Upcoming matches scrape failed:', e.message);
          return [];
        }),
        scrapeMatches("ft_Tabs_Live").catch(e => {
          console.error('Live matches scrape failed:', e.message);
          return [];
        }),
        scrapeMatches("ft_Tabs_Completed").catch(e => {
          console.error('Completed matches scrape failed:', e.message);
          return [];
        })
      ]);
      
      // Scrape details for live matches
      if (live && live.length > 0) {
        await Promise.all(live.map(async (match) => {
          try {
            await Promise.all([
              scrapeLiveMatchDetails(match.matchId).catch(e => 
                console.error(`Live details for ${match.matchId} failed:`, e.message)
              ),
              scrapeContests(match.matchId).catch(e => 
                console.error(`Contests for ${match.matchId} failed:`, e.message)
              )
            ]);
          } catch (error) {
            console.error(`Error processing live match ${match.matchId}:`, error.message);
          }
        }));
      }
      
      console.log('✅ Background scraping completed');
    } catch (error) {
      console.error('❌ Background scraping error:', error.message);
    } finally {
      setTimeout(scrapeAll, 30000); // Run every 30 seconds
    }
  };
  
  scrapeAll();
};

// Server Startup with proper initialization
const startServer = async () => {
  try {
    console.log('🚀 Starting server...');
    
    // Launch browser and check login
    const browserLaunched = await launchBrowser();
    if (!browserLaunched) {
      throw new Error('Failed to launch browser');
    }
    
    const loggedIn = await isLoggedIn();
    if (!loggedIn) {
      console.log("🔑 Login Required! Opening browser for login...");
      if (browser) await browser.close();
      await launchBrowser(true);
      console.log("👉 Please login in the browser window and restart the server.");
      return;
    }
    
    console.log("✅ Logged In. Starting background scraping...");
    startScraping();
    
    server.listen(5000, () => {
      console.log("🚀 Server running on http://localhost:5000");
      console.log("📡 WebSocket server ready for real-time updates");
    });
  } catch (error) {
    console.error('🚨 Server startup error:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log('🛑 Shutting down gracefully...');
  isScraping = false;
  
  try {
    if (browser) await browser.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Shutdown error:', error);
    process.exit(1);
  }
});

// Start the server
startServer();
const PORT = process.env.PORT || 5000;