"use client";

import { useState } from "react";
import type { CreatorContentItem, CreatorPromotionPersona, CreatorSocialAccount } from "./types";
import { ApprovalStatusPill, ContentStatusPill, EmptyState, FormatPill, SectionHeading, classNames, displayLabel, displayTime } from "./shared";

type PreviewProps = {
  persona: CreatorPromotionPersona;
  content: CreatorContentItem;
  handle: string;
};

function formatLabel(format?: CreatorContentItem["format"]) {
  if (format === "carousel") return "Carousel";
  if (format === "reel") return "Reel";
  if (format === "story") return "Story";
  return "Feed post";
}

function PersonaMark({ persona, className }: { persona: CreatorPromotionPersona; className?: string }) {
  const initials = persona.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className={classNames("size-8 shrink-0 rounded-full bg-gradient-to-tr from-amber via-onair to-signal p-[2px]", className)}>
      <div className="grid size-full place-items-center overflow-hidden rounded-full bg-panel-2 text-[9px] font-bold text-ink">
        {persona.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={persona.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          initials || "—"
        )}
      </div>
    </div>
  );
}

function MediaFrame({
  url,
  kind,
  alt,
  controls = false,
  className,
}: {
  url: string;
  kind?: "image" | "video";
  alt?: string;
  controls?: boolean;
  className?: string;
}) {
  if (kind === "video") {
    return <video src={url} controls={controls} playsInline preload="metadata" className={classNames("size-full object-cover", className)} aria-label={alt ?? "Selected render review preview"} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt ?? "Selected render review preview"} className={classNames("size-full object-cover", className)} />
  );
}

function MissingCreative({ format }: { format: CreatorContentItem["format"] }) {
  return (
    <div className="grid size-full place-items-center px-8 text-center">
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-white/60 uppercase">Creative not rendered</p>
        <p className="mt-2 text-[10px] leading-relaxed text-white/35">A selected render is required before this {formatLabel(format).toLowerCase()} can be reviewed.</p>
      </div>
    </div>
  );
}

function ReviewOnlyMark({ content, className }: { content: CreatorContentItem; className?: string }) {
  return (
    <span className={classNames("rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[8px] font-semibold tracking-[0.12em] text-white/80 uppercase", className)}>
      {content.selectedRenderCandidateId ? "Selected render · not published" : "Review-only preview"}
    </span>
  );
}

function InstagramFeedPreview({ persona, content, handle }: PreviewProps) {
  const isCarousel = content.format === "carousel";
  const media = content.previewMedia ?? [];

  return (
    <div className="overflow-hidden rounded-[23px] bg-[#0b0b0d]">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <PersonaMark persona={persona} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[12px] font-semibold text-white">{handle}</p>
          <p className="mt-0.5 text-[9px] text-white/45">{isCarousel ? "Carousel" : "Feed"} · review presentation</p>
        </div>
        <span className="text-base leading-none text-white/60" aria-hidden>⋯</span>
      </div>

      <InstagramMediaCarousel key={`${content.id}:${content.format}`} media={media} format={content.format} />
      <div className="flex items-center gap-4 px-3 pt-1 text-xl text-white/90" aria-hidden>
        <span>♡</span><span>◌</span><span>⌁</span><span className="ml-auto">▱</span>
      </div>
      <div className="space-y-2 px-3 pb-3 pt-2">
        {content.caption ? (
          <p className="whitespace-pre-line text-[11px] leading-relaxed text-white/90"><span className="mr-1 font-semibold">{handle}</span>{content.caption}</p>
        ) : (
          <p className="text-[10px] text-white/35">Caption has not been drafted.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] tracking-wide text-white/35 uppercase">
          <span>{content.scheduledAt ? `planned ${displayTime(content.scheduledAt)}` : "not scheduled"}</span>
          <ReviewOnlyMark content={content} />
        </div>
      </div>
    </div>
  );
}

function InstagramReelPreview({ persona, content, handle }: PreviewProps) {
  const media = content.previewMedia?.[0];

  return (
    <div className="relative aspect-[9/16] overflow-hidden rounded-[23px] bg-[#09090b]">
      {media ? <MediaFrame url={media.url} kind={media.kind} alt={media.alt} /> : <MissingCreative format="reel" />}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 via-black/20 to-transparent px-3 pb-10 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold tracking-[0.16em] text-white uppercase">Reels</span>
          <ReviewOnlyMark content={content} />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        <span className="grid size-11 place-items-center rounded-full border border-white/45 bg-black/25 pl-0.5 text-lg text-white/90">▷</span>
      </div>
      <div className="pointer-events-none absolute bottom-3 right-2.5 flex flex-col items-center gap-3 text-white" aria-hidden>
        <div className="text-center"><span className="block text-xl leading-none">♡</span><span className="mt-1 block text-[8px] text-white/60">not live</span></div>
        <div className="text-center"><span className="block text-xl leading-none">◌</span><span className="mt-1 block text-[8px] text-white/60">review</span></div>
        <div className="text-center"><span className="block text-xl leading-none">⌁</span><span className="mt-1 block text-[8px] text-white/60">only</span></div>
        <span className="text-lg leading-none">⋯</span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-4 pt-14">
        <div className="flex items-center gap-2">
          <PersonaMark persona={persona} className="size-7" />
          <p className="min-w-0 truncate text-[11px] font-semibold text-white">{handle}</p>
          <span className="rounded border border-white/45 px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-white/80 uppercase">Preview</span>
        </div>
        {content.caption ? (
          <p className="mt-2 max-w-[calc(100%-48px)] whitespace-pre-line text-[10px] leading-relaxed text-white/90">{content.caption}</p>
        ) : content.hook ? (
          <p className="mt-2 max-w-[calc(100%-48px)] text-[10px] leading-relaxed text-white/80">{content.hook}</p>
        ) : (
          <p className="mt-2 text-[10px] text-white/45">Caption is still being reviewed.</p>
        )}
        <p className="mt-2 text-[8px] tracking-wide text-white/55 uppercase">Local visual simulation · no live playback or metrics</p>
      </div>
    </div>
  );
}

function InstagramStoryPreview({ persona, content, handle }: PreviewProps) {
  const media = content.previewMedia?.[0];
  const progressSegments = Math.max(1, Math.min(content.previewMedia?.length || 1, 5));

  return (
    <div className="relative aspect-[9/16] overflow-hidden rounded-[23px] bg-[#09090b]">
      {media ? <MediaFrame url={media.url} kind={media.kind} alt={media.alt} /> : <MissingCreative format="story" />}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/25 to-transparent px-2.5 pb-10 pt-2.5">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${progressSegments}, minmax(0, 1fr))` }} aria-label={`${progressSegments} story-frame review sequence`}>
          {Array.from({ length: progressSegments }, (_, index) => <span key={index} className={classNames("h-0.5 rounded-full", index === 0 ? "bg-white" : "bg-white/35")} />)}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <PersonaMark persona={persona} className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold text-white">{handle}</p>
            <p className="text-[8px] text-white/55">Story review · not live</p>
          </div>
          <ReviewOnlyMark content={content} />
          <span className="text-base leading-none text-white/75" aria-hidden>⋯</span>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-3 pb-4 pt-20">
        {content.caption && <p className="mb-2 whitespace-pre-line text-[10px] leading-relaxed text-white/90">{content.caption}</p>}
        <div className={classNames("rounded-full border px-3 py-2 text-center text-[10px] font-semibold", content.cta ? "border-white/65 bg-white/15 text-white" : "border-amber/60 bg-black/30 text-amber")} aria-label="Story call to action presentation only">
          {content.cta || "CTA pending operator review"}
        </div>
        <p className="mt-2 text-center text-[8px] leading-relaxed text-white/60">Review-only link sticker. Confirm required disclosure and destination approval before anything is shown live.</p>
      </div>
    </div>
  );
}

function InstagramDevice({ persona, content, handle }: PreviewProps) {
  const isVertical = content.format === "story" || content.format === "reel";
  return (
    <div className={classNames("mx-auto w-full rounded-[30px] border border-line-2 bg-black p-2 shadow-2xl", isVertical ? "max-w-[272px]" : "max-w-[380px]")}>
      {content.format === "story" ? (
        <InstagramStoryPreview persona={persona} content={content} handle={handle} />
      ) : content.format === "reel" ? (
        <InstagramReelPreview persona={persona} content={content} handle={handle} />
      ) : (
        <InstagramFeedPreview persona={persona} content={content} handle={handle} />
      )}
    </div>
  );
}

export function CreatorInstagramPostPreview({
  persona,
  content,
  account,
  className,
}: {
  persona?: CreatorPromotionPersona;
  content?: CreatorContentItem;
  account?: CreatorSocialAccount;
  className?: string;
}) {
  const handle = (account?.handle || persona?.handle || "creator").replace(/^@/, "");
  const accountAllowsPreview = !account || account.platform === "instagram";

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Instagram post preview">
      <SectionHeading
        eyebrow="Channel simulation"
        title="Instagram preview"
        description="A review surface only. It does not represent a live post, engagement count, provider receipt, or publishing action."
      />
      {!persona || !content ? (
        <EmptyState title="Select a scheduled creative" detail="Choose a content item in the week schedule to inspect its channel appearance, caption, and approval state." />
      ) : !accountAllowsPreview ? (
        <EmptyState title="This item is not assigned to Instagram" detail="Assign an Instagram account before reviewing this content in an Instagram format." />
      ) : (
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:p-5">
          <InstagramDevice persona={persona} content={content} handle={handle} />

          <div className="min-w-0 space-y-4">
            <div className="border border-line-2 bg-panel-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold tracking-[0.15em] text-ink-faint uppercase">Publish brief</p>
                  <h3 className="display mt-1 text-lg font-bold tracking-tight text-ink">{content.title}</h3>
                  {content.hook && <p className="mt-2 text-xs leading-relaxed text-ink-dim">{content.hook}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5"><FormatPill format={content.format} /><ContentStatusPill status={content.status} /></div>
              </div>
              <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <Metadata label="Assigned account" value={account ? `${displayLabel(account.platform)} · ${account.handle.startsWith("@") ? account.handle : `@${account.handle}`}` : "No account assigned"} />
                <Metadata label="Scheduled for" value={content.scheduledAt ? displayTime(content.scheduledAt) : "Not scheduled"} />
                <Metadata label="Render plan" value={content.renderProvider ? `${displayLabel(content.renderProvider)} · ${displayLabel(content.renderState ?? "unrequested")}` : "No render provider selected"} />
                {content.selectedRenderCandidateId && <Metadata label="Render selection" value="Operator selected · not published" />}
                <div><p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Publishing approval</p><div className="mt-1">{content.approvalStatus ? <ApprovalStatusPill status={content.approvalStatus} /> : <span className="text-[10px] text-ink-faint">Not requested</span>}</div></div>
              </div>
            </div>
            <DetailBlock label="Why this post" value={content.whyNow} empty="No editorial reasoning recorded." />
            <DetailBlock label="Call to action" value={content.cta} empty="No call to action recorded." />
            {content.format === "story" && <DetailBlock label="Story disclosure gate" value="Review required before any destination or link sticker is released." empty="" />}
            <DetailBlock label="Prompt snapshot" value={content.promptSnapshot} empty="No render prompt snapshot recorded." mono />
          </div>
        </div>
      )}
    </section>
  );
}

function InstagramMediaCarousel({ media, format }: { media: NonNullable<CreatorContentItem["previewMedia"]>; format: CreatorContentItem["format"] }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const isCarousel = format === "carousel";
  const visibleSlide = media[isCarousel ? slideIndex : 0];

  return (
    <>
      <div className="relative aspect-[4/5] bg-black">
        {visibleSlide ? (
          <MediaFrame url={visibleSlide.url} kind={visibleSlide.kind} alt={visibleSlide.alt} controls={visibleSlide.kind === "video"} />
        ) : (
          <MissingCreative format={format} />
        )}
        {isCarousel && media.length > 1 && (
          <>
            <span className="absolute right-2.5 top-2.5 rounded-full bg-black/65 px-2 py-0.5 text-[9px] text-white">{slideIndex + 1}/{media.length}</span>
            {slideIndex > 0 && <button type="button" aria-label="Previous carousel item" onClick={() => setSlideIndex((index) => Math.max(0, index - 1))} className="absolute left-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-base text-white transition hover:bg-black/80">‹</button>}
            {slideIndex < media.length - 1 && <button type="button" aria-label="Next carousel item" onClick={() => setSlideIndex((index) => Math.min(media.length - 1, index + 1))} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-base text-white transition hover:bg-black/80">›</button>}
          </>
        )}
      </div>
      {isCarousel && media.length > 1 && (
        <div className="flex justify-center gap-1 py-2" aria-label={`${media.length} carousel items`}>
          {media.map((item, index) => <span key={`${item.url}:${index}`} className={classNames("size-1.5 rounded-full", index === slideIndex ? "bg-scope" : "bg-white/25")} />)}
        </div>
      )}
    </>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">{label}</p><p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{value}</p></div>;
}

function DetailBlock({ label, value, empty, mono = false }: { label: string; value?: string; empty: string; mono?: boolean }) {
  return (
    <div className="border-l border-line-2 pl-3">
      <p className="text-[9px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{label}</p>
      <p className={classNames("mt-1 whitespace-pre-line text-[11px] leading-relaxed", mono ? "text-ink-dim" : "text-ink")}>{value || <span className="text-ink-faint">{empty}</span>}</p>
    </div>
  );
}
