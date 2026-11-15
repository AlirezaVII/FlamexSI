/**
 * End-to-end test of a running Falmex site in a real browser (live droplet or Vercel).
 *
 *   E2E_BASE=http://129.212.254.115:3000 node <runner> --script frontend/e2e/live.mjs
 *
 * The runner passes a Playwright `page`. Safe for production: forms are only submitted
 * empty or with values the server must reject, so nothing permanent is created. The one
 * exception is a small QA upload (name starts with "QA-E2E"), deleted at the end.
 *
 * Checks on every page: HTTP 200, no uncaught JS error, no 5xx API call, no raw JSON /
 * stack trace / "[object Object]" / "undefined" / "NaN" on screen, no horizontal scroll at
 * phone width, and dark mode renders. Then each form with empty, too-short, wrong-type and
 * hostile input: the message shown must be a sentence, never a JSON dump.
 */

const BASE = (process.env.E2E_BASE || "http://129.212.254.115:3000").replace(/\/$/, "");
const ROUTES = ["/", "/overview", "/investigations", "/data", "/bass-review", "/footage",
  "/explorer", "/compare", "/relationships", "/findings", "/review", "/insights",
  "/flight-evidence", "/flame-lab", "/simulator", "/innovation"];
const BAD_TEXT = /\{"detail"|"loc":\s*\[|Traceback|\[object Object\]|\bundefined\b|\bNaN\b|string_too_short|Internal Server Error|Unhandled Runtime Error|Application error/;

export default async function run(page) {
  const results = [];
  const check = (name, ok, info = "") => results.push({ ok: !!ok, name, info: String(info).slice(0, 240) });
  const jsErrors = [];
  const serverErrors = [];
  page.on("pageerror", (e) => jsErrors.push(`${page.url()} :: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  const api = async (path, init) => {
    const r = await page.request.fetch(BASE + path, init);
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status(), body };
  };
  const visibleText = () => page.evaluate(() => document.body.innerText);
  const alerts = async () =>
    (await page.locator('[role="alert"], .text-\\[var\\(--critical\\)\\], [aria-invalid="true"] ~ *').allInnerTexts()).join(" | ");
  const go = async (path) => {
    const r = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(() => { document.documentElement.dataset.splash = "gone"; });
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    return r;
  };
  const noRawText = async (where) => {
    const t = await visibleText();
    const m = t.match(BAD_TEXT);
    check(`${where}: no raw error text on screen`, !m, m ? t.slice(Math.max(0, m.index - 80), m.index + 120) : "");
  };

  // ---------------------------------------------------------------- every page --------
  for (const path of ROUTES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = jsErrors.length;
    const r = await go(path);
    check(`${path}: HTTP 200`, r && r.status() === 200, r && r.status());
    await page.waitForTimeout(1500);
    await noRawText(path);
    check(`${path}: no JS error`, jsErrors.length === before, jsErrors.slice(before).join(" ; "));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const ox = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`${path}: no sideways scroll on a phone`, ox <= 1, `${ox}px wider`);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.waitForTimeout(300);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${path}: dark mode has a dark background`, /rgb\((\d|[1-5]\d),/.test(bg), bg);
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // a real finding page (FLEX)
  const f = await api("/api/findings?status=validated&limit=1");
  const fid = f.body?.[0]?.finding_id;
  check("API: a validated finding exists", fid, f.status);
  if (fid) {
    const r = await go(`/findings/${fid}`);
    check("finding page: HTTP 200", r.status() === 200);
    await noRawText("finding page");
    // unknown finding id: friendly page, not a crash
    await go("/findings/does-not-exist");
    await noRawText("unknown finding");
  }

  // ------------------------------------------------------------- insight form --------
  if (fid) {
    await go(`/findings/${fid}`);
    const promote = page.getByRole("button", { name: /Promote to insight/ });
    if (await promote.count()) {
      await promote.first().click();
      const save = page.getByRole("button", { name: /Save insight/ });
      let posted = false;
      const onReq = (q) => { if (q.method() === "POST" && q.url().includes("/insight")) posted = true; };
      page.on("request", onReq);
      await save.click();
      await page.waitForTimeout(800);
      const t1 = await visibleText();
      check("insight form: empty save shows field notes", /Required|at least/i.test(t1));
      check("insight form: empty save sends nothing", !posted);
      for (const box of await page.locator("form textarea, form input[type=text], textarea").all())
        await box.fill("          ").catch(() => {});
      await save.click();
      await page.waitForTimeout(800);
      check("insight form: spaces only still blocked", !posted && /Required|at least/i.test(await visibleText()));
      page.off("request", onReq);
      await noRawText("insight form");
      await page.getByRole("button", { name: "Cancel" }).first().click().catch(() => {});
    } else check("insight form: Promote button present", false);

    // prior-knowledge check form
    await go(`/findings/${fid}`);
    const pk = page.getByRole("button", { name: /Record what the sources say|Edit the check/ });
    if (await pk.count()) {
      await pk.first().click();
      const s = page.getByRole("button", { name: /Save check/ });
      if (await s.count()) {
        const linkBox = page.getByPlaceholder("Link (optional)");
        if (await linkBox.count()) await linkBox.first().fill("javascript:alert(1)");
        await s.first().click();
        await page.waitForTimeout(1500);
        await noRawText("prior-knowledge form");
        const a = await alerts();
        check("prior-knowledge form: invalid save shows a message", a.length > 0 || /required|at least|must/i.test(await visibleText()), a);
      }
    }
  }

  // ----------------------------------------------------------- reference limits ------
  await go("/simulator");
  const addLimit = page.getByRole("button", { name: /Add a limit/ });
  if (await addLimit.count()) {
    await addLimit.first().click();
    const saveLimit = page.getByRole("button", { name: "Save limit" });
    await saveLimit.click();
    await page.waitForTimeout(1500);
    await noRawText("limit form (empty)");
    check("limit form: empty save explains what is missing", /required|at least|greater than|must/i.test(await alerts()), await alerts());
    // valid-looking but with a javascript: link: must be refused, nothing saved
    const fill = async (label, v) => page.locator("label", { hasText: label }).locator("input").first().fill(v);
    await fill("Material", "QA-E2E material");
    await fill("Kind", "MOC");
    await fill("Oxygen limit", "21");
    await fill("Entered by", "QA");
    await fill("Link", "javascript:alert(1)");
    await page.getByPlaceholder("Authors, title, report number, year, page/table").fill("QA-E2E citation, must be refused");
    await saveLimit.click();
    await page.waitForTimeout(1500);
    check("limit form: javascript: link refused with a sentence", /http/i.test(await alerts()), await alerts());
    await fill("Link", "");
    await fill("Oxygen limit", "abc");
    await saveLimit.click();
    await page.waitForTimeout(1500);
    await noRawText("limit form (text in number)");
    check("limit form: text in a number field is refused", (await alerts()).length > 0, await alerts());
    const left = await api("/api/reference-limits");
    check("limit form: nothing was saved", !(left.body || []).some((l) => /QA-E2E/.test(l.material)));
  } else check("simulator: Add a limit button present", false);

  // --------------------------------------------------------------- explorer ----------
  await go("/explorer");
  for (const v of ["abc", "'; DROP TABLE x; --", "<img src=x onerror=alert(1)>", "1e309", "🔥"]) {
    const box = page.locator("input:visible").first();
    if (!(await box.count())) break;
    await box.fill(v).catch(() => {});
    const apply = page.getByRole("button", { name: "Apply" });
    if (await apply.count()) await apply.first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await noRawText("explorer after hostile filters");

  // ---------------------------------------------------------------- compare ----------
  await go("/compare");
  const ids = page.getByPlaceholder("Add experiment IDs, comma separated");
  if (await ids.count()) {
    await ids.fill("NOPE-1, ,,<script>x</script>, " + "A".repeat(500));
    await page.getByRole("button", { name: "Add" }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await noRawText("compare with unknown ids");
  }

  // ----------------------------------------------------------------- footage ---------
  await go("/footage");
  const fps = page.locator("input").filter({ hasNot: page.locator("[type=file]") });
  const fpsBox = page.locator("label", { hasText: "Frame rate" }).locator("input").first();
  if (await fpsBox.count()) {
    for (const v of ["0", "-5", "abc", "99999999"]) {
      await fpsBox.fill(v).catch(() => {});
      const btn = page.getByRole("button", { name: /Analyze|Re-analyze/ });
      if (await btn.count()) await btn.first().click().catch(() => {});
      await page.waitForTimeout(2500);
      await noRawText(`footage fps=${v}`);
    }
    await fpsBox.fill("");
  }
  void fps;

  // ------------------------------------------------------------- evidence chat -------
  await go("/flight-evidence");
  const ask = page.getByRole("button", { name: /^Ask$/ });
  if (await ask.count()) {
    check("chat: Ask is disabled with an empty question", await ask.first().isDisabled());
    const area = page.locator("textarea").first();
    await area.fill(" ".repeat(50));
    check("chat: spaces only does not enable Ask", await ask.first().isDisabled());
    const len = await area.evaluate((el) => { el.value = ""; return el.maxLength; });
    check("chat: question length capped in the box", len === 1200, len);
  }

  // ------------------------------------------------------------------- uploads -------
  await go("/data");
  const fileInput = page.locator('input[type="file"]').first();
  const upload = page.getByRole("button", { name: /Upload & standardize/ });
  const appendBox = page.locator('input[type="checkbox"]').first();
  if (await appendBox.count()) check("upload: 'add to current dataset' is off by default", !(await appendBox.isChecked()));
  const tryUpload = async (name, buffer, mimeType = "text/csv") => {
    await fileInput.setInputFiles({ name, mimeType, buffer });
    await upload.click();
    // the answer can take a while on a slow link: wait for a message or a settled page
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      if ((await alerts()).length > 5) break;
      if (i >= 5 && !(await upload.isDisabled().catch(() => false))) break;
    }
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    return { alert: await alerts(), text: await visibleText() };
  };
  for (const [name, buf, why] of [
    ["virus.exe", Buffer.from("MZ\x90\x00"), "unsupported type"],
    ["QA-E2E-empty.csv", Buffer.from(""), "empty file"],
    ["QA-E2E-broken.xlsx", Buffer.from("PK\x03\x04garbage"), "damaged Excel"],
    ["QA-E2E-broken.json", Buffer.from("{not json"), "broken JSON"],
  ]) {
    const r = await tryUpload(name, buf);
    check(`upload ${why}: refused with a readable message`, r.alert.length > 5 && !BAD_TEXT.test(r.alert), r.alert);
  }
  if (BASE.includes("vercel.app")) {
    const big = Buffer.alloc(5_000_000, "1,2,3\n");
    const r = await tryUpload("QA-E2E-big.csv", big);
    check("upload 5 MB on Vercel: tells the user to use the droplet", /4\.5 MB|droplet|129\.212/.test(r.alert), r.alert);
  }
  const good = await tryUpload("QA-E2E-valid.csv",
    Buffer.from("Test ID,O2,Pressure (atm),burn time (s)\nQ1,21,1,3.1\nQ2,25,0.7,2.4\nQ3,30,0.5,1.9\n"));
  check("upload valid CSV: accepted", !good.alert, good.alert);
  await noRawText("data page after uploads");

  // ------------------------------------------------------------------ cleanup --------
  const all = await api("/api/datasets");
  for (const d of all.body || []) {
    if (/QA-E2E/.test(d.name) || (d.source_ids?.length && /QA-E2E/.test(d.name))) {
      const del = await api(`/api/datasets/${d.dataset_id}`, { method: "DELETE" });
      check(`cleanup: deleted ${d.name}`, del.status === 204, del.status);
    }
  }
  const after = await api("/api/datasets");
  check("cleanup: no QA datasets left", !(after.body || []).some((d) => /QA-E2E/.test(d.name)));
  check("cleanup: the FLEX dataset is still there", (after.body || []).some((d) => d.name.startsWith("NASA PSI-69 FLEX")));

  check("no 5xx response from any API call during the run", serverErrors.length === 0, serverErrors.join(" ; "));
  const failed = results.filter((r) => !r.ok);
  return { base: BASE, passed: results.length - failed.length, total: results.length, failed };
}
