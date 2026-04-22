require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

// ─── S3 / MinIO client ────────────────────────────────────────────────────────
const s3 = new S3Client({
  endpoint:        process.env.MINIO_ENDPOINT,   // http://localhost:9000
  region:          process.env.MINIO_REGION,
  forcePathStyle:  true,                          // REQUIRED for MinIO
  credentials: {
    accessKeyId:     process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
})

const BUCKET = process.env.MINIO_BUCKET

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express()
app.use(cors())                   // allow all origins — fine for local dev
app.use(express.json())

// Simple request logger
app.use((req, _res, next) => {
  console.log(`→ ${req.method} ${req.path}`, req.body)
  next()
})

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', bucket: BUCKET }))

// ─── 1. Initiate multipart upload ────────────────────────────────────────────
// POST /api/v1/s3/initiate-upload
// Body: { file_name, file_type, entity, entity_id, collection_name }
app.post('/api/v1/s3/initiate-upload', async (req, res) => {
  const { file_name, file_type, entity, entity_id, collection_name = 'default' } = req.body

  if (!file_name || !file_type) {
    return res.status(422).json({ message: 'file_name and file_type are required' })
  }

  // Use a timestamp prefix as a "media id" stand-in
  const mediaId = Date.now()
  const key     = `${collection_name}/${entity}/${entity_id}/${mediaId}/${file_name}`

  try {
    const result = await s3.send(new CreateMultipartUploadCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: file_type,
    }))

    console.log(`✅ Initiated upload: ${key} — UploadId: ${result.UploadId}`)

    res.json({
      upload_id:       result.UploadId,
      file_name,
      file_path:       key,
      entity,
      entity_id,
      collection_name,
      media_id:        mediaId,
    })
  } catch (err) {
    console.error('❌ initiate-upload error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ─── 2. Get pre-signed URL for one part ──────────────────────────────────────
// POST /api/v1/s3/get-presigned-url
// Body: { file_path, upload_id, part_number, file_type }
app.post('/api/v1/s3/get-presigned-url', async (req, res) => {
  const { file_path, upload_id, part_number, file_type } = req.body

  if (!file_path || !upload_id || !part_number) {
    return res.status(422).json({ message: 'file_path, upload_id and part_number are required' })
  }

  try {
    const command = new UploadPartCommand({
      Bucket:        BUCKET,
      Key:           file_path,
      UploadId:      upload_id,
      PartNumber:    Number(part_number),
      ContentType:   file_type,
    })

    // URL valid for 20 minutes
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 20 })

    console.log(`✅ Presigned URL for part ${part_number}: ${presignedUrl.slice(0, 80)}...`)

    res.json({
      presigned_url: presignedUrl,
      file_path,
      part_number,
    })
  } catch (err) {
    console.error('❌ get-presigned-url error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ─── 3. Complete multipart upload ────────────────────────────────────────────
// POST /api/v1/s3/complete-upload
// Body: { upload_id, file_path, media_id, collection_name, part_numbers: [{PartNumber, ETag}] }
app.post('/api/v1/s3/complete-upload', async (req, res) => {
  const { upload_id, file_path, media_id, collection_name, part_numbers } = req.body

  if (!upload_id || !file_path || !Array.isArray(part_numbers) || part_numbers.length === 0) {
    return res.status(422).json({ message: 'upload_id, file_path and part_numbers[] are required' })
  }

  try {
    const result = await s3.send(new CompleteMultipartUploadCommand({
      Bucket:          BUCKET,
      Key:             file_path,
      UploadId:        upload_id,
      MultipartUpload: { Parts: part_numbers },   // [{ PartNumber, ETag }, ...]
    }))

    console.log(`✅ Upload complete: ${result.Location}`)

    res.json({
      message:         'Upload completed successfully!',
      media_id,
      collection_name,
      file_path,
      location:        result.Location,
      // Public URL for MinIO
      url:             `${process.env.MINIO_ENDPOINT}/${BUCKET}/${file_path}`,
    })
  } catch (err) {
    console.error('❌ complete-upload error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ─── 4. Abort (cleanup on cancel) ────────────────────────────────────────────
// POST /api/v1/s3/abort-upload
// Body: { upload_id, file_path }
app.post('/api/v1/s3/abort-upload', async (req, res) => {
  const { upload_id, file_path } = req.body

  if (!upload_id || !file_path) {
    return res.status(422).json({ message: 'upload_id and file_path are required' })
  }

  try {
    await s3.send(new AbortMultipartUploadCommand({
      Bucket:   BUCKET,
      Key:      file_path,
      UploadId: upload_id,
    }))

    console.log(`🗑️  Aborted upload: ${file_path}`)
    res.json({ message: 'Upload aborted and cleaned up.' })
  } catch (err) {
    console.error('❌ abort-upload error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`)
  console.log(`📦 MinIO bucket  : ${BUCKET}`)
  console.log(`🔗 MinIO endpoint: ${process.env.MINIO_ENDPOINT}\n`)
  console.log('Endpoints:')
  console.log('  GET  /health')
  console.log('  POST /api/v1/s3/initiate-upload')
  console.log('  POST /api/v1/s3/get-presigned-url')
  console.log('  POST /api/v1/s3/complete-upload')
  console.log('  POST /api/v1/s3/abort-upload\n')
})