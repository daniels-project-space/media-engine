import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { vaultService } from "./vault";

const BUCKET = "media-engine";

let client: S3Client | null = null;

async function r2(): Promise<S3Client> {
  if (client) return client;
  const cf = await vaultService("cloudflare");
  client = new S3Client({
    region: "auto",
    endpoint: cf.R2_ENDPOINT,
    credentials: {
      accessKeyId: cf.R2_ACCESS_KEY_ID,
      secretAccessKey: cf.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  const c = await r2();
  await c.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function presignedGet(key: string, expiresIn = 60 * 60 * 24 * 7) {
  const c = await r2();
  return getSignedUrl(c, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export async function objectExists(key: string) {
  const c = await r2();
  try {
    await c.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
