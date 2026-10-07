# مرور دو پروژه اولیه و تصمیم‌های نسخه نهایی

## پروژه اول — build-discord-clone-app
نقاط قوت اصلی: مدل داده کامل‌تر برای Friendship / Room / Participant / Signal / Chat / Call Invite، رابط تماس پرجزئیات‌تر، و طراحی نئونی قوی.

محدودیت اصلی برای این محصول: تکیه بیشتر روی PostgreSQL/Drizzle و polling برای بخشی از realtime؛ بنابراین برای معماری ساده‌تر Cloudflare باید بازطراحی می‌شد.

## پروژه دوم — echocall
نقاط قوت اصلی: login/register تمیزتر، ساختار صفحه‌های اصلی ساده‌تر، و جریان احراز هویت سرراست‌تر.

محدودیت اصلی: منطق تماس و realtime به اندازه سناریوی تماس گروهی نهایی کامل نبود و برای Cloudflare به همان شکل قابل استقرار بهینه نبود.

## نتیجه ادغام
در HalloCall نسخه نهایی:

- تجربه ورود و داشبورد از الگوی UI تمیز پروژه دوم الهام گرفته شد.
- مدل Friendship / Invite / Call از منطق قوی‌تر پروژه اول بازطراحی و ساده‌سازی شد.
- polling دیتابیس برای signaling حذف و WebSocket + Durable Object جایگزین شد.
- PostgreSQL/Drizzle به D1 منتقل شد تا deployment یکپارچه روی Cloudflare انجام شود.
- اتاق تماس اکنون تا ۲۰ شرکت‌کننده را با سقف ثابت Durable Object پشتیبانی می‌کند؛ سیگنالینگ همچنان WebSocket است و مسیر صدا WebRTC P2P باقی می‌ماند.
- کنترل bitrate صدا، TURN آماده، presence، incoming call، chat، reaction، mute و speaking indicator به تجربه نهایی اضافه شد.
