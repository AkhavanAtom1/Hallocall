import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { api } from "./lib/api";
import { AVATAR_CATEGORIES, AVATARS, DEFAULT_AVATAR, avatarOf } from "./lib/avatars";
import type { Friend, FriendRequest, IncomingCall, User } from "./lib/types";
import { Icon } from "./components/Icon";
import { AvatarImage } from "./components/AvatarImage";
import { AvatarPicker } from "./components/AvatarPicker";
import { AppAvatar } from "./components/AppAvatar";
import { APP_AVATAR, APP_AVATAR_DEF } from "./lib/appIdentity";
import { GlowButton } from "./components/GlowButton";
import { Scene, spotlight } from "./components/Scene";
import { CALL_CODE_LENGTH, MAX_CALL_PARTICIPANTS } from "./lib/call";
import { CallPage } from "./components/CallRoom";

const SHOWCASE = ["ronaldo_red","messi_barca_blue","ronaldinho_brazil","haaland_city","malenia","kratos","solaire","geralt"];

type Route = { page:"login" } | { page:"dashboard" } | { page:"friends" } | { page:"profiles" } | { page:"calls" } | { page:"call"; code:string };

function routeFromPath(path = location.pathname): Route {
  if (path.startsWith("/call/")) {
    const segment = path.slice(6).split("/")[0];
    try { return { page:"call", code:decodeURIComponent(segment).trim().toUpperCase() }; }
    catch { return { page:"calls" }; }
  }
  if (path === "/friends") return { page:"friends" };
  if (path === "/profiles") return { page:"profiles" };
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
  const [dark,setDark] = useState(()=>{ try { return localStorage.getItem("hallocall-theme") !== "light"; } catch { return true; } });
  const [incoming,setIncoming] = useState<IncomingCall|null>(null);
  const [incomingBusy,setIncomingBusy] = useState(false);
  const [profileOpen,setProfileOpen] = useState(false);
  const [toast,setToast] = useState<string|undefined>(undefined);

  useEffect(()=>{
    document.documentElement.classList.toggle("light",!dark);
    document.documentElement.classList.toggle("dark",dark);
    try { localStorage.setItem("hallocall-theme",dark?"dark":"light"); } catch {}
  },[dark]);
  useEffect(()=>{ let active=true; api.me().then((d)=>{if(active)setUser(d.user)}).catch(()=>{}).finally(()=>{if(active)setBooting(false)}); return()=>{active=false}; },[]);
  useEffect(()=>{ if(booting)return; if(user && route.page==="login")go("/dashboard"); else if(!user && route.page!=="login")go("/login"); },[booting,user,route.page,go]);
  useEffect(()=>{ if (!user) return; api.touch().catch(()=>{}); const id=setInterval(()=>api.touch().catch(()=>{}),10000); return()=>clearInterval(id); },[user]);
  useEffect(()=>{ if(!user || route.page==="call") return; let active=true; const poll=async()=>{ try { const d=await api.incoming(); if(active) setIncoming(d.calls[0]??null);} catch{} }; poll(); const id=setInterval(poll,2200); return()=>{active=false;clearInterval(id)}; },[user,route.page]);
  useEffect(()=>{ if(!toast) return; const id=setTimeout(()=>setToast(undefined),2500); return()=>clearTimeout(id); },[toast]);

  const logout=async()=>{ await api.logout().catch(()=>{}); setUser(null); go("/login"); };
  const signIn=(u:User)=>{ setUser(u); go("/dashboard"); };
  const applyAvatar=async(avatarId:string)=>{ try{ const d=await api.profile(avatarId); setUser(d.user); setToast(`پروفایل ${avatarOf(avatarId).name} ذخیره شد`); return true; } catch(e){ setToast(e instanceof Error?e.message:"ذخیره نشد"); return false; } };
  const respondIncoming=async(action:"accept"|"decline")=>{
    if(!incoming || incomingBusy)return;
    setIncomingBusy(true);
    try {
      const d=await api.respondCall(incoming.inviteId,action);
      setIncoming(null);
      if(action==="accept" && d.code)go(`/call/${d.code}`);
    } catch(e){setToast(e instanceof Error?e.message:"خطا")}
    finally{setIncomingBusy(false)}
  };

  if (booting) return <BootScreen dark={dark} />;
  const effectivePage = route.page === "login" && user ? "dashboard" : route.page;
  if (!user) return <LoginPage onSuccess={signIn} dark={dark} setDark={setDark} />;
  if (route.page==="call") return <CallPage key={route.code} user={user} code={route.code} go={go} dark={dark} setDark={setDark} />;

  return <>
    <AppShell user={user} route={route} go={go} dark={dark} setDark={setDark} logout={logout} openProfile={()=>setProfileOpen(true)}>
      {effectivePage==="dashboard" && <Dashboard user={user} go={go} onToast={setToast}/>}
      {effectivePage==="friends" && <Friends user={user} go={go} onToast={setToast}/>}
      {effectivePage==="profiles" && <Profiles user={user} onApply={applyAvatar}/>}
      {effectivePage==="calls" && <Calls go={go} onToast={setToast}/>}
    </AppShell>
    {incoming && <IncomingOverlay call={incoming} busy={incomingBusy} onAccept={()=>respondIncoming("accept")} onDecline={()=>respondIncoming("decline")} />}
    {profileOpen && <ProfileModal user={user} onClose={()=>setProfileOpen(false)} onApply={async(id)=>{ const ok=await applyAvatar(id); if(ok) setProfileOpen(false); return ok; }} />}
    {toast && <div className="toast glass" role="status" aria-live="polite"><Icon name="check" size={14}/><span>{toast}</span></div>}
  </>;
}

function BootScreen({dark}:{dark:boolean}) {
  return <div className="app-bg boot"><Scene/><div className="boot-core"><AppAvatar size={76} className="boot-avatar"/><div className="spinner"/><p>در حال آماده‌سازی HalloCall</p><small>{dark?"حالت تاریک":"حالت روشن"} • لطفاً کمی صبر کن</small></div></div>;
}

/* ─────────────────────────── auth ─────────────────────────── */

function LoginPage({onSuccess,dark,setDark}:{onSuccess:(u:User)=>void;dark:boolean;setDark:(v:boolean)=>void}) {
  const [mode,setMode]=useState<"login"|"register">("login");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [avatar,setAvatar]=useState<string>(DEFAULT_AVATAR);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{const d=mode==="login"?await api.login(username,password):await api.register(username,password,avatar);onSuccess(d.user);}catch(err){setError(err instanceof Error?err.message:"خطایی رخ داد.")}finally{setBusy(false)}};

  return <main className="auth-page app-bg">
    <Scene variant="auth"/>
    <button className="icon-btn theme-btn" onClick={()=>setDark(!dark)} aria-label="تغییر تم"><Icon name={dark?"sun":"moon"}/></button>

    <section className="auth-hero">
      <div className="brand-lockup">
        <AppAvatar size={64} className="brand-avatar"/>
        <div><h1>Hallo<span>Call</span></h1><p>voice • friends • zero clutter</p></div>
      </div>
      <div className="hero-copy">
        <span className="eyebrow"><i/> ساخته‌شده برای تماس‌های گروهی</span>
        <h2>یک تماس.<br/><em>یک حلقه نور.</em><br/>و تمام.</h2>
        <p>دوستت را با یوزرنیم پیدا کن، تماس بگیر یا یک اتاق خصوصی بساز و تا ۲۰ نفر را با یک کد ساده دور هم جمع کن.</p>
      </div>
      <div className="feature-row">
        <Feature icon="users" title="Friends" text="دوستان آنلاین را ببین"/>
        <Feature icon="call" title="One‑tap call" text="تماس مستقیم با یک کلیک"/>
        <Feature icon="signal" title="Adaptive audio" text="کنترل کیفیت برای اینترنت ضعیف"/>
      </div>
      <div className="avatar-ticker" aria-hidden="true">
        <div className="ticker-track">{[...AVATARS, ...AVATARS].map((a, i) => <span key={`${a.id}-${i}`} style={{"--accent":a.accent} as CSSProperties}><AvatarImage avatar={a}/></span>)}</div>
        <b>۳۰ پروفایل اختصاصی • فوتبال، Elden Ring، Dark Souls و افسانه‌های بازی</b>
      </div>
    </section>

    <section className="auth-card glass" onMouseMove={spotlight}>
      <div className="card-lamp" aria-hidden="true"/>
      <div className="auth-card-top"><div><p className="muted">خوش آمدی</p><h3>{mode==="login"?"وارد حساب شو":"حساب خودت را بساز"}</h3></div><div className="mini-status"><span/> آنلاین در هر دو حالت</div></div>
      <div className="segmented" role="group" aria-label="نوع ورود"><button type="button" className={mode==="login"?"active":""} aria-pressed={mode==="login"} onClick={()=>{setMode("login");setError("")}}>ورود</button><button type="button" className={mode==="register"?"active":""} aria-pressed={mode==="register"} onClick={()=>{setMode("register");setError("")}}>ثبت‌نام</button></div>
      {error&&<div className="error-box"><Icon name="info" size={17}/><span>{error}</span></div>}
      <form onSubmit={submit}>
        <Field label="نام کاربری" value={username} onChange={setUsername} placeholder="مثلاً ali_23" dir="ltr" maxLength={20} pattern="[A-Za-z0-9_]{3,20}" autoComplete="username"/>
        <Field label="رمز عبور" type="password" value={password} onChange={setPassword} placeholder="حداقل ۶ کاراکتر" dir="ltr" minLength={mode==="register"?6:undefined} autoComplete={mode==="register"?"new-password":"current-password"}/>
        {mode==="register"&&<AvatarPicker value={avatar} onChange={setAvatar} variant="compact"/>}
        <GlowButton className="wide" type="submit" tone="primary" size="lg" disabled={busy} trailingIcon={busy?undefined:"arrow"} loading={busy?<span className="tiny-spinner"/>:undefined}>{busy?"در حال ورود...":mode==="login"?"ورود به HalloCall":"ساخت حساب و ورود"}</GlowButton>
      </form>
      <div className="security-note"><span>●</span> رمز عبور به‌صورت هش‌شده ذخیره می‌شود</div>
    </section>
  </main>;
}

function Field({label,type="text",value,onChange,placeholder,dir,minLength,maxLength,pattern,autoComplete}:{label:string;type?:string;value:string;onChange:(s:string)=>void;placeholder:string;dir?:string;minLength?:number;maxLength?:number;pattern?:string;autoComplete?:string}){return <label className="field"><span>{label}</span><input dir={dir} type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} minLength={minLength} maxLength={maxLength} pattern={pattern} autoComplete={autoComplete} required /></label>}
function Feature({icon,title,text}:{icon:string;title:string;text:string}){return <div className="feature glass"><div className="feature-icon"><Icon name={icon}/></div><div><b>{title}</b><span>{text}</span></div></div>}

/* ─────────────────────────── shell ─────────────────────────── */

function AppShell({user,route,go,dark,setDark,logout,openProfile,children}:{user:User;route:Route;go:(s:string)=>void;dark:boolean;setDark:(v:boolean)=>void;logout:()=>void;openProfile:()=>void;children:ReactNode}){
  const avatar=avatarOf(user.avatar);
  return <div className="app-bg shell">
    <Scene/>
    <aside className="sidebar glass">
      <div className="sidebar-brand"><AppAvatar size={40} className="brand-avatar"/><div><b>Hallo<span>Call</span></b><small>voice workspace</small></div></div>
      <nav>
        <NavItem icon="spark" label="خانه" active={route.page==="dashboard"} onClick={()=>go("/dashboard")}/>
        <NavItem icon="users" label="فرندها" active={route.page==="friends"} onClick={()=>go("/friends")}/>
        <NavItem icon="mask" label="پروفایل‌ها" active={route.page==="profiles"} onClick={()=>go("/profiles")}/>
        <NavItem icon="call" label="کال‌ها" active={route.page==="calls"} onClick={()=>go("/calls")}/>
        <button className="mobile-theme-toggle" onClick={()=>setDark(!dark)} title="تغییر تم" aria-label="تغییر تم"><Icon name={dark?"sun":"moon"}/></button>
      </nav>
      <div className="sidebar-spacer"/>
      <button className="profile-chip" onClick={openProfile} onMouseMove={spotlight}>
        <div className="avatar" style={{"--accent":avatar.accent, boxShadow:`0 0 0 1px ${avatar.ring}, 0 0 26px ${avatar.glow}`} as CSSProperties}><AvatarImage avatar={avatar}/><span className="online-dot"/></div>
        <div className="profile-text"><b>{user.username}</b><span>{avatar.name} • {avatar.tag}</span></div>
        <Icon name="settings" size={17}/>
      </button>
      <div className="sidebar-actions">
        <button className="icon-btn" onClick={()=>setDark(!dark)} title="تغییر تم"><Icon name={dark?"sun":"moon"}/></button>
        <button className="icon-btn" onClick={openProfile} title="انتخاب آواتار"><Icon name="mask"/></button>
        <button className="icon-btn danger-lite" onClick={logout} title="خروج"><Icon name="logout"/></button>
      </div>
    </aside>
    <main className="content">{children}</main>
  </div>;
}

function NavItem({icon,label,active,onClick}:{icon:string;label:string;active:boolean;onClick:()=>void}){
  return <button onClick={onClick} aria-current={active?"page":undefined} className={active?"nav-item active":"nav-item"}><span className="nav-icon"><Icon name={icon}/></span><span>{label}</span>{active&&<i/>}</button>;
}

function PageTop({eyebrow,title,desc,action}:{eyebrow:string;title:string;desc:string;action?:ReactNode}){
  return <header className="page-top"><div><span className="eyebrow"><i/>{eyebrow}</span><h1>{title}</h1><p>{desc}</p></div><div className="top-actions">{action}<div className="live-pill"><Icon name="signal" size={14}/> پنل کاربری <small>•</small> HalloCall</div></div></header>;
}

/* ─────────────────────────── home ─────────────────────────── */

function Dashboard({user,go,onToast}:{user:User;go:(s:string)=>void;onToast:(s:string)=>void}){
  const [friends,setFriends]=useState<Friend[]>([]);
  useEffect(()=>{let active=true;const load=()=>api.friends().then(d=>{if(active)setFriends(d.friends)}).catch(()=>{});load();const id=setInterval(load,9000);return()=>{active=false;clearInterval(id)};},[]);
  const online=friends.filter(f=>f.online);
  const quickCall=async(friend:Friend)=>{try{const d=await api.invite(friend.id);onToast(`درخواست تماس برای ${friend.username} ارسال شد`);go(`/call/${d.call.code}`);}catch(e){onToast(e instanceof Error?e.message:"خطا")}};

  return <div className="page">
    <PageTop eyebrow="WORKSPACE" title={`سلام ${user.username} 👋`} desc="همه‌چیز برای یک تماس سریع آماده است." action={<GlowButton tone="ghost" size="sm" icon="mask" onClick={()=>go("/profiles")}>گالری پروفایل</GlowButton>}/>

    <section className="dashboard-grid">
      <div className="hero-card glass" onMouseMove={spotlight}>
        <div className="card-lamp" aria-hidden="true"/>
        <div className="hero-content">
          <span className="eyebrow"><i/> ONLINE VOICE</span>
          <h2>صدای دوستت<br/><em>همین نزدیکی است.</em></h2>
          <p>از لیست فرندها یک تماس مستقیم بگیر یا یک کال بساز و لینک آن را بفرست.</p>
          <div className="hero-actions">
            <GlowButton tone="primary" size="lg" icon="call" onClick={()=>go("/calls")}>ساخت کال</GlowButton>
            <GlowButton tone="ghost" size="lg" icon="users" onClick={()=>go("/friends")}>مدیریت فرندها</GlowButton>
          </div>
        </div>
        <div className="hero-orbit"><div className="orbit-ring r1"><span className="orbit-sat s1"><AvatarImage avatar={SHOWCASE[0]}/></span><span className="orbit-sat s3"><AvatarImage avatar={SHOWCASE[4]}/></span></div><div className="orbit-ring r2"><span className="orbit-sat s2"><AvatarImage avatar={SHOWCASE[3]}/></span><span className="orbit-sat s4"><AvatarImage avatar={SHOWCASE[5]}/></span></div><div className="orbit-core">🎧</div></div>
      </div>

      <div className="stat-card glass" onMouseMove={spotlight}>
        <div className="stat-icon green"><Icon name="users"/></div>
        <div><span>فرندهای آنلاین</span><b>{online.length}</b></div>
        <button onClick={()=>go("/friends")}>مشاهدهٔ فرندها <Icon name="arrow" size={15}/></button>
      </div>

      <div className="stat-card glass" onMouseMove={spotlight}>
        <div className="stat-icon purple"><Icon name="signal"/></div>
        <div><span>بازهٔ کیفیت صدا</span><b>۱۲–۹۶ kbps</b></div>
        <div className="spark-bars" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/></div>
        <button onClick={()=>go("/calls")}>رفتن به کال‌ها <Icon name="arrow" size={15}/></button>
      </div>
    </section>

    <section className="section-head"><div><h3>فرندهای آنلاین</h3><p>برای تماس، یک نفر را انتخاب کن.</p></div><button className="text-btn" onClick={()=>go("/friends")}>همه فرندها <Icon name="arrow" size={15}/></button></section>
    <div className="friend-strip">
      {online.slice(0,6).map(f=><FriendCard key={f.id} friend={f} onCall={()=>quickCall(f)}/>)}
      {online.length===0&&<EmptyCard title="فعلاً کسی آنلاین نیست" text="وقتی یکی از فرندها آنلاین شود، دکمه تماس اینجا ظاهر می‌شود." icon="moon"/>}
    </div>

    <section className="collection-card glass" onMouseMove={spotlight}>
      <div className="collection-head">
        <div><span className="eyebrow"><i/> NEW AVATAR SET</span><h3>۳۰ پروفایل تازه برای انتخاب</h3><p>{AVATAR_CATEGORIES.map(c=>`${c.icon} ${c.fa}`).join("  •  ")}</p></div>
        <GlowButton tone="cyan" icon="spark" onClick={()=>go("/profiles")}>باز کردن گالری</GlowButton>
      </div>
      <div className="collection-strip">{AVATARS.slice(0,14).map(a=><span key={a.id} title={a.label} style={{"--accent-glow":a.glow} as CSSProperties}><AvatarImage avatar={a}/></span>)}</div>
    </section>
  </div>;
}

function FriendCard({friend,onCall}:{friend:Friend;onCall:()=>void}){
  const a=avatarOf(friend.avatar);
  return <div className="friend-card glass" onMouseMove={spotlight}>
    <div className="card-avatar" style={{"--accent":a.accent, background:a.gradient} as CSSProperties}><AvatarImage avatar={a}/><span className="speck"/></div>
    <div className="card-user"><b>{friend.username}</b><span><i/> آنلاین</span></div>
    <GlowButton tone="mint" size="sm" className="call-mini" icon="call" onClick={onCall} aria-label={`تماس با ${friend.username}`}/>
  </div>;
}

function EmptyCard({title,text,icon}:{title:string;text:string;icon:string}){return <div className="empty-card glass"><div className="empty-icon"><Icon name={icon}/></div><div><b>{title}</b><p>{text}</p></div></div>}

/* ─────────────────────────── friends ─────────────────────────── */

function FriendRow({friend,onCall,onRemove}:{friend:Friend;onCall:()=>void;onRemove?:()=>void}){
  const a=avatarOf(friend.avatar);
  return <div className="friend-row glass" onMouseMove={spotlight}>
    <div className="row-avatar" style={{"--accent":a.accent, background:a.gradient} as CSSProperties}><AvatarImage avatar={a}/><span className={friend.online?"online-ring on":"online-ring"}/></div>
    <div className="row-user"><b>{friend.username}</b><span className={friend.online?"online-label":"offline-label"}>{friend.online?"● آنلاین":"○ آفلاین"}</span></div>
    <div className="row-actions">
      {friend.online?<GlowButton tone="primary" size="sm" icon="call" onClick={onCall}>تماس</GlowButton>:<span className="offline-note">الان در دسترس نیست</span>}
      {onRemove&&<button onClick={onRemove} className="row-remove" title={`حذف ${friend.username} از فرندها`} aria-label={`حذف ${friend.username} از فرندها`}><Icon name="x" size={15}/></button>}
    </div>
  </div>;
}

function Friends({user,go,onToast}:{user:User;go:(s:string)=>void;onToast:(s:string)=>void}){
  const [friends,setFriends]=useState<Friend[]>([]);
  const [requests,setRequests]=useState<FriendRequest[]>([]);
  const [q,setQ]=useState("");
  const [results,setResults]=useState<User[]>([]);
  const timer=useRef<number | undefined>(undefined);
  const searchVersion=useRef(0);
  const load=useCallback(()=>api.friends().then(d=>{setFriends(d.friends);setRequests(d.requests)}).catch(()=>{}),[]);
  useEffect(()=>{load();const id=setInterval(load,9000);return()=>clearInterval(id)},[load]);
  useEffect(()=>()=>{window.clearTimeout(timer.current);searchVersion.current++},[]);
  const search=(value:string)=>{
    setQ(value);
    window.clearTimeout(timer.current);
    const version=++searchVersion.current;
    if(value.trim().length<2){setResults([]);return}
    timer.current=window.setTimeout(()=>{
      api.searchUsers(value.trim()).then(d=>{if(searchVersion.current===version)setResults(d.users)}).catch(()=>{if(searchVersion.current===version)setResults([])});
    },260);
  };
  const relationFor=(id:string)=>{if(friends.some(f=>f.id===id))return "friend" as const;const request=requests.find(r=>r.id===id);return request?.direction==="incoming"?"incoming":request?"outgoing":"none" as const};
  const add=async(id:string)=>{try{await api.friendRequest(id);onToast("درخواست دوستی ارسال شد");setResults([]);setQ("");load()}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  const respond=async(id:string,action:"accept"|"decline")=>{try{await api.friendRespond(id,action);onToast(action==="accept"?"فرند جدید اضافه شد":"درخواست رد شد");load()}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  const cancelRequest=async(id:string)=>{try{await api.friendRemove(id);onToast("درخواست لغو شد");load()}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  const removeFriend=async(friend:Friend)=>{if(!window.confirm(`فرند ${friend.username} حذف شود؟`))return;try{await api.friendRemove(friend.friendshipId);onToast(`${friend.username} از فرندها حذف شد`);load()}catch(e){onToast(e instanceof Error?e.message:"خطا")}};
  const call=async(f:Friend)=>{try{const d=await api.invite(f.id);onToast(`درخواست تماس برای ${f.username} ارسال شد`);go(`/call/${d.call.code}`)}catch(e){onToast(e instanceof Error?e.message:"خطا")}};

  return <div className="page">
    <PageTop eyebrow="FRIENDS" title="فرندهای من" desc="یوزرنیم پیدا کن، درخواست بفرست، قبول کن و با یک کلیک وارد تماس شو."/>
    <section className="friends-layout">
      <div className="friends-main">
        <div className="panel-head glass"><div><h3>جست‌وجوی سریع</h3><p>نام کاربری دوستت را بنویس؛ درخواست از همین‌جا مدیریت می‌شود.</p></div><div className="search-wrap"><Icon name="search" size={18}/><input value={q} onChange={e=>search(e.target.value)} placeholder="search username..." dir="ltr" aria-label="جست‌وجوی نام کاربری" autoComplete="off"/></div></div>
        {results.length>0&&<div className="search-results glass" role="list" aria-label="نتایج جست‌وجو">{results.map(r=>{const a=avatarOf(r.avatar);const relation=relationFor(r.id);const label=relation==="friend"?"فرند شما":relation==="outgoing"?"در انتظار":"+ افزودن";const request=requests.find(item=>item.id===r.id);return <div className="result-row" key={r.id} role="listitem"><div className="result-avatar" style={{background:a.gradient}}><AvatarImage avatar={a}/></div><div className="result-user"><b>{r.username}</b><span>{relation==="incoming"?"برای شما درخواست فرستاده است":"عضو HalloCall"}</span></div>{relation==="incoming"&&request?<div className="result-actions"><button onClick={()=>respond(request.friendshipId,"accept")} className="secondary-btn accept-request">قبول</button><button onClick={()=>respond(request.friendshipId,"decline")} className="secondary-btn decline-request">رد</button></div>:<button onClick={()=>relation==="none"?add(r.id):undefined} disabled={relation!=="none"} className={relation==="none"?"secondary-btn":"secondary-btn is-disabled"}>{label}</button>}</div>})}</div>}
        <div className="section-head compact"><div><h3>فرندها <span className="count">{friends.length}</span></h3><p>{friends.filter(f=>f.online).length} نفر آنلاین</p></div></div>
        <div className="friends-list">
          {friends.map(f=><FriendRow key={f.id} friend={f} onCall={()=>call(f)} onRemove={()=>removeFriend(f)} />)}
          {!friends.length&&<EmptyCard title="هنوز فرندی نداری" text="از بالای صفحه یوزرنیم دوستت را پیدا کن و درخواست بفرست." icon="users"/>}
        </div>
      </div>
      <aside className="request-panel glass">
        <div className="panel-title"><div className="stat-icon purple"><Icon name="users"/></div><div><h3>درخواست‌ها</h3><p>درخواست‌ها را قبول، رد یا لغو کن.</p></div></div>
        {requests.map(r=><div className="request-row" key={r.friendshipId}>
          <div className="tiny-avatar" style={{background:avatarOf(r.avatar).gradient}}><AvatarImage avatar={avatarOf(r.avatar)}/></div>
          <div className="request-copy"><b>{r.username}</b><span>{r.direction==="incoming"?"درخواست دوستی برای شما":"در انتظار پاسخ او"}</span></div>
          {r.direction==="incoming"
            ?<div className="request-actions"><button onClick={()=>respond(r.friendshipId,"accept")} className="round-green" title="قبول درخواست" aria-label={`قبول درخواست ${r.username}`}><Icon name="check" size={16}/></button><button onClick={()=>respond(r.friendshipId,"decline")} className="round-red" title="رد درخواست" aria-label={`رد درخواست ${r.username}`}><Icon name="x" size={16}/></button></div>
            :<button onClick={()=>cancelRequest(r.friendshipId)} className="pending-chip pending-button">لغو</button>}
        </div>)}
        {!requests.length&&<div className="empty-mini">درخواستی برای نمایش وجود ندارد.</div>}
      </aside>
    </section>
  </div>;
}

/* ─────────────────────────── profile gallery ─────────────────────────── */

function Profiles({user,onApply}:{user:User;onApply:(id:string)=>Promise<boolean>}){
  const [pending,setPending]=useState<string>(user.avatar);
  useEffect(()=>{setPending(user.avatar)},[user.avatar]);
  const [saving,setSaving]=useState(false);
  const current=avatarOf(user.avatar);
  const chosen=avatarOf(pending);
  const dirty=pending!==user.avatar;
  const save=async()=>{setSaving(true);const ok=await onApply(pending);setSaving(false);if(!ok)return};

  return <div className="page profiles-page">
    <PageTop eyebrow="PROFILES" title="گالری پروفایل‌ها" desc="۳۰ آواتار تازه؛ ۱۵ افسانه فوتبال، ۵ شخصیت Elden Ring، ۵ شوالیه Dark Souls و ۵ آیکون بازی."/>
    <section className="profile-stage glass" onMouseMove={spotlight}>
      <div className="card-lamp" aria-hidden="true"/>
      <div className="stage-avatar" style={{"--accent":chosen.accent, background:chosen.gradient, boxShadow:`0 0 0 1px ${chosen.ring}, 0 26px 70px ${chosen.glow}`} as CSSProperties}>
        <AvatarImage avatar={chosen}/>
        <span className="stage-sheen" aria-hidden="true"/>
      </div>
      <div className="stage-copy">
        <span className="eyebrow"><i/> {chosen.jersey}</span>
        <h3>{chosen.name}</h3>
        <p>{chosen.tag}{dirty?" • هنوز ذخیره نشده":` • روی پروفایل ${user.username}`}</p>
      </div>
      <div className="stage-actions">
        <GlowButton tone="primary" size="lg" icon="check" disabled={!dirty||saving} loading={saving?<span className="tiny-spinner"/>:undefined} onClick={save}>{dirty?"ذخیره روی پروفایل":"پروفایل فعلی"}</GlowButton>
        {dirty&&<GlowButton tone="ghost" size="sm" onClick={()=>setPending(user.avatar)}>بازگشت</GlowButton>}
      </div>
      <div className="stage-current"><span>پروفایل فعلی</span><b style={{"--accent":current.accent} as CSSProperties}><AvatarImage avatar={current}/>{current.name}</b></div>
    </section>

    {AVATAR_CATEGORIES.map(cat=>{
      const items=AVATARS.filter(a=>a.category===cat.id);
      return <section className="cat-section" key={cat.id}>
        <div className="section-head"><div><span className="eyebrow"><i/>{cat.en}</span><h3>{cat.icon} {cat.fa}</h3><p>{cat.hint}</p></div><div className="count-pill">{items.length} پروفایل</div></div>
        <div className="avatar-showcase">
          {items.map(a=>{const active=a.id===pending;return <button type="button" key={a.id} className={active?"showcase-card on":"showcase-card"} aria-pressed={active} onClick={()=>setPending(a.id)} style={{"--accent":a.accent,"--accent-glow":a.glow,"--accent-soft":a.ring} as CSSProperties}>
            <span className="showcase-face"><AvatarImage avatar={a}/></span>
            <span className="showcase-meta"><b>{a.name}</b><small>{a.tag}</small></span>
            {a.id===user.avatar&&<span className="showcase-flag">فعلی</span>}
            {active&&<span className="showcase-check"><Icon name="check" size={12} stroke={2.6}/></span>}
          </button>})}
        </div>
      </section>;
    })}

    <section className="official-card glass" onMouseMove={spotlight}>
      <AppAvatar size={84} className="official-avatar"/>
      <div className="official-copy">
        <span className="eyebrow"><i/> OFFICIAL PROFILE</span>
        <h3>{APP_AVATAR.name} <small>{APP_AVATAR.tag}</small></h3>
        <p>پروفایل مینیمال خودِ برنامه: یک نشان لوزی با حلقهٔ نئونی بنفش تا فیروزه‌ای. همین تصویر به‌عنوان فاوآیکون، هدرها و آیکون اپ استفاده می‌شود.</p>
      </div>
      <div className="official-preview"><AvatarImage avatar={APP_AVATAR_DEF}/></div>
    </section>
  </div>;
}

function ProfileModal({user,onClose,onApply}:{user:User;onClose:()=>void;onApply:(id:string)=>Promise<boolean>}){
  const [avatar,setAvatar]=useState<string>(user.avatar);
  const [saving,setSaving]=useState(false);
  const dialogRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  const chosen=avatarOf(avatar);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    dialogRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();closeRef.current();return}
      if(event.key!=="Tab"||!dialogRef.current)return;
      const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>{document.removeEventListener("keydown",onKeyDown);document.body.style.overflow=previousOverflow;previous?.focus()};
  },[]);
  const save=async()=>{setSaving(true);try{await onApply(avatar)}finally{setSaving(false)}};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div ref={dialogRef} className="profile-modal glass" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" tabIndex={-1}>
      <div className="modal-head"><div><span className="eyebrow"><i/> PROFILE</span><h3 id="profile-dialog-title">{user.username}</h3></div><button className="icon-btn" onClick={onClose} aria-label="بستن"><Icon name="x"/></button></div>
      <div className="profile-preview">
        <div className="big-avatar" style={{"--accent":chosen.accent, background:chosen.gradient, boxShadow:`0 0 0 1px ${chosen.ring}, 0 0 45px ${chosen.glow}`} as CSSProperties}><AvatarImage avatar={chosen}/></div>
        <div><b>{chosen.name} • {chosen.tag}</b><span>در کال، وقتی حرف بزنی هاله سبز می‌گیرد.</span></div>
      </div>
      <AvatarPicker value={avatar} onChange={setAvatar}/>
      <GlowButton className="wide" tone="primary" size="lg" icon="check" disabled={saving||avatar===user.avatar} loading={saving?<span className="tiny-spinner"/>:undefined} onClick={save}>{avatar===user.avatar?"بدون تغییر":"ذخیره تغییرات"}</GlowButton>
    </div>
  </div>;
}

/* ─────────────────────────── calls ─────────────────────────── */

function Calls({go,onToast}:{go:(s:string)=>void;onToast:(s:string)=>void}){
  const [name,setName]=useState("Friend Call");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const create=async()=>{setBusy(true);try{const d=await api.createCall(name);onToast("کال ساخته شد؛ شما به‌عنوان میزبان وارد شدید.");go(`/call/${d.call.code}`)}catch(e){onToast(e instanceof Error?e.message:"خطا در ساخت کال")}finally{setBusy(false)}};
  const join=async(e:FormEvent)=>{
    e.preventDefault();
    const normalized=code.trim().toUpperCase();
    if(normalized.length!==CALL_CODE_LENGTH){onToast(`کد کال باید ${CALL_CODE_LENGTH} کاراکتر باشد.`);return}
    setBusy(true);
    try{const d=await api.getCall(normalized);if(d.call.status==="ended")throw new Error("این کال تمام شده است.");go(`/call/${d.call.code}`)}
    catch(e){onToast(e instanceof Error?e.message:"کال پیدا نشد")}
    finally{setBusy(false)}
  };

  return <div className="page">
    <PageTop eyebrow="CALLS" title="کال صوتی" desc={`کال بساز، کد را بالای صفحه ببین و تا ${MAX_CALL_PARTICIPANTS} نفر را دور هم جمع کن.`}/>
    <section className="calls-grid">
      <div className="create-call glass" onMouseMove={spotlight}>
        <div className="card-lamp" aria-hidden="true"/>
        <div className="call-illustration">
          <div className="pulse-ring p1"/><div className="pulse-ring p2"/><div className="pulse-ring p3"/>
          <div className="call-orb">🎧</div>
          <div className="call-lights" aria-hidden="true"><i/><i/><i/></div>
        </div>
        <div className="call-text">
          <span className="eyebrow"><i/> PRIVATE ROOM</span>
          <h2>کال شخصی خودت را بساز.</h2>
          <p>با زدن این دکمه، کال ساخته می‌شود و خودت همان لحظه به‌عنوان میزبان وارد اتاق می‌شوی. بعد کد یا لینک بالای صفحه را برای دوستانت بفرست.</p>
          <label className="field"><span>نام کال <small>اختیاری · حداکثر ۶۴ کاراکتر</small></span><input value={name} onChange={e=>setName(e.target.value.slice(0,64))} dir="rtl" maxLength={64} aria-label="نام کال"/></label>
          <GlowButton tone="primary" size="lg" className="wide" icon="plus" disabled={busy} loading={busy?<span className="tiny-spinner"/>:undefined} onClick={create}>{busy?"در حال ورود به کال...":"ساخت و ورود به کال"}</GlowButton>
          <div className="call-flow-note"><span className="flow-step active"><b>۱</b> ساخت</span><i/><span className="flow-step active"><b>۲</b> ورود خودکار</span><i/><span className="flow-step"><b>۳</b> دعوت دوستان</span></div>
        </div>
      </div>

      <div className="calls-side">
      <div className="join-card glass" onMouseMove={spotlight}>
        <div className="join-icon"><Icon name="link"/></div>
        <span className="eyebrow"><i/> JOIN A CALL</span>
        <h2>کد را وارد کن.</h2>
        <p>اگر دوستت کد یک کال را فرستاده، اینجا واردش کن. بعد از ورود، کد همیشه بالای صفحه در دسترس است.</p>
        <form onSubmit={join}><input value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,"").slice(0,CALL_CODE_LENGTH))} placeholder="مثلاً 7J9K2WP" dir="ltr" maxLength={CALL_CODE_LENGTH} minLength={CALL_CODE_LENGTH} pattern="[A-HJ-NP-Z2-9]{7}" autoComplete="off" aria-label="کد کال" required/><GlowButton className="wide" tone="cyan" trailingIcon={busy?undefined:"arrow"} disabled={busy||code.length!==CALL_CODE_LENGTH} loading={busy?<span className="tiny-spinner"/>:undefined}>{busy?"در حال بررسی…":"ورود به کال"}</GlowButton></form>
        <div className="tip"><Icon name="info" size={16}/><span>برای اینترنت ضعیف، داخل تماس می‌توانی کیفیت صدا را پایین بیاوری.</span></div>
      </div>

      <section className="quality-banner glass">
        <div className="quality-badge"><Icon name="signal"/></div>
        <div><b>Adaptive Audio</b><span>کنترل کیفیت صدا از 12 تا 96 kbps؛ مناسب برای اینترنت‌های ناپایدار.</span></div>
        <div className="quality-demo"><span>LOW</span><i/><i/><i/><i/><i/><span>HIGH</span></div>
      </section>
      </div>
    </section>
  </div>;
}

function IncomingOverlay({call,busy,onAccept,onDecline}:{call:IncomingCall;busy:boolean;onAccept:()=>void;onDecline:()=>void}){
  const a=avatarOf(call.caller.avatar);
  const dialogRef=useRef<HTMLDivElement>(null);
  const declineRef=useRef(onDecline);
  declineRef.current=onDecline;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialogRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();declineRef.current();return}
      if(event.key!=="Tab"||!dialogRef.current)return;
      const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>{document.removeEventListener("keydown",onKeyDown);previous?.focus()};
  },[]);
  return <div className="incoming-backdrop">
    <div ref={dialogRef} className="incoming-card glass" role="dialog" aria-modal="true" aria-label={`تماس ورودی از ${call.caller.username}`} tabIndex={-1}>
      <div className="incoming-top"><span>تماس ورودی</span><div className="ring-dot" aria-hidden="true"><i/><i/><i/></div></div>
      <div className="incoming-avatar" style={{"--accent":a.accent, background:a.gradient, boxShadow:`0 0 0 8px var(--panel), 0 0 60px ${a.glow}`} as CSSProperties}><AvatarImage avatar={a}/></div>
      <h3>{call.caller.username}</h3>
      <p>{call.name}</p>
      <div className="incoming-actions">
        <GlowButton tone="rose" size="lg" className="round-big" icon="phoneOff" onClick={onDecline} disabled={busy} aria-label="رد تماس"/>
        <GlowButton tone="mint" size="lg" className="round-big" icon="call" onClick={onAccept} disabled={busy} aria-label="پاسخ دادن"/>
      </div>
    </div>
  </div>;
}

export default App;
