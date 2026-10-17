import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright-core";
import { Browserbase } from "@browserbasehq/sdk";

const UBER_RIDE_URL = "https://www.uber.com/gb/en/ride/";
const CONTEXT_SAVE_DELAY_MS = 5_000;
const CDP_HEARTBEAT_INTERVAL_MS = 60 * 1_000;

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.BROWSERBASE_API_KEY;
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
}

async function openPersistentSession(browserbase, projectId, contextId) {
  const session = await browserbase.sessions.create({
    projectId,
    browserSettings: { context: { id: contextId, persist: true } },
  });
  let browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Browserbase connected, but no default browser context was available.");
    const page = context.pages()[0] ?? (await context.newPage());
    const liveView = await browserbase.sessions.debug(session.id);
    if (!liveView.debuggerFullscreenUrl) throw new Error("Browserbase did not return a Live View URL for the session.");
    return { browser, context, page, liveViewUrl: liveView.debuggerFullscreenUrl };
  } catch (error) {
    if (browser) await browser.close().catch(() => console.error("Could not close browser after setup failed."));
    throw error;
  }
}

async function openUberPage(page) {
  const response = await page.goto(UBER_RIDE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  return { status: response?.status() ?? null, finalUrl: page.url() };
}

async function getUberCookieCount(context) {
  return (await context.cookies([UBER_RIDE_URL])).length;
}

async function questionWithHeartbeat(readline, page, prompt) {
  const heartbeat = setInterval(() => {
    page.evaluate(() => undefined).catch(() => clearInterval(heartbeat));
  }, CDP_HEARTBEAT_INTERVAL_MS);
  try { return await readline.question(prompt); }
  finally { clearInterval(heartbeat); }
}

function printNavigationResult(label, result) {
  const status = result.status === null ? "not provided" : String(result.status);
  const pageUrl = new URL(result.finalUrl);
  console.log(`${label}: navigation completed; HTTP status ${status}.`);
  console.log(`Page location: ${pageUrl.origin}${pageUrl.pathname}`);
}

async function main() {
  if (!stdin.isTTY) throw new Error("Run this command in an interactive terminal so you can use Live View.");
  const apiKey = getRequiredEnv("BROWSERBASE_API_KEY");
  const projectId = getRequiredEnv("BROWSERBASE_PROJECT_ID");
  const contextId = getRequiredEnv("BROWSERBASE_CONTEXT_ID");
  const browserbase = new Browserbase({ apiKey });
  const readline = createInterface({ input: stdin, output: stdout });
  let activeBrowser;
  try {
    console.log("Starting Browserbase connectivity and persistent-session verification.");
    console.log("No password or verification-code entry will be automated.");
    const first = await openPersistentSession(browserbase, projectId, contextId);
    activeBrowser = first.browser;
    console.log("\nFirst session Live View (do not share this link):");
    console.log(first.liveViewUrl);
    printNavigationResult("First session", await openUberPage(first.page));
    console.log(`Uber-origin cookies before manual login: ${await getUberCookieCount(first.context)}`);
    await questionWithHeartbeat(readline, first.page, "\nUse Live View to sign in manually if needed. When ready, return here and press Enter to save this session: ");
    const firstCookieCount = await getUberCookieCount(first.context);
    console.log(`Uber-origin cookies before closing the first session: ${firstCookieCount}`);
    await activeBrowser.close();
    activeBrowser = undefined;
    console.log(`Waiting ${CONTEXT_SAVE_DELAY_MS / 1_000} seconds for Browserbase to save the context...`);
    await new Promise(resolve => setTimeout(resolve, CONTEXT_SAVE_DELAY_MS));
    const second = await openPersistentSession(browserbase, projectId, contextId);
    activeBrowser = second.browser;
    console.log("\nSecond session Live View (do not share this link):");
    console.log(second.liveViewUrl);
    printNavigationResult("Second session", await openUberPage(second.page));
    const secondCookieCount = await getUberCookieCount(second.context);
    console.log(`Uber-origin cookies after reopening the context: ${secondCookieCount}`);
    const answer = await questionWithHeartbeat(readline, second.page, "In the second Live View, is the Uber account already signed in? [y/N] ");
    const confirmedSignedIn = answer.trim().toLowerCase() === "y";
    const cookieDataPersisted = firstCookieCount > 0 && secondCookieCount > 0;
    console.log("\nVerification summary");
    console.log("- Browserbase + Playwright connection: passed");
    console.log(`- Uber cookie data present before and after reopening: ${cookieDataPersisted ? "yes" : "no"}`);
    console.log(`- Signed-in state confirmed in second Live View: ${confirmedSignedIn ? "yes" : "no"}`);
    if (!confirmedSignedIn) console.log("The account's authenticated state was not confirmed as persistent.");
  } finally {
    if (activeBrowser) await activeBrowser.close().catch(() => console.error("Could not close the active browser connection cleanly."));
    readline.close();
  }
}

main().catch(error => {
  console.error(`Browser verification failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
