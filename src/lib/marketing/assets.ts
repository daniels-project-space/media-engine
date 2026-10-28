import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { vaultService } from "../vault";

export async function storeMarketingImage(projectId: string, bytes: Buffer) {
  if (
    !/^[a-z0-9]{20,64}$/.test(projectId) ||
    bytes.length < 1 ||
    bytes.length > 4 * 1024 * 1024
  )
    throw new Error("Choose a project image no larger than 4 MB");
  const metadata = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: 36_000_000,
  }).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 300 ||
    metadata.height < 300 ||
    (metadata.pages ?? 1) > 1 ||
    !["jpeg", "png", "webp"].includes(metadata.format ?? "")
  )
    throw new Error(
      "Use a single JPEG, PNG or WebP image at least 300px wide and high",
    );
  // Original bytes and precision are preserved; this is not a compression pass.
  const sha256 = createHash("sha256").update(bytes).digest("hex"),
    format = metadata.format!;
  const key = `marketing/${projectId}/assets/${sha256}.${format === "jpeg" ? "jpg" : format}`;
  const contentType = `image/${format}`;
  const cf = await vaultService("cloudflare");
  const client = new S3Client({
    region: "auto",
    endpoint: cf.R2_ENDPOINT,
    credentials: {
      accessKeyId: cf.R2_ACCESS_KEY_ID,
      secretAccessKey: cf.R2_SECRET_ACCESS_KEY,
    },
  });
  try {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: "media-engine",
          Key: key,
          Body: bytes,
          ContentType: contentType,
          Metadata: { sha256 },
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 412
      )
        throw error;
    }
    const head = await client.send(
      new HeadObjectCommand({ Bucket: "media-engine", Key: key }),
    );
    if (
      head.ContentLength !== bytes.length ||
      head.ContentType !== contentType ||
      head.Metadata?.sha256 !== sha256 ||
      !head.ETag
    )
      throw new Error("R2 image receipt metadata differs");
    const object = await client.send(
      new GetObjectCommand({
        Bucket: "media-engine",
        Key: key,
        IfMatch: head.ETag,
      }),
    );
    if (!object.Body) throw new Error("R2 readback body is missing");
    const digest = createHash("sha256");
    let length = 0;
    for await (const part of object.Body as AsyncIterable<Uint8Array>) {
      length += part.length;
      if (length > bytes.length)
        throw new Error("R2 readback exceeds the receipt");
      digest.update(part);
    }
    if (length !== bytes.length || digest.digest("hex") !== sha256)
      throw new Error("R2 full image hash verification failed");
    return { key, sha256, bytes: bytes.length, contentType };
  } finally {
    client.destroy();
  }
}

async function verifiedObject(
  client: S3Client,
  key: string,
  sha256: string,
  bytes: number,
) {
  const head = await client.send(
    new HeadObjectCommand({ Bucket: "media-engine", Key: key }),
  );
  if (head.ContentLength !== bytes || !head.ETag)
    throw new Error("R2 video size or immutable object receipt differs");
  const object = await client.send(
    new GetObjectCommand({
      Bucket: "media-engine",
      Key: key,
      IfMatch: head.ETag,
    }),
  );
  if (!object.Body) throw new Error("R2 video readback is missing");
  const digest = createHash("sha256");
  let length = 0;
  for await (const part of object.Body as AsyncIterable<Uint8Array>) {
    length += part.length;
    if (length > bytes)
      throw new Error("R2 video exceeds its approved receipt");
    digest.update(part);
  }
  if (length !== bytes || digest.digest("hex") !== sha256)
    throw new Error("R2 full video hash verification failed");
  return head.ETag;
}

/** Runs in Trigger: server-side R2 copy plus streamed hash checks. No local
 * finished file, transcoding, remote media URL fetch or Vercel media proxy. */
export async function copyMarketingVideo(input: {
  projectId: string;
  sourceKey: string;
  destinationKey: string;
  sha256: string;
  bytes: number;
}) {
  if (
    !/^[a-z0-9]{20,64}$/.test(input.projectId) ||
    !/^creative\/[a-z0-9]{20,64}\/ad\.mp4$/.test(input.sourceKey) ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    input.destinationKey !==
      `marketing/${input.projectId}/assets/${input.sha256}.mp4` ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > 500_000_000
  )
    throw new Error("A project-owned approved video receipt is required");
  const cf = await vaultService("cloudflare");
  const client = new S3Client({
    region: "auto",
    endpoint: cf.R2_ENDPOINT,
    credentials: {
      accessKeyId: cf.R2_ACCESS_KEY_ID,
      secretAccessKey: cf.R2_SECRET_ACCESS_KEY,
    },
  });
  try {
    const etag = await verifiedObject(
      client,
      input.sourceKey,
      input.sha256,
      input.bytes,
    );
    await client.send(
      new CopyObjectCommand({
        Bucket: "media-engine",
        Key: input.destinationKey,
        CopySource: `media-engine/${input.sourceKey}`,
        CopySourceIfMatch: etag,
        MetadataDirective: "REPLACE",
        ContentType: "video/mp4",
        Metadata: { sha256: input.sha256 },
      }),
    );
    await verifiedObject(
      client,
      input.destinationKey,
      input.sha256,
      input.bytes,
    );
    return {
      key: input.destinationKey,
      sha256: input.sha256,
      bytes: input.bytes,
      contentType: "video/mp4",
    };
  } finally {
    client.destroy();
  }
}

/** Re-read both source and copy in the requesting app's bucket before registration. */
export async function copyHyperMarketingAsset(input: {
  projectId: string; sourceKey: string; sourcePrefix: string;
  sha256: string; bytes: number; contentType: string;
}) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4",
  };
  const extension = extensions[input.contentType];
  if (!/^[a-z0-9]{20,64}$/.test(input.projectId) || !extension ||
      !input.sourcePrefix.endsWith("/") || input.sourcePrefix.startsWith("/") ||
      input.sourcePrefix.includes("..") || !input.sourceKey.startsWith(input.sourcePrefix) ||
      input.sourceKey.includes("..") || input.sourceKey.includes("\\") ||
      !/^[a-f0-9]{64}$/.test(input.sha256) || !Number.isSafeInteger(input.bytes) ||
      input.bytes < 1 || input.bytes > 500_000_000)
    throw new Error("Invalid project-owned render receipt");
  const destinationKey = `marketing/${input.projectId}/assets/${input.sha256}.${extension}`;
  const cf = await vaultService("cloudflare");
  const client = new S3Client({ region: "auto", endpoint: cf.R2_ENDPOINT,
    credentials: { accessKeyId: cf.R2_ACCESS_KEY_ID, secretAccessKey: cf.R2_SECRET_ACCESS_KEY } });
  try {
    const etag = await verifiedObject(client, input.sourceKey, input.sha256, input.bytes);
    const encodedSource = input.sourceKey.split("/").map(encodeURIComponent).join("/");
    await client.send(new CopyObjectCommand({ Bucket: "media-engine", Key: destinationKey,
      CopySource: `media-engine/${encodedSource}`, CopySourceIfMatch: etag,
      MetadataDirective: "REPLACE", ContentType: input.contentType, Metadata: { sha256: input.sha256 } }));
    await verifiedObject(client, destinationKey, input.sha256, input.bytes);
    return { key: destinationKey, sha256: input.sha256, bytes: input.bytes, contentType: input.contentType };
  } finally { client.destroy(); }
}
