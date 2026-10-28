import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { website } from "../../../convex/marketingPolicy";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^[23][a-f0-9]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Resolve, validate ALL addresses, then pin the actual socket lookup. A mere
 * DNS precheck followed by fetch would still permit DNS-rebinding SSRF. */
async function publicHtml(
  value: string,
  deadline: number,
  redirects = 0,
): Promise<{ html: string; url: string }> {
  const url = new URL(website(value));
  if (redirects > 2 || Date.now() >= deadline)
    throw new Error("Website inspection timed out or redirected too often");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Website DNS lookup timed out")),
        Math.max(1, deadline - Date.now()),
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  )
    throw new Error(
      "Website must resolve exclusively to public internet addresses",
    );
  const pinned = addresses[0];
  const result = await new Promise<{ html?: string; redirect?: string }>(
    (resolve, reject) => {
      const connection = request(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": "MediaEngineProjectOnboarding/1.0",
            accept: "text/html",
            "accept-encoding": "identity",
          },
          lookup: (_host, options, callback) => {
            if (typeof options === "object" && options.all)
              callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(8_000, deadline - Date.now())),
          ),
        },
        (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            const location = response.headers.location;
            response.destroy();
            if (!location)
              reject(new Error("Website redirect has no destination"));
            else resolve({ redirect: new URL(location, url).toString() });
            return;
          }
          if (
            response.statusCode !== 200 ||
            !response.headers["content-type"]?.includes("text/html") ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            response.destroy();
            reject(
              new Error(
                "Website did not return readable HTML; define its facts manually",
              ),
            );
            return;
          }
          let length = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > 256 * 1024) {
              response.destroy();
              reject(
                new Error("Website HTML exceeds the 256 KB inspection limit"),
              );
            } else chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({ html: Buffer.concat(chunks).toString("utf8") }),
          );
          response.on("error", reject);
        },
      );
      connection.on("error", () =>
        reject(
          new Error(
            "Could not inspect this website; enter its verified facts manually",
          ),
        ),
      );
      connection.end();
    },
  );
  if (result.redirect)
    return publicHtml(result.redirect, deadline, redirects + 1);
  return { html: result.html!, url: url.toString() };
}

function plain(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function websiteFacts(html: string, sourceUrl: string) {
  const source = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const tags = source.match(/<meta\b[^>]*>/gi) ?? [];
  const metadata = new Map<string, string>();
  for (const tag of tags.slice(0, 100)) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((match) => [
        match[1].toLowerCase(),
        plain(match[3]),
      ]),
    );
    const key = attributes.property ?? attributes.name;
    if (key && attributes.content)
      metadata.set(key.toLowerCase(), attributes.content);
  }
  const name = plain(
    metadata.get("og:site_name") ??
      metadata.get("og:title") ??
      source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      new URL(sourceUrl).hostname,
  ).slice(0, 120);
  const offer = plain(
    metadata.get("description") ?? metadata.get("og:description") ?? "",
  ).slice(0, 2_000);
  return {
    name,
    website: sourceUrl,
    offer,
    source: "website_metadata" as const,
    capturedAt: Date.now(),
    needsOperatorConfirmation: true,
  };
}

export async function inspectMarketingWebsite(url: string) {
  const result = await publicHtml(url, Date.now() + 10_000);
  return websiteFacts(result.html, result.url);
}

/** Bounded public-page evidence; page text is untrusted, not verified claims. */
export function researchWebsiteFacts(html: string, finalUrl: string) {
  const metadata = websiteFacts(html, finalUrl);
  const safe = html.replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const snippets = [...safe.matchAll(/<(h[1-3]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .slice(0, 40).map(match => plain(match[2]).slice(0, 400)).filter(value => value.length >= 20).slice(0, 12);
  return { url: finalUrl, title: metadata.name, description: metadata.offer,
    excerpt: snippets.join("\n").slice(0, 4_000), capturedAt: Date.now() };
}

export async function inspectResearchWebsite(url: string) {
  const { html, url: finalUrl } = await publicHtml(url, Date.now() + 10_000);
  return researchWebsiteFacts(html, finalUrl);
}
