const puppeteer = require("puppeteer");
const fs = require("fs");
const SESSION_PATH = "./session_data";

let browser, page;
const URL = "https://www.my11circle.com/mecspa/lobby";

const launchBrowser = async (forLogin = false) => {
  if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH);
  browser = await puppeteer.launch({
    headless: forLogin ? false : "new",
    userDataDir: SESSION_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  await page.goto(URL, { waitUntil: "networkidle2" });
};

const isLoggedIn = async () => {
  try {
    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForSelector("div[testid='ft_Tabs_Upcoming']", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

const closeBrowser = async () => {
  if (browser) await browser.close();
};

const getPage = () => page;

module.exports = { launchBrowser, isLoggedIn, closeBrowser, getPage };
