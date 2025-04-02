import { chromium, errors, Page } from "playwright";
import * as dotenv from "dotenv";
dotenv.config();

const punchType = process.env.PUNCH_TYPE as "上班" | "下班";
const isProduction = process.env.IS_PRODUCTION === "true";
const GPS_LATITUDE = process.env.GPS_LATITUDE ? parseFloat(process.env.GPS_LATITUDE) : 22.621478041039;
const GPS_LONGITUDE = process.env.GPS_LONGITUDE ? parseFloat(process.env.GPS_LONGITUDE) : 120.3954638209;
const GPS_ACCURACY = 5; 

// Extended timeout values for GitHub Actions
const NAVIGATION_TIMEOUT = 120000;  // 2 minutes
const ELEMENT_TIMEOUT = 60000;      // 1 minute
const LOGIN_TIMEOUT = 120000;       // 2 minutes

async function main(punchType: "上班" | "下班") {
  const startTime = new Date();
  console.log(`${formatDateTime()} => 開始執行 [${punchType}] 打卡`);
  console.log(`${formatDateTime()} => 使用GPS座標: 緯度=${GPS_LATITUDE}, 經度=${GPS_LONGITUDE}, 精確度=${GPS_ACCURACY}米`);
  
  // Launch browser with minimal resource usage
  const browser = await chromium.launch({
    headless: true, // Always use headless in GitHub Actions
    args: [
      "--disable-dev-shm-usage", // Prevents crash in Docker/CI environments
      "--no-sandbox",            // Required for CI environments
      "--disable-gpu",           // Reduces resource usage
      "--disable-setuid-sandbox",
      "--disable-extensions",
      "--use-fake-ui-for-media-stream",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ]
  });
  
  try {
    const context = await browser.newContext({
      geolocation: {
        latitude: GPS_LATITUDE,
        longitude: GPS_LONGITUDE,
        accuracy: GPS_ACCURACY
      },
      permissions: ['geolocation'],
      viewport: { width: 1280, height: 720 }, // Set a standard viewport size
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', // Set a standard user agent
      bypassCSP: true, // Bypass Content Security Policy
      locale: 'zh-TW', // Set locale to match expected region
      timezoneId: 'Asia/Taipei', // Set timezone to match expected region
    });
    
    // Set default timeout for all operations
    context.setDefaultTimeout(NAVIGATION_TIMEOUT);
    
    // Reduce console logging in GitHub Actions
    const page = await context.newPage();
    if (!isProduction) {
      page.on('console', msg => {
        console.log(`${formatDateTime()} => Browser console: ${msg.text()}`);
      });
      
      page.on('request', request => {
        console.log(`${formatDateTime()} => Network request: ${request.url()}`);
      });
    }
    
    console.log(`${formatDateTime()} => 正在載入登入頁面...`);
    await page.goto("https://portal.nueip.com/login", { 
      waitUntil: 'networkidle',
      timeout: NAVIGATION_TIMEOUT 
    });
    console.log(`${formatDateTime()} => 登入頁面載入完成`);
    
    console.log(`${formatDateTime()} => 正在登入...`);
    // Login with enhanced retry mechanism
    await enhancedRetry(async () => {
      await page.getByRole("textbox", { name: "公司代碼" }).fill(process.env.COMPANY_ID || "");
      await page.getByRole("textbox", { name: "員工編號" }).fill(process.env.EMPLOYEE_ID || "");
      await page.getByPlaceholder("密碼").fill(process.env.PASSWORD || "");
      
      // Wait a moment before clicking login
      await page.waitForTimeout(1000);
      
      await Promise.all([
        page.waitForResponse(
          response => response.url().includes('/auth/login') && response.status() === 200,
          { timeout: LOGIN_TIMEOUT }
        ).catch(() => console.log(`${formatDateTime()} => 找不到登入響應，但繼續嘗試`)),
        page.getByRole("button", { name: "登入", exact: true }).click(),
      ]);
    }, 5, 3000);
    
    console.log(`${formatDateTime()} => 等待導航到首頁...`);
    // Wait for successful navigation
    await page.waitForURL("**/home", { timeout: NAVIGATION_TIMEOUT });
    console.log(`${formatDateTime()} => 已成功導航到首頁`);
    
    // Wait for page to be fully loaded with a generous timeout
    await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT });
    console.log(`${formatDateTime()} => 頁面載入完成`);
    
    // Verify location detection upon reaching the home page
    console.log(`${formatDateTime()} => 正在驗證位置資訊...`);
    await verifyLocationDetection(page);
    
    // Wait for punch button to be visible with generous timeout
    console.log(`${formatDateTime()} => 正在尋找打卡按鈕...`);
    const punchButton = page.getByRole("button", { name: punchType, exact: true });
    await punchButton.waitFor({ 
      state: 'visible', 
      timeout: ELEMENT_TIMEOUT 
    });
    console.log(`${formatDateTime()} => 找到打卡按鈕`);
    
    // Add stabilization delay before clicking
    await page.waitForTimeout(3000);
    
    // Click with enhanced retry mechanism
    console.log(`${formatDateTime()} => 正在點擊打卡按鈕...`);
    await enhancedRetry(async () => {
      await page.waitForTimeout(1000); // Small delay before each attempt
      await punchButton.click({ timeout: ELEMENT_TIMEOUT });
    }, 5, 3000);
    
    // Modified success check with generous timeout
    await checkPunchSuccess(page, 60000);
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
      
      // Take screenshot of error state
      try {
        await page.screenshot({
          path: `error-${formatDateTime()}.png`,
          fullPage: true,
        });
        console.log(`${formatDateTime()} => 已儲存錯誤截圖`);
      } catch (screenshotError) {
        console.error(`${formatDateTime()} => 無法保存螢幕截圖: ${screenshotError}`);
      }
    }
    
    // Ensure the process exits with error
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

// Enhanced retry mechanism with exponential backoff
async function enhancedRetry<T>(
  fn: () => Promise<T>, 
  attempts: number, 
  initialDelay: number = 2000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = initialDelay * Math.pow(1.5, i); // Exponential backoff
      console.log(`${formatDateTime()} => 重試嘗試 ${i + 1}/${attempts}，等待 ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error(`重試失敗 (${attempts} 次嘗試): ${lastError}`);
}

async function verifyLocationDetection(page: Page) {
  try {
    // Execute JavaScript to check if geolocation is working
    const locationInfo = await page.evaluate(() => {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              success: true
            });
          },
          (error) => {
            resolve({
              errorMessage: error.message,
              errorCode: error.code,
              success: false
            });
          },
          { 
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          }
        );
      });
    });
    
    console.log(`${formatDateTime()} => 位置偵測結果: ${JSON.stringify(locationInfo)}`);
  } catch (error) {
    console.warn(`${formatDateTime()} => 位置驗證失敗，但繼續執行: ${error}`);
  }
}

async function checkPunchSuccess(page: Page, timeout: number = 30000) {
  const startCheck = Date.now();
  console.log(`${formatDateTime()} => 等待打卡成功提示 (最多等待 ${timeout/1000} 秒)...`);
  
  try {
    // First, check if the alert exists
    const alert = page.getByRole("alert");
    await alert.waitFor({ state: 'visible', timeout });
    
    // Then check for success message
    const successText = alert.getByText("打卡成功");
    await successText.waitFor({ state: 'visible', timeout });
    
    const checkDuration = (Date.now() - startCheck) / 1000;
    console.log(`${formatDateTime()} => 打卡成功提示已出現 (等待了 ${checkDuration} 秒)`);
  } catch (error) {
    console.error(`::warning title=打卡成功提示超時::${JSON.stringify(error, null, 2)}`);
    
    // Take screenshot of error state
    try {
      await page.screenshot({
        path: `check-punch-error-${formatDateTime()}.png`,
        fullPage: true,
      });
    } catch (screenshotError) {
      console.error(`${formatDateTime()} => 無法保存打卡錯誤截圖: ${screenshotError}`);
    }
    
    // In GitHub Actions, we should still check the page content for success indicators
    const pageContent = await page.content();
    if (pageContent.includes("打卡成功") || pageContent.includes("成功打卡")) {
      console.log(`${formatDateTime()} => 頁面內容中找到打卡成功字樣，視為成功`);
      return; // Return successfully
    }
    
    throw error;
  }
}

function formatDateTime(date = new Date()) {
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }).replace(/[^\d]/g, "-");
}

main(punchType);
