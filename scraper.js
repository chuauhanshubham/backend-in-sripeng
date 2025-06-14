const cheerio = require("cheerio");
const { getPage } = require("./browser");

const scrapeMatches = async (tabTestId) => {
  const page = getPage();
  const tabSelector = `div[testid='${tabTestId}']`;

  const isTabInactive = await page.evaluate((selector) => {
    const tab = document.querySelector(selector);
    return tab && tab.classList.contains("ft-tab-inactive");
  }, tabSelector);

  if (isTabInactive) {
    await Promise.all([
      page.click(tabSelector),
      page.waitForFunction(
        (selector) => !document.querySelector(selector)?.classList.contains('ft-tab-inactive'),
        {}, tabSelector
      ),
      page.waitForSelector("div[id^='ft-fixture-card-new']", { timeout: 5000 }),
    ]);
  } else {
    await page.waitForSelector("div[id^='ft-fixture-card-new']", { timeout: 5000 });
  }

  const html = await page.content();
  const $ = cheerio.load(html);
  const matches = [];

  $("div[id^='ft-fixture-card-new']").each((_, el) => {
    const matchId = $(el).attr("matchid");
    const seriesName = $(el).find(".fixture-card-header").text().trim();
    const teamAName = $(el).find("span[testid^='team-a']").text().trim();
    const teamALogo = $(el).find("div#ft-team-badge .flag-containerNew img").first().attr("src");
    const teamBName = $(el).find("span[testid^='team-b']").text().trim();
    const teamBLogo = $(el).find("div#ft-team-badge .flag-containerNew img").last().attr("src");
    const matchTime = $(el).find("div[testid^='match-status']").text().trim();

    matches.push({ matchId, seriesName, teamA: teamAName, teamALogo, teamB: teamBName, teamBLogo, matchTime });
  });
  return matches;
};

module.exports = { scrapeMatches };
