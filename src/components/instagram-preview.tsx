"use client";

import { useState } from "react";
import { slideSrc, isVideo, type Slide } from "@/lib/media";

type Persona = {
  name: string;
  handle: string;
  bio?: string;
};

// Pixel-faithful Instagram post mockup inside a phone frame: profile header,
// swipeable carousel with dots, action bar, likes, caption, timestamp.
export function InstagramPreview({
  persona,
  slides,
  caption,
  hook,
}: {
  persona: Persona;
  slides: Slide[];
  caption?: string;
  hook?: string;
}) {
  const [idx, setIdx] = useState(0);
  const media = slides.filter((s) => slideSrc(s));
  const handle = persona.handle.replace("@", "");
  const initials = persona.name.split(" ").map((w) => w[0]).join("");
  const captionText = [caption, hook].filter(Boolean).join("\n");

  return (
    <div className="mx-auto w-full max-w-[380px] bg-black border border-line-2 rounded-[36px] p-2 shadow-2xl">
      <div className="bg-[#0b0b0b] rounded-[28px] overflow-hidden">
        {/* profile header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="size-8 rounded-full bg-gradient-to-tr from-amber via-onair to-signal p-[2px]">
            <div className="size-full rounded-full bg-panel-2 grid place-items-center text-[9px] font-bold text-ink">
              {initials}
            </div>
          </div>
          <div className="flex-1 leading-tight">
            <div className="text-white text-[13px] font-semibold">{handle}</div>
            <div className="text-[10px] text-white/50">Sponsored</div>
          </div>
          <span className="text-white/70 text-lg leading-none">⋯</span>
        </div>

        {/* media carousel */}
        <div className="relative aspect-[4/5] bg-black">
          {media.length > 0 ? (
            isVideo(media[idx]) ? (
              <video src={slideSrc(media[idx])!} controls loop playsInline className="size-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slideSrc(media[idx])!} alt="" className="size-full object-cover" />
            )
          ) : (
            <div className="size-full grid place-items-center text-white/30 text-xs">no media yet</div>
          )}
          {media.length > 1 && (
            <>
              <div className="absolute top-2.5 right-2.5 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
                {idx + 1}/{media.length}
              </div>
              {idx > 0 && (
                <button onClick={() => setIdx(idx - 1)} className="absolute left-1 top-1/2 -translate-y-1/2 size-7 grid place-items-center bg-black/40 text-white rounded-full">‹</button>
              )}
              {idx < media.length - 1 && (
                <button onClick={() => setIdx(idx + 1)} className="absolute right-1 top-1/2 -translate-y-1/2 size-7 grid place-items-center bg-black/40 text-white rounded-full">›</button>
              )}
            </>
          )}
        </div>

        {/* carousel dots */}
        {media.length > 1 && (
          <div className="flex justify-center gap-1 py-2">
            {media.map((_, i) => (
              <span key={i} className={`size-1.5 rounded-full ${i === idx ? "bg-scope" : "bg-white/25"}`} />
            ))}
          </div>
        )}

        {/* action bar */}
        <div className="flex items-center gap-4 px-3 pt-1.5 text-white text-xl">
          <span>♡</span>
          <span>💬</span>
          <span>➤</span>
          <span className="ml-auto">🔖</span>
        </div>

        {/* likes + caption */}
        <div className="px-3 py-2 space-y-1">
          <div className="text-white text-[12px] font-semibold">1,204 likes</div>
          {captionText && (
            <p className="text-white text-[12px] leading-snug whitespace-pre-line">
              <span className="font-semibold mr-1">{handle}</span>
              {captionText}
            </p>
          )}
          <div className="text-white/40 text-[10px]">View all 48 comments</div>
          <div className="text-white/30 text-[9px] uppercase tracking-wide pt-0.5">2 hours ago</div>
        </div>
      </div>
    </div>
  );
}
