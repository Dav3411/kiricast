import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function getR2Client() {
  const endpoint = getEnv("R2_ENDPOINT");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function createUploadUrl({
  bucket,
  key,
  contentType,
  expiresInSec = 900,
}: {
  bucket: string;
  key: string;
  contentType?: string;
  expiresInSec?: number;
}) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: expiresInSec,
  });

  return { url, expiresInSec };
}

export async function uploadBufferToR2({
  bucket,
  key,
  contentType,
  body,
}: {
  bucket: string;
  key: string;
  contentType: string;
  body: Buffer;
}) {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteObjectFromR2({
  bucket,
  key,
}: {
  bucket: string;
  key: string;
}) {
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function getObjectFromR2({
  bucket,
  key,
}: {
  bucket: string;
  key: string;
}) {
  const client = getR2Client();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
  return {
    body: res.Body,
    contentType: res.ContentType ?? "application/octet-stream",
    contentLength: res.ContentLength,
  };
}
