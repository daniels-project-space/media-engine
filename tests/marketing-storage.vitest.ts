// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const r2 = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      send = r2.send;
      destroy = r2.destroy;
    },
    HeadObjectCommand: class Head extends Command {},
    GetObjectCommand: class Get extends Command {},
    CopyObjectCommand: class Copy extends Command {},
    PutObjectCommand: class Put extends Command {},
  };
});
vi.mock("../src/lib/vault", () => ({
  vaultService: vi.fn(async () => ({
    R2_ENDPOINT: "https://fixture.invalid",
    R2_ACCESS_KEY_ID: "fixture",
    R2_SECRET_ACCESS_KEY: "fixture",
  })),
}));
import { copyHyperMarketingAsset, copyMarketingVideo } from "../src/lib/marketing/assets";

describe("R2 original-video copy integrity (simulated storage transport)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("pins the approved source and verifies both full hashes without transforming bytes", async () => {
    const bytes = Buffer.from("original-approved-video-fixture"),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const input = {
      projectId: "a".repeat(32),
      sourceKey: `creative/${"b".repeat(32)}/ad.mp4`,
      destinationKey: `marketing/${"a".repeat(32)}/assets/${sha256}.mp4`,
      sha256,
      bytes: bytes.length,
    };
    const reads: string[] = [];
    r2.send.mockImplementation(
      async (command: {
        constructor: { name: string };
        input: Record<string, unknown>;
      }) => {
        if (command.constructor.name === "Head")
          return { ContentLength: bytes.length, ETag: "immutable-object" };
        if (command.constructor.name === "Get") {
          reads.push(command.input.Key as string);
          expect(command.input.IfMatch).toBe("immutable-object");
          return {
            Body: (async function* () {
              yield bytes;
            })(),
          };
        }
        expect(command.input.CopySourceIfMatch).toBe("immutable-object");
        expect(command.input.Metadata).toEqual({ sha256 });
        return {};
      },
    );
    expect((await copyMarketingVideo(input)).sha256).toBe(sha256);
    expect(reads).toEqual([input.sourceKey, input.destinationKey]);
    expect(r2.destroy).toHaveBeenCalledOnce();
  });
  it("refuses changed source bytes before copying anything", async () => {
    r2.send.mockImplementation(
      async (command: { constructor: { name: string } }) =>
        command.constructor.name === "Head"
          ? { ContentLength: 4, ETag: "receipt" }
          : {
              Body: (async function* () {
                yield Buffer.from("evil");
              })(),
            },
    );
    const sha256 = "a".repeat(64),
      projectId = "b".repeat(32);
    await expect(
      copyMarketingVideo({
        projectId,
        sourceKey: `creative/${"c".repeat(32)}/ad.mp4`,
        destinationKey: `marketing/${projectId}/assets/${sha256}.mp4`,
        sha256,
        bytes: 4,
      }),
    ).rejects.toThrow(/hash verification/);
    expect(r2.send).toHaveBeenCalledTimes(2);
  });
  it("verifies a new-service image before and after copying into the marketing project", async () => {
    const bytes = Buffer.from("new-service-image-fixture"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const projectId = "a".repeat(32), sourceKey = "projects/alpha/jobs/example/output.png";
    const reads: string[] = [];
    r2.send.mockImplementation(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (command.constructor.name === "Head") return { ContentLength: bytes.length, ETag: "source-version" };
      if (command.constructor.name === "Get") { reads.push(command.input.Key as string); return { Body: (async function* () { yield bytes; })() }; }
      expect(command.input.CopySourceIfMatch).toBe("source-version");
      return {};
    });
    const result = await copyHyperMarketingAsset({ projectId, sourceKey, sourcePrefix: "projects/alpha/", sha256, bytes: bytes.length, contentType: "image/png" });
    expect(reads).toEqual([sourceKey, result.key]);
    expect(result.key).toBe(`marketing/${projectId}/assets/${sha256}.png`);
    await expect(copyHyperMarketingAsset({ projectId, sourceKey, sourcePrefix: "projects/beta/", sha256, bytes: bytes.length, contentType: "image/png" })).rejects.toThrow(/receipt/);
  });
  it("does not copy a new-service output whose bytes disagree with its receipt", async () => {
    r2.send.mockImplementation(async (command: { constructor: { name: string } }) =>
      command.constructor.name === "Head" ? { ContentLength: 4, ETag: "source-version" } :
        { Body: (async function* () { yield Buffer.from("evil"); })() });
    await expect(copyHyperMarketingAsset({ projectId: "a".repeat(32), sourceKey: "projects/alpha/output.mp4",
      sourcePrefix: "projects/alpha/", sha256: "b".repeat(64), bytes: 4, contentType: "video/mp4" })).rejects.toThrow(/hash verification/);
    expect(r2.send).toHaveBeenCalledTimes(2);
  });
});
