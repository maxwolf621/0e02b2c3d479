import { chromium, errors, Page } from "playwright";
import * as dotenv from "dotenv";

dotenv.config();

const punchType = process.env.PUNCH_TYPE as "上班" | "下班";
const isProduction = process.env.IS_PRODUCTION === "true";
// not used
// const companyGeolocation = {
//   latitude: 22.628214,
//   longitude: 120.293037,
// };

async function main(punchType: "上班" | "下班") {
  const startTime = new Date();
  console.log(`${formatDateTime()} => 開始執行 [${punchType}] 打卡`);
  // 設定瀏覽器啟動選項，包含地理位置權限
  const browser = await chromium.launch({
    headless: isProduction,
    devtools: !isProduction,
    args: ["--use-fake-ui-for-media-stream"], // 允許存取媒體設備
  });

  try {
    const context = await browser.newContext();

    const page = await context.newPage();
    // 登入頁面
    await page.goto("https://portal.nueip.com/login");

    console.log(process.env.COMPANY_ID);
    console.log(process.env.PASSWORDD);
    console.log(process.env.EMPLOYEE_ID);

    await page
      .getByRole("textbox", { name: "公司代碼" })
      .fill(process.env.COMPANY_ID || "");
    await page
      .getByRole("textbox", { name: "員工編號" })
      .fill(process.env.EMPLOYEE_ID || "");
    await page.getByPlaceholder("密碼").fill(process.env.PASSWORD || "");
    await page.getByRole("button", { name: "登入", exact: true }).click();

    await page.waitForURL("**/home");

    console.log(`${formatDateTime()} => 點擊 [${punchType}] 打卡`);
    await page.getByRole("button", { name: punchType, exact: true }).click();
    console.log(`${formatDateTime()} => 點擊 [${punchType}] 打卡成功`);

    await checkPunchSuccess(page);

    console.log(`${formatDateTime()} => [${punchType}] 打卡成功`);
    const endTime = new Date();
    console.log(
      `${formatDateTime()} => 總共花費 ${
        (endTime.getTime() - startTime.getTime()) / 1000
      } 秒`
    );
  } catch (error) {
    console.error(
      `${formatDateTime()} => [${punchType}] 打卡失敗：`,
      JSON.stringify(error, null, 2)
    );
  } finally {
    await browser.close();
  }
}

async function checkPunchSuccess(page: Page) {
  try {
    // 等待包含成功訊息的 alert 元素出現
    console.log(`${formatDateTime()} => 等待打卡成功提示`);
    await page.getByRole("alert").getByText("打卡成功").waitFor({
      state: "visible",
      timeout: 15000,
    });
    console.log(`${formatDateTime()} => 打卡成功提示已出現`);
  } catch (error) {
    // 拍攝截圖以便除錯
    await page.screenshot({
      path: `error-${formatDateTime()}.png`,
      fullPage: true,
    });

    if (error instanceof errors.TimeoutError) {
      throw new Error(
        `${formatDateTime()} => 等待打卡成功提示超時：${error.message}`
      );
    }
    throw error;
  }
}

main(punchType);

function formatDateTime(date = new Date()) {
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}
