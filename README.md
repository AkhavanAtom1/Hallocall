# HalloCall — Cloudflare Edition

یک اپلیکیشن تماس صوتی گروهی تا ۲۰ نفره با ظاهر شیشه‌ای/نئونی، حالت روشن/تاریک و شش پالت رنگی؛ ساخته‌شده برای استقرار مستقیم روی **Cloudflare Workers + Workers Static Assets + D1 + Durable Objects**.

## چیزهایی که در نسخه نهایی هست

- ثبت‌نام و ورود با Username + Password
- هش امن رمز عبور با PBKDF2/SHA-256 در Worker Runtime
- انتخاب آواتار هنگام ثبت‌نام و یک صفحه کامل «پروفایل‌ها» برای تغییر آن
- مجموعهٔ کامل ۴۵ آواتار با تصویر اختصاصی برای هر پروفایل (بدون پروفایل خالی) در کالکشن‌های فوتبال، ابرقهرمان‌ها، Elden Ring، Dark Souls و افسانه‌های بازی
- همهٔ پروفایل‌ها به‌صورت فایل‌های جداگانهٔ webp در پوشهٔ `image/` در گیت‌هاب نگهداری می‌شوند (تک‌منبع برای کل مجموعه) و هنگام build به `public/avatars/` کپی می‌شوند؛ تصویر قهرمان صفحهٔ اصلی و تصویر اتاق تماس هم در `image/site/` هستند
- فیلتر کالکشن (chip) روی گالری آواتار، پیش‌نمایش زنده و ذخیره آنی روی پروفایل
- سیستم دکمه‌ای GlowButton با سایهٔ نئونی آرام؛ انیمیشن «عبور نور» (shine sweep) روی دکمه‌ها به درخواست کاربر حذف شده و فقط lift ملایم hover باقی مانده است
- صحنهٔ پس‌زمینهٔ لایه‌ای و رنگی: چهار aurora (بنفش/فیروزه‌ای/صورتی/کهربایی)، grid محو، ذرات درخشان و vignette؛ در صفحهٔ ورود نوار پروفایل‌ها نمایش داده می‌شود و `prefers-reduced-motion` رعایت می‌شود
- جست‌وجوی کاربران با Username
- Friend Request / Accept / Decline / Remove
- Presence آنلاین/آفلاین
- دکمه تماس سریع برای دوستان آنلاین
- Incoming Call با Accept / Decline — قبول درخواست، شما را وارد **همان تماسی** می‌کند که دوستتان درخواست داده بود
- ساخت Call با کد یکتا و لینک مستقیم قابل کپی؛ سازنده همان لحظه به‌عنوان میزبان وارد می‌شود
- نمایش کد و لینک مستقیم ورود در صفحهٔ کال با کپی یک‌کلیکی (بدون نیاز به Share)
- لینک مستقیم دعوت: لینک `/call/<CODE>` را به هر کسی بده؛ با کلیک روی آن مستقیم وارد همان تماس می‌شود (حتی اگر قبلاً وارد نشده باشد — بعد از ورود مستقیم به تماس می‌رود)
- رفرش خودکار هر ۱.۵ ثانیهٔ فهرست دوستان، درخواست‌های دوستی و درخواست‌های تماس تا هر رویدادی همان لحظه دیده شود
- Join Call با کد
- WebRTC صوتی P2P
- WebSocket واقعی برای signaling، حضور داخل کال، mute state، chat و reactions
- Durable Object مجزا برای هر Call Code
- نمایش هاله سبز هنگام صحبت کردن
- هاله قرمز هنگام mute
- دکمه‌های دایره‌ای برای میکروفون، چت، ایموجی، کیفیت صدا و خروج
- کنترل کیفیت صدای خروجی از 12 تا 96 kbps؛ سه preset و slider، با اعمال روی senderهای فعلی و اتصال‌های جدید
- آماده برای Cloudflare TURN؛ در نبود TURN از STUN fallback استفاده می‌شود
- حالت روشن/تاریک و ۶ تم رنگی قابل انتخاب از نوار بالای صفحه‌ها: بنفش نئونی، اقیانوسی، رز نئونی، زمردی، غروب و «مخصوص» (ترکیب اختصاصی بنفش، فیروزه‌ای، صورتی و طلایی)؛ انتخاب‌ها روی همین دستگاه ذخیره می‌شوند
- Responsive برای موبایل و دسکتاپ
- رابط responsive با glass و glow کنترل‌شده، پشتیبانی واقعی‌تر از تم روشن/تاریک و کاهش موشن در دستگاه‌های لمسی
- مدیریت بهتر دعوت تماس: جلوگیری از زنگ‌زدن تکراری، انقضای دعوت‌های قدیمی و پایان درست تماس ردشده
- بررسی ظرفیت ۲۰ نفره قبل از ورود و نمایش بهتر وضعیت پایان تماس
- چیدمان واکنش‌گرا برای اتاق‌های شلوغ تا ۲۰ شرکت‌کننده
- fallback کپی لینک برای مرورگرهایی که Clipboard کامل ندارند

## چرا این نسخه نسبت به دو پروژه قبلی بهتر است؟

پروژه اول مدل داده‌ی تماس و سیگنالینگ کامل‌تری داشت، اما polling دیتابیس باعث می‌شد realtime بودن وابسته به درخواست‌های تکراری باشد و برای Cloudflare معماری مناسبی نباشد.

پروژه دوم از نظر login و ساختار UI ساده‌تر و تمیزتر بود، اما منطق تماس و مدل Call تک‌شرکت‌کننده محدودتر بود.

این نسخه از منطق قوی Call/Invite/Presence الهام گرفته و آن را در معماری Cloudflare-native بازسازی کرده است:

- **D1**: کاربران، sessionها، فرندها، call metadata و invitationها
- **Durable Object**: WebSocket signalling و state لحظه‌ای هر Call
- **WebRTC**: انتقال مستقیم صدای بین مرورگرها
- **Workers Static Assets**: سرو شدن رابط React/Vite از کنار Worker API

## ساختار

```text
hallocall/
├─ image/                     # منبع اصلی هر ۴۵ پروفایل (webp، ۵۱۲×۵۱۲) + تصویرهای رابط در image/site/
├─ scripts/compose-avatars.mjs # تبدیل خروجی خام `.gen/` به webp نهایی در image/ (ImageMagick)
├─ scripts/build-avatars.mjs  # کپی image/ به public/avatars/ هنگام build
├─ src/
│  ├─ App.tsx                 # صفحات اصلی و جریان کاربری
│  ├─ main.tsx
│  ├─ styles.css              # تم پایه
│  ├─ premium.css             # لایهٔ بصری اصلی
│  ├─ refinement.css           # اصلاح responsive، accessibility و کاهش موشن
│  ├─ theme.css                # پالت‌های رنگی پویا و کنترل‌های نوار بالایی
│  ├─ components/ThemeControls.tsx # انتخاب پالت رنگی و حالت روشن/تاریک
│  ├─ components/CallRoom.tsx # اتاق تماس، WebRTC، چت و تنظیم بیت‌ریت
│  ├─ components/Icon.tsx
│  ├─ components/Scene.tsx    # پس‌زمینهٔ ثابت و helper spotlight
│  ├─ components/GlowButton.tsx
│  ├─ components/AvatarPicker.tsx
│  ├─ components/AvatarImage.tsx
│  ├─ lib/api.ts              # کلاینت API
│  ├─ lib/avatars.ts          # رجیستری آواتارها از روی کاتالوگ JSON
│  ├─ lib/avatars.catalog.json # تعریف ۴۵ پروفایل (رنگ، لیبل، کالکشن، فایل رندر)
│  ├─ lib/types.ts
│  ├─ lib/webrtc.ts            # TURN/STUN + bitrate control
│  └─ worker/index.ts          # Worker API + Durable Object
├─ migrations/0001_init.sql   # D1 schema
├─ wrangler.jsonc
├─ vite.config.ts
└─ package.json
```

## اجرای محلی

برای اجرای کامل UI و API محلی، ابتدا migration دیتابیس محلی را اجرا کن؛ سپس در دو ترمینال Worker و رابط Vite را بالا بیاور. مسیرهای `/api` و `/ws` در Vite به Worker محلی proxy می‌شوند:

```bash
npm install
npm run db:migrate:local
npm run worker:dev
```

در ترمینال دوم:

```bash
npm run dev
```

اگر فقط بخواهی ظاهر رابط را ببینی، `npm run dev` به‌تنهایی هم اجرا می‌شود؛ ورود/ثبت‌نام و تماس برای کارکرد کامل به Worker و D1 محلی نیاز دارند.

برای typecheck و build کامل:

```bash
npm run verify
```

برای اجرای نسخه‌ای که خود Wrangler همراه با Static Assets سرو می‌کند:

```bash
npm run cf:dev
```

## اتصال D1

اول وارد Cloudflare شوید:

```bash
npx wrangler login
```

سپس یک D1 بسازید:

```bash
npx wrangler d1 create hallocall-db
```

مقدار `database_id` برگشتی را در `wrangler.jsonc` جایگزین کنید:

```jsonc
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

بعد migration را اجرا کنید:

```bash
npm run db:migrate:remote
```

برای دیتابیس محلی:

```bash
npm run db:migrate:local
```

## دیپلوی از سیستم شخصی

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

بعد از deploy، یک آدرس `workers.dev` دریافت می‌کنید. بعداً می‌توانید از Cloudflare برای آن Custom Domain هم تنظیم کنید.

## اتصال GitHub به Cloudflare

1. پروژه را در یک repository جدید GitHub قرار دهید.
2. در داشبورد Cloudflare بخش Workers & Pages را باز کنید.
3. پروژه Git را به Workers متصل کنید.
4. Build command را `npm run build` قرار دهید.
5. deploy را با Wrangler configuration همین repository انجام دهید.
6. D1 را به همین Worker bind کنید؛ این binding از قبل در `wrangler.jsonc` تعریف شده است.
7. migration دیتابیس را یک‌بار روی database اصلی اجرا کنید.

برای این پروژه **Workers + Static Assets** پیشنهاد می‌شود، نه یک Pages-only deployment؛ چون API و Durable Object هم بخشی از همان برنامه هستند.

## استقرار خودکار از GitHub

داخل پروژه یک workflow اختیاری در `.github/workflows/deploy.yml` قرار داده شده است. اگر در GitHub یک secret با نام `CLOUDFLARE_API_TOKEN` بسازید، هر push به branch `main` می‌تواند build، typecheck و deploy را انجام دهد.

Migration دیتابیس را عمداً از deploy خودکار جدا نگه داشته‌ام تا تغییر schema ناخواسته روی production اجرا نشود؛ migration را هنگام تغییر دیتابیس دستی اجرا کنید.

## TURN برای تماس‌های پایدارتر

در حالت فعلی اگر TURN تنظیم نشده باشد، برنامه از Cloudflare STUN و Google STUN به‌عنوان fallback استفاده می‌کند.

برای اینترنت‌هایی که NAT یا Firewall سخت‌گیر دارند، Cloudflare Realtime TURN را فعال کنید و دو secret زیر را به Worker بدهید:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

بعد برنامه از endpoint `/api/webrtc/ice` برای گرفتن ICE Server credentials کوتاه‌عمر استفاده می‌کند.

## نکته مهم درباره کیفیت صدا

کنترل Call سقف بیت‌ریت صدای خروجی را از 12 تا 96 kbps تغییر می‌دهد و مقدار واقعی را با kbps نشان می‌دهد. سه preset کم، متعادل و شفاف هم دارد. مرورگر و شرایط شبکه می‌توانند بیت‌ریت نهایی را پایین‌تر نگه دارند.

در مرورگرهایی که محدودیت روی `RTCRtpSender.setParameters()` دارند، برنامه بدون خراب کردن تماس ادامه می‌دهد.

## نکات امنیتی قبل از استفاده عمومی

- برای production از HTTPS استفاده کنید؛ WebRTC microphone روی secure context به دسترسی میکروفون نیاز دارد.
- TURN API token را فقط به‌صورت Worker secret نگه دارید.
- Rate limiting برای login/register/search/invite را می‌توان در مرحله بعد با Worker/Rate Limiting اضافه کرد.
- برای abuse prevention بهتر است بعداً گزارش کاربر، block و محدودیت تعداد دعوت تماس اضافه شود.
- sessionهای منقضی‌شده به‌صورت opportunistic پاک می‌شوند؛ می‌توان یک cleanup job دوره‌ای هم اضافه کرد.

## نام پروژه

`HalloCall` نام داخلی/نمایشی پروژه است و می‌توانید در `index.html` و عنوان‌های UI هر نام دلخواهی جایگزین کنید.
