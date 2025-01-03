import { chromium, errors, Page } from "playwright";
import * as dotenv from "dotenv";
dotenv.config();

const punchType = process.env.PUNCH_TYPE as "上班" | "下班";
const isProduction = process.env.IS_PRODUCTION === "true";

async function main(punchType: "上班" | "下班") {
  const startTime = new Date();
  console.log(`${formatDateTime()} => 開始執行 [${punchType}] 打卡`);
  
  const browser = await chromium.launch({
    headless: isProduction,
    devtools: !isProduction,
    args: ["--use-fake-ui-for-media-stream"],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Add event listener for console messages
    page.on('console', msg => {
      console.log(`${formatDateTime()} => Browser console: ${msg.text()}`);
    });

    // Add event listener for network requests
    page.on('request', request => {
      console.log(`${formatDateTime()} => Network request: ${request.url()}`);
    });

    await page.goto("https://portal.nueip.com/login");
    
    // Wait for login form to be fully loaded
    await page.waitForLoadState('networkidle');
    
    // Login with retry mechanism
    await retry(async () => {
      await page.getByRole("textbox", { name: "公司代碼" }).fill(process.env.COMPANY_ID || "");
      await page.getByRole("textbox", { name: "員工編號" }).fill(process.env.EMPLOYEE_ID || "");
      await page.getByPlaceholder("密碼").fill(process.env.PASSWORD || "");
      await page.getByRole("button", { name: "登入", exact: true }).click();
    }, 3);

    // Wait for navigation with extended timeout
    await page.waitForURL("**/home", { timeout: 60000 });

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Wait for punch button to be visible and clickable
    const punchButton = page.getByRole("button", { name: punchType, exact: true });
    await punchButton.waitFor({ state: 'visible', timeout: 30000 });
    
    // Add delay before clicking
    await page.waitForTimeout(2000);

    // Click with retry mechanism
    await retry(async () => {
      await punchButton.click();
    }, 3);

    // Modified success check
    await checkPunchSuccess(page);

    console.log(`${formatDateTime()} => [${punchType}] 打卡成功`);
    const endTime = new Date();
    console.log(
      `${formatDateTime()} => Total time elapsed: ${
        (endTime.getTime() - startTime.getTime()) / 1000
      } seconds`
    );

  } catch (error) {
    console.error(`::error title=打卡失敗::${JSON.stringify(error, null, 2)}`);
    
    // Capture page state
    const contextPages = browser.contexts().flatMap((ctx) => ctx.pages());
    if (contextPages.length > 0) {
      const page = contextPages[0];
      console.log(`${formatDateTime()} => Current URL: ${page.url()}`);
      console.log(`${formatDateTime()} => Page content: ${await page.content()}`);
      
      await page.screenshot({
        path: `error-${formatDateTime()}.png`,
        fullPage: true,
      });
    }
  } finally {
    await browser.close();
  }
}

async function checkPunchSuccess(page: Page) {
  try {
    console.log(`${formatDateTime()} => 等待打卡成功提示`);
    
    // First, check if the alert exists
    const alert = page.getByRole("alert");
    await alert.waitFor({ state: 'visible', timeout: 30000 });
    
    // Then check for success message
    const successText = alert.getByText("打卡成功");
    await successText.waitFor({ state: 'visible', timeout: 30000 });
    
    console.log(`${formatDateTime()} => 打卡成功提示已出現`);
  } catch (error) {
    console.error(`::warning title=打卡成功提示超時::${JSON.stringify(error, null, 2)}`);
    await page.screenshot({
      path: `check-punch-error-${formatDateTime()}.png`,
      fullPage: true,
    });
    throw error;
  }
}

// Retry mechanism
async function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      console.log(`${formatDateTime()} => Retry attempt ${i + 1} of ${attempts}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Retry failed');
}

function formatDateTime(date = new Date()) {
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }).replace(/[^\d]/g, "-");
}

main(punchType);
