# ☕ باشگاه مشتریان کافه

وب‌اپلیکیشن کامل باشگاه مشتریان برای کافه — **۱۰۰٪ روی زیرساخت Cloudflare**:

| لایه | فناوری |
| --- | --- |
| Runtime | Cloudflare Workers (Serverless) |
| Backend | [Hono](https://hono.dev) |
| Database | Cloudflare D1 (SQLite) |
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS |
| Auth | JWT با `hono/jwt` + کوکی HttpOnly |

بدون بیلد استپ پیچیده، بدون سرور، بدون هزینه‌ی زیرساخت اضافه.

---

## ✨ قابلیت‌ها

### پورتال مشتری
- ثبت‌نام با نام، شماره موبایل، **تاریخ تولد شمسی** و کد معرف اختیاری
- کارت عضویت دیجیتال با کد معرف اختصاصی و لینک دعوت
- اعتبارسنجی سمت سرور برای شماره، تاریخ تولد و کد معرف
- محافظت ضد اسپم (Rate Limit) روی ثبت‌نام

### پنل کارمند (`/staff`)
- جستجوی مشتری با شماره موبایل (نوتیفیکیشن «مشتری یافت نشد» + لینک ثبت‌نام)
- انتخاب آیتم از منوی کافه + تعداد (یا ورود مبلغ دستی)
- اعمال **کد تخفیف** با پیش‌نمایش مبلغ تخفیف
- محاسبه‌ی خودکار امتیاز، نمایش رسید و ارسال پیامک تأیید
- آمار فاکتورهای امروز + صفحه‌ی تاریخچه‌ی فاکتورهای کارمند

### داشبورد ادمین (`/admin`)
- **نمای کلی:** کل مشتریان، فروش امروز، فروش ماه شمسی، مشتریان در خطر ریزش
- نمودار فروش ۷ روز، مشتریان برتر، آخرین فاکتورها
- **مدیریت مشتریان:** جستجو، فیلتر سطح/وضعیت، صفحه‌بندی، خروجی CSV
- **جزئیات مشتری:** ویرایش اطلاعات، تنظیم دستی امتیاز، فاکتورها، کدهای تخفیف، شبکه‌ی معرفی
- **تنظیمات:** قالب ۵ پیامک، نسبت امتیازدهی، سطح‌بندی، آستانه‌های ریزش، درصد تخفیف تولد، منوی کافه، کلیدهای API
- **مدیریت کارمندان:** ساخت/غیرفعال‌سازی/حذف، تغییر رمز، تغییر نقش (با محافظت از آخرین ادمین)
- **لاگ پیامک‌ها:** فیلتر بر اساس نوع و وضعیت
- **کدهای تخفیف:** ساخت کد عمومی یا اختصاصی، مدیریت انقضا
- اجرای دستی جاب‌ها برای تست

### جاب‌های خودکار (Cron)
| جاب | زمان (تهران) | توضیح |
| --- | --- | --- |
| پیش‌بینی ریزش | ۲۳:۰۰ هر شب | مشتریانی که بیش از «میانگین فاصله خرید + مهلت» نیامده‌اند پیامک «دلتنگیم» می‌گیرند (با کول‌داون ۳۰ روزه) |
| تولد | ۰۸:۰۰ هر روز | تبریک تولد + کد تخفیف اختصاصی ۱۴ روزه (یک‌بار در سال) |
| آب‌وهوا | ۰۸:۳۰ هر روز | وضعیت هوای شهر از OpenWeather و پیامک مناسب (بارانی/آفتابی/برفی…) |
| نگهداری | هر ساعت | بازمحاسبه میانگین خرید، انقضای کدها، پاک‌سازی لاگ‌های قدیمی |
| گزارش ماهانه | اول هر ماه | خلاصه‌ی عملکرد برای ادمین‌ها |

> جاب‌ها هر بار حداکثر ۵۰ پیامک می‌فرستند تا از سقف Subrequest پلن رایگان عبور نکنیم.

### سیستم معرفی
- هر مشتری یک کد یکتا مثل `REF-A1B2C3` دارد
- هنگام ثبت‌نام، کد معرف (یا شماره معرف) اعتبارسنجی می‌شود
- پس از **اولین فاکتور** مشتری معرفی‌شده، امتیاز پاداش به معرف اضافه می‌شود (یک‌بار)

---

## 🚀 راه‌اندازی سریع (محلی)

```bash
# ۱) نصب وابستگی‌ها
npm install

# ۲) یک کلید JWT بسازید
cp .dev.vars.example .dev.vars
# مقدار JWT_SECRET را با یک رشته تصادفی حداقل ۳۲ کاراکتری جایگزین کنید

# ۳) ساخت دیتابیس محلی D1
npm run db:init:local

# ۴) اجرا
npm run dev
# → http://localhost:8787
```

### حساب‌های پیش‌فرض

| نقش | شماره | رمز |
| --- | --- | --- |
| ادمین اصلی | `09120000000` | `Admin@12345` |
| کارمند نمونه | `09120000001` | `Staff@12345` |

> ⚠️ **قبل از انتشار عمومی** رمز هر دو حساب را از بخش «کارمندان → تغییر رمز عبور خودم» و «تغییر رمز» تغییر دهید و کارمند نمونه را حذف/غیرفعال کنید.

---

## ☁️ دیپلوی روی Cloudflare

### ۰) دریافت پروژه و رفتن به پوشهٔ درست

> ⚠️ **مهم‌ترین نکته:** هر دو خطای رایج
> `Unable to read SQL text file "schema.sql"` و
> `Required Worker name missing`
> یعنی دستور از **پوشهٔ اشتباه** اجرا شده است؛ یعنی `wrangler.toml` و `schema.sql` در پوشهٔ جاری نیستند.
> همیشه اول با `ls wrangler.toml schema.sql` مطمئن شوید که داخل ریشهٔ پروژه هستید.

```bash
git clone -b arena/ba9e1761-checklists https://github.com/boogh13822-spec/checklists.git cafe-club
cd cafe-club
npm install
```

### ۱) انتشار خودکار (ساده‌ترین راه) ⭐

یک اسکریپت آماده همهٔ مراحل زیر را انجام می‌دهد (ساخت D1، نوشتن `database_id`، اجرای schema، ساخت Secret و دیپلوی):

```bash
bash scripts/deploy.sh
```

### ۲) ساخت دیتابیس D1 (روش دستی)

```bash
npx wrangler login
npx wrangler d1 create cafe-club-db --location weur
```

خروجی یک `database_id` می‌دهد. آن را در `wrangler.toml` جای‌گذاری کنید:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cafe-club-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

اگر شناسه را گم کردید:

```bash
npx wrangler d1 list --json
```

### ۳) ساخت جدول‌ها و داده‌های اولیه

```bash
npx wrangler d1 execute cafe-club-db --remote --file=./schema.sql
# یا: npm run db:init:remote
```

> `schema.sql` تکرارپذیر است (`IF NOT EXISTS` + `ON CONFLICT DO NOTHING`)؛ اجرای دوبارهٔ آن آسیبی نمی‌زند.

### ۴) تنظیم Secret

```bash
npx wrangler secret put JWT_SECRET     # مقدار را در ترمینال پیست کنید (حداقل ۳۲ کاراکتر)
```

ساخت مقدار تصادفی:

```bash
openssl rand -base64 48
```

### ۵) انتشار

```bash
npx wrangler deploy
# یا: npm run deploy
```

اگر باز هم `Required Worker name missing` دیدید، یعنی wrangler فایل کانفیگ را پیدا نکرده است؛ با مسیر صریح اجرا کنید:

```bash
npx wrangler deploy --config ./wrangler.toml
# یا با تعیین دستی نام:
npx wrangler deploy --name cafe-club --config ./wrangler.toml
```

### ۶) اتصال دامنه (اختیاری)

در داشبورد Cloudflare → Workers & Pages → `cafe-club` → Settings → Domains & Routes، دامنه‌ی خود را اضافه کنید.

---

## 🔑 متغیرها و Secretها

| نام | نوع | الزام | توضیح |
| --- | --- | --- | --- |
| `JWT_SECRET` | Secret | **الزامی** | امضای توکن JWT؛ حداقل ۳۲ کاراکتر |
| `TZ_NAME` | Var | اختیاری | منطقه زمانی (پیش‌فرض `Asia/Tehran`) |
| `OPENWEATHER_API_KEY` | Secret | اختیاری | در صورت تنظیم، بر کلید ذخیره‌شده در تنظیمات اولویت دارد |
| `KAVENEGAR_API_KEY` | Secret | اختیاری | اولویت بر کلید ذخیره‌شده در تنظیمات |
| `SMS_SENDER` | Var | اختیاری | شماره فرستنده‌ی پیامک |

کلیدهای هواشناسی و پیامک را می‌توانید از **داشبورد → تنظیمات → اتصال سرویس‌ها** هم وارد کنید (در جدول `settings` ذخیره می‌شوند). استفاده از Secret برای محیط تولید توصیه می‌شود.

---

## 📱 سرویس پیامک

به صورت پیش‌فرض روی حالت `console` است: پیام‌ها فقط در لاگ Worker و جدول `sms_logs` ثبت می‌شوند — بدون هزینه و مناسب توسعه.

برای ارسال واقعی:
1. در [کاوه‌نگار](https://kavenegar.com) حساب بسازید و کلید API بگیرید.
2. در تنظیمات، «سرویس‌دهنده» را روی **کاوه‌نگار** بگذارید و کلید + شماره فرستنده را وارد کنید.
3. دکمه‌ی «پیامک آزمایشی به خودم» را بزنید و لاگ‌ها را در `/admin/sms` ببینید.

> برای سرویس‌دهنده‌های دیگر، تابع `sendSms` در `src/lib/sms.ts` را توسعه دهید.

## 🌤 سرویس هواشناسی

1. کلید رایگان از [OpenWeatherMap](https://openweathermap.org/api) بگیرید.
2. در تنظیمات → «کلید API هواشناسی» وارد کنید.
3. نام شهر را در «اطلاعات کافه» تنظیم کنید (مثلاً `Tehran`) و «تست آب‌وهوا» را بزنید.

اگر کلید تنظیم نشده باشد، جاب آب‌وهوا با پیام واضح رد می‌شود و بقیه‌ی برنامه بدون اختلال کار می‌کند.

---

## 🗂 ساختار پروژه

```
.
├── wrangler.toml            # تنظیمات Worker، D1 و Cron
├── schema.sql               # ساخت جدول‌ها + داده‌های اولیه
├── package.json
├── tsconfig.json
├── scripts/
│   └── hash-password.mjs    # ساخت هش PBKDF2 برای رمز عبور
└── src/
    ├── index.ts             # ★ نقطه‌ی ورود: همه‌ی روت‌ها، API ها و Cron
    ├── types.ts             # تایپ‌های مشترک
    ├── lib/
    │   ├── utils.ts         # تاریخ شمسی/میلادی، اعتبارسنجی، escape، پاسخ API
    │   ├── crypto.ts        # PBKDF2، تولید کد، Base64
    │   ├── auth.ts          # JWT، کوکی، نقش‌ها، Rate Limit
    │   ├── db.ts            # منطق امتیاز، فاکتور، معرفی، آمار
    │   ├── jobs.ts          # جاب‌های Cron
    │   ├── sms.ts           # ارسال پیامک + OpenWeather
    │   └── settings.ts      # تنظیمات و منو
    └── ui/
        ├── layout.ts        # پوسته، استایل‌ها، آیکون‌ها، JS مشترک
        ├── public.ts        # فرود، ثبت‌نام، ورود
        ├── staff.ts         # پنل کارمند
        ├── admin.ts         # داشبورد، مشتریان، فاکتورها
        └── adminManage.ts   # تنظیمات، کارمندان، پیامک‌ها، کدها
```

**درباره‌ی «یک فایل»:** طبق درخواست، تمام فرانت‌اند داخل Template Literal است و هیچ فایل HTML/CSS/JS جدا یا بیلد استپ فرانتی وجود ندارد. نقطه‌ی ورود و دیپلوی تنها یک فایل است (`src/index.ts`)؛ Wrangler بقیه‌ی ماژول‌ها را خودکار باندل می‌کند. اگر واقعاً یک فایل تک‌نفره برای «پنل Quick Edit» کلادفلر می‌خواهید:

```bash
npm run build:single     # → single-file/worker.js  (یک فایل، بدون import)
```

سپس محتوای `single-file/worker.js` را در ویرایشگر Quick Edit کلادفلر جای‌گذاری کنید و Binding دیتابیس `DB` را وصل کنید.

---

## 🧮 قواعد کسب‌وکار

- **امتیاز:** `floor(مبلغ ÷ واحد مبلغ) × امتیاز هر واحد` — پیش‌فرض: هر ۱٬۰۰۰ تومان = ۱ امتیاز
- **سطح‌ها:** برنزی (شروع) → نقره‌ای ۵۰۰ → طلایی ۲٬۰۰۰ → الماسی ۵٬۰۰۰ (قابل تغییر)
- **میانگین فاصله خرید:** از روی روزهای متمایز خرید (تا ۱۰۰ فاکتور اخیر) محاسبه می‌شود
- **آستانه‌ی ریزش:** `روزهای غیبت > میانگین + مهلت` و حداقل `churn_min_visits` خرید
  - اگر مشتری فقط یک روز خرید کرده باشد (میانگین صفر)، مبنای سنجش ۳۰ روز است
  - هر مشتری حداکثر هر ۳۰ روز یک پیامک دلتنگی می‌گیرد
- **تولد:** مقایسه‌ی ماه/روز شمسی؛ کد تخفیف سالی یک‌بار صادر می‌شود
- **کد تخفیف:** درصدی یا مبلغی، اختصاصی یک مشتری یا عمومی، با سقف استفاده و انقضا
- **پاداش معرف:** فقط پس از اولین فاکتور مشتری معرفی‌شده و فقط یک‌بار

---

## 🔌 مرجع API

همه‌ی پاسخ‌ها JSON و در قالب `{ ok: true, data }` یا `{ ok: false, error, code }` هستند.

### عمومی
| متد | مسیر | توضیح |
| --- | --- | --- |
| `POST` | `/api/auth/register` | ثبت‌نام مشتری |
| `POST` | `/api/auth/login` | ورود کارمند/ادمین |
| `POST` | `/api/auth/logout` | خروج |
| `GET` | `/api/auth/me` | کاربر جاری |
| `GET` | `/api/health` | سلامت سرویس و اتصال D1 |

### کارمند
| متد | مسیر | توضیح |
| --- | --- | --- |
| `GET` | `/api/staff/customer?phone=` | جستجوی مشتری + کدهای تخفیف فعال |
| `GET` | `/api/staff/coupons/check` | بررسی کد تخفیف |
| `POST` | `/api/staff/invoices` | ثبت فاکتور |
| `GET` | `/api/staff/invoices/today` | فاکتورهای امروز |

### ادمین
| متد | مسیر | توضیح |
| --- | --- | --- |
| `GET` | `/api/admin/stats` | آمار داشبورد |
| `POST` | `/api/admin/customers` | افزودن مشتری |
| `PUT` | `/api/admin/customers/:id` | ویرایش مشتری |
| `POST` | `/api/admin/customers/:id/points` | تنظیم امتیاز |
| `POST` | `/api/admin/customers/:id/activate` \| `deactivate` | فعال/غیرفعال |
| `GET`/`PUT` | `/api/admin/settings` | خواندن/ذخیره تنظیمات |
| `POST` | `/api/admin/jobs/:job` | اجرای دستی جاب (`churn`, `birthday`, `weather`, `maintenance`, `monthly`) |
| `POST` | `/api/admin/test-sms` | پیامک آزمایشی |
| `GET` | `/api/admin/weather` | تست آب‌وهوا |
| `GET`/`POST` | `/api/admin/staff` | فهرست/ایجاد کاربر |
| `PUT`/`DELETE` | `/api/admin/staff/:id` | ویرایش/حذف |
| `POST` | `/api/admin/staff/:id/password` | ساخت رمز جدید |
| `POST` | `/api/admin/me/password` | تغییر رمز خود |
| `POST` | `/api/admin/coupons` | ساخت کد تخفیف |
| `DELETE` | `/api/admin/coupons/:id` | غیرفعال‌سازی کد |
| `GET` | `/admin/export/customers.csv` | خروجی CSV |

---

## 🗄 جداول دیتابیس

| جدول | ستون‌های کلیدی |
| --- | --- |
| `users` | `id`, `name`, `phone (UNIQUE)`, `birth_date`, `points`, `tier`, `referred_by`, `referral_code`, `last_visit_date`, `avg_visit_interval`, `role`, `password_hash`, `is_active`, `first_purchase_at`, `referral_rewarded`, `last_churn_sms_at`, `created_at` |
| `invoices` | `id`, `user_id`, `amount`, `subtotal`, `discount`, `coupon_code`, `items (JSON)`, `points_earned`, `created_at`, `registered_by` |
| `settings` | `key (PK)`, `value (JSON)` |
| `sms_logs` | `id`, `user_id`, `type`, `status`, `message`, `provider_id`, `error`, `sent_at` |
| `coupons` | `id`, `code (UNIQUE)`, `user_id`, `kind`, `value`, `reason`, `max_uses`, `used_count`, `expires_at`, `is_active`, `created_at` |

---

## 🔐 امنیت

- **رمز عبور:** PBKDF2-SHA256 با نمک تصادفی ۱۶ بایتی و ۲۵٬۰۰۰ دور (سازگار با محدودیت CPU پلن رایگان). هر هش، تعداد دور خودش را ذخیره می‌کند؛ بنابراین افزایش دورها در آینده بدون شکستن رمزهای قبلی ممکن است. برای پلن Paid می‌توانید `PBKDF2_ITERATIONS` در `src/lib/crypto.ts` را افزایش دهید.
- **JWT:** HS256، انقضای ۱۲ ساعته، کوکی `HttpOnly` + `SameSite=Lax` + `Secure` روی HTTPS
- **CSRF:** بررسی هم‌مبدأ بودن `Origin` برای همه‌ی درخواست‌های تغییردهنده + کوکی SameSite
- **XSS:** به‌صورت پیش‌فرض همه‌ی مقادیر با `escapeHtml` رندر می‌شوند؛ خروجی JSON در اسکریپت‌ها با escape امن تزریق می‌شود
- **SQL Injection:** تمام کوئری‌ها Prepared Statement با Binding هستند
- **دسترسی:** هر مسیر API با `requireApiRole` و هر صفحه با `requirePageRole` محافظت می‌شود؛ نقش و فعال‌بودن کاربر در هر درخواست از دیتابیس بازخوانی می‌شود تا غیرفعال‌سازی فوری اعمال شود
- **Rate Limit:** ورود ۸ تلاش / ۱۵ دقیقه، ثبت‌نام ۶ / ۱۰ دقیقه، API عمومی ۱۲۰ / دقیقه (در حافظه‌ی ایزوله — بهترین تلاش)
- **سرصفحه‌های امنیتی:** `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`
- اعتبارسنجی و پاک‌سازی همه‌ی ورودی‌ها سمت سرور (نه فقط کلاینت)

> نکته: Rate Limit در حافظه‌ی هر ایزوله است. برای محدودسازی دقیق‌تر می‌توانید از Cloudflare WAF / Rate Limiting Rules استفاده کنید.

---

## 🛠 سفارشی‌سازی

| چه چیزی | کجا |
| --- | --- |
| رنگ‌ها و فونت | `src/ui/layout.ts` (بخش `tailwind.config` و `BASE_STYLES`) |
| قالب پیامک‌ها | از داشبورد → تنظیمات (یا `DEFAULT_SETTINGS` در `src/lib/settings.ts`) |
| منوی کافه | داشبورد → تنظیمات → منوی کافه |
| آستانه‌ها و امتیازدهی | داشبورد → تنظیمات |
| زمان جاب‌ها | `wrangler.toml` **و** `dispatchCron` در `src/lib/jobs.ts` (باید هم‌خوان باشند) |
| سرویس پیامک دیگر | `sendSms` در `src/lib/sms.ts` |

---

## 🧪 دستورهای مفید

```bash
npm run dev              # اجرای محلی روی 0.0.0.0:8787
npm run typecheck        # بررسی تایپ‌ها
npm run db:init:local    # ساخت/به‌روزرسانی D1 محلی
npm run db:init:remote   # اجرای schema.sql روی D1 ابری
npm run deploy           # انتشار Worker
npm run build:single     # ساخت تک‌فایل dist/worker.js
npm run hash-password -- 'MyPassword'   # ساخت هش برای seed
```

---

## 🩺 عیب‌یابی

| مشکل | راه‌حل |
| --- | --- |
| `Unable to read SQL text file "schema.sql"` | دستور از پوشهٔ اشتباه اجرا شده؛ `cd` به ریشهٔ پروژه‌ای که `schema.sql` در آن است (`ls wrangler.toml schema.sql`) |
| `Required Worker name missing` | `wrangler.toml` در پوشهٔ جاری نیست؛ یا `npx wrangler deploy --config ./wrangler.toml` بزنید یا فایل را کنار دستور بیاورید |
| `no such table: users` | `schema.sql` اجرا نشده؛ `npm run db:init:remote` |
| «کلید JWT تنظیم نشده است» | `npx wrangler secret put JWT_SECRET` (حداقل ۳۲ کاراکتر) |
| ورود با خطای CPU | پلن رایگان Workers سقف CPU کمی دارد؛ مقدار `PBKDF2_ITERATIONS` را کم کنید یا به پلن Paid ارتقا دهید |
| پیامک ارسال نمی‌شود | سرویس‌دهنده را روی کاوه‌نگار بگذارید، کلید و شماره فرستنده را وارد کنید، `/admin/sms` را ببینید |
| آب‌وهوا کار نمی‌کند | کلید OpenWeather و نام شهر (انگلیسی) را بررسی کنید |
| جاب‌ها اجرا نمی‌شوند | Cron در `wrangler.toml` باید با `dispatchCron` هم‌خوان باشد؛ لاگ Worker در داشبورد |
| فونت یا Tailwind لود نمی‌شود | دسترسی CDN از شبکه‌ی کاربر لازم است (برای محیط بسته، فایل‌ها را self-host کنید) |

---

## 📄 مجوز

MIT — استفاده، تغییر و انتشار آزاد است.
