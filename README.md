# Multipart File Upload with S3/MinIO

A beginner-friendly guide to setting up and running a multipart file upload system using Node.js (Backend), Vue.js (Frontend), and MinIO (S3-compatible storage).

## 🚀 Overview

This project demonstrates how to handle large file uploads by splitting them into smaller chunks. This ensures reliability and allows for parallel uploads directly to storage from the browser.

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your machine:
- **Node.js** (v18 or higher)
- **Docker** (to run MinIO)
- **npm** (comes with Node.js)

---

## 🛠️ Step 1: Start MinIO Storage

MinIO provides an S3-compatible API locally. We will run it using Docker.

1.  **Start the MinIO container**:
    ```bash
    docker run -d --name minio \
      -p 9000:9000 -p 9001:9001 \
      -e MINIO_ROOT_USER=minioadmin \
      -e MINIO_ROOT_PASSWORD=minioadmin \
      minio/minio server /data --console-address ":9001"
    ```

2.  **Initialize the bucket**:
    Run these commands to create your first bucket and set permissions:
    ```bash
    docker exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
    docker exec minio mc mb local/test-bucket
    docker exec minio mc anonymous set download local/test-bucket
    ```

> [!TIP]
> You can access the MinIO Dashboard at [http://localhost:9001](http://localhost:9001) using `minioadmin` / `minioadmin`.

---

## ⚙️ Step 2: Setup the Backend

The backend coordinates the upload process by generating secure, temporary (presigned) URLs for the frontend.

1.  **Navigate to the backend folder**:
    ```bash
    cd backend
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    Create a file named `.env` (or use the existing one) with these values:
    ```env
    PORT=3001
    MINIO_ENDPOINT=http://localhost:9000
    MINIO_ACCESS_KEY=minioadmin
    MINIO_SECRET_KEY=minioadmin
    MINIO_BUCKET=test-bucket
    MINIO_REGION=us-east-1
    ```

4.  **Start the server**:
    ```bash
    npm run dev
    ```
    Your backend should now be running at [http://localhost:3001](http://localhost:3001).

---

## 💻 Step 3: Setup the Frontend

The frontend handles file selection, chunking, and direct uploads to MinIO.

1.  **Navigate to the frontend folder**:
    ```bash
    cd ../frontend
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Start the development server**:
    ```bash
    npm run dev
    ```
    Typically, the frontend will run at [http://localhost:5173](http://localhost:5173) (or 5174).

---

## 🧪 Testing the Flow

1.  Open your browser to the Frontend URL.
2.  Select a large file (e.g., > 10MB).
3.  Click **Upload**.
4.  You will see the progress bar update as chunks are uploaded in parallel.
5.  Once finished, check your MinIO Dashboard to see the uploaded file in `test-bucket`.

---

## 🔍 Checking Your Uploads

Once you have uploaded a file, you can verify it in two ways:

### 1. MinIO Web Dashboard (Easiest)
Since you are running MinIO with the console address set to `:9001`, you can use the built-in UI:
- **URL**: [http://localhost:9001](http://localhost:9001)
- **Username**: `minioadmin` 
- **Password**: `minioadmin`
- **Action**: Click on **"Object Browser"** in the sidebar and select `test-bucket`. You will see your files and folders there.

### 2. Using the Command Line (mc)
You can use the MinIO Client inside your running Docker container to list files:
```bash
docker exec minio mc ls local/test-bucket --recursive
```

---

## 📄 Documentation

For a deep dive into the technical flow and API endpoints, see:
- [MULTIPART_UPLOAD_FLOW.md](./MULTIPART_UPLOAD_FLOW.md)
