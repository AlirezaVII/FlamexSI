# راهنمای اعمال به‌روزرسانی افزایشی روی GitHub

**به‌روزرسانی:** این سند سابقهٔ تحویل پیشین است. تصمیم نهایی تیم برای گزارش جداگانهٔ A و B در [گزارش دومرجعی](DUAL_REFERENCE_FA.md) ثبت شده است.

این بسته فقط فایل‌های **جدید یا تغییرکرده** را دارد. قرار نیست repository قبلی حذف یا از صفر بازسازی شود. فایل `GITHUB_UPDATE_MANIFEST.json` کنار بسته برای هر مسیر مشخص می‌کند که عملیات `ADD` است یا `REPLACE`.

## روش مطمئن با Git

۱. از وضعیت فعلی repository یک نسخهٔ پشتیبان یا branch بگیرید.

۲. بسته را استخراج کنید. داخل آن پوشه‌ای به نام `Falmex-main` وجود دارد؛ این پوشه ریشهٔ repository شماست، نه پوشه‌ای که باید داخل خود repository کپی شود.

۳. در سیستم‌عامل‌های دارای ترمینال، از ریشهٔ repository واقعی خود این دستور را اجرا کنید؛ مسیرها را با محل استخراج خود عوض کنید:

```bash
cd /path/to/your/Falmex-main
cp -a /path/to/extracted-update/Falmex-main/. .
git status --short
```

این روش فایل‌های همنام را جایگزین و فایل‌های تازه را اضافه می‌کند، اما فایل‌های دیگر repository را حذف نمی‌کند. هیچ دستور `rm`، `git clean` یا بازنویسی تاریخ لازم نیست.

۴. تغییرات را پیش از commit بررسی کنید:

```bash
git diff --stat
git diff -- README.md .gitignore
git status --short
```

۵. اگر نتیجه درست بود:

```bash
git add .
git commit -m "Add real FLEX analyses and BASS-II vision v6"
git push
```

انجام commit و push به عهدهٔ شماست؛ این بسته هیچ انتشار یا deployment انجام نداده است.

## اگر فقط از صفحهٔ وب GitHub استفاده می‌کنید

- فایل‌های دارای عملیات `ADD` را در همان مسیر نسبی مشخص‌شده در manifest آپلود کنید.
- برای `REPLACE`، وارد همان مسیر شوید و فایل همنام را جایگزین کنید؛ نسخهٔ قدیم را در مسیر متفاوت نگه ندارید.
- `README.md` و `.gitignore` در ریشهٔ repository جایگزین می‌شوند.
- پوشهٔ تازهٔ `bass-cv/` و پوشهٔ `docs/` را با تمام زیرپوشه‌هایشان اضافه کنید.
- فایل‌های راهنما و manifest بیرون از پوشهٔ `Falmex-main` لازم نیست به repository آپلود شوند؛ نسخهٔ راهنماها داخل `docs/` نیز هست.

## بررسی پس از اعمال

در ریشهٔ repository:

```bash
cd backend
python3 -m pip install -e '.[dev]'
python3 -m pytest -q
python3 -m ruff check .

cd ../frontend
npm ci
npm run lint
npm run typecheck
npm run build

cd ../bass-cv
python3 -m pip install -r requirements.txt
python3 scripts/verify_lightweight_v6.py
```

نتیجهٔ مورد انتظار برای verifier سبک، `status: passed` و ۱۳۲ بررسی است. این فقط سلامت artifactهای سبک را ثابت می‌کند؛ تأیید عملیاتی یا موفقیت علمی مدل نیست.

## چیزهایی که نباید آپلود کنید

- ویدئوهای خام، cache آموزش، fold prediction و overlayهای حجیم تولیدی؛
- بستهٔ کامل ۴۸۲مگابایتی evidence به‌جای فایل‌های سبک repository؛
- `.env`، کلید API، URL علامت‌دار NASA S3 یا پارامترهای موقت AWS؛
- فایل‌های آپلود اصلی داوران و آرشیوهای فشردهٔ آن‌ها؛
- `node_modules`، `.next`، `__pycache__` و خروجی‌های build.

قواعد تازهٔ `.gitignore` برای جلوگیری از ورود تصادفی فایل‌های سنگین BASS-II اضافه شده‌اند.

## بعد از دریافت داور سوم

فولدر شامل دقیقاً ۲۴ JSON تکمیل‌شده را بدون تغییر نام نگه دارید. PNG اختیاری است. سپس از داخل `bass-cv/` اجرا کنید:

```bash
python3 scripts/finalize_adjudication_v6.py \
  --adjudicator /path/to/completed-adjudicator \
  --output adjudicated-confirmation-v6
```

خروجی تازه، مرجع و provenance داوری و ارزیابی هر چهار مدل روی همان ۹۶ پیش‌بینی را می‌سازد. نتایج اولیه و مدل‌ها را بازنویسی نمی‌کند. پس از آن باید نتایج واقعی را در Model Card و فرم مسابقه وارد کنید و وضعیت «در انتظار داوری» را فقط در صورت تکمیل واقعی همهٔ ۲۴ فریم تغییر دهید.

## فیلدهایی که هنوز باید خودتان تکمیل کنید

نام تیم، اعضا، چالش/دستهٔ دقیق، لینک عمومی repository، لینک ویدئوی demo، لینک ارائه و سایر فیلدهای پرتال مسابقه هنوز نیازمند اطلاعات واقعی شما هستند. پیش‌نویس قابل ویرایش در `bass-cv/submission-v6/فرم-مسابقه-پیش‌نویس.md` است.
