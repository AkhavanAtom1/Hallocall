import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api } from "./lib/api";
import { avatarOf, AVATARS } from "./lib/avatars";
import { getIceServers, applyAudioQuality } from "./lib/webrtc";
import type { CallInfo, Friend, FriendRequest, IncomingCall, Participant, User } from "./lib/types";
import { Icon } from "./components/Icon";

const QUICK_EMOJIS = ["😂","❤️","👍","🔥","🎉","😮","👏","🙌","💯","✨","🥳","👀"];

function AvatarImage({ avatar }: { avatar: ReturnType<typeof avatarOf> }) {
  if (!avatar.src || !avatar.sprite) {
    return <span className="avatar-emoji" aria-hidden="true">{avatar.emoji}</span>;
  }
  const [x, y] = avatar.sprite;
  return (
    <span
      className="avatar-photo"
      role="img"
      aria-label={avatar.label}
      style={{
        backgroundImage: `url(${avatar.src})`,
        backgroundPosition: `${x / 3 * 100}% ${y / 3 * 100}%`,
      }}
    />
  );
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    return ok;
  } catch {
    return false;
  }
}

type Route = { page:"login" } | { page:"dashboard" } | { page:"friends" } | { page:"calls" } | { page:"call"; code:string };

function routeFromPath(path = location.pathname): Route {
  if (path.startsWith("/call/")) return { page:"call", code:decodeURIComponent(path.slice(6)).toUpperCase() };
  if (path === "/friends") return { page:"friends" };
  if (path === "/calls") return { page:"calls" };
  if (path === "/login" || path === "/") return { page:"login" };
  return { page:"dashboard" };
}

function useRoute() {
  const [route,setRoute] = useState<Route>(()=>routeFromPath());
  const go = useCallback((path:string) => { history.pushState({},"",path); setRoute(routeFromPath(path)); window.scrollTo(0,0); },[]);
  useEffect(()=>{ const onPop=()=>setRoute(routeFromPath()); addEventListener("popstate",onPop); return()=>removeEventListener("popstate",onPop);},[]);
  return {route,go};
}

export function App() {
  const { route, go } = useRoute();
  const [user,setUser] = useState<User|null>(null);
  const [booting,setBooting] = useState(true);
  const [dark,setDark] = useState(()=>localStorage.getItem("hallocall-theme") !== "light");
  const [incoming,setIncoming] = useState<IncomingCall|null>(null);
  const [profileOpen,setProfileOpen] = useState(false);
  const [toast,setToast] = useState<string|undefined>(undefined);

  useEffect(()=>{ document.documentElement.classList.toggle("light",!dark); document.documentElement.classList.toggle("dark",dark); localStorage.setItem("hallocall-theme",dark?"dark":"light"); },[dark]);
  useEffect(()=>{ api.me().then((d)=>setUser(d.user)).catch(()=>{}).finally(()=>setBooting(false)); },[]);
  useEffect(()=>{ if(!booting && user && route.page==="login") go("/dashboard"); },[booting,user,route.page,go]);
  useEffect(()=>{ if (!user) return; api.touch().catch(()=>{}); const id=setInterval(()=>api.touch().catch(()=>{}),10000); return()=>clearInterval(id); },[user]);
  useEffect(()=>{ if(!user || route.page==="call") return; let active=true; const poll=async()=>{ try { const d=await api.incoming(); if(active) setIncoming(d.calls[0]??null);} catch{} }; poll(); const id=setInterval(poll,2200); return()=>{active=false;clearInterval(id)}; },[user,route.page]);
  useEffect(()=>{ if(!toast) return; const id=setTimeout(()=>setToast(undefined),2500); return()=>clearTimeout(id); },[toast]);

  const logout=async()=>{ await api.logout().catch(()=>{}); setUser(null); go("/login"); };
  const signIn=(u:User)=>{ setUser(u); go("/dashboard"); };
  const respondIncoming=async(action:"accept"|"decline")=>{ if(!incoming) return; try { const d=await api.respondCall(incoming.inviteId,action); const code=d.code; setIncoming(null); if(action==="accept" && code) go(`/call/${code}`); } catch(e){setToast(e instanceof Error?e.message:"خطا")}; };

  if (booting) return <BootScreen dark={dark} />;
  const effectivePage = route.page === "login" && user ? "dashboard" : route.page;
  if (route.page==="login" && !user) return <LoginPage onSuccess={signIn} dark={dark} setDark={setDark} />;
  if (!user) { go("/login"); return null; }
  if (route.page==="call") return <CallPage user={user} code={route.code} go={go} dark={dark} setDark={setDark} />;

  return <>
    <AppShell user={user} route={route} go={go} dark={dark} setDark={setDark} logout={logout} openProfile={()=>setProfileOpen(true)}>
      {effectivePage==="dashboard" && <Dashboard user={user} go={go} onToast={setToast}/>} 
      {effectivePage==="friends" && <Friends user={user} go={go} onToast={setToast}/>} 
      {effectivePage==="calls" && <Calls go={go} onToast={setToast}/>} 
    </AppShell>
    {incoming && <IncomingOverlay call={incoming} onAccept={()=>respondIncoming("accept")} onDecline={()=>respondIncoming("decline")} />}
    {profileOpen && <ProfileModal user={user} onClose={()=>setProfileOpen(false)} onSave={(u)=>{setUser(u);setProfileOpen(false);setToast("آواتارت ذخیره شد")}} />}
    {toast && <div className="toast glass">{toast}</div>}
  </>;
}

function BootScreen({dark}:{dark:boolean}) { return <div className="app-bg boot"><div className="brand-mark"><span>◈</span></div><div className="spinner"/><p>در حال آماده‌سازی HalloCall</p><small>{dark?"حالت تاریک":"حالت روشن"}</small></div> }

function LoginPage({onSuccess,dark,setDark}:{onSuccess:(u:User)=>void;dark:boolean;setDark:(v:boolean)=>void}) {
  const [mode,setMode]=useState<"login"|"register">("login"); const [username,setUsername]=useState(""); const [password,setPassword]=useState(""); const [avatar,setAvatar]=useState(AVATARS[0].id); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{const d=mode==="login"?await api.login(username,password):await api.register(username,password,avatar);onSuccess(d.user);}catch(err){setError(err instanceof Error?err.message:"خطایی رخ داد.")}finally{setBusy(false)}};
  return <main className="auth-page app-bg">
    <div className="aurora a1"/><div className="aurora a2"/><div className="aurora a3"/>
    <button className="icon-btn theme-btn" onClick={()=>setDark(!dark)} aria-label="theme"><Icon name={dark?"sun":"moon"}/></button>
    <section className="auth-hero">
      <div className="brand-lockup"><div className="brand-mark large"><span>◈</span></div><div><h1>Hallo<span>Call</span></h1><p>Voice calls, friends, zero clutter.</p></div></div>
      <div className="hero-copy"><span className="eyebrow"><i/> ساخته‌شده برای تماس‌های دو نفره</span><h2>یک تماس.<br/><em>یک حلقه نور.</em><br/>و تمام.</h2><p>دوستت را با یوزرنیم پیدا کن، تماس بگیر و بدون شلوغی وارد یک فضای صوتی تمیز و جذاب شوید.</p></div>
      <div className="feature-row"><Feature icon="users" title="Friends" text="دوستان آنلاین را ببین"/><Feature icon="call" title="One‑tap call" text="تماس مستقیم با یک کلیک"/><Feature icon="signal" title="Adaptive audio" text="کنترل کیفیت برای اینترنت ضعیف"/></div>
    </section>
    <section className="auth-card glass">
      <div className="auth-card-top"><div><p className="muted">خوش آمدی</p><h3>{mode==="login"?"وارد حساب شو":"حساب خودت را بساز"}</h3></div><div className="mini-status"><span/> آنلاین در هر دو حالت</div></div>
      <div className="segmented"><button className={mode==="login"?"active":""} onClick={()=>setMode("login")}>ورود</button><button className={mode==="register"?"active":""} onClick={()=>setMode("register")}>ثبت‌نام</button></div>
      {error&&<div className="error-box"><Icon name="info" size={17}/><span>{error}</span></div>}
      <form onSubmit={submit}>
        <Field label="نام کاربری" value={username} onChange={setUsername} placeholder="مثلاً ali_23" dir="ltr" />
        <Field label="رمز عبور" type="password" value={password} onChange={setPassword} placeholder="حداقل ۶ کاراکتر" dir="ltr" />
        {mode==="register"&&<div className="avatar-picker"><div className="field-label"><span>آواتار فوتبالی پروفایل</span><small>از ۱۵ آواتار لیگندری انتخاب کن</small></div><div className="avatar-grid">{AVATARS.map(a=><button type="button" key={a.id} title={a.label} aria-label={a.label} className={avatar===a.id?"avatar-choice selected":"avatar-choice"} onClick={()=>setAvatar(a.id)} style={{background:a.gradient,boxShadow:avatar===a.id?`0 0 0 3px var(--panel),0 0 0 5px ${a.glow}`:undefined}}><AvatarImage avatar={a}/></button>)}</div></div>}
        <button disabled={busy} className="primary-btn wide">{busy?<><span className="tiny-spinner"/>در حال ورود...</>:<>{mode==="login"?"ورود به HalloCall":"ساخت حساب و ورود"}<Icon name="arrow" size={18}/></>}</button>
      </form>
      <div className="security-note"><span>●</span> رمز عبور به‌صورت هش‌شده ذخیره می‌شود</div>
    </section>
  </main>
}
function Field({label,type="text",value,onChange,placeholder,dir}:{label:string;type?:string;value:string;onChange:(s:string)=>void;placeholder:string;dir?:string}){return <label className="field"><span>{label}</span><input dir={dir} type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required /></label>}
function Feature({icon,title,text}:{icon:string;title:string;text:string}){return <div className="feature glass"><div className="feature-icon"><Icon name={icon}/></div><div><b>{title}</b><span>{text}</span></div></div>}

function AppShell({user,route,go,dark,setDark,logout,openProfile,children}:{user:User;route:Route;go:(s:string)=>void;dark:boolean;setDark:(v:boolean)=>void;logout:()=>void;openProfile:()=>void;children:ReactNode}){
  const avatar=avatarOf(user.avatar); return <div className="app-bg shell"><div className="aurora a1"/><div className="aurora a2"/>
    <aside className="sidebar glass">
      <div className="sidebar-brand"><div className="brand-mark"><span>◈</span></div><div><b>Hallo<span>Call</span></b><small>voice workspace</small></div></div>
      <nav><NavItem icon="users" label="فرندها" active={route.page==="friends"||route.page==="dashboard"} onClick={()=>go("/friends")}/><NavItem icon="call" label="کال‌ها" active={route.page==="calls"} onClick={()=>go("/calls")}/></nav>
      <div className="sidebar-spacer"/>
      <button className="profile-chip" onClick={openProfile}><div className="avatar" style={{background:avatar.gradient,boxShadow:`0 0 22px ${avatar.glow}`}}><AvatarImage avatar={avatar}/><span className="online-dot"/></div><div className="profile-text"><b>{user.username}</b><span>آنلاین</span></div><Icon name="settings" size={17}/></button>
      <div className="sidebar-actions"><button className="icon-btn" onClick={()=>setDark(!dark)} title="تغییر تم"><Icon name={dark?"sun":"moon"}/></button><button className="icon-btn danger-lite" onClick={logout} title="خروج"><Icon name="logout"/></button></div>
    </aside>
    <main className="content">{children}</main>
  </div>
}
function NavItem({icon,label,active,onClick}:{icon:string;label:string;active:boolean;onClick:()=>void}){return <button onClick={onClick} className={active?"nav-item active":"nav-item"}><span className="nav-icon"><Icon name={icon}/></span><span>{label}</span>{active&&<i/>}</button>}

function Dashboard({user,go,onToast}:{user:User;go:(s:string)=>void;onToast:(s:string)=>void}){
  const [friends,setFriends]=useState<Friend[]>([]); useEffect(()=>{api.friends().then(d=>setFriends(d.friends)).catch(()=>{});},[]); const online=friends.filter(f=>f.online);
  const quickCall=async(friend:Friend)=>{try{const d=await api.invite(friend.id);onToast(`درخواست تماس برای ${friend.username} ارسال شد`);go(`/call/${d.call.code}`);}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  return <div className="page"><PageTop eyebrow="WORKSPACE" title={`سلام ${user.username} 👋`} desc="همه‌چیز برای یک تماس سریع آماده است."/><section className="dashboard-grid">
    <div className="hero-card glass"><div className="hero-glow"/><div className="hero-content"><span className="eyebrow"><i/> ONLINE VOICE</span><h2>صدای دوستت<br/><em>همین نزدیکی است.</em></h2><p>از لیست فرندها یک تماس مستقیم بگیر یا یک کال بساز و لینک آن را بفرست.</p><div className="hero-actions"><button className="primary-btn" onClick={()=>go("/calls")}><Icon name="call"/> ساخت کال</button><button className="ghost-btn" onClick={()=>go("/friends")}><Icon name="users"/> مدیریت فرندها</button></div></div><div className="hero-orbit"><div className="orbit-ring r1"/><div className="orbit-ring r2"/><div className="orbit-core">🎧</div></div></div>
    <div className="stat-card glass"><div className="stat-icon green"><Icon name="users"/></div><div><span>فرندهای آنلاین</span><b>{online.length}</b></div><button onClick={()=>go("/friends")}>مشاهده <Icon name="arrow" size={15}/></button></div>
    <div className="stat-card glass"><div className="stat-icon purple"><Icon name="signal"/></div><div><span>کیفیت هوشمند</span><b>12–96 kbps</b></div><button onClick={()=>go("/calls")}>تنظیمات <Icon name="arrow" size={15}/></button></div>
  </section><section className="section-head"><div><h3>فرندهای آنلاین</h3><p>برای تماس، یک نفر را انتخاب کن.</p></div><button className="text-btn" onClick={()=>go("/friends")}>همه فرندها <Icon name="arrow" size={15}/></button></section>
  <div className="friend-strip">{online.slice(0,6).map(f=><FriendCard key={f.id} friend={f} onCall={()=>quickCall(f)}/>)}{online.length===0&&<EmptyCard title="فعلاً کسی آنلاین نیست" text="وقتی یکی از فرندها آنلاین شود، دکمه تماس اینجا ظاهر می‌شود." icon="moon"/>}</div>
</div>
}
function PageTop({eyebrow,title,desc}:{eyebrow:string;title:string;desc:string}){return <header className="page-top"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{desc}</p></div><div className="live-pill"><span/> سرویس آنلاین <small>•</small> WebRTC ready</div></header>}
function FriendCard({friend,onCall}:{friend:Friend;onCall:()=>void}){const a=avatarOf(friend.avatar);return <div className="friend-card glass"><div className="card-avatar" style={{background:a.gradient,boxShadow:`0 0 24px ${a.glow}`}}><AvatarImage avatar={a}/><span className="speck"/></div><div className="card-user"><b>{friend.username}</b><span><i/> آنلاین</span></div><button className="call-mini" onClick={onCall}><Icon name="call" size={17}/></button></div>}
function EmptyCard({title,text,icon}:{title:string;text:string;icon:string}){return <div className="empty-card glass"><div className="empty-icon"><Icon name={icon}/></div><div><b>{title}</b><p>{text}</p></div></div>}

function Friends({user,go,onToast}:{user:User;go:(s:string)=>void;onToast:(s:string)=>void}){
  const [friends,setFriends]=useState<Friend[]>([]); const [requests,setRequests]=useState<FriendRequest[]>([]); const [q,setQ]=useState(""); const [results,setResults]=useState<User[]>([]); const timer=useRef<number | undefined>(undefined);
  const load=useCallback(()=>api.friends().then(d=>{setFriends(d.friends);setRequests(d.requests)}).catch(()=>{}),[]); useEffect(()=>{load();const id=setInterval(load,9000);return()=>clearInterval(id)},[load]);
  const search=(value:string)=>{setQ(value);window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>{if(value.trim().length>=2)api.searchUsers(value.trim()).then(d=>setResults(d.users)).catch(()=>setResults([]));else setResults([])},260)};
  const add=async(id:string)=>{try{await api.friendRequest(id);onToast("درخواست دوستی ارسال شد");setResults([]);setQ("");load()}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  const respond=async(id:string,action:"accept"|"decline")=>{try{await api.friendRespond(id,action);load()}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  const call=async(f:Friend)=>{try{const d=await api.invite(f.id);onToast(`درخواست تماس برای ${f.username} ارسال شد`);go(`/call/${d.call.code}`)}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  return <div className="page"><PageTop eyebrow="FRIENDS" title="فرندهای من" desc="یوزرنیم پیدا کن، درخواست بفرست و با یک کلیک تماس بگیر."/>
    <section className="friends-layout"><div className="friends-main"><div className="panel-head"><div><h3>جست‌وجوی سریع</h3><p>نام کاربری دوستت را بنویس.</p></div><div className="search-wrap"><Icon name="search" size={18}/><input value={q} onChange={e=>search(e.target.value)} placeholder="search username..." dir="ltr"/></div></div>
      {results.length>0&&<div className="search-results glass">{results.map(r=>{const a=avatarOf(r.avatar);return <div className="result-row" key={r.id}><div className="result-avatar" style={{background:a.gradient}}><AvatarImage avatar={a}/></div><div><b>{r.username}</b><span>عضو HalloCall</span></div><button onClick={()=>add(r.id)} className="secondary-btn">+ افزودن</button></div>})}</div>}
      <div className="section-head compact"><div><h3>فرندها <span className="count">{friends.length}</span></h3><p>{friends.filter(f=>f.online).length} نفر آنلاین</p></div></div>
      <div className="friends-list">{friends.map(f=><FriendRow key={f.id} friend={f} onCall={()=>call(f)} />)}{!friends.length&&<EmptyCard title="هنوز فرندی نداری" text="از بالای صفحه یوزرنیم دوستت را پیدا کن و درخواست بفرست." icon="users"/>}</div>
    </div>
    <aside className="request-panel glass"><div className="panel-title"><div className="stat-icon purple"><Icon name="users"/></div><div><h3>درخواست‌ها</h3><p>مدیریت درخواست‌های دوستی</p></div></div>{requests.map(r=><div className="request-row" key={r.friendshipId}><div className="tiny-avatar" style={{background:avatarOf(r.avatar).gradient}}><AvatarImage avatar={avatarOf(r.avatar)}/></div><div className="request-copy"><b>{r.username}</b><span>{r.direction==="incoming"?"درخواست دوستی":"در انتظار پاسخ"}</span></div>{r.direction==="incoming"?<div className="request-actions"><button onClick={()=>respond(r.friendshipId,"accept")} className="round-green"><Icon name="check" size={16}/></button><button onClick={()=>respond(r.friendshipId,"decline")} className="round-red"><Icon name="x" size={16}/></button></div>:<span className="pending-chip">در انتظار</span>}</div>)}{!requests.length&&<div className="empty-mini">درخواستی برای نمایش وجود ندارد.</div>}</aside></section></div>
}
function FriendRow({friend,onCall}:{friend:Friend;onCall:()=>void}){const a=avatarOf(friend.avatar);return <div className="friend-row glass"><div className="row-avatar" style={{background:a.gradient,boxShadow:`0 0 20px ${a.glow}`}}><AvatarImage avatar={a}/><span className={friend.online?"online-ring on":"online-ring"}/></div><div className="row-user"><b>{friend.username}</b><span className={friend.online?"online-label":"offline-label"}>{friend.online?"● آنلاین":"○ آفلاین"}</span></div><div className="row-actions">{friend.online?<button onClick={onCall} className="primary-mini"><Icon name="call" size={16}/> تماس</button>:<span className="offline-note">الان در دسترس نیست</span>}</div></div>}

function Calls({go,onToast}:{go:(s:string)=>void;onToast:(s:string)=>void}){
  const [name,setName]=useState("Friend Call"); const [code,setCode]=useState(""); const [created,setCreated]=useState<CallInfo|null>(null); const [busy,setBusy]=useState(false);
  const create=async()=>{setBusy(true);try{const d=await api.createCall(name);setCreated(d.call);onToast("کال ساخته شد؛ لینک را برای دوستت بفرست.")}catch(e){onToast(e instanceof Error?e.message:"خطا")}finally{setBusy(false)}};
  const join=async(e:FormEvent)=>{e.preventDefault();if(!code.trim())return;try{const d=await api.getCall(code.trim().toUpperCase());if(d.call.status==="ended")throw new Error("این کال تمام شده است.");go(`/call/${d.call.code}`)}catch(e){onToast(e instanceof Error?e.message:"کال پیدا نشد")}};
  const share=async()=>{if(!created)return;const link=`${location.origin}/call/${created.code}`;try{if(navigator.share){await navigator.share({title:"HalloCall",text:"ورود به کال صوتی HalloCall",url:link});onToast("لینک کال به اشتراک گذاشته شد");return}}catch(e){if(e instanceof DOMException && e.name==="AbortError")return}const copied=await copyText(link);onToast(copied?"لینک کال کپی شد":"کپی لینک انجام نشد؛ لینک را دستی بردار")};
  return <div className="page"><PageTop eyebrow="CALLS" title="کال صوتی" desc="کال بساز، لینک بده یا با کد وارد یک تماس شو."/><section className="calls-grid"><div className="create-call glass"><div className="call-illustration"><div className="pulse-ring p1"/><div className="pulse-ring p2"/><div className="call-orb">🎧</div></div><div className="call-text"><span className="eyebrow"><i/> PRIVATE ROOM</span><h2>کال شخصی خودت را بساز.</h2><p>همین‌جا یک کد یکتا بگیر و برای دوستت بفرست. هر کسی که کد را داشته باشد می‌تواند وارد شود.</p><label className="field"><span>نام کال <small>اختیاری</small></span><input value={name} onChange={e=>setName(e.target.value)} dir="rtl"/></label><button className="primary-btn" onClick={create} disabled={busy}>{busy?<><span className="tiny-spinner"/>در حال ساخت...</>:<><Icon name="plus"/> ساخت کال</>}</button>{created&&<div className="created-call"><div><span>کد کال</span><b dir="ltr">{created.code}</b></div><div className="created-actions"><button onClick={share}><Icon name="copy" size={16}/> کپی لینک</button><button onClick={()=>go(`/call/${created.code}`)} className="primary-mini"><Icon name="arrow" size={16}/> ورود</button></div></div>}</div></div>
    <div className="join-card glass"><div className="join-icon"><Icon name="link"/></div><span className="eyebrow">JOIN A CALL</span><h2>کد را وارد کن.</h2><p>اگر دوستت کد یک کال را فرستاده، اینجا واردش کن.</p><form onSubmit={join}><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="مثلاً 7J9K2WP" dir="ltr" maxLength={7}/><button className="primary-btn wide">ورود به کال <Icon name="arrow"/></button></form><div className="tip"><Icon name="info" size={16}/><span>برای اینترنت ضعیف، داخل تماس می‌توانی کیفیت صدا را پایین بیاوری.</span></div></div></section><section className="quality-banner glass"><div className="quality-badge"><Icon name="signal"/></div><div><b>Adaptive Audio</b><span>کنترل کیفیت صدا از 12 تا 96 kbps؛ مناسب برای اینترنت‌های ناپایدار.</span></div><div className="quality-demo"><span>LOW</span><i/><i/><i/><i/><i/><span>HIGH</span></div></section></div>
}

function IncomingOverlay({call,onAccept,onDecline}:{call:IncomingCall;onAccept:()=>void;onDecline:()=>void}){const a=avatarOf(call.caller.avatar);return <div className="incoming-backdrop"><div className="incoming-card glass"><div className="incoming-top"><span>INCOMING CALL</span><div className="ring-dot"><i/><i/><i/></div></div><div className="incoming-avatar" style={{background:a.gradient,boxShadow:`0 0 0 8px var(--panel),0 0 60px ${a.glow}`}}><AvatarImage avatar={a}/></div><h3>{call.caller.username}</h3><p>{call.name}</p><div className="incoming-actions"><button onClick={onDecline} className="round-red big"><Icon name="phoneOff"/></button><button onClick={onAccept} className="round-green big pulse"><Icon name="call"/></button></div></div></div>}

function ProfileModal({user,onClose,onSave}:{user:User;onClose:()=>void;onSave:(u:User)=>void}){const [avatar,setAvatar]=useState(user.avatar);const save=async()=>{try{const d=await api.profile(avatar);onSave(d.user)}catch{}};return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="profile-modal glass"><div className="modal-head"><div><span className="eyebrow">PROFILE</span><h3>{user.username}</h3></div><button className="icon-btn" onClick={onClose}><Icon name="x"/></button></div><div className="profile-preview"><div className="big-avatar" style={{background:avatarOf(avatar).gradient,boxShadow:`0 0 45px ${avatarOf(avatar).glow}`}}><AvatarImage avatar={avatarOf(avatar)}/></div><div><b>آواتارت را انتخاب کن</b><span>در کال، وقتی حرف بزنی هاله سبز می‌گیرد.</span></div></div><div className="avatar-grid large">{AVATARS.map(a=><button type="button" key={a.id} title={a.label} aria-label={a.label} className={avatar===a.id?"avatar-choice selected":"avatar-choice"} onClick={()=>setAvatar(a.id)} style={{background:a.gradient,boxShadow:avatar===a.id?"0 0 0 3px var(--panel),0 0 0 5px "+a.glow:undefined}}><AvatarImage avatar={a}/></button>)}</div><button className="primary-btn wide" onClick={save}>ذخیره تغییرات <Icon name="check"/></button></div></div>}

function CallPage({user,code,go,dark,setDark}:{user:User;code:string;go:(s:string)=>void;dark:boolean;setDark:(v:boolean)=>void}){
  const [call,setCall]=useState<CallInfo|null>(null); const [error,setError]=useState(""); const [joined,setJoined]=useState(false); const [chatOpen,setChatOpen]=useState(false); const [emojiOpen,setEmojiOpen]=useState(false); const [qualityOpen,setQualityOpen]=useState(false); const [quality,setQuality]=useState(70); const [messages,setMessages]=useState<Array<{id:string;userId:string;username:string;avatar:string;text:string;createdAt:number}>>([]); const [draft,setDraft]=useState(""); const [participants,setParticipants]=useState<Participant[]>([]); const [reactions,setReactions]=useState<Array<{id:string;emoji:string;x:number}>>([]); const [connection,setConnection]=useState<"connecting"|"connected"|"reconnecting">("connecting");
  const wsRef=useRef<WebSocket|null>(null); const participantsRef=useRef<Participant[]>([]); const pcs=useRef(new Map<string,RTCPeerConnection>()); const streams=useRef(new Map<string,MediaStream>()); const local=useRef<MediaStream|null>(null); const audioEls=useRef(new Map<string,HTMLAudioElement>()); const offerStarted=useRef(new Set<string>()); const candidates=useRef(new Map<string,RTCIceCandidateInit[]>()); const analyserCleanup=useRef<Array<()=>void>>([]); const callCodeRef=useRef(code);
  useEffect(()=>{callCodeRef.current=code},[code]);
  useEffect(()=>{ let cancelled=false; (async()=>{try{const d=await api.getCall(code);if(cancelled)return;setCall(d.call); await api.join(code); setJoined(true);}catch(e){setError(e instanceof Error?e.message:"ورود به کال ممکن نشد.")}})(); return()=>{cancelled=true}; },[code]);
  const send=(payload:unknown)=>{const ws=wsRef.current;if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));};
  const closePeer=(id:string)=>{pcs.current.get(id)?.close(); pcs.current.delete(id); streams.current.delete(id); const a=audioEls.current.get(id); a?.remove(); audioEls.current.delete(id); offerStarted.current.delete(id); candidates.current.delete(id);};
  const syncParticipants=useCallback((list:Participant[])=>{participantsRef.current=list;setParticipants(list); for(const p of list){ if(p.id!==user.id&&!pcs.current.has(p.id)) void makePeer(p); } for(const id of Array.from(pcs.current.keys())) if(!list.some(p=>p.id===id)) closePeer(id); },[user.id]);
  const makePeer=useCallback(async(p:Participant)=>{if(pcs.current.has(p.id))return; const ice=await getIceServers(); const pc=new RTCPeerConnection({iceServers:ice}); pcs.current.set(p.id,pc); local.current?.getTracks().forEach(t=>pc.addTrack(t,local.current!)); pc.onicecandidate=e=>{if(e.candidate)send({type:"signal",to:p.id,payload:{kind:"ice",candidate:e.candidate.toJSON()}})}; pc.ontrack=e=>{const stream=e.streams[0]; if(!stream)return;streams.current.set(p.id,stream);let audio=audioEls.current.get(p.id);if(!audio){audio=new Audio();audio.autoplay=true;audioEls.current.set(p.id,audio)}audio.srcObject=stream; void audio.play().catch(()=>{}); setupAnalyser(stream,p.id,false)};pc.onconnectionstatechange=()=>{const s=pc.connectionState;if(s==="connected")setConnection("connected");else if(s==="failed"||s==="disconnected")setConnection("reconnecting")}; return pc;},[]);
  const maybeOffer=useCallback(async(p:Participant)=>{if(user.id>=p.id||offerStarted.current.has(p.id))return; const pc=pcs.current.get(p.id);if(!pc)return; offerStarted.current.add(p.id); try{await pc.setLocalDescription(await pc.createOffer());send({type:"signal",to:p.id,payload:{kind:"offer",sdp:pc.localDescription}})}catch{offerStarted.current.delete(p.id)}},[user.id]);
  const setupAnalyser=(stream:MediaStream,id:string,localStream=false)=>{try{const Ctx=window.AudioContext||((window as any).webkitAudioContext as typeof AudioContext);if(!Ctx)return;const ctx=new Ctx();const source=ctx.createMediaStreamSource(stream);const analyser=ctx.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.72;source.connect(analyser);const data=new Uint8Array(analyser.frequencyBinCount);let raf=0;const tick=()=>{analyser.getByteFrequencyData(data);let sum=0;for(const v of data)sum+=v;const avg=sum/data.length;if(localStream){setParticipants(ps=>ps.map(p=>p.id===user.id?{...p,speaking:avg>15&&!local.current?.getAudioTracks().some(t=>!t.enabled)}:p))}else setParticipants(ps=>ps.map(p=>p.id===id?{...p,speaking:avg>13&&!p.muted}:p));raf=requestAnimationFrame(tick)};tick();analyserCleanup.current.push(()=>{cancelAnimationFrame(raf);ctx.close().catch(()=>{})})}catch{}};
  useEffect(()=>{if(!joined)return;let active=true;const poll=async()=>{try{const d=await api.getCall(code);if(active)setCall(d.call)}catch(e){const msg=e instanceof Error?e.message:"";if(active && /دیگر فعال|فعال نیست|پیدا نشد/.test(msg))setError("این تماس به پایان رسیده یا دیگر در دسترس نیست.")}};poll();const pollId=setInterval(poll,3500);return()=>{active=false;clearInterval(pollId)};},[joined,code]);
  useEffect(()=>{if(!joined)return;let dead=false; (async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false});if(dead){stream.getTracks().forEach(t=>t.stop());return;}local.current=stream;setParticipants(ps=>{if(ps.some(p=>p.id===user.id))return ps;const next=ps.concat({id:user.id,username:user.username,avatar:user.avatar,muted:false,speaking:false});participantsRef.current=next;return next;});setupAnalyser(stream,user.id,true); const scheme=location.protocol==="https:"?"wss":"ws"; const ws=new WebSocket(`${scheme}://${location.host}/ws/call/${encodeURIComponent(code)}`); wsRef.current=ws; ws.onopen=()=>{setConnection("connected");send({type:"hello"})}; ws.onclose=()=>setConnection("reconnecting"); ws.onerror=()=>setConnection("reconnecting"); ws.onmessage=async(ev)=>{try{const m=JSON.parse(ev.data);if(m.type==="ready"||m.type==="presence"){syncParticipants((m.participants||[]).map((p:any)=>({...p,speaking:false})));if(m.messages)setMessages(m.messages); setTimeout(()=>{for(const p of (m.participants||[]))if(p.id!==user.id)void makePeer(p).then(()=>maybeOffer(p))},30)}else if(m.type==="signal"){const from=m.from as string;let p=participantsRef.current.find(x=>x.id===from);if(!p)p={id:from,username:"Friend",avatar:AVATARS[0].id,muted:false};const peer=pcs.current.get(from)??await makePeer(p);if(!peer)return;const data=m.payload;if(data?.kind==="offer"){await peer.setRemoteDescription(data.sdp);for(const c of candidates.current.get(from)||[])await peer.addIceCandidate(c).catch(()=>{});candidates.current.delete(from);if(peer.signalingState==="have-remote-offer"){await peer.setLocalDescription(await peer.createAnswer());send({type:"signal",to:from,payload:{kind:"answer",sdp:peer.localDescription}})}}else if(data?.kind==="answer"){await peer.setRemoteDescription(data.sdp);for(const c of candidates.current.get(from)||[])await peer.addIceCandidate(c).catch(()=>{});candidates.current.delete(from)}else if(data?.kind==="ice"){if(!peer.remoteDescription){const arr=candidates.current.get(from)||[];arr.push(data.candidate);candidates.current.set(from,arr)}else{try{await peer.addIceCandidate(new RTCIceCandidate(data.candidate))}catch{}}} }else if(m.type==="ended"){setError("میزبان این کال را تمام کرد.");ws.close()}else if(m.type==="chat"){setMessages(ms=>ms.some(x=>x.id===m.message.id)?ms:ms.concat(m.message).slice(-100))}else if(m.type==="reaction"){const reactionId=crypto.randomUUID();setReactions(rs=>rs.concat({id:reactionId,emoji:m.emoji,x:35+Math.random()*30}).slice(-18));setTimeout(()=>setReactions(rs=>rs.filter(r=>r.id!==reactionId)),2200)}}catch{}};
        }catch{setError("دسترسی به میکروفون ممکن نشد. اجازهٔ Microphone را در مرورگر فعال کن.")}})(); return()=>{dead=true; wsRef.current?.close();local.current?.getTracks().forEach(t=>t.stop());for(const id of Array.from(pcs.current.keys()))closePeer(id);analyserCleanup.current.splice(0).forEach(fn=>fn());};},[joined,code,user.id,user.username,user.avatar]);
  useEffect(()=>{participants.filter(p=>p.id!==user.id).forEach(p=>{void makePeer(p).then(()=>maybeOffer(p))})},[participants,makePeer,maybeOffer]);
  const toggleMute=()=>{const track=local.current?.getAudioTracks()[0];if(!track)return;track.enabled=!track.enabled;const muted=!track.enabled;setParticipants(ps=>{const next=ps.map(p=>p.id===user.id?{...p,muted,speaking:false}:p);participantsRef.current=next;return next;});send({type:"mute",muted})};
  const changeQuality=async(v:number)=>{setQuality(v);for(const pc of pcs.current.values())await applyAudioQuality(pc,v)};
  const leave=async()=>{await api.leave(code).catch(()=>{});local.current?.getTracks().forEach(t=>t.stop());wsRef.current?.close();go("/calls")};
  const sendChat=()=>{if(!draft.trim())return;send({type:"chat",text:draft});setDraft("")};
  const react=(emoji:string)=>{send({type:"reaction",emoji});};
  const my=participants.find(p=>p.id===user.id); const qualityLabel=quality<34?"مصرف کم • مناسب اینترنت ضعیف":quality<72?"بالانس • کیفیت خوب":"کیفیت بالا • مصرف بیشتر";
  if(error)return <main className="app-bg call-error"><div className="error-card glass"><div className="brand-mark">◈</div><h2>ورود به کال ممکن نشد</h2><p>{error}</p><button className="primary-btn" onClick={()=>go("/calls")}>بازگشت به کال‌ها</button></div></main>;
  return <main className="app-bg call-page"><div className="aurora a1"/><div className="aurora a2"/><header className="call-header"><div className="call-brand"><div className="brand-mark"><span>◈</span></div><div><b>{call?.name??"Friend Call"}</b><span dir="ltr">#{code}</span></div></div><div className="call-center-status"><span className={connection==="connected"?"live-dot":"live-dot warn"}/>{connection==="connected"?"متصل":"در حال اتصال دوباره…"}<small>•</small><span>{participants.length} نفر</span></div><div className="call-head-actions"><button className="icon-btn" onClick={()=>setDark(!dark)}><Icon name={dark?"sun":"moon"}/></button><button className="leave-top" onClick={leave}><Icon name="phoneOff" size={16}/> خروج</button></div></header>
    <section className="call-stage"><div className="participant-stage">{participants.map(p=><ParticipantTile key={p.id} participant={p} self={p.id===user.id}/>)}</div>{reactions.map(r=><span key={r.id} className="reaction-float" style={{left:`${r.x}%`}}>{r.emoji}</span>)}{!participants.length&&<div className="joining"><span className="spinner"/><p>در حال ورود به کال…</p></div>}{participants.length===1&&<div className="waiting-pill glass"><span className="waiting-dot"/> منتظر دوستت هستیم… لینک کال را برایش بفرست.</div>}</section>
    <div className="call-toolbar-wrap"><div className="call-toolbar glass">
      {qualityOpen&&<div className="popover quality-pop"><div className="popover-head"><div><b>🎚 کنترل کیفیت صدا</b><span>{qualityLabel}</span></div><span className="quality-number">{quality}</span></div><input type="range" min="0" max="100" value={quality} onChange={e=>changeQuality(Number(e.target.value))}/><div className="range-labels"><span>ضعیف</span><span>تعادل</span><span>شفاف</span></div></div>}
      {emojiOpen&&<div className="popover emoji-pop">{QUICK_EMOJIS.map(e=><button key={e} onClick={()=>{react(e);setEmojiOpen(false)}}>{e}</button>)}</div>}
      <ToolButton label={my?.muted?"باز کردن میکروفون":"میوت کردن"} danger={!!my?.muted} active={!my?.muted} onClick={toggleMute} icon={my?.muted?"micOff":"mic"}/><ToolButton label="ایموجی" active={emojiOpen} onClick={()=>{setEmojiOpen(!emojiOpen);setQualityOpen(false)}} icon="smile"/><ToolButton label="چت" active={chatOpen} onClick={()=>{setChatOpen(!chatOpen);setEmojiOpen(false)}} icon="message"/><ToolButton label="کیفیت صدا" active={qualityOpen} onClick={()=>{setQualityOpen(!qualityOpen);setEmojiOpen(false)}} icon="signal"/><div className="toolbar-divider"/><button className="leave-btn" onClick={leave}><Icon name="phoneOff"/></button>
    </div></div>
    {chatOpen&&<aside className="chat-drawer glass"><div className="chat-head"><div><b>گفت‌وگو</b><span>پیام‌های همین کال</span></div><button className="icon-btn" onClick={()=>setChatOpen(false)}><Icon name="x"/></button></div><div className="chat-list">{messages.map(m=><div key={m.id} className={m.userId===user.id?"chat-msg mine":"chat-msg"}><div className="chat-avatar" style={{background:avatarOf(m.avatar).gradient}}><AvatarImage avatar={avatarOf(m.avatar)}/></div><div><span>{m.userId===user.id?"شما":m.username}</span><p>{m.text}</p></div></div>)}{!messages.length&&<div className="chat-empty"><Icon name="message" size={28}/><p>هنوز پیامی نیست.</p></div>}</div><div className="chat-compose"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")sendChat()}} placeholder="پیامت را بنویس…"/><button onClick={sendChat}><Icon name="arrow" size={16}/></button></div></aside>}
  </main>
}
function ParticipantTile({participant,self}:{participant:Participant;self:boolean}){const a=avatarOf(participant.avatar);const state=participant.muted?"muted":participant.speaking?"speaking":"idle";return <div className={self?"participant-card self":"participant-card"}><div className={`avatar-stage ${state}`}><div className="avatar-face" style={{background:a.gradient,boxShadow:`inset 0 2px 12px rgba(255,255,255,.24),0 18px 50px ${a.glow}`}}><AvatarImage avatar={a}/></div>{participant.muted&&<span className="mute-badge"><Icon name="micOff" size={13}/></span>}{participant.speaking&&!participant.muted&&<span className="speaking-dot"/>}</div><div className="participant-name"><b>{participant.username}</b>{self&&<span>شما</span>}{participant.muted&&<em>میوت</em>}</div></div>}
function ToolButton({label,icon,onClick,active,danger}:{label:string;icon:string;onClick:()=>void;active?:boolean;danger?:boolean}){return <button onClick={onClick} className={danger?"tool danger":"tool"}><span className={active?"tool-circle active":"tool-circle"}><Icon name={icon}/></span><small>{label}</small></button>}

export default App;
