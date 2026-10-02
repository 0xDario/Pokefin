const { chromium } = require("playwright-core");
const BASE = "http://localhost:3099";
const OUT = __dirname + "/shots/";
const pages = (process.env.PAGES || "home:/,prices:/prices,market:/market,product:/product/110,stats:/stats,analytics:/analytics,compare:/compare,boxcalc:/box-calculator,login:/auth/login,signup:/auth/signup,forgotpw:/auth/forgot-password,resetpw:/auth/reset-password,privacy:/privacy,notfound:/product/999999,portfolio:/portfolio").split(",").map(s => s.split(/:(.*)/s));
const vps = (process.env.VPS || "mobile,desktop").split(",");
(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  for (const vp of vps) {
    const ctx = await browser.newContext({ bypassCSP: true, viewport: vp === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: vp === "mobile", hasTouch: vp === "mobile" });
    for (const [name, path] of pages) {
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
      page.on("pageerror", e => errs.push("PAGEERROR " + e.message.slice(0, 200)));
      const t0 = Date.now();
      try { await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 120000 }); } catch (e) { errs.push("GOTO " + e.message.slice(0, 100)); }
      await page.waitForTimeout(+(process.env.WAIT || 2500));
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      if (process.env.ACTION) { await eval(process.env.ACTION); await page.waitForTimeout(1500); }
      await page.screenshot({ path: `${OUT}${name}-${vp}.png`, fullPage: true });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const segH = vp === "mobile" ? 1100 : 1400; const w = vp === "mobile" ? 390 : 1440;
      for (let y = 0, i = 1; y < h; y += segH, i++) {
        await page.screenshot({ path: `${OUT}seg2/${name}-${vp}-${i}.png`, fullPage: true, clip: { x: 0, y, width: w, height: Math.min(segH, h - y) } });
      }
      console.log(vp, name, page.url(), (Date.now() - t0) + "ms", errs.length ? JSON.stringify(errs.slice(0, 5)) : "");
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
})();
