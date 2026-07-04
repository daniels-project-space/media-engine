"use client";

import { useState } from "react";
import { slideSrc, isVideo, type Slide } from "@/lib/media";

// A clickable thumbnail (image or video) that opens a fullscreen lightbox.
export function MediaTile({
  slide,
  className = "",
  aspect = "aspect-[2/3]",
}: {
  slide: Slide;
  className?: string;
  aspect?: string;
}) {
  const [open, setOpen] = useState(false);
  const src = slideSrc(slide);
  const video = isVideo(slide);
  if (!src) {
    return (
      <div className={`${aspect} ${className} border border-line-2 bg-panel-2 grid place-items-center text-[9px] text-ink-faint`}>
        {(slide.role ?? "GEN").toUpperCase()}
      </div>
    );
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${aspect} ${className} relative block w-full overflow-hidden border border-line-2 bg-void group`}
      >
        {video ? (
          <video src={src} muted loop playsInline className="size-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={slide.prompt.slice(0, 60)} className="size-full object-cover" />
        )}
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
        {video && (
          <span className="absolute bottom-1.5 right-1.5 size-6 grid place-items-center bg-black/60 rounded-full text-white text-[10px]">
            ▶
          </span>
        )}
      </button>
      {open && <Lightbox slide={slide} src={src} video={video} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({
  slide,
  src,
  video,
  onClose,
}: {
  slide: Slide;
  src: string;
  video: boolean;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm grid place-items-center p-6 rise"
    >
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[440px] w-full flex flex-col gap-3">
        {video ? (
          <video src={src} controls autoPlay loop playsInline className="w-full max-h-[80vh] object-contain bg-black border border-line" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="w-full max-h-[80vh] object-contain bg-black border border-line" />
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-dim leading-relaxed line-clamp-2 flex-1">{slide.prompt}</p>
          <a href={src} target="_blank" rel="noreferrer" className="text-[10px] tracking-widest text-signal shrink-0 hover:underline">
            OPEN ↗
          </a>
        </div>
      </div>
      <button onClick={onClose} className="fixed top-5 right-6 text-ink-dim hover:text-ink text-2xl">×</button>
    </div>
  );
}
