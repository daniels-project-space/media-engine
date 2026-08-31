"use client";

import type { CreatorPartnerDestination } from "./types";
import { ApprovalStatusPill, ComplianceStatusPill, DestinationStatusPill, EmptyState, SectionHeading, classNames, displayLabel, displayTime } from "./shared";

export function CreatorPartnerDestinationPanel({
  destinations,
  selectedCreatorId,
  className,
}: {
  destinations: CreatorPartnerDestination[];
  selectedCreatorId?: string;
  className?: string;
}) {
  const visible = selectedCreatorId ? destinations.filter((destination) => destination.creatorId === selectedCreatorId) : destinations;
  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Brand and partner destinations">
      <SectionHeading
        eyebrow="Commercial pathway"
        title="Brand & partner destinations"
        description="Use these records to govern a lifestyle creator’s public route to brand inquiries, portfolios, and approved link hubs. They do not send outreach or represent a signed contract."
      />
      {visible.length === 0 ? (
        <EmptyState title="No brand or partner destination" detail="Create a truthful inquiry, portfolio, or website destination before attaching it to an editorial plan." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((destination) => (
            <li key={destination.id} className="px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-7 place-items-center border border-line-2 bg-panel-2 text-[9px] font-bold text-ink-dim">{destination.kind === "brand_inquiry" ? "BR" : destination.kind === "link_in_bio" ? "LB" : destination.kind === "website" ? "WEB" : "↗"}</span>
                    <h3 className="text-xs font-semibold text-ink">{destination.label}</h3>
                    <DestinationStatusPill status={destination.connectionStatus} />
                  </div>
                  <p className="mt-2 text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">{displayLabel(destination.kind)}</p>
                  {destination.url ? <a href={destination.url} target="_blank" rel="noreferrer" className="mt-2 inline-block max-w-full truncate text-[10px] text-scope hover:underline">{destination.url} ↗</a> : <p className="mt-2 text-[10px] text-ink-faint">No public destination URL recorded.</p>}
                </div>
                {destination.lastReviewedAt && <p className="shrink-0 text-[9px] text-ink-faint">Reviewed {displayTime(destination.lastReviewedAt)}</p>}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
                <ComplianceStatusPill status={destination.complianceStatus} />
                <ApprovalStatusPill status={destination.approvalStatus} />
              </div>
              <p className="mt-3 border-l border-line-2 pl-3 text-[10px] leading-relaxed text-ink-dim">{destination.disclosure || "No disclosure or commercial-use note recorded."}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
