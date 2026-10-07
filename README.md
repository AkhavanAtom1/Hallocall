# HalloCall — Cloudflare Edition

یک اپلیکیشن تماس صوتی گروهی تا ۲۰ نفره با ظاهر شیشه‌ای/نئونی و دو تم Dark/Light؛ ساخته‌شده برای استقرار مستقیم روی **Cloudflare Workers + Workers Static Assets + D1 + Durable Objects**.

## چیزهایی که در نسخه نهایی هست

- ثبت‌نام و ورود با Username + Password
- هش امن رمز عبور با PBKDF2/SHA-256 در Worker Runtime
- انتخاب آواتار هنگام ثبت‌نام و یک صفحه کامل «پروفایل‌ها» برای تغییر آن
- ۳۰ آواتار تصویری در ۴ کالکشن: ۱۵ افسانه فوتبال، ۵ شخصیت Elden Ring، ۵ شوالیه Dark Souls و ۵ آیکون بازی
- همه آواتارها در یک sprite تک‌فایل ۶×۵ (webp) با حلقه نئونی، rim-light و هاله رنگی هر پروفایل
- فیلتر کالکشن (chip) روی گالری آواتار، پیش‌نمایش زنده و ذخیره آنی روی پروفایل
- سیستم دکمه‌ای GlowButton: سایه لایه‌ای، spotlight دنبال‌کننده ماوس، shine sweep و هاله کف دکمه
- پس‌زمینه چندلایه: aurora متحرک، پرتوهای نوری استادیوم، گرید، جرقه، film grain و vignette
- جست‌وجوی کاربران با Username
- Friend Request / Accept / Decline / Remove
- Presence آنلاین/آفلاین
- دکمه تماس سریع برای دوستان آنلاین
- Incoming Call با Accept / Decline
- ساخت Call با کد یکتا و لینک قابل اشتراک؛ سازنده همان لحظه به‌عنوان میزبان وارد می‌شود
- نمایش کد و دکمه اشتراک‌گذاری در هدر کال
- Join Call با کد
- WebRTC صوتی P2P
- WebSocket واقعی برای signaling، حضور داخل کال، mute state، chat و reactions
- Durable Object مجزا برای هر Call Code
- نمایش هاله سبز هنگام صحبت کردن
- هاله قرمز هنگام mute
- دکمه‌های دایره‌ای برای میکروفون، چت، ایموجی، کیفیت صدا و خروج
- کنترل کیفیت صدا از 12 تا 96 kbps با `RTCRtpSender.setParameters()`
- آماده برای Cloudflare TURN؛ در نبود TURN از STUN fallback استفاده می‌شود
- Dark Mode / Light Mode
- Responsive برای موبایل و دسکتاپ
- CSS glow / glass / ambient orbs / rim-light / hover-lift / pulse / shimmer motion بدون نیاز به UI library
- مدیریت بهتر دعوت تماس: جلوگیری از زنگ‌زدن تکراری، انقضای دعوت‌های قدیمی و پایان درست تماس ردشده
- بررسی ظرفیت ۲۰ نفره قبل از ورود و نمایش بهتر وضعیت پایان تماس
- چیدمان واکنش‌گرا برای اتاق‌های شلوغ تا ۲۰ شرکت‌کننده
- fallback اشتراک‌گذاری لینک برای مرورگرهایی که Clipboard/Share کامل ندارند

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
├─ src/
│  ├─ App.tsx                 # UI اصلی + صفحات + Call UI
│  ├─ main.tsx
│  ├─ styles.css              # تم پایه
│  ├─ premium.css             # لایه نورپردازی، موشن و کامپوننت‌های بصری
│  ├─ assets/legends-avatars.b64  # sprite آواتارها (base64، خروجی compose-avatars)
│  ├─ components/Icon.tsx
│  ├─ components/Scene.tsx    # پس‌زمینه چندلایه + helper نور spotlight
│  ├─ components/GlowButton.tsx
│  ├─ components/AvatarPicker.tsx
│  ├─ components/AvatarImage.tsx
│  ├─ lib/api.ts              # کلاینت API
│  ├─ lib/avatars.ts          # رجیستری آواتارها از روی کاتالوگ JSON
│  ├─ lib/avatars.catalog.json # تعریف ۳۰ پروفایل (رنگ، لیبل، کالکشن، فایل رندر)
│  ├─ lib/types.ts
│  ├─ lib/webrtc.ts            # TURN/STUN + bitrate control
│  └─ worker/index.ts          # Worker API + Durable Object
├─ scripts/compose-avatars.mjs  # ساخت sprite از avatar-src/*.png (dev، ImageMagick)
├─ migrations/0001_init.sql   # D1 schema
├─ wrangler.jsonc
├─ vite.config.ts
└─ package.json
```

## اجرای محلی UI

```bash
npm install
npm run dev
```

برای اجرای نسخه‌ای که واقعاً توسط Wrangler سرو می‌شود:

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

Slider داخل Call یک عدد 0 تا 100 دارد و bitrate سمت sender را تغییر می‌دهد:

- پایین: مناسب اینترنت ضعیف و مصرف کمتر
- وسط: تعادل کیفیت/مصرف
- بالا: صدای شفاف‌تر و مصرف بیشتر

در مرورگرهایی که محدودیت روی `RTCRtpSender.setParameters()` دارند، برنامه بدون خراب کردن تماس ادامه می‌دهد.

## نکات امنیتی قبل از استفاده عمومی

- برای production از HTTPS استفاده کنید؛ WebRTC microphone روی secure context به دسترسی میکروفون نیاز دارد.
- TURN API token را فقط به‌صورت Worker secret نگه دارید.
- Rate limiting برای login/register/search/invite را می‌توان در مرحله بعد با Worker/Rate Limiting اضافه کرد.
- برای abuse prevention بهتر است بعداً گزارش کاربر، block و محدودیت تعداد دعوت تماس اضافه شود.
- sessionهای منقضی‌شده به‌صورت opportunistic پاک می‌شوند؛ می‌توان یک cleanup job دوره‌ای هم اضافه کرد.

## نام پروژه

`HalloCall` نام داخلی/نمایشی پروژه است و می‌توانید در `index.html` و عنوان‌های UI هر نام دلخواهی جایگزین کنید.
