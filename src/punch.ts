import { chromium, errors, Page } from "playwright";
import * as dotenv from "dotenv";

dotenv.config();

const punchType = process.env.PUNCH_TYPE as "上班" | "下班";
const isProduction = process.env.IS_PRODUCTION === "true";

async function main(punchType: "上班" | "下班") {
  const startTime = new Date();
  console.log(`${formatDateTime()} => 開始執行 [${punchType}] 打卡`);

  // Launch browser
  const browser = await chromium.launch({
    headless: isProduction,
    devtools: !isProduction,
    args: ["--use-fake-ui-for-media-stream"], // Allow media stream access
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Debugging: Log environment variables
    console.log(`${formatDateTime()} => Debugging environment variables:`);
    console.log(`COMPANY_ID: ${process.env.COMPANY_ID}`);
    console.log(`EMPLOYEE_ID: ${process.env.EMPLOYEE_ID}`);
    console.log(`PASSWORD: ${process.env.PASSWORD ? "****" : "NOT SET"}`);

    console.log(`${formatDateTime()} => Navigating to login page...`);
    await page.goto("https://portal.nueip.com/login");
    console.log(`${formatDateTime()} => Login page loaded.`);

    // Fill in login form
    console.log(`${formatDateTime()} => Filling login form...`);
    await page.getByRole("textbox", { name: "公司代碼" }).fill(process.env.COMPANY_ID || "");
    console.log(`${formatDateTime()} => Filled 公司代碼.`);

    await page.getByRole("textbox", { name: "員工編號" }).fill(process.env.EMPLOYEE_ID || "");
    console.log(`${formatDateTime()} => Filled 員工編號.`);

    await page.getByPlaceholder("密碼").fill(process.env.PASSWORD || "");
    console.log(`${formatDateTime()} => Filled 密碼.`);

    console.log(`${formatDateTime()} => Submitting login form...`);
    await page.getByRole("button", { name: "登入", exact: true }).click();

    console.log(`${formatDateTime()} => Waiting for home page...`);
    await page.waitForURL("**/home", { timeout: 30000 });
    console.log(`${formatDateTime()} => Navigated to home page.`);
    console.log(`${formatDateTime()} => Current URL: ${page.url()}`);

    // Click punch button
    console.log(`${formatDateTime()} => Locating and clicking [${punchType}] button...`);
    await page.getByRole("button", { name: punchType, exact: true }).click();
    console.log(`${formatDateTime()} => [${punchType}] button clicked.`);

    // Wait for success message
    console.log(`${formatDateTime()} => Waiting for 打卡成功 message...`);
    await checkPunchSuccess(page);

    // Success
    console.log(`${formatDateTime()} => [${punchType}] 打卡成功`);
    const endTime = new Date();
    console.log(
      `${formatDateTime()} => Total time elapsed: ${
        (endTime.getTime() - startTime.getTime()) / 1000
      } seconds`
    );
  } catch (error) {
    // Log error in GitHub Actions format
    console.error(`::error title=打卡失敗::${JSON.stringify(error, null, 2)}`);

    // Capture screenshot for debugging
    console.log(`${formatDateTime()} => Capturing screenshot for debugging...`);
    const contextPages = browser.contexts().flatMap((ctx) => ctx.pages());
    if (contextPages.length > 0) {
      await contextPages[0].screenshot({
        path: `error-${formatDateTime()}.png`,
        fullPage: true,
      });
      console.log(`${formatDateTime()} => Screenshot captured.`);
    }
  } finally {
    await browser.close();
  }
}

async function checkPunchSuccess(page: Page) {
  try {
    console.log(`${formatDateTime()} => 等待打卡成功提示`);
    await page.getByRole("alert").getByText("打卡成功").waitFor({
      state: "visible",
      timeout: 30000, // 30 seconds
    });
    console.log(`${formatDateTime()} => 打卡成功提示已出現`);
  } catch (error) {
    // Log error in GitHub Actions format
    console.error(`::warning title=打卡成功提示超時::${JSON.stringify(error, null, 2)}`);

    // Capture screenshot
    console.log(`${formatDateTime()} => Capturing screenshot for 打卡成功提示超時...`);
    await page.screenshot({
      path: `check-punch-error-${formatDateTime()}.png`,
      fullPage: true,
    });
    throw error;
  }
}

main(punchType);

function formatDateTime(date = new Date()) {
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }).replace(/[^\d]/g, "-");
}
