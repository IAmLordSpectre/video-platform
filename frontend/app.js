// ======================
// CONFIG
// ======================
const API_BASE_URL = "https://video-api-nosa123-djdxcag4e3aubaba.spaincentral-01.azurewebsites.net/"; // change only if your URL differs

// ======================
// DOM
// ======================
const elTitle = document.getElementById("title");
const elFile = document.getElementById("file");
const elBtnUpload = document.getElementById("btnUpload");
const elBtnRefresh = document.getElementById("btnRefresh");
const elStatusText = document.getElementById("statusText");
const elStatusHint = document.getElementById("statusHint");
const elProgressBar = document.getElementById("progressBar");
const elVideos = document.getElementById("videos");
const elTpl = document.getElementById("videoItemTemplate");
const elSearch = document.getElementById("search");
const elBackendUrlText = document.getElementById("backendUrlText");

elBackendUrlText.textContent = API_BASE_URL;

// ======================
// STATE
// ======================
let cachedVideos = [];

// ======================
// HELPERS
// ======================
function setStatus(text, hint = "", progress = null) {
  elStatusText.textContent = text;
  elStatusHint.textContent = hint || "";
  if (progress !== null) {
    elProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function formatDate(iso) {
  if (!iso) return "Unknown time";
  const d = new Date(iso);
  return d.toLocaleString();
}

function matchesSearch(v, q) {
  if (!q) return true;
  const hay = `${v.title || ""} ${v.id || ""}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

// ======================
// API CALLS
// ======================
async function apiUploadRequest(title, fileName) {
  const res = await fetch(`${API_BASE_URL}/upload-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, fileName })
  });

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(data?.error || text || `Upload request failed (${res.status})`);
  }

  return data;
}

async function apiConfirmUpload(fileName, title) {
  const res = await fetch(`${API_BASE_URL}/confirm-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, title })
  });

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(data?.error || text || `Confirm upload failed (${res.status})`);
  }

  return data;
}

async function apiListVideos() {
  const res = await fetch(`${API_BASE_URL}/videos`, { method: "GET" });
  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(data?.error || text || `List videos failed (${res.status})`);
  }

  return data;
}

async function apiGetDownloadUrl(fileName) {
  const res = await fetch(`${API_BASE_URL}/videos/${encodeURIComponent(fileName)}/download`, { method: "GET" });
  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(data?.error || text || `Download link failed (${res.status})`);
  }

  return data;
}

async function apiDeleteVideo(fileName) {
  const res = await fetch(`${API_BASE_URL}/videos/${encodeURIComponent(fileName)}`, { method: "DELETE" });
  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(data?.error || text || `Delete failed (${res.status})`);
  }

  return data;
}

// ======================
// SAS UPLOAD (PUT to Blob)
// ======================
async function uploadToSasUrl(sasUrl, file) {
  // Use XMLHttpRequest to get upload progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sasUrl, true);

    // Required header for Azure Block Blob uploads
    xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setStatus("Uploading to storage...", "Uploading the file to Azure Blob Storage using SAS...", pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Blob upload failed (${xhr.status}): ${xhr.responseText}`));
    };

    xhr.onerror = () => reject(new Error("Network error during blob upload"));

    xhr.send(file);
  });
}

// ======================
// RENDER
// ======================
function renderVideos() {
  const q = elSearch.value.trim();
  elVideos.innerHTML = "";

  const list = cachedVideos.filter(v => matchesSearch(v, q));

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No videos found.";
    elVideos.appendChild(empty);
    return;
  }

  for (const v of list) {
    const node = elTpl.content.cloneNode(true);
    const item = node.querySelector(".video-item");
    const title = node.querySelector(".video-title");
    const sub = node.querySelector(".video-sub");
    const tag = node.querySelector(".tag");

    const btnDownload = node.querySelector(".btnDownload");
    const btnDelete = node.querySelector(".btnDelete");

    title.textContent = v.title || "(Untitled)";
    sub.textContent = `File: ${v.id} • Uploaded: ${formatDate(v.uploadTime)} • Status: ${v.status || "unknown"}`;
    tag.textContent = v.status || "unknown";

    btnDownload.addEventListener("click", async () => {
      try {
        btnDownload.disabled = true;
        setStatus("Generating download link...", "Requesting a read-only SAS URL from the backend...", null);

        const data = await apiGetDownloadUrl(v.id);
        const url = data.downloadUrl;

        // Open download link
        window.open(url, "_blank", "noopener,noreferrer");
        setStatus("Download link generated", "A new tab should open with the SAS URL.", 100);
        setTimeout(() => setStatus("Idle", "Ready.", 0), 800);
      } catch (err) {
        console.error(err);
        setStatus("Download failed", err.message, 0);
      } finally {
        btnDownload.disabled = false;
      }
    });

    btnDelete.addEventListener("click", async () => {
      const ok = confirm(`Delete "${v.title}" (${v.id})?\n\nThis will remove blob + metadata.`);
      if (!ok) return;

      try {
        btnDelete.disabled = true;
        setStatus("Deleting...", "Deleting blob and metadata via backend...", null);
        await apiDeleteVideo(v.id);
        setStatus("Deleted", "Refreshing list...", 100);
        await refreshList();
        setTimeout(() => setStatus("Idle", "Ready.", 0), 800);
      } catch (err) {
        console.error(err);
        setStatus("Delete failed", err.message, 0);
      } finally {
        btnDelete.disabled = false;
      }
    });

    elVideos.appendChild(item);
  }
}

// ======================
// MAIN ACTIONS
// ======================
async function refreshList() {
  setStatus("Loading videos...", "Fetching metadata from Cosmos DB...", null);
  cachedVideos = await apiListVideos();
  renderVideos();
  setStatus("Idle", `Loaded ${cachedVideos.length} videos.`, 0);
}

async function handleUpload() {
  const title = elTitle.value.trim();
  const file = elFile.files?.[0];

  if (!title) {
    setStatus("Missing title", "Enter a title before uploading.", 0);
    return;
  }
  if (!file) {
    setStatus("Missing file", "Choose a video file before uploading.", 0);
    return;
  }

  // Keep filename stable and safe
  const fileName = file.name;

  try {
    elBtnUpload.disabled = true;
    setStatus("Requesting upload URL...", "Calling backend to generate a write SAS URL...", 0);

    // 1) Get SAS upload URL + initial metadata write
    const { uploadUrl } = await apiUploadRequest(title, fileName);

    // 2) Upload file directly to Blob Storage using SAS URL
    setStatus("Uploading to storage...", "Uploading the file to Azure Blob Storage using SAS...", 5);
    await uploadToSasUrl(uploadUrl, file);

    // 3) Confirm upload (so list reflects real uploads)
    setStatus("Confirming upload...", "Updating Cosmos metadata status to 'uploaded'...", 95);
    await apiConfirmUpload(fileName, title);

    // 4) Refresh list
    setStatus("Refreshing list...", "Updating UI from Cosmos DB...", 98);
    await refreshList();

    setStatus("Upload complete", "Video uploaded and metadata updated.", 100);
    setTimeout(() => setStatus("Idle", "Ready.", 0), 1000);
  } catch (err) {
    console.error(err);
    setStatus("Upload failed", err.message, 0);
  } finally {
    elBtnUpload.disabled = false;
  }
}

// ======================
// EVENTS
// ======================
elBtnUpload.addEventListener("click", handleUpload);
elBtnRefresh.addEventListener("click", refreshList);
elSearch.addEventListener("input", renderVideos);

// Initial load
setStatus("Idle", "Ready.", 0);
refreshList().catch(err => {
  console.error(err);
  setStatus("Backend unreachable", err.message, 0);
});
