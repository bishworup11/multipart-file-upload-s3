// composables/useS3ChunkUpload.js
import { ref } from 'vue'
import axios from 'axios'
import mime from 'mime'

//const API_BASE = 'http://your-laravel.test/api/v1/s3'
const API_BASE = 'http://localhost:3001/api/v1/s3'
const AUTH_TOKEN = 'Bearer your-token-here'
const CHUNK_SIZE = 5 * 1024 * 1024 // 5 MB — S3 minimum
const CONCURRENCY = 3 // parallel chunk uploads
const MAX_RETRIES = 3

export function useS3ChunkUpload() {
  const progress = ref(0)
  const status = ref('idle')
  const error = ref(null)
  let aborted = false

  const headers = { Authorization: AUTH_TOKEN }

  async function upload(file, entity, entityId, collectionName = 'default') {
    aborted = false
    status.value = 'uploading'
    progress.value = 0
    error.value = null

    const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '-')}`
    const fileType = file.type || mime.getType(file.name) || 'application/octet-stream'
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    // 1. Initiate
    const initData = await initiateUpload(fileName, fileType, entity, entityId, collectionName)
    if (!initData) return null

    const { upload_id, file_path, media_id } = initData

    // 2. Upload all parts with concurrency pool
    const uploadedParts = new Array(totalChunks)
    const queue = Array.from({ length: totalChunks }, (_, i) => i)
    let completedCount = 0

    async function processChunk(i) {
      if (aborted) return

      const partNumber = i + 1
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const blob = file.slice(start, end)

      const presignedUrl = await getPresignedUrl(file_path, upload_id, partNumber, fileType)
      if (!presignedUrl) throw new Error(`Failed presigned URL for part ${partNumber}`)

      const etag = await uploadChunkWithRetry(presignedUrl, blob, partNumber)
      if (!etag) throw new Error(`Failed to upload part ${partNumber}`)

      uploadedParts[i] = { PartNumber: partNumber, ETag: etag }
      completedCount++
      progress.value = Math.round((completedCount / totalChunks) * 100)
    }

    // Concurrent pool
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const i = queue.shift()
        if (i === undefined || aborted) break
        await processChunk(i)
      }
    })

    try {
      await Promise.all(workers)
    } catch (e) {
      error.value = e.message
      status.value = 'error'
      return null
    }

    if (aborted) {
      status.value = 'aborted'
      return null
    }

    // 3. Complete
    const result = await completeUpload(
      upload_id,
      file_path,
      media_id,
      uploadedParts,
      collectionName,
    )
    status.value = 'complete'
    return result
  }

  async function initiateUpload(fileName, fileType, entity, entityId, collectionName) {
    try {
      const { data } = await axios.post(
        `${API_BASE}/initiate-upload`,
        {
          file_name: fileName,
          file_type: fileType,
          entity,
          entity_id: entityId,
          collection_name: collectionName,
        },
        { headers },
      )
      return data
    } catch (e) {
      error.value = 'Initiation failed'
      return null
    }
  }

  async function getPresignedUrl(filePath, uploadId, partNumber, fileType) {
    try {
      const { data } = await axios.post(
        `${API_BASE}/get-presigned-url`,
        {
          file_path: filePath,
          upload_id: uploadId,
          part_number: partNumber,
          file_type: fileType,
        },
        { headers },
      )
      return data.presigned_url
    } catch (e) {
      return null
    }
  }

  async function uploadChunkWithRetry(url, blob, partNumber) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await axios.put(url, blob, {
          headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        })
        // Strip quotes from ETag
        return res.headers.etag?.replace(/"/g, '')
      } catch (e) {
        if (attempt === MAX_RETRIES) return null
        await new Promise((r) => setTimeout(r, 1000 * attempt)) // backoff
      }
    }
  }

  async function completeUpload(uploadId, filePath, mediaId, parts, collectionName) {
    try {
      const { data } = await axios.post(
        `${API_BASE}/complete-upload`,
        {
          upload_id: uploadId,
          file_path: filePath,
          media_id: mediaId,
          collection_name: collectionName,
          part_numbers: parts,
        },
        { headers },
      )
      return data
    } catch (e) {
      error.value = 'Completion failed'
      return null
    }
  }

  function abort() {
    aborted = true
  }

  return { upload, abort, progress, status, error }
}
