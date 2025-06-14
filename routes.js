const express = require("express");
const router = express.Router();
const fs = require("fs");
const cheerio = require("cheerio");
const { getPage, closeBrowser } = require("./browser");

const SESSION_PATH = "./session_data";

// ✅ Session Reset API
router.get("/reset-session", async (req, res) => {
  await closeBrowser();
  fs.rmSync(SESSION_PATH, { recursive: true, force: true });
  res.send("✅ Session Reset Done");
});

// ✅ MATCH DETAILS API WITH RETRY AND FULL SCRAPING
app.get("/match-details/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const matchUrl = `https://www.my11circle.com/mecspa/lobby/live-contests/${matchId}`;
  let retries = 3;
  let data = {};

  while (retries > 0) {
    try {
      await page.goto(matchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector(".page_coninner_autoheight", { timeout: 15000 });

      const content = await page.content();
      const $ = cheerio.load(content);
      const container = $('.page_coninner_autoheight');

      // ✅ Team Details
      const teamA = container.find(".sc-headTeamInfo .sc-teamInfoName").first().text().trim() || "N/A";
      const teamB = container.find(".sc-headTeamInfo .sc-teamInfoName").last().text().trim() || "N/A";

      // ✅ Team Score extraction FIXED
      const scoreText = container.find(".text-black-50.small.text-center div div").first().text().trim() || "N/A";
      const teamAScore = scoreText.split('(')[0].trim();   // e.g., "DA CC 74/2"
      const currentScore = scoreText;

      // ✅ Batsman Data
      const batsmen = [];
      container.find(".batsmen .batsman").each((i, el) => {
        const name = $(el).find(".name").text().trim();
        const runs = $(el).find(".runs").text().trim();
        const balls = $(el).find(".ball").text().trim();
        if (name) batsmen.push({ name, runs, balls });
      });

      // ✅ Bowler Data FIX - overs ka sahi selector
      const bowlers = [];
      container.find(".bowlers .bowler").each((i, el) => {
        const name = $(el).find(".name").text().trim();
        const wickets = $(el).find(".wickets").text().trim();
        const overs = $(el).find(".ball").text().trim(); // overs yaha milta hai
        if (name) bowlers.push({ name, wickets, overs });
      });

      // ✅ This Over data
      const thisOver = [];
      container.find(".score-book .delivery").each((i, el) => {
        thisOver.push($(el).text().trim());
      });

      // ✅ Final JSON
      data = {
        teamA,
        teamB,
        teamAScore,
        currentScore,
        batsmen,
        bowlers,
        thisOver
      };
      break;  // ✅ Success
    } catch (err) {
      console.log("Retrying... Remaining:", retries - 1);
      retries--;
      if (retries === 0) {
        console.error("❌ Player Scraping Error:", err.message);
        return res.status(500).json({ message: "❌ Failed to fetch match details" });
      }
    }
  }

  res.json(data);
});


module.exports = router;
