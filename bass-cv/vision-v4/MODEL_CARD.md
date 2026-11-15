# کارت مدل Falmex Vision v4

## شناسه و وضعیت

- **مدل منتخب:** LightGBM، قطعه‌بندی پیکسلی نواحی درخشان قابل‌مشاهدهٔ شعله
- **کاندیدای مقایسه:** ExtraTrees با همان نمونه‌ها، ویژگی‌ها و foldهای ویدئویی
- **آموزش نهایی:** ۸۲۶٬۸۱۶ نمونهٔ پیکسلی از ۷۲ فریم و نه ویدئوی BASS-II
- **ویژگی‌ها:** ۴۰ ویژگی مکانی، رنگی، چندمقیاسی و زمانی برای هر پیکسل
- **SHA-256 مدل ثابت:** `f0cceefc6281887ae46646d35fd8b8b8db015f52027866e7596fbcab7c0c985a`
- **فایل مدل:** `vision-v4/models/falmex-vision-v4.joblib`
- **وضعیت:** proof-of-method آموزش‌دیده و ارزیابی‌شده؛ مدل operational یا external validation متخصص نیست

خروجی مدل mask باینری شعلهٔ درخشان مرئی است، نه مرز شیمیایی شعله، دما، زمان خاموشی، uncertainty کالیبره یا معیار اثربخشی مهار آتش.

## داده و نقش آزمون‌ها

منبع داده NASA BASS-II، accession ‏PSI-25 و DOI ‏`10.60555/4qc4-de67` است. مجوز ثبت‌شده در متادیتای منبع CC0-1.0 است. نام، اندازه و SHA-256 هر ۱۲ ویدئوی خام و جدول تجربی در manifestهای `metadata/` موجود است.

### توسعهٔ v4

- آزمون‌ها: B1، B2، B3، B4، B5، B6، B7، B8 و B12؛
- ۷۲ فریم: ۵۳ مثبت و ۱۹ منفی؛
- B6/B8/B12 پس از ثبت confirmation مدل v3 صریحاً به توسعهٔ v4 منتقل شدند؛ نتایج قبلی حذف نشده‌اند؛
- ارزیابی: Leave-One-Test-Out روی نه گروه ویدئویی؛
- ExtraTrees و LightGBM از همان ۴۰ ویژگی و همان نمونه‌های آموزشی در هر fold استفاده کردند.

### confirmation مدل ثابت v4

- آزمون‌ها: B9، B10 و B11؛
- ۲۴ فریم: ۱۳ مثبت و ۱۱ منفی؛
- ویدئوها فقط بر اساس متادیتا و پیش از آموزش v4 رزرو شدند؛
- کسرهای زمانی هشت فریم هر ویدئو پیش از مشاهدهٔ فریم یا خروجی ثابت شدند؛
- مدل نهایی، انتخاب فریم و ۴۸ فایل mask/overlay پیش‌بینی پیش از annotation ثبت و hash شدند؛
- annotation فقط از روی source frame و بدون دیدن prediction overlay انجام شد؛
- پس از دیدن نتایج B9/B10/B11 هیچ مدل، ویژگی یا آستانه‌ای تغییر نکرد.

## annotation و استقلال آماری

maskها polygon درشت دستیِ تولیدشده و بازبینی‌شده توسط دستیار AI هستند، نه gold standard متخصص مستقل. B10 و فریم‌های پایانی B11 شعله‌های بسیار کم‌نور و مرز مبهم دارند؛ خودِ annotation نیز عدم‌قطعیت دارد.

فریم‌های یک ویدئو مستقل نیستند و واحد گروهی ارزیابی ویدئو است. با فقط سه خوشهٔ confirmation فاصلهٔ اطمینان گزارش نشده است. confirmation جدید با ویدئوهای confirmation نسخهٔ v3 یکسان نیست؛ پس امتیازهای تجمیعی v3 و v4 مقایسهٔ هم‌ویدئویی محسوب نمی‌شوند.

## مدل و ویژگی‌ها

LightGBM منتخب دارای ۱۶۰ درخت boosting، نرخ یادگیری ۰٫۰۵، ۴۸ برگ، حداکثر عمق ۱۲، `min_child_samples=35`، `colsample_bytree=0.85`، `subsample=0.9`، `reg_alpha=0.2`، `reg_lambda=2` و وزن کلاس balanced است. seed برابر ۴۲ و تعداد thread برابر ۲ است.

۲۵ ویژگی نخست از v3 حفظ شده‌اند: مختصات، RGB، HSV/Lab، chromaticity، red/green excess، نرمال‌سازی فریم و چند ویژگی محلی. ۱۵ ویژگی جدید عبارت‌اند از:

- بیشترین و میانگین اختلاف مطلق فریم جاری با median سی فریم نخست؛
- اختلاف V و red excess از مرجع زمانی؛
- میانگین و انحراف معیار محلی V در مقیاس sigma ‏۲؛
- میانگین و contrast محلی red excess، S و R در مقیاس sigma ‏۵؛
- V و red excess مرجع؛
- بزرگی گرادیان V.

نمونه‌برداری آموزشی برای هر فریم شامل همهٔ پیکسل‌های مثبت و تا ۱۲۰۰ منفی تصادفی، ۲۴۰۰ منفی سخت روشن/رنگی و ۲۴۰۰ منفی نزدیک مرز است. boundary dilation با kernel ‏۴۱×۴۱ انجام می‌شود.

در inference، احتمال مدل در gate اختلاف زمانی `clip(difference/0.05,0,1)` ضرب می‌شود. پس‌پردازش ثابت: Gaussian blur با sigma ‏۱٫۲، آستانهٔ ۰٫۵، opening سه‌درسه، closing پنج‌درپنج و حذف مؤلفه‌های زیر ۵۰ پیکسل. آستانه پس از confirmation تغییر نکرده است.

## مقایسهٔ grouped development

قاعدهٔ انتخاب پیش از دیدن نتیجهٔ confirmation ثابت بود: بالاترین pooled positive Macro IoU و در حالت تساوی Macro Dice.

| معیار تجمیعی توسعه | ExtraTrees | LightGBM |
|---|---:|---:|
| Macro IoU | ۰٫۴۲۶۵ | **۰٫۴۴۳۰** |
| Macro Dice | ۰٫۵۶۹۴ | **۰٫۵۸۹۲** |
| Micro IoU | ۰٫۳۹۴۵ | **۰٫۴۸۹۷** |
| Micro Dice | ۰٫۵۶۵۸ | **۰٫۶۵۷۴** |
| Micro Precision | ۰٫۴۲۶۱ | **۰٫۵۶۲۷** |
| Micro Recall | **۰٫۸۴۱۸** | ۰٫۷۹۰۴ |
| FP پیکسلی | ۵۰۳٬۵۵۰ | **۲۷۲٬۷۷۱** |
| detection failure | ۱ | **۰** |
| فریم منفی دارای FP | **۰** | ۲ |
| FP در فریم‌های منفی | **۰** | ۲۶۵ پیکسل |

LightGBM در B8 بهبود زیادی داشت: Macro IoU ‏۰٫۴۹۰۲ در برابر ۰٫۲۷۴۱ برای ExtraTrees. در B3 نیز ۰٫۲۱۷۴ در برابر ۰٫۱۵۸۷ شد، اما هنوز ضعیف است. در B12 و B7 امتیاز LightGBM پایین‌تر بود. این نتایج model-selection estimate هستند و confirmation را جایگزین نمی‌کنند.

## نتایج confirmation مدل ثابت

| آزمون | مثبت/منفی | Macro IoU | Macro Dice | Micro Precision | Micro Recall | میانهٔ خطای Centroid |
|---|---:|---:|---:|---:|---:|---:|
| B9 | ۵ / ۳ | ۰٫۷۸۸۲ | ۰٫۸۷۹۲ | ۰٫۸۵۵۶ | ۰٫۸۹۳۰ | ۳٫۰۶ px |
| B10 | ۳ / ۵ | ۰٫۶۸۳۰ | ۰٫۸۰۸۷ | ۰٫۹۷۰۰ | ۰٫۶۷۲۵ | ۱۰٫۷۸ px |
| B11 | ۵ / ۳ | ۰٫۴۷۵۸ | ۰٫۵۸۵۴ | ۰٫۸۹۸۴ | ۰٫۶۹۶۵ | ۱۷٫۷۵ px |
| تجمیعی | ۱۳ / ۱۱ | ۰٫۶۴۳۸ | ۰٫۷۵۰۰ | ۰٫۸۷۷۲ | ۰٫۸۰۲۱ | ۴٫۴۷ px |

- Micro IoU = ‏۰٫۷۲۱۱ و Micro Dice = ‏۰٫۸۳۷۹؛
- TP = ‏۴۹٬۸۸۷، FP = ‏۶٬۹۸۴ و FN = ‏۱۲٬۳۱۲ پیکسل؛
- detection failure در ۱۳ فریم مثبت = ‏۰؛
- false positive در ۱۱ فریم منفی = ‏۰ پیکسل؛
- میانهٔ خطای مطلق نسبی مساحت = ‏۰٫۱۷۹۰.

این بهترین confirmation فعلی پروژه است، اما ۱۳ فریم مثبت از سه ویدئو و annotation غیرمتخصص برای ادعای operational readiness کافی نیست. صفر FP در ۱۱ فریم منفی نیز برآورد نرخ عمومی false positive نیست.

## شکست‌ها و محدودیت‌ها

- **B11 کم‌نور:** خطای اصلی undersegmentation است. IoU فریم‌های ۱۷۳۵، ۲۲۸۳ و ۲۸۳۱ به‌ترتیب ۰٫۰۹۵، ۰٫۲۵۰ و ۰٫۳۶۴ شد؛ بخش زیادی از شعلهٔ کم‌نور در mask پیش‌بینی حذف شده است.
- **B10:** precision بالا اما recall پایین‌تر است؛ انتهای کم‌نور شعله در برخی فریم‌ها از دست می‌رود.
- **B9 فریم ۱۵۷:** reflection و جرقه هنوز FP ایجاد می‌کنند و IoU برابر ۰٫۶۳۹ است.
- **B3 در توسعه:** نور کم همچنان مشکل‌ساز است و امتیاز LightGBM فقط ۰٫۲۱۷۴ است.
- **B12 و B7 در توسعه:** مدل منتخب نسبت به ExtraTrees بهتر نیست؛ همهٔ شرایط به یک اندازه بهبود نیافته‌اند.
- مرجع median سی فریم نخست به ثبات نمای دوربین وابسته است و در ویدئویی با شعله یا حرکت شدید از ابتدا ممکن است نامناسب شود.
- annotation مستقل متخصص، inter-rater reliability، آزمون روی دوربین دیگر و external validation وجود ندارد.
- هیچ ادعای زمان خاموشی، پیش‌بینی Lunar-g/Mars-g، اثر علیّت مهار یا ایمنی عملیاتی مجاز نیست.

## اجرا و بازتولید

نسخه‌های راستی‌آزمایی‌شده: Python ‏۳٫۱۲٫۱۲، NumPy ‏۲٫۲٫۵، OpenCV ‏۴٫۱۲٫۰، scikit-learn ‏۱٫۷٫۲، joblib ‏۱٫۵٫۲ و LightGBM ‏۴٫۶٫۰. نسخه‌های دقیق در `requirements.txt` ثبت شده‌اند.

```bash
python3 -m pip install -r requirements.txt
python3 scripts/verify_delivery_v4.py
```

inference روی فریم ۳۲۸ ویدئوی B9:

```bash
python3 scripts/falmex_vision_v4.py predict-video \
  --video "raw/PSI-25_Raw Data_BASS_GMT188_SAMPLE_154_TESTB9.mp4" \
  --test-id B9 \
  --frames 328 \
  --output /tmp/falmex-v4-inference
```

بازمحاسبهٔ confirmation از maskهای ثابت:

```bash
python3 scripts/evaluate_confirmation_v4.py
```

بازتولید نمودار:

```bash
python3 scripts/plot_vision_v4_results.py
```

آموزش کامل برای بازتولید پژوهش، نه برای ارزیابی سریع:

```bash
python3 scripts/falmex_vision_v4.py prepare
for test in B1 B2 B3 B4 B5 B6 B7 B8 B12; do
  python3 scripts/falmex_vision_v4.py run-fold --test-id "$test"
done
python3 scripts/falmex_vision_v4.py summarize
python3 scripts/falmex_vision_v4.py train-final
```

اجرای دوبارهٔ آموزش، artifactهای مدل را بازنویسی می‌کند. برای چرخهٔ بعدی باید ویدئوهای confirmation تازه رزرو شوند؛ B9/B10/B11 دیگر دادهٔ دیده‌نشده نیستند.

## محتوای بسته

بستهٔ v4 شامل مدل، کد آموزش و inference، فریم‌ها و annotationهای توسعه و confirmation، foldهای دو کاندید، پیش‌بینی‌های ثابت، معیارها، overlayها، نمودارها و گزارش راستی‌آزمایی است. ویدئوی خام B9 برای اجرای فوری inference داخل بسته است. سایر ویدئوهای خام به‌خاطر حجم در بسته تکرار نمی‌شوند؛ نام، مسیر NASA، اندازه و SHA-256 همه در manifestها ثبت شده و برای آموزش مجدد کامل باید در مسیرهای `raw/` بازیابی شوند. ارزیابی confirmation از فریم‌های داخل بسته بدون ویدئوهای خام انجام می‌شود. باینری‌های v2/v3، cache آموزش، فایل‌های pyc و reviewهای منسوخ نیز خارج شده‌اند.
