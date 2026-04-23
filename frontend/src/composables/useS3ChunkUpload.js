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

  // Helpers for persistence
  const getFileKey = (file) => `s3_up_${file.name}_${file.size}_${file.lastModified}`
  const saveMetadata = (file, meta) => localStorage.setItem(getFileKey(file), JSON.stringify(meta))
  const getMetadata = (file) => JSON.parse(localStorage.getItem(getFileKey(file)))
  const clearMetadata = (file) => localStorage.removeItem(getFileKey(file))

  async function upload(file, entity, entityId, collectionName = 'default') {
    aborted = false
    status.value = 'uploading'
    progress.value = 0
    error.value = null

    const fileType = file.type || mime.getType(file.name) || 'application/octet-stream'
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    let uploadId, filePath, mediaId
    let uploadedParts = new Array(totalChunks)
    let completedCount = 0

    // ─── 1. Check for existing upload (Resume Logic) ───
    const existing = getMetadata(file)
    let resumed = false

    if (existing) {
      console.log('🔄 Found existing upload, checking progress...')
      const remoteParts = await listUploadedParts(existing.upload_id, existing.file_path)

      if (remoteParts) {
        uploadId = existing.upload_id
        filePath = existing.file_path
        mediaId = existing.media_id
        resumed = true

        remoteParts.forEach((p) => {
          const idx = p.PartNumber - 1
          if (idx >= 0 && idx < totalChunks) {
            uploadedParts[idx] = { PartNumber: p.PartNumber, ETag: p.ETag }
            completedCount++
          }
        })
        progress.value = Math.round((completedCount / totalChunks) * 100)
        console.log(`📈 Resuming from ${completedCount}/${totalChunks} parts`)
      } else {
        console.warn('⚠️ Stale upload meta found, starting fresh.')
        clearMetadata(file)
      }
    }

    if (!resumed) {
      const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '-')}`
      const initData = await initiateUpload(fileName, fileType, entity, entityId, collectionName)
      if (!initData) return null

      uploadId = initData.upload_id
      filePath = initData.file_path
      mediaId = initData.media_id

      saveMetadata(file, { upload_id: uploadId, file_path: filePath, media_id: mediaId })
    }

    // ─── 2. Upload missing parts ───
    const queue = []
    for (let i = 0; i < totalChunks; i++) {
       if (!uploadedParts[i]) queue.push(i)
    }

    async function processChunk(i) {
      if (aborted) return

      const partNumber = i + 1
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const blob = file.slice(start, end)
      
      // Calculate SHA-256 for data integrity
      const checksum = await calculateSHA256(blob)

      const presignedUrl = await getPresignedUrl(filePath, uploadId, partNumber, fileType, checksum)
      if (!presignedUrl) throw new Error(`Failed presigned URL for part ${partNumber}`)

      const etag = await uploadChunkWithRetry(presignedUrl, blob, partNumber, checksum)
      if (!etag) throw new Error(`Failed to upload part ${partNumber}`)

      uploadedParts[i] = { PartNumber: partNumber, ETag: etag }
      completedCount++
      progress.value = Math.round((completedCount / totalChunks) * 100)
    }

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

    // ─── 3. Complete ───
    const result = await completeUpload(
      uploadId,
      filePath,
      mediaId,
      uploadedParts.filter(Boolean),
      collectionName,
    )

    if (result) {
      clearMetadata(file)
      status.value = 'complete'
    } else {
      status.value = 'error'
    }
    
    return result
  }

  async function calculateSHA256(blob) {
    const buffer = await blob.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = new Uint8Array(hashBuffer)
    let binary = ''
    for (let i = 0; i < hashArray.byteLength; i++) {
      binary += String.fromCharCode(hashArray[i])
    }
    return btoa(binary)
  }

  async function listUploadedParts(uploadId, filePath) {
    try {
      const { data } = await axios.post(`${API_BASE}/list-parts`, {
        upload_id: uploadId,
        file_path: filePath,
      }, { headers })
      return data.parts
    } catch (e) {
      return null
    }
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

  async function getPresignedUrl(filePath, uploadId, partNumber, fileType, checksumSha256) {
    try {
      const { data } = await axios.post(
        `${API_BASE}/get-presigned-url`,
        {
          file_path: filePath,
          upload_id: uploadId,
          part_number: partNumber,
          file_type: fileType,
          checksum_sha256: checksumSha256,
        },
        { headers },
      )
      return data.presigned_url
    } catch (e) {
      return null
    }
  }

  async function uploadChunkWithRetry(url, blob, partNumber, checksumSha256) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await axios.put(url, blob, {
          headers: { 
            'Content-Type': blob.type || 'application/octet-stream',
            'x-amz-checksum-sha256': checksumSha256,
          },
        })
        return res.headers.etag?.replace(/"/g, '')
      } catch (e) {
        if (attempt === MAX_RETRIES) return null
        await new Promise((r) => setTimeout(r, 1000 * attempt))
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
    // Note: We don't clear metadata here so the user can resume later.
    // If they want to start fresh, they should select a different file or we could add a "Clear Progress" button.
  }

  return { upload, abort, progress, status, error }
}
