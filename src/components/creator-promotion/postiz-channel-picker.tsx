"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import type { PostizDiscoveredChannel } from "@/lib/creator-promotion";

export type PostizChannelPickerCreator = Readonly<{
  id: string;
  name: string;
  handle: string;
}>;

export type PostizChannelMapInput = Readonly<{
  creatorId: string;
  platform: NonNullable<PostizDiscoveredChannel["platform"]>;
  integrationId: string;
  handle: string;
  displayName: string;
  requestedCapabilities: string[];
}>;

export type CreatorPostizChannelPickerProps = Readonly<{
  creators: PostizChannelPickerCreator[];
  initialCreatorId?: string;
  channels: PostizDiscoveredChannel[] | null;
  refreshing: boolean;
  busy: boolean;
  onRefresh: () => void;
  onMap: (input: PostizChannelMapInput) => Promise<boolean>;
}>;

const inputClass = "w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-scope";

function platformLabel(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * An explicit, read-only Postiz channel chooser. It does not initiate OAuth,
 * write back to Postiz, auto-link a creator account, or expose an integration
 * ID as an operator text field. Mapping remains a separate user submission.
 */
export function CreatorPostizChannelPicker({
  creators,
  initialCreatorId,
  channels,
  refreshing,
  busy,
  onRefresh,
  onMap,
}: CreatorPostizChannelPickerProps) {
  const [selectedId, setSelectedId] = useState("");
  const [creatorId, setCreatorId] = useState(initialCreatorId ?? "");
  const selected = useMemo(
    () => channels?.find((channel) => channel.id === selectedId)
      ?? channels?.find((channel) => channel.canMap)
      ?? channels?.[0],
    [channels, selectedId],
  );
  const selectedChannelId = selected?.id ?? "";
  const [draftChannelId, setDraftChannelId] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const draftMatchesSelected = draftChannelId === selectedChannelId;
  const selectedHandle = draftMatchesSelected ? handle : selected?.handle ?? "";
  const selectedDisplayName = draftMatchesSelected ? displayName : selected?.displayLabel ?? "";

  const chooseChannel = (id: string) => {
    const next = channels?.find((channel) => channel.id === id);
    setSelectedId(id);
    setDraftChannelId(id);
    setHandle(next?.handle ?? "");
    setDisplayName(next?.displayLabel ?? "");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected?.canMap || !selected.platform || !creatorId || !selectedHandle.trim()) return;
    await onMap({
      creatorId,
      platform: selected.platform,
      integrationId: selected.id,
      handle: selectedHandle.trim(),
      displayName: selectedDisplayName.trim(),
      requestedCapabilities: selected.capabilityHints,
    });
  };

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.13em] text-scope uppercase">Discover Postiz channels</p>
          <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-ink-dim">Request a fresh, read-only list from the configured Postiz instance. OAuth, tokens, raw provider data, and account creation stay outside this desk. Selecting a channel does not map it or schedule a post.</p>
        </div>
        <button type="button" disabled={busy || refreshing} onClick={onRefresh} className="border border-scope/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope hover:bg-scope hover:text-void disabled:cursor-not-allowed disabled:opacity-50">
          {refreshing ? "Refreshing channels…" : "Refresh authorised channels"}
        </button>
      </div>

      {channels === null ? (
        <p className="mt-4 text-[10px] leading-relaxed text-ink-faint">Nothing is requested until you refresh. This is useful for a large approved portfolio because channel IDs never need to be copied by hand.</p>
      ) : channels.length === 0 ? (
        <p className="mt-4 border border-amber/40 bg-amber/[0.04] p-3 text-[10px] leading-relaxed text-amber">Postiz returned no connected channels. Connect and authorise a channel in Postiz, then refresh this list.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[10px] font-medium text-ink-dim">
            <span className="mb-1.5 block">Authorised Postiz channel</span>
            <select value={selectedChannelId} onChange={(event) => chooseChannel(event.target.value)} className={inputClass}>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.displayLabel} · {platformLabel(channel.provider)} · {channel.status}</option>)}
            </select>
          </label>
          <label className="block text-[10px] font-medium text-ink-dim">
            <span className="mb-1.5 block">Creator</span>
            <select required value={creatorId} onChange={(event) => setCreatorId(event.target.value)} className={inputClass}>
              <option value="" disabled>Select creator</option>
              {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name} · {creator.handle}</option>)}
            </select>
          </label>

          {selected && (
            <div className="sm:col-span-2 border border-line bg-panel-2/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold text-ink">{selected.displayLabel}</p>
                <span className="border border-current/30 px-2 py-1 text-[9px] font-semibold tracking-[0.12em] text-ink-dim uppercase">{selected.status}</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">{selected.mappingHint}</p>
              <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">Provider: {platformLabel(selected.provider)}{selected.platform ? ` · governed platform: ${platformLabel(selected.platform)}` : ""}{selected.capabilityHints.length ? ` · capability hint: ${selected.capabilityHints.join(", ")}` : ""}</p>
            </div>
          )}

          <label className="block text-[10px] font-medium text-ink-dim">
            <span className="mb-1.5 block">Account handle</span>
            <input required value={selectedHandle} onChange={(event) => { setDraftChannelId(selectedChannelId); setHandle(event.target.value); }} className={inputClass} placeholder="Confirm channel handle" />
          </label>
          <label className="block text-[10px] font-medium text-ink-dim">
            <span className="mb-1.5 block">Channel label</span>
            <input value={selectedDisplayName} onChange={(event) => { setDraftChannelId(selectedChannelId); setDisplayName(event.target.value); }} className={inputClass} placeholder="Operator-facing label" />
          </label>
          <div className="sm:col-span-2">
            <p className="text-[10px] leading-relaxed text-ink-faint">Mapping records an operator-attested association only. Each future schedule still needs a selected render, frozen delivery policy, separate approval, explicit Postiz handoff, and worker-side connection check.</p>
            <button type="submit" disabled={busy || !selected?.canMap || !selected?.platform || !creatorId || !selectedHandle.trim()} className="mt-3 border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:opacity-50">Map selected authorised channel</button>
          </div>
        </form>
      )}
    </div>
  );
}
