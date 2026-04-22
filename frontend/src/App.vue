<script setup lang="ts">
import S3FileUploader from './components/S3FileUploader.vue'
</script>

<template>
  <main class="app-container">
    <S3FileUploader />
  </main>
</template>

<style>
:root {
  --app-bg: #0f172a;
  --text-main: #f8fafc;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--app-bg);
  color: var(--text-main);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  min-height: 100vh;
}

.app-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
</style>
