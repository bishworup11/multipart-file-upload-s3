// Example: Multipart upload to MinIO using AWS SDK for JavaScript v3
// MinIO supports AWS S3 compatible multipart upload APIs,
// including checksum fields such as SHA256, CRC32, CRC32C, etc.

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand
} from "@aws-sdk/client-s3";

import { createHash } from "crypto";
import fs from "fs";

// --------------------------------------------------
// 1. Connect to MinIO
// --------------------------------------------------
const client = new S3Client({
  region: "us-east-1",
  endpoint: "http://localhost:9000", // MinIO endpoint
  credentials: {
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin"
  },
  forcePathStyle: true // required for MinIO
});

// --------------------------------------------------
// 2. Helper: SHA256 checksum in Base64
// AWS/MinIO expects Base64 checksum value
// --------------------------------------------------
function sha256Base64(buffer) {
  return createHash("sha256").update(buffer).digest("base64");
}

// Read a byte range from a file into a Buffer without loading the whole file
function readChunk(filePath, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function ensureBucket(bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`Bucket "${bucket}" created`);
    } else {
      throw err;
    }
  }
}

async function multipartUpload() {
  const bucket = "demo";
  const key = "manjaro.iso";
  const filePath = "./manjaro.iso";

  await ensureBucket(bucket);

  const PART_SIZE = 100 * 1024 * 1024; // 100 MiB — well above the 5 MiB AWS minimum

  const { size: fileSize } = fs.statSync(filePath);
  const numParts = Math.ceil(fileSize / PART_SIZE);

  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(1)} MiB, parts: ${numParts}`);

  // --------------------------------------------------
  // 3. Create multipart upload with checksum algorithm
  // --------------------------------------------------
  const createRes = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ChecksumAlgorithm: "SHA256"
    })
  );

  const uploadId = createRes.UploadId;
  const parts = [];
  const s3UploadedParts = [];

  try {
    // --------------------------------------------------
    // 4. Upload each part sequentially, one in memory at a time
    // --------------------------------------------------
    for (let i = 0; i < numParts; i++) {
      const partNumber = i + 1;
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE - 1, fileSize - 1);

      console.log(`Uploading part ${partNumber}/${numParts} (bytes ${start}–${end})…`);

      const partBuffer = await readChunk(filePath, start, end);
      const checksum = sha256Base64(partBuffer);

      const uploadPartRes = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: partBuffer,
          ChecksumSHA256: checksum
        })
      );

      parts.push({
        PartNumber: partNumber,
        ETag: uploadPartRes.ETag,
        ChecksumSHA256: checksum
      });

      const listRes = await client.send(
        new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
      );
      s3UploadedParts.length = 0;
      s3UploadedParts.push(...(listRes.Parts ?? []));

      console.log("Parts uploaded so far:", parts);
      console.log("S3 confirmed parts:", s3UploadedParts);
    }

    // --------------------------------------------------
    // 5. Complete multipart upload
    // --------------------------------------------------
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts }
      })
    );

    console.log("Upload completed successfully");
  } catch (err) {
    // If something goes wrong, abort the upload so MinIO doesn't keep the incomplete parts
    console.error("Upload failed, aborting multipart upload:", err.message);
    await client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
    );
    throw err;
  }
}

async function listIncompleteUploads(bucket) {
  const res = await client.send(
    new ListMultipartUploadsCommand({ Bucket: bucket })
  );
  const uploads = res.Uploads ?? [];

  for (const upload of uploads) {
    const partsRes = await client.send(
      new ListPartsCommand({ Bucket: bucket, Key: upload.Key, UploadId: upload.UploadId })
    );
    upload.Parts = partsRes.Parts ?? [];
    console.log(`Upload key="${upload.Key}" uploadId=${upload.UploadId} parts:`, upload.Parts);
  }

  console.log(`Incomplete multipart uploads in "${bucket}":`, uploads);
  return uploads;
}

//listIncompleteUploads("demo").catch(console.error);
 multipartUpload().catch(console.error);
