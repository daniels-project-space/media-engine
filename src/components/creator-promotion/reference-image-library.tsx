"use client";

import { useState } from "react";
import type { CreatorReferenceAsset, CreatorReferenceRightsStatus } from "./types";
import { EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime } from "./shared";

export type CreatorReferenceImageLibraryProps = {
  /** References returned by the authenticated media service. No sample assets are rendered. */
  assets: CreatorReferenceAsset[];
  /** Controlled selection. The parent owns persistence and review state. */
  selectedAssetIds: string[];
  onSelectionChange: (selectedAssetIds: string[]) => void;
  /** Opens the host product's authenticated upload/request workflow. */
  onRequestUpload: () => void;
  className?: string;
};

const RIGHTS_PRESENTATION: Record<CreatorReferenceRightsStatus, { label: string; tone: "signal" | "scope" | "amber" | "onair" }> = {
  creator_owned: { label: "Creator-owned", tone: "signal" },
  consent_verified: { label: "Consent verified", tone: "signal" },
  license_verified: { label: "License verified", tone: "scope" },
  review_required: { label: "Rights review required", tone: "amber" },
  rejected: { label: "Not usable", tone: "onair" },
};

/**
 * Match the content-plan boundary: a visible historical asset is not
 * automatically usable as visual guidance. Creator-likeness constraints are
 * enforced again by the server because this component has no authority over
 * storage or render requests.
 */
function canGuideCreatorRender(asset: CreatorReferenceAsset): boolean {
  return asset.rightsStatus === "creator_owned"
    || asset.rightsStatus === "consent_verified"
    || asset.rightsStatus === "license_verified";
}

function RightsPill({ status }: { status: CreatorReferenceRightsStatus }) {
  const presentation = RIGHTS_PRESENTATION[status];
  return <StatusPill label={presentation.label} tone={presentation.tone} />;
}

function ReferenceThumbnail({ asset }: { asset: CreatorReferenceAsset }) {
  const [hasPreviewError, setHasPreviewError] = useState(false);

  if (!asset.imageUrl || hasPreviewError) {
    return (
      <div className="grid aspect-[4/3] place-items-center border-b border-line bg-panel-2 px-5 text-center">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.14em] text-ink-faint uppercase">No signed preview</p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">The reference record is visible, but its image is not available in this session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3] overflow-hidden border-b border-line bg-panel-2">
      {/* A supplied signed URL is rendered directly; the library never invents a reference image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.imageUrl} alt={asset.label} className="size-full object-cover" onError={() => setHasPreviewError(true)} />
      <span className="absolute bottom-2 left-2 border border-white/20 bg-black/65 px-2 py-1 text-[8px] font-semibold tracking-[0.12em] text-white/80 uppercase">Signed preview</span>
    </div>
  );
}

function ReferenceCard({ asset, selected, onToggle }: { asset: CreatorReferenceAsset; selected: boolean; onToggle: () => void }) {
  const canSelect = canGuideCreatorRender(asset);
  const selectionLabel = selected ? "Remove" : canSelect ? "Select" : asset.rightsStatus === "review_required" ? "Needs review" : "Unavailable";

  return (
    <article className={classNames("overflow-hidden border bg-panel transition-colors", selected ? "border-signal/70" : "border-line")} aria-label={`${asset.label} reference`} data-selected={selected || undefined}>
      <ReferenceThumbnail asset={asset} />
      <div className="space-y-3 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-xs font-semibold text-ink" title={asset.label}>{asset.label}</h3>
            <p className="mt-1 truncate text-[9px] text-ink-faint" title={asset.creatorId}>Creator record · {asset.creatorId}</p>
          </div>
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`${selectionLabel} ${asset.label}`}
            disabled={!canSelect && !selected}
            onClick={onToggle}
            className={classNames(
              "shrink-0 border px-2 py-1 text-[9px] font-semibold tracking-[0.1em] uppercase transition",
              selected ? "border-signal/60 bg-signal/10 text-signal hover:bg-signal/15" : !canSelect ? "cursor-not-allowed border-line bg-panel-2 text-ink-faint" : "border-line-2 bg-panel-2 text-ink-dim hover:border-scope/60 hover:text-scope",
            )}
          >
            {selectionLabel}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <StatusPill label={displayLabel(asset.useType)} tone="muted" />
          <RightsPill status={asset.rightsStatus} />
        </div>

        <div className="border-l border-line-2 pl-2.5">
          <p className="text-[8px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Source & provenance</p>
          <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-ink-dim">{asset.sourceDescription}</p>
        </div>

        <p className="border-t border-line pt-2 text-[9px] text-ink-faint">Added {displayTime(asset.createdAt, { dateStyle: "medium" })}</p>
      </div>
    </article>
  );
}

/**
 * Controlled, provider-agnostic reference selector. It has no upload/storage
 * behaviour of its own, so provenance, consent and access checks remain with
 * the authenticated backend that supplied these metadata records.
 */
export function CreatorReferenceImageLibrary({
  assets,
  selectedAssetIds,
  onSelectionChange,
  onRequestUpload,
  className,
}: CreatorReferenceImageLibraryProps) {
  const selectedIds = new Set(selectedAssetIds);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  function toggleAsset(asset: CreatorReferenceAsset) {
    // A previously selected, now-unreviewed asset is removed the next time a
    // selection changes. Unknown ids are retained because this controlled
    // component may be rendering only one creator's inventory at a time.
    const next = new Set(selectedAssetIds.filter((assetId) => {
      const selectedAsset = assetsById.get(assetId);
      return !selectedAsset || canGuideCreatorRender(selectedAsset);
    }));
    if (next.has(asset.id)) {
      next.delete(asset.id);
    } else if (canGuideCreatorRender(asset)) {
      next.add(asset.id);
    }
    onSelectionChange([...next]);
  }

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Reference image library">
      <SectionHeading
        eyebrow="Visual source control"
        title="Reference image library"
        description="Use verified references to guide a creator’s visual system. Records remain metadata-first until an authenticated signed preview is supplied."
        action={
          <button type="button" onClick={onRequestUpload} className="border border-scope/60 bg-scope/5 px-3 py-2 text-[9px] font-semibold tracking-[0.12em] text-scope uppercase transition hover:bg-scope/10">
            Request upload
          </button>
        }
      />

      <div className="border-b border-line bg-amber/5 px-4 py-2.5 sm:px-5" role="note">
        <p className="text-[10px] leading-relaxed text-amber"><span className="mr-1 font-semibold tracking-[0.1em] uppercase">Rights guardrail</span> Do not add scraped, unconsented, or likeness-matching material. Select only creator-owned, licensed, or consent-verified references.</p>
      </div>

      {assets.length === 0 ? (
        <EmptyState
          title="No reference assets have been shared"
          detail="This library shows only authenticated, operator-supplied metadata and signed previews. Request a rights-cleared upload instead of sourcing images from public profiles."
          action={<button type="button" onClick={onRequestUpload} className="border border-line-2 bg-panel-2 px-3 py-2 text-[9px] font-semibold tracking-[0.12em] text-ink-dim uppercase transition hover:border-scope/60 hover:text-scope">Request a rights-cleared upload</button>}
        />
      ) : (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-faint">
            <p>{assets.length} {assets.length === 1 ? "reference" : "references"} available</p>
            <p>{selectedIds.size} selected for this review</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => <ReferenceCard key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} onToggle={() => toggleAsset(asset)} />)}
          </div>
        </div>
      )}
    </section>
  );
}
