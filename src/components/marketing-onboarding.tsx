"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Doc } from "../../convex/_generated/dataModel";
import { MarketingIcon } from "./marketing-frame";

type Account = Doc<"marketingProviderAccounts">;
type Choice = {
  accountId: string;
  mode: "off" | "draft" | "automatic";
  subreddit: string;
  communityApproved: boolean;
  adAccountId: string;
  pageId: string;
};
const platforms = [
  {
    id: "instagram",
    name: "Instagram",
    short: "IG",
    detail: "Images, video & captions",
  },
  { id: "x", name: "X", short: "𝕏", detail: "Short posts & product updates" },
  { id: "reddit", name: "Reddit", short: "r/", detail: "Approved communities" },
  {
    id: "googleads",
    name: "Google Ads",
    short: "G",
    detail: "Search campaigns",
  },
  { id: "metaads", name: "Meta Ads", short: "M", detail: "Website campaigns" },
];
async function request(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/marketing", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Could not save your project");
  return body;
}

export default function MarketingOnboarding({
  accounts,
  reservedProfileIds,
  onRefresh,
  onComplete,
  onCancel,
}: {
  accounts: Account[];
  reservedProfileIds: string[];
  onRefresh: () => Promise<void>;
  onComplete: (projectId: string, token: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [details, setDetails] = useState({
    website: "",
    name: "",
    offer: "",
    audience: "",
    goal: "lead",
    timezone: "Europe/Zurich",
    facts: "",
    tone: "Clear, useful and direct",
    cadence: "3",
    currency: "USD",
    generationLimit: "0",
    advertisingLimit: "0",
  });
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timer = window.setTimeout(() => {
      if (timezone) setDetails((previous) => ({ ...previous, timezone }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  // A partial save retries the same project instead of creating a duplicate.
  const created = useRef<{ projectId: string; token: string } | null>(null);
  const onboardingKey = useRef("");
  const [savedProject, setSavedProject] = useState<{
    projectId: string;
    token: string;
  } | null>(null);
  const selectedProfileId = Object.values(choices)
    .map((row) => accounts.find((account) => account._id === row.accountId)?.profileId)
    .find((profileId): profileId is string => Boolean(profileId));
  const connected = accounts.filter(
    (account) =>
      account.connected &&
      !reservedProfileIds.includes(account.profileId) &&
      (!selectedProfileId || account.profileId === selectedProfileId),
  );
  const update = (name: keyof typeof details, value: string) =>
    setDetails((previous) => ({ ...previous, [name]: value }));
  const choice = (platform: string, patch: Partial<Choice>) =>
    setChoices((previous) => ({
      ...previous,
      [platform]: {
        ...(previous[platform] ?? {
          accountId: "",
          mode: "off",
          subreddit: "",
          communityApproved: false,
          adAccountId: "",
          pageId: "",
        }),
        ...patch,
      },
    }));
  const enabled = Object.entries(choices).filter(
    ([, row]) => row.mode !== "off" && row.accountId,
  );
  async function inspect() {
    if (!details.website) {
      setError("Add your website URL first.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/marketing/inspect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: details.website }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Website import failed");
      setDetails((previous) => ({
        ...previous,
        website: body.website || previous.website,
        name: body.name || previous.name,
        offer: body.offer || previous.offer,
      }));
      setNotice("Website imported. Review the details before continuing.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Website import failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      if (!created.current) {
        if (!onboardingKey.current) onboardingKey.current = crypto.randomUUID();
        const result = await request("create-project", {
          onboardingKey: onboardingKey.current,
          ...details,
          facts: details.facts
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          cadence: Number(details.cadence),
          generationLimitMinor: Math.round(
            Number(details.generationLimit) * 100,
          ),
          advertisingLimitMinor: Math.round(
            Number(details.advertisingLimit) * 100,
          ),
          generationLimit: undefined,
          advertisingLimit: undefined,
        });
        created.current = {
          projectId: result.projectId,
          token: result.conversionToken,
        };
        setSavedProject(created.current);
      }
      for (const [, row] of enabled)
        await request("save-channel", {
          projectId: created.current.projectId,
          accountId: row.accountId,
          mode: row.mode,
          communityApproved: row.communityApproved,
          ...(row.subreddit
            ? { subreddit: row.subreddit.replace(/^r\//, "") }
            : {}),
          ...(row.adAccountId ? { adAccountId: row.adAccountId } : {}),
          ...(row.pageId ? { pageId: row.pageId } : {}),
          ...(row.mode === "automatic"
            ? { authorisedUntil: Date.now() + 30 * 86_400_000 - 60_000 }
            : {}),
        });
      await onComplete(created.current.projectId, created.current.token);
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "Setup failed"}${created.current ? " Your project is saved; retry to finish its channels." : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }
  const field = (
    label: string,
    name: keyof typeof details,
    options: {
      placeholder?: string;
      type?: string;
      required?: boolean;
      maxLength?: number;
    } = {},
  ) => (
    <label className="mk-field">
      <span>{label}</span>
      <input
        name={name}
        value={details[name]}
        onChange={(event) => update(name, event.target.value)}
        required={options.required !== false}
        maxLength={options.maxLength ?? 1000}
        placeholder={options.placeholder}
        type={options.type || "text"}
        disabled={busy || !!savedProject}
      />
    </label>
  );
  return (
    <section className="mk-onboarding">
      <div className="mk-heading">
        <div>
          <h1>
            Your next project.
            <br />
            Ready to market.
          </h1>
          <p>One setup. Your content, channels and budget in one place.</p>
        </div>
        <span className="mk-private">
          <i />
          Private workspace
        </span>
      </div>
      <ol className="mk-steps" aria-label="Project setup progress">
        {["Project", "Channels", "Review"].map((label, index) => (
          <li
            key={label}
            className={
              index === step ? "is-current" : index < step ? "is-complete" : ""
            }
            aria-current={index === step ? "step" : undefined}
          >
            <span>
              {index < step ? (
                <MarketingIcon name="check" size={18} />
              ) : (
                index + 1
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div role="alert" className="mk-feedback mk-error">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mk-feedback">
          {notice}
        </p>
      )}
      <div className="mk-onboard-grid">
        <form className="mk-card mk-setup-card" onSubmit={submit}>
          <div className="mk-card-heading">
            <h2>
              {
                [
                  "Start with your website",
                  "Choose your channels",
                  "Make it yours",
                ][step]
              }
            </h2>
            <span className="mk-step-badge">STEP {step + 1} OF 3</span>
          </div>
          <p className="mk-card-description">
            {
              [
                "We’ll pull in the basics. You stay in control.",
                "Choose this project’s connected accounts.",
                "Confirm your facts and set a comfortable starting pace.",
              ][step]
            }
          </p>
          {step === 0 && (
            <>
              <label className="mk-field mk-website">
                <span>Website URL</span>
                <div className="mk-url-input">
                  <MarketingIcon name="globe" />
                  <input
                    aria-label="Website URL"
                    name="website"
                    type="url"
                    required
                    value={details.website}
                    onChange={(event) => update("website", event.target.value)}
                    placeholder="https://your-project.com"
                    disabled={busy}
                  />
                  <button
                    className="mk-button mk-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void inspect()}
                  >
                    {busy ? "Importing…" : "Import website"}
                    <MarketingIcon name="arrow" size={19} />
                  </button>
                </div>
              </label>
              <div className="mk-form-grid mk-project-fields">
                {field("Project name", "name", {
                  placeholder: "e.g. My product",
                  maxLength: 120,
                })}
                {field("One-line offer", "offer", {
                  placeholder: "e.g. The simplest way to…",
                  maxLength: 2000,
                })}
                <div className="mk-span-two">
                  {field("Audience", "audience", {
                    placeholder: "e.g. Founders, marketers, small businesses",
                  })}
                </div>
                <label className="mk-field">
                  <span>Conversion goal</span>
                  <select
                    aria-label="Conversion goal"
                    name="goal"
                    value={details.goal}
                    onChange={(event) => update("goal", event.target.value)}
                  >
                    <option value="lead">Lead</option>
                    <option value="signup">Signup</option>
                    <option value="purchase">Purchase</option>
                  </select>
                </label>
                {field("Timezone", "timezone")}
              </div>
            </>
          )}
          {step === 1 && (
            <div className="mk-channel-options">
              <div className="mk-connect-bar">
                <a
                  className="mk-text-link"
                  href="https://app.zernio.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Connect accounts in Zernio{" "}
                  <MarketingIcon name="external" size={16} />
                </a>
                <button
                  type="button"
                  className="mk-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await onRefresh();
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Refresh failed",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Refresh accounts
                </button>
              </div>
              {!connected.length && (
                <p className="mk-inline-note">
                  No unassigned connected accounts are available. Save this
                  project now, then connect accounts from its Channels page or
                  assign accounts that share one unassigned provider profile.
                </p>
              )}
              {platforms.map((platform) => {
                const row = choices[platform.id];
                const available = connected.filter(
                  (account) => account.platform === platform.id,
                );
                const active = row?.mode && row.mode !== "off";
                return (
                  <div
                    key={platform.id}
                    className={`mk-channel-option ${active ? "is-selected" : ""}`}
                  >
                    <div className="mk-channel-top">
                      <span className="mk-platform-icon">{platform.short}</span>
                      <div>
                        <h3>{platform.name}</h3>
                        <p>{platform.detail}</p>
                      </div>
                      <select
                        aria-label={`${platform.name} mode`}
                        value={row?.mode ?? "off"}
                        onChange={(event) =>
                          choice(platform.id, {
                            mode: event.target.value as Choice["mode"],
                            accountId:
                              row?.accountId || available[0]?._id || "",
                          })
                        }
                        disabled={!available.length || busy}
                      >
                        <option value="off">Off</option>
                        <option value="draft">Draft</option>
                        <option value="automatic">Automatic</option>
                      </select>
                    </div>
                    {active && (
                      <div className="mk-channel-details">
                        <label className="mk-field">
                          <span>Connected account</span>
                          <select
                            required
                            value={row.accountId}
                            onChange={(event) =>
                              choice(platform.id, {
                                accountId: event.target.value,
                              })
                            }
                          >
                            <option value="">Choose an account</option>
                            {available.map((account) => (
                              <option key={account._id} value={account._id}>
                                {account.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {platform.id === "reddit" && (
                          <>
                            <label className="mk-field">
                              <span>Approved Reddit community</span>
                              <input
                                required
                                placeholder="community_name"
                                value={row.subreddit}
                                onChange={(event) =>
                                  choice(platform.id, {
                                    subreddit: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="mk-checkbox">
                              <input
                                type="checkbox"
                                required
                                checked={row.communityApproved}
                                onChange={(event) =>
                                  choice(platform.id, {
                                    communityApproved: event.target.checked,
                                  })
                                }
                              />
                              This community permits my promotional posts.
                            </label>
                          </>
                        )}
                        {["googleads", "metaads"].includes(platform.id) && (
                          <label className="mk-field">
                            <span>Verified ad account ID</span>
                            <input
                              required
                              value={row.adAccountId}
                              onChange={(event) =>
                                choice(platform.id, {
                                  adAccountId: event.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        {platform.id === "metaads" && (
                          <label className="mk-field">
                            <span>Facebook Page ID</span>
                            <input
                              required
                              value={row.pageId}
                              onChange={(event) =>
                                choice(platform.id, {
                                  pageId: event.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        {row.mode === "automatic" && (
                          <p className="mk-inline-note">
                            Authorises this channel’s cadence for 30 days.
                            Public dispatch still requires account activation;
                            each ad needs its own approval.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {step === 2 && (
            <div className="mk-review">
              <div className="mk-review-summary">
                <strong>{details.name}</strong>
                <span>{details.website}</span>
                <p>
                  {enabled.length
                    ? `${enabled.length} selected channels`
                    : "Channels can be connected later"}{" "}
                  · Goal: {details.goal}
                </p>
              </div>
              <label className="mk-field">
                <span>Confirmed product facts · one per line</span>
                <textarea
                  name="facts"
                  required
                  rows={3}
                  maxLength={6000}
                  placeholder="What can your product do? Use facts you can substantiate."
                  value={details.facts}
                  onChange={(event) => update("facts", event.target.value)}
                  disabled={busy || !!savedProject}
                />
              </label>
              <div className="mk-form-grid">
                {field("Brand voice", "tone", { maxLength: 300 })}
                <label className="mk-field">
                  <span>Posts per channel / week</span>
                  <select
                    aria-label="Posts per channel / week"
                    name="cadence"
                    value={details.cadence}
                    onChange={(event) => update("cadence", event.target.value)}
                    disabled={!!savedProject}
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="mk-field">
                  <span>Budget currency</span>
                  <select
                    aria-label="Budget currency"
                    name="currency"
                    value={details.currency}
                    onChange={(event) => update("currency", event.target.value)}
                    disabled={!!savedProject}
                  >
                    {["USD", "GBP", "EUR", "CHF"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <div />
                <label className="mk-field">
                  <span>Generation allowance / month</span>
                  <input
                    name="generationLimit"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={details.generationLimit}
                    onChange={(event) =>
                      update("generationLimit", event.target.value)
                    }
                    disabled={!!savedProject}
                  />
                </label>
                <label className="mk-field">
                  <span>Advertising allowance / month</span>
                  <input
                    name="advertisingLimit"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={details.advertisingLimit}
                    onChange={(event) =>
                      update("advertisingLimit", event.target.value)
                    }
                    disabled={!!savedProject}
                  />
                </label>
              </div>
              <p className="mk-inline-note">
                Both start at zero. Brand-template drafts are free. The software
                target is $30/month; account connections and metered X usage are
                separate from these allowances. Saving does not start paid work.
              </p>
              <label className="mk-checkbox">
                <input type="checkbox" required />I confirm these facts, usage
                rights and selected channel policies.
              </label>
            </div>
          )}
          <footer className="mk-form-footer">
            <span>
              {step === 0 ? (
                <>
                  <MarketingIcon name="lock" size={18} />
                  Only you can access this workspace
                </>
              ) : (
                <button
                  className="mk-text-link"
                  type="button"
                  disabled={busy || !!savedProject}
                  onClick={() => setStep(step - 1)}
                >
                  ← Back
                </button>
              )}
            </span>
            <button
              className="mk-button mk-primary"
              disabled={busy}
              type="submit"
            >
              {busy
                ? "Saving…"
                : [
                    "Continue to channels",
                    "Review project",
                    savedProject ? "Finish setup" : "Create project",
                  ][step]}
              <MarketingIcon name="arrow" size={19} />
            </button>
          </footer>
        </form>
        <aside className="mk-onboard-aside">
          <div className="mk-card mk-checklist">
            <h2>Your launch checklist</h2>
            <ul>
              {[
                "Define your project",
                "Connect your channels",
                "Set your limits",
                "Generate your first week",
              ].map((label, index) => (
                <li key={label}>
                  <span className={index < step ? "is-done" : ""}>
                    {index < step && <MarketingIcon name="check" size={17} />}
                  </span>
                  {label}
                </li>
              ))}
            </ul>
            <p>Add once. Reuse for every campaign.</p>
          </div>
          <div className="mk-card mk-tip">
            <MarketingIcon name="sparkle" size={29} />
            <h2>Start small. Stay consistent.</h2>
            <p>
              Draft first, review your content, then turn on automation when
              you’re ready.
            </p>
          </div>
        </aside>
      </div>
      <div className="mk-card mk-connections-footer">
        <div>
          <h2>Already connected?</h2>
          <p>
            Each provider profile is assigned to one project in Media Engine.
            Connect new accounts from that project&apos;s Channels page.
          </p>
        </div>
        <a
          className="mk-text-link"
          href="https://app.zernio.com"
          target="_blank"
          rel="noreferrer"
        >
          Manage connections
          <MarketingIcon name="arrow" size={19} />
        </a>
      </div>
      {onCancel && (
        <button
          className="mk-text-link mk-cancel-setup"
          onClick={onCancel}
          disabled={busy || !!savedProject}
        >
          Return to projects
        </button>
      )}
    </section>
  );
}
