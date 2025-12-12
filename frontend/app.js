// app.js

// ---------------- DOM ----------------
const apiBaseInput = document.getElementById("apiBaseUrl");
const titleInput = document.getElementById("videoTitle");
const fileInput = document.getElementById("videoFile");
const generateButton = document.getElementById("generateButton");

const statusBox = document.getElementById("statusBox");
const statusText = document.getElementById("statusText");

const videoTableBody = document.getElementById("videoTableBody");

// ---------------- Helpers ----------------
function setStatus(message, type = "info") {
  statusText.textContent = message || "";

  statusBox.classList.remove("status-info", "status-error", "status-success");

  if (!message) {
    statusBox.style.display = "none";
    return;
  }

  if (type === "error") statusBox.classList.add("status-error");
  else if (type === "success") statusBox.classList.add("status-success");
  else statusBox.classList.add("status-info");

  statusBox.style.display = "block";
}

function getApiBaseUrl() {
  const raw = apiBaseInput.value.trim();
  if (!raw) {
    throw new Error("Please enter your API Base URL.");
  }
  return raw.replace(/\/+$/, "");
}

function safeText(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

// ---------------- Load list ----------------
async function loadVideoList() {
  try {
    const baseUrl = getApiBaseUrl();
    setStatus("Loading videos...", "info");

    const res = await fetch(`${baseUrl}/videos`);
    if (!res.ok) {
      throw new Error(`Failed to fetch videos (HTTP ${res.status})`);
    }

    const videos = await res.json();

    videoTableBody.innerHTML = "";

    if (!Array.isArray(videos) || videos.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "No videos found yet.";
      row.appendChild(cell);
      videoTableBody.appendChild(row);
      setStatus("", "info");
      return;
    }

    for (const vid of videos) {
      const id = vid.id || vid.fileName || "";
      const title = vid.title || "(untitled)";
      const uploadTime = vid.uploadTime ? new Date(vid.uploadTime).toLocaleString() : "-";
      const status = vid.status || "-";

      const row = document.createElement("tr");

      // Title
      const titleCell = document.createElement("td");
      titleCell.textContent = title;

      // File / ID
      const idCell = document.createElement("td");
      idCell.textContent = id;

      // Upload Time
      const timeCell = document.createElement("td");
      timeCell.textContent = uploadTime;

      // Status
      const statusCell = document.createElement("td");
      statusCell.textContent = status;

      // Actions
      const actionsCell = document.createElement("td");

      const watchBtn = document.createElement("button");
      watchBtn.className = "btn-secondary";
      watchBtn.textContent = "Watch/Download";
      watchBtn.disabled = !id;
      watchBtn.addEventListener("click", () => watchOrDownload(id));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.disabled = !id;
      deleteBtn.addEventListener("click", () => deleteVideo(id));

      actionsCell.appendChild(watchBtn);
      actionsCell.appendChild(document.createTextNode(" "));
      actionsCell.appendChild(deleteBtn);

      row.appendChild(titleCell);
      row.appendChild(idCell);
      row.appendChild(timeCell);
      row.appendChild(statusCell);
      row.appendChild(actionsCell);

      videoTableBody.appendChild(row);
    }

    setStatus("", "info");
  } catch (err) {
    console.error(err);
    setStatus(`Could not load videos: ${err.message}`, "error");
  }
}

// ---------------- Step A Feature 1: Watch/Download ----------------
// Uses backend: GET /videos/:id/download
async function watchOrDownload(id) {
  try {
    if (!id) return;

    const baseUrl = getApiBaseUrl();
    setStatus(`Creating secure link for: ${id}`, "info");

    const res = await fetch(`${baseUrl}/videos/${encodeURIComponent(id)}/download`);
    if (!res.ok) {
      let msg = `Failed to create download link (HTTP ${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg += ` – ${body.error}`;
      } catch {}
      throw new Error(msg);
    }

    const body = await res.json();
    const downloadUrl = body.downloadUrl;

    if (!downloadUrl) {
      throw new Error("Backend did not return a downloadUrl.");
    }

    setStatus("Opening download/watch link in a new tab (time-limited SAS).", "success");
    window.open(downloadUrl, "_blank");
  } catch (err) {
    console.error(err);
    setStatus(`Watch/Download failed: ${err.message}`, "error");
  }
}

// ---------------- Step A Feature 2: Delete ----------------
// Uses backend: DELETE /videos/:id
async function deleteVideo(id) {
  try {
    if (!id) return;

    const confirmed = window.confirm(
      `Delete "${id}"?\n\nThis will remove the blob from storage and delete the metadata record.`
    );
    if (!confirmed) return;

    const baseUrl = getApiBaseUrl();
    setStatus(`Deleting video: ${id}`, "info");

    const res = await fetch(`${baseUrl}/videos/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    if (!res.ok) {
      let msg = `Delete failed (HTTP ${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg += ` – ${body.error}`;
      } catch {}
      throw new Error(msg);
    }

    setStatus(`Deleted: ${id}`, "success");
    await loadVideoList();
  } catch (err) {
    console.error(err);
    setStatus(`Delete failed: ${err.message}`, "error");
  }
}

// ---------------- Upload flow ----------------
async function handleUploadClick(event) {
  event.preventDefault();

  try {
    generateButton.disabled = true;

    const baseUrl = getApiBaseUrl();
    const title = titleInput.value.trim();
    const file = fileInput.files[0];

    if (!title) throw new Error("Please enter a video title.");
    if (!file) throw new Error("Please choose a video file.");

    const fileName = file.name;

    // 1) Request upload SAS
    setStatus("Requesting upload URL...", "info");

    const sasRes = await fetch(`${baseUrl}/upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, fileName })
    });

    if (!sasRes.ok) {
      let msg = `upload-request failed (HTTP ${sasRes.status})`;
      try {
        const body = await sasRes.json();
        if (body?.error) msg += ` – ${body.error}`;
      } catch {}
      throw new Error(msg);
    }

    const sasBody = await sasRes.json();
    const uploadUrl = sasBody.uploadUrl;

    if (!uploadUrl) throw new Error("Backend did not return uploadUrl.");

    // 2) Upload to Blob using SAS
    setStatus("Uploading video to storage...", "info");

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });

    if (!putRes.ok) {
      throw new Error(`Blob upload failed (HTTP ${putRes.status}).`);
    }

    // 3) Confirm upload (backend accepts fileName OR id)
    setStatus("Confirming upload...", "info");

    const confirmRes = await fetch(`${baseUrl}/confirm-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: fileName }) // your backend now supports this
    });

    if (!confirmRes.ok) {
      let msg = `confirm-upload failed (HTTP ${confirmRes.status})`;
      try {
        const body = await confirmRes.json();
        if (body?.error) msg += ` – ${body.error}`;
      } catch {}
      throw new Error(msg);
    }

    setStatus("Upload complete. Refreshing list...", "success");
    await loadVideoList();
  } catch (err) {
    console.error(err);
    setStatus(`Upload failed: ${err.message}`, "error");
  } finally {
    generateButton.disabled = false;
  }
}

// ---------------- Events ----------------
generateButton.addEventListener("click", handleUploadClick);

apiBaseInput.addEventListener("change", () => {
  if (apiBaseInput.value.trim()) loadVideoList();
});

// Initial load (if pre-filled)
try {
  if (apiBaseInput.value.trim()) loadVideoList();
} catch {}
