<script setup>
import { ref } from 'vue'
import { useS3ChunkUpload } from '@/composables/useS3ChunkUpload'

const fileInput = ref(null)
const selectedFile = ref(null)
const { upload, abort, progress, status, error } = useS3ChunkUpload()

const handleFileChange = (event) => {
  selectedFile.value = event.target.files[0]
}

const startUpload = async () => {
  if (!selectedFile.value) return

  try {
    const result = await upload(
      selectedFile.value,
      'user_upload', // entity
      'user_123',    // entityId
      'documents'    // collectionName
    )
    
    if (result) {
      console.log('Upload successful:', result)
    }
  } catch (err) {
    console.error('Upload failed:', err)
  }
}

const handleAbort = () => {
  abort()
}
</script>

<template>
  <div class="uploader-container">
    <div class="uploader-card">
      <h2 class="title">S3 Multipart Upload</h2>
      <p class="subtitle">Securely upload large files in chunks</p>

      <div class="upload-zone" :class="{ 'has-file': selectedFile }">
        <input 
          type="file" 
          ref="fileInput" 
          @change="handleFileChange" 
          id="file-upload" 
          class="hidden-input"
        />
        <label for="file-upload" class="upload-label">
          <div v-if="!selectedFile" class="placeholder">
            <span class="icon">📁</span>
            <span>Click to select or drag and drop</span>
          </div>
          <div v-else class="file-info">
            <span class="icon">📄</span>
            <span class="filename">{{ selectedFile.name }}</span>
            <span class="filesize">({{ (selectedFile.size / (1024 * 1024)).toFixed(2) }} MB)</span>
          </div>
        </label>
      </div>

      <div v-if="status !== 'idle'" class="progress-section">
        <div class="progress-header">
          <span class="status-tag" :class="status">{{ status }}</span>
          <span class="percentage">{{ progress }}%</span>
        </div>
        <div class="progress-bar-bg">
          <div 
            class="progress-bar-fill" 
            :style="{ width: progress + '%' }"
          ></div>
        </div>
        <p v-if="error" class="error-msg">{{ error }}</p>
      </div>

      <div class="actions">
        <button 
          v-if="status === 'idle' || status === 'complete' || status === 'error' || status === 'aborted'"
          @click="startUpload" 
          class="btn btn-primary"
          :disabled="!selectedFile || status === 'uploading'"
        >
          {{ status === 'complete' ? 'Upload Another' : 'Start Upload' }}
        </button>
        
        <button 
          v-if="status === 'uploading'" 
          @click="handleAbort" 
          class="btn btn-danger"
        >
          Abort Upload
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uploader-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  width: 100%;
}

.uploader-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  padding: 2.5rem;
  width: 100%;
  max-width: 500px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  transition: transform 0.3s ease;
}

.uploader-card:hover {
  transform: translateY(-5px);
}

.title {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  background: linear-gradient(135deg, #60a5fa, #a855f7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  color: #94a3b8;
  margin-bottom: 2rem;
  font-size: 0.95rem;
}

.upload-zone {
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 2rem;
  text-align: center;
  transition: all 0.3s ease;
  cursor: pointer;
  margin-bottom: 1.5rem;
}

.upload-zone:hover {
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.05);
}

.upload-zone.has-file {
  border-style: solid;
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
}

.hidden-input {
  display: none;
}

.upload-label {
  cursor: pointer;
  display: block;
}

.placeholder {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: #94a3b8;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.icon {
  font-size: 2.5rem;
}

.filename {
  font-weight: 600;
  color: #f8fafc;
  word-break: break-all;
}

.filesize {
  font-size: 0.8rem;
  color: #94a3b8;
}

.progress-section {
  margin-bottom: 1.5rem;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.status-tag {
  text-transform: capitalize;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.1);
}

.status-tag.uploading { color: #60a5fa; background: rgba(96, 165, 250, 0.2); }
.status-tag.complete { color: #22c55e; background: rgba(34, 197, 94, 0.2); }
.status-tag.error { color: #ef4444; background: rgba(239, 68, 68, 0.2); }
.status-tag.aborted { color: #f59e0b; background: rgba(245, 158, 11, 0.2); }

.percentage {
  font-weight: 700;
  color: #f8fafc;
}

.progress-bar-bg {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #60a5fa, #a855f7);
  border-radius: 9999px;
  transition: width 0.3s ease;
}

.error-msg {
  color: #ef4444;
  font-size: 0.85rem;
  margin-top: 0.75rem;
  text-align: center;
}

.actions {
  display: flex;
  gap: 1rem;
}

.btn {
  flex: 1;
  padding: 0.875rem;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  font-size: 1rem;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: white;
  box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.5);
}

.btn-primary:hover:not(:disabled) {
  transform: scale(1.02);
  filter: brightness(1.1);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.2);
}
</style>
