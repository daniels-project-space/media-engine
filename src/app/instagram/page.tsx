"use client";

// Faithful port of the v1 ai-instagram profile emulator (Daniel's own build):
// authentic IG dark theme, persona switcher, stories, profile header, tabs,
// 3-up grid, two-pane post modal with carousel, reels, and a story viewer.
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useEffect, useMemo, useState } from "react";
import { slideSrc, isVideo, type Slide } from "@/lib/media";

type PostDoc = {
  _id: string;
  status: string;
  kind: string;
  title?: string;
  hook?: string;
  caption?: string;
  slides?: Slide[];
  createdAt: number;
};

// Deterministic pseudo-numbers from an id (no Math.random → no hydration drift).
function hashInt(s: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return min + (h % (max - min + 1));
}
function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}
function timeAgo(ts: number): string {
  const h = Math.max(1, Math.round((Date.now() - ts) / 3600000));
  if (h < 24) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default function InstagramEmulator() {
  const personas = useQuery(api.personas.list);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [tab, setTab] = useState<"posts" | "reels" | "tagged">("posts");
  const [openPost, setOpenPost] = useState<PostDoc | null>(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [story, setStory] = useState<{ items: Slide[]; i: number } | null>(null);

  const activeId = personaId ?? personas?.[0]?._id ?? null;
  const posts = useQuery(
    api.posts.forPersona,
    activeId ? { personaId: activeId as import("../../../convex/_generated/dataModel").Id<"personas"> } : "skip",
  );
  const persona = personas?.find((p) => p._id === activeId);

  const withMedia = useMemo(
    () => (posts ?? []).filter((p) => (p.slides ?? []).some((s) => slideSrc(s as Slide))),
    [posts],
  );
  const imagePosts = withMedia.filter((p) => !(p.slides ?? []).every((s) => isVideo(s as Slide)));
  const reels = withMedia.filter((p) => (p.slides ?? []).some((s) => isVideo(s as Slide)));
  const stories = imagePosts.slice(0, 5);

  // story auto-advance
  useEffect(() => {
    if (!story) return;
    const id = setTimeout(() => {
      setStory((s) => {
        if (!s) return null;
        return s.i + 1 < s.items.length ? { ...s, i: s.i + 1 } : null;
      });
    }, 4000);
    return () => clearTimeout(id);
  }, [story]);

  if (personas === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  if (personas.length === 0) return <div className="text-ink-dim text-sm">No personas yet.</div>;

  const followers = persona ? hashInt(persona._id + "f", 4200, 89000) : 0;
  const following = persona ? hashInt(persona._id + "g", 180, 900) : 0;
  const initials = persona?.name.split(" ").map((w) => w[0]).join("") ?? "";
  const modalSlides = (openPost?.slides ?? []).filter((s) => slideSrc(s as Slide)) as Slide[];

  return (
    <div className="igview">
      <style>{IG_CSS}</style>

      {/* top nav */}
      <div className="ig-topnav">
        <span className="ig-back">◂ Media Engine</span>
        <div className="ig-logo">Instagram</div>
        <div className="ig-icons"><span>＋</span><span>♡</span><span>✉</span></div>
      </div>

      {/* persona switcher */}
      <div className="ig-personas">
        {personas.map((p) => (
          <button
            key={p._id}
            className={`ig-pbtn ${p._id === activeId ? "active" : ""}`}
            onClick={() => { setPersonaId(p._id); setTab("posts"); }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* stories bar */}
      {persona && (
        <div className="ig-stories">
          <div className="ig-story-item" onClick={() => stories.length && setStory({ items: stories.map((s) => (s.slides ?? []).find((x) => slideSrc(x as Slide)) as Slide), i: 0 })}>
            <div className="ig-story-ring"><div className="ig-story-avatar">{initials}</div></div>
            <div className="ig-story-name">{persona.handle.replace("@", "")}</div>
          </div>
        </div>
      )}

      {/* profile header */}
      {persona && (
        <div className="ig-profile">
          <div className="ig-profile-top">
            <div className="ig-avatar-wrap"><div className="ig-avatar">{initials}</div></div>
            <div className="ig-profile-info">
              <div className="ig-username-row">
                <h1>{persona.handle.replace("@", "")}</h1>
                <svg className="ig-verified" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#0095f6" /><path d="M17 20.5l-3-3-1.5 1.5L17 23.5l10-10-1.5-1.5z" fill="white" /></svg>
                <button className="ig-btn-follow">Follow</button>
                <button className="ig-btn-message">Message</button>
              </div>
              <div className="ig-stats">
                <span><strong>{withMedia.length}</strong> posts</span>
                <span><strong>{fmt(followers)}</strong> followers</span>
                <span><strong>{following}</strong> following</span>
              </div>
              <div className="ig-bio">
                <div className="ig-bio-name">{persona.name}</div>
                <div className="ig-bio-cat">{persona.niche}</div>
                <div className="ig-bio-text">{persona.bio}</div>
                <a className="ig-bio-link" href={`/p/${persona.handle.replace("@", "")}`} target="_blank" rel="noreferrer">
                  linktr.ee/{persona.handle.replace("@", "")}
                </a>
              </div>
            </div>
          </div>
          <div className="ig-highlights">
            {["✨", "🌇", "☕", "📚", "👗"].map((e, i) => (
              <div key={i} className="ig-highlight"><div className="ig-hl-ring">{e}</div></div>
            ))}
          </div>
        </div>
      )}

      {/* tabs */}
      <div className="ig-tabs">
        <div className={`ig-tab ${tab === "posts" ? "active" : ""}`} onClick={() => setTab("posts")}>▦ POSTS</div>
        <div className={`ig-tab ${tab === "reels" ? "active" : ""}`} onClick={() => setTab("reels")}>▷ REELS</div>
        <div className={`ig-tab ${tab === "tagged" ? "active" : ""}`} onClick={() => setTab("tagged")}>◎ TAGGED</div>
      </div>

      {/* posts grid */}
      {tab === "posts" && (
        imagePosts.length === 0 ? (
          <div className="ig-empty">No posts yet</div>
        ) : (
          <div className="ig-grid">
            {imagePosts.map((p) => {
              const media = (p.slides ?? []).filter((s) => slideSrc(s as Slide)) as Slide[];
              const cover = media[0];
              const src = slideSrc(cover)!;
              return (
                <div key={p._id} className="ig-thumb" onClick={() => { setOpenPost(p as PostDoc); setCarouselIdx(0); }}>
                  {isVideo(cover) ? <video src={src} muted /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={src} alt="" loading="lazy" />}
                  <div className="ig-overlay"><span>♥ {fmt(hashInt(p._id, 200, 9000))}</span><span>💬 {hashInt(p._id + "c", 3, 40)}</span></div>
                  {media.length > 1 && <div className="ig-carousel-badge">⧉</div>}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* reels grid */}
      {tab === "reels" && (
        reels.length === 0 ? <div className="ig-empty">No reels yet</div> : (
          <div className="ig-reels">
            {reels.map((p) => {
              const v = (p.slides ?? []).find((s) => isVideo(s as Slide)) as Slide;
              return (
                <div key={p._id} className="ig-reel" onClick={() => { setOpenPost(p as PostDoc); setCarouselIdx(0); }}>
                  <video src={slideSrc(v)!} muted loop preload="metadata" onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                  <div className="ig-reel-views">▷ {fmt(hashInt(p._id, 1200, 220000))}</div>
                </div>
              );
            })}
          </div>
        )
      )}
      {tab === "tagged" && <div className="ig-empty">No tagged posts</div>}

      {/* post modal */}
      {openPost && persona && (
        <div className="ig-modal-backdrop open" onClick={() => setOpenPost(null)}>
          <button className="ig-modal-close" onClick={() => setOpenPost(null)}>×</button>
          <div className="ig-post-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ig-modal-img">
              {isVideo(modalSlides[carouselIdx]) ? (
                <video src={slideSrc(modalSlides[carouselIdx])!} controls autoPlay loop />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slideSrc(modalSlides[carouselIdx])!} alt="" />
              )}
              {modalSlides.length > 1 && (
                <>
                  {carouselIdx > 0 && <button className="ig-cnav prev" onClick={() => setCarouselIdx((i) => i - 1)}>‹</button>}
                  {carouselIdx < modalSlides.length - 1 && <button className="ig-cnav next" onClick={() => setCarouselIdx((i) => i + 1)}>›</button>}
                  <div className="ig-cdots">{modalSlides.map((_, i) => <div key={i} className={`ig-cdot ${i === carouselIdx ? "active" : ""}`} />)}</div>
                </>
              )}
            </div>
            <div className="ig-modal-side">
              <div className="ig-post-header">
                <div className="ig-ph-avatar">{initials}</div>
                <div><div className="ig-ph-name">{persona.handle.replace("@", "")}</div><div className="ig-ph-loc">{persona.niche}</div></div>
              </div>
              <div className="ig-caption-area">
                <div className="ig-caption"><span className="ig-c-user">{persona.handle.replace("@", "")}</span>{openPost.caption ?? openPost.hook ?? openPost.title}</div>
              </div>
              <div className="ig-post-actions"><span>♡</span><span>💬</span><span>➤</span><span className="ig-spacer" /><span>🔖</span></div>
              <div className="ig-likes">{fmt(hashInt(openPost._id, 200, 9000))} likes</div>
              <div className="ig-time">{timeAgo(openPost.createdAt).toUpperCase()}</div>
            </div>
          </div>
        </div>
      )}

      {/* story viewer */}
      {story && persona && (
        <div className="ig-story-viewer open" onClick={() => setStory(null)}>
          <div className="ig-story-container" onClick={(e) => e.stopPropagation()}>
            <div className="ig-story-progress">
              {story.items.map((_, i) => (
                <div key={i} className="ig-sbar"><div className={`ig-sbar-fill ${i < story.i ? "done" : i === story.i ? "active" : ""}`} /></div>
              ))}
            </div>
            {isVideo(story.items[story.i]) ? (
              <video src={slideSrc(story.items[story.i])!} autoPlay muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slideSrc(story.items[story.i])!} alt="" />
            )}
            <div className="ig-story-user"><div className="ig-su-av">{initials}</div><span>{persona.handle.replace("@", "")}</span></div>
            <button className="ig-story-close" onClick={() => setStory(null)}>×</button>
            <div className="ig-story-nav left" onClick={(e) => { e.stopPropagation(); setStory((s) => s && s.i > 0 ? { ...s, i: s.i - 1 } : s); }} />
            <div className="ig-story-nav right" onClick={(e) => { e.stopPropagation(); setStory((s) => s && s.i + 1 < s.items.length ? { ...s, i: s.i + 1 } : null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

const IG_CSS = `
.igview { --ig-bg:#000; --ig-elev:#121212; --ig-modal:#262626; --ig-text:#f5f5f5; --ig-sec:#a8a8a8; --ig-link:#e0f1ff; --ig-border:#262626; --ig-sep:#363636; --ig-accent:#0095f6; --ig-ring:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);
  background:var(--ig-bg); color:var(--ig-text); margin:-1.5rem; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
@media (min-width:768px){ .igview{ margin:-2rem; } }
.ig-topnav{ height:56px; border-bottom:1px solid var(--ig-border); display:flex; align-items:center; justify-content:space-between; padding:0 20px; position:sticky; top:0; background:var(--ig-bg); z-index:10; }
.ig-back{ color:var(--ig-sec); font-size:13px; }
.ig-logo{ font-family:'Segoe Script','Brush Script MT',cursive; font-size:26px; }
.ig-icons{ display:flex; gap:20px; font-size:20px; color:var(--ig-text); }
.ig-personas{ max-width:935px; margin:0 auto; padding:12px 20px; display:flex; gap:12px; justify-content:center; }
.ig-pbtn{ background:var(--ig-modal); color:var(--ig-sec); border:1px solid var(--ig-sep); padding:8px 24px; border-radius:20px; cursor:pointer; font-size:14px; font-weight:500; }
.ig-pbtn.active{ background:var(--ig-text); color:var(--ig-bg); border-color:var(--ig-text); }
.ig-stories{ display:flex; gap:16px; padding:16px 20px; max-width:935px; margin:0 auto; border-bottom:1px solid var(--ig-border); }
.ig-story-item{ text-align:center; cursor:pointer; }
.ig-story-ring{ width:66px; height:66px; border-radius:50%; padding:3px; background:var(--ig-ring); }
.ig-story-avatar{ width:100%; height:100%; border-radius:50%; border:3px solid var(--ig-bg); background:var(--ig-modal); display:grid; place-items:center; font-weight:700; font-size:16px; }
.ig-story-name{ font-size:12px; color:var(--ig-sec); margin-top:4px; }
.ig-profile{ max-width:935px; margin:0 auto; padding:30px 20px 0; }
.ig-profile-top{ display:flex; gap:80px; margin-bottom:30px; }
.ig-avatar-wrap{ flex-shrink:0; }
.ig-avatar{ width:150px; height:150px; border-radius:50%; border:3px solid var(--ig-sep); background:var(--ig-modal); display:grid; place-items:center; font-size:42px; font-weight:800; }
.ig-profile-info{ flex:1; }
.ig-username-row{ display:flex; align-items:center; gap:12px; margin-bottom:20px; }
.ig-username-row h1{ font-size:20px; font-weight:400; }
.ig-verified{ width:18px; height:18px; }
.ig-btn-follow{ background:var(--ig-accent); color:#fff; border:none; padding:7px 20px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
.ig-btn-message{ background:var(--ig-modal); color:var(--ig-text); border:none; padding:7px 20px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
.ig-stats{ display:flex; gap:40px; margin-bottom:20px; }
.ig-stats span{ font-size:16px; color:var(--ig-sec); }
.ig-stats strong{ color:var(--ig-text); font-weight:600; }
.ig-bio{ line-height:1.5; }
.ig-bio-name{ font-weight:600; }
.ig-bio-cat{ color:var(--ig-sec); font-size:14px; }
.ig-bio-text{ font-size:14px; margin-top:4px; white-space:pre-line; max-width:400px; }
.ig-bio-link{ color:var(--ig-link); font-size:14px; font-weight:600; text-decoration:none; }
.ig-highlights{ display:flex; gap:15px; padding:10px 0 20px; border-bottom:1px solid var(--ig-border); }
.ig-highlight{ text-align:center; }
.ig-hl-ring{ width:77px; height:77px; border-radius:50%; background:var(--ig-modal); border:1px solid var(--ig-sep); display:grid; place-items:center; font-size:26px; }
.ig-tabs{ display:flex; justify-content:center; border-top:1px solid var(--ig-border); max-width:935px; margin:0 auto; }
.ig-tab{ flex:1; text-align:center; padding:14px 0; cursor:pointer; color:var(--ig-sec); font-size:12px; font-weight:600; letter-spacing:1px; border-top:1px solid transparent; margin-top:-1px; }
.ig-tab.active{ color:var(--ig-text); border-top-color:var(--ig-text); }
.ig-grid,.ig-reels{ max-width:935px; margin:0 auto; display:grid; grid-template-columns:repeat(3,1fr); gap:4px; padding:4px 0 40px; }
.ig-thumb{ aspect-ratio:1; overflow:hidden; cursor:pointer; position:relative; background:#000; }
.ig-thumb img,.ig-thumb video{ width:100%; height:100%; object-fit:cover; }
.ig-thumb:hover .ig-overlay{ opacity:1; }
.ig-overlay{ position:absolute; inset:0; background:rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; gap:24px; opacity:0; transition:opacity .2s; color:#fff; font-weight:600; font-size:14px; }
.ig-carousel-badge{ position:absolute; top:8px; right:8px; color:#fff; font-size:16px; filter:drop-shadow(0 1px 3px rgba(0,0,0,.5)); }
.ig-reel{ aspect-ratio:9/16; overflow:hidden; cursor:pointer; position:relative; border-radius:4px; background:#000; }
.ig-reel video{ width:100%; height:100%; object-fit:cover; }
.ig-reel-views{ position:absolute; bottom:8px; left:8px; color:#fff; font-size:13px; font-weight:600; text-shadow:0 1px 3px rgba(0,0,0,.6); }
.ig-empty{ text-align:center; padding:60px 20px; color:var(--ig-sec); max-width:935px; margin:0 auto; }
.ig-modal-backdrop{ position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:200; display:flex; align-items:center; justify-content:center; }
.ig-modal-close{ position:absolute; top:16px; right:20px; color:#fff; font-size:30px; cursor:pointer; background:none; border:none; z-index:210; }
.ig-post-modal{ background:var(--ig-elev); display:flex; max-width:90vw; max-height:90vh; overflow:hidden; }
.ig-modal-img{ flex:1; min-width:0; max-width:600px; background:#000; display:flex; align-items:center; justify-content:center; position:relative; }
.ig-modal-img img,.ig-modal-img video{ width:100%; height:100%; object-fit:contain; max-height:90vh; }
.ig-cnav{ position:absolute; top:50%; transform:translateY(-50%); width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,.85); border:none; cursor:pointer; font-size:16px; color:#333; }
.ig-cnav.prev{ left:8px; } .ig-cnav.next{ right:8px; }
.ig-cdots{ position:absolute; bottom:12px; left:50%; transform:translateX(-50%); display:flex; gap:4px; }
.ig-cdot{ width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,.4); }
.ig-cdot.active{ background:var(--ig-accent); }
.ig-modal-side{ width:335px; display:flex; flex-direction:column; border-left:1px solid var(--ig-border); }
.ig-post-header{ display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ig-border); }
.ig-ph-avatar,.ig-su-av{ width:32px; height:32px; border-radius:50%; background:var(--ig-modal); display:grid; place-items:center; font-size:11px; font-weight:700; }
.ig-ph-name{ font-weight:600; font-size:14px; }
.ig-ph-loc{ font-size:12px; color:var(--ig-sec); }
.ig-caption-area{ flex:1; overflow-y:auto; padding:16px; }
.ig-caption{ font-size:14px; line-height:1.6; }
.ig-c-user{ font-weight:600; margin-right:6px; }
.ig-post-actions{ padding:10px 16px; border-top:1px solid var(--ig-border); display:flex; gap:16px; font-size:22px; }
.ig-spacer{ flex:1; }
.ig-likes{ padding:0 16px 4px; font-weight:600; font-size:14px; }
.ig-time{ padding:0 16px 12px; font-size:10px; color:var(--ig-sec); }
.ig-story-viewer{ position:fixed; inset:0; background:#000; z-index:300; display:flex; align-items:center; justify-content:center; }
.ig-story-container{ position:relative; width:420px; max-width:94vw; max-height:90vh; aspect-ratio:9/16; border-radius:12px; overflow:hidden; }
.ig-story-container img,.ig-story-container video{ width:100%; height:100%; object-fit:cover; }
.ig-story-progress{ position:absolute; top:8px; left:8px; right:8px; display:flex; gap:4px; z-index:5; }
.ig-sbar{ flex:1; height:3px; background:rgba(255,255,255,.3); border-radius:2px; overflow:hidden; }
.ig-sbar-fill{ height:100%; background:#fff; width:0; }
.ig-sbar-fill.done{ width:100%; }
.ig-sbar-fill.active{ width:100%; transition:width 4s linear; }
.ig-story-user{ position:absolute; top:24px; left:12px; display:flex; align-items:center; gap:8px; z-index:5; }
.ig-story-user span{ color:#fff; font-weight:600; font-size:14px; text-shadow:0 1px 3px rgba(0,0,0,.5); }
.ig-story-close{ position:absolute; top:22px; right:12px; color:#fff; font-size:24px; cursor:pointer; background:none; border:none; z-index:6; }
.ig-story-nav{ position:absolute; top:0; bottom:0; width:40%; cursor:pointer; }
.ig-story-nav.left{ left:0; } .ig-story-nav.right{ right:0; }
@media (max-width:735px){ .ig-profile-top{ gap:20px; } .ig-avatar{ width:80px; height:80px; font-size:26px; } .ig-stats{ gap:20px; } .ig-post-modal{ flex-direction:column; max-width:95vw; } .ig-modal-side{ width:100%; max-height:280px; } }
`;
