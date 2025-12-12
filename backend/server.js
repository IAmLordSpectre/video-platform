const express = require("express");
const cors = require("cors");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters
} = require("@azure/storage-blob");
const { CosmosClient } = require("@azure/cosmos");

const app = express();
const port = process.env.PORT || 3000;

// ----------------- CONFIG FROM ENVIRONMENT -----------------
const accountName = process.env.STORAGE_ACCOUNT_NAME;
const accountKey = process.env.STORAGE_ACCOUNT_KEY;
const containerName = "videos";
const cosmosConnection = process.env.COSMOS_DB_CONNECTION;

if (!accountName || !accountKey) {
  console.warn("WARNING: STORAGE_ACCOUNT_NAME or STORAGE_ACCOUNT_KEY not set.");
}
if (!cosmosConnection) {
  console.warn("WARNING: COSMOS_DB_CONNECTION not set.");
}

// ----------------- AZURE CLIENT HELPERS -----------------
let blobContainerClient;

function getBlobContainerClient() {
  if (!blobContainerClient) {
    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential
    );
    blobContainerClient = blobServiceClient.getContainerClient(containerName);
  }
  return blobContainerClient;
}

function getCosmosContainer() {
  const cosmosClient = new CosmosClient(cosmosConnection);
  return cosmosClient.database("VideoDB").container("Videos");
}

// ----------------- MIDDLEWARE -----------------
app.use(cors());
app.use(express.json());

// ----------------- HEALTH CHECK -----------------
app.get("/", (req, res) => {
  res.send("Video API is running");
});

// ----------------- SAS HELPER -----------------
function buildSasUrl(fileName, permissionsString, minutesValid) {
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: fileName,
      permissions: BlobSASPermissions.parse(permissionsString),
      expiresOn: new Date(Date.now() + minutesValid * 60 * 1000)
    },
    credential
  ).toString();

  const url = `https://${accountName}.blob.core.windows.net/${containerName}/${fileName}?${sasToken}`;
  return { sasToken, url };
}

// ======================================================
// 1) POST /upload-request
// ======================================================
app.post("/upload-request", async (req, res) => {
  console.log("Received upload-request:", req.body);

  try {
    const { title, fileName } = req.body || {};

    if (!title || !fileName) {
      console.warn("Missing title or fileName:", req.body);
      return res.status(400).json({ error: "Missing title or fileName" });
    }

    if (!accountName || !accountKey) {
      return res.status(500).json({ error: "Storage account is not configured" });
    }
    if (!cosmosConnection) {
      return res.status(500).json({ error: "Cosmos DB is not configured" });
    }

    const { url: uploadUrl } = buildSasUrl(fileName, "cw", 10);

    const cosmosContainer = getCosmosContainer();
    const metadata = {
      id: fileName,
      title,
      uploadTime: new Date().toISOString(),
      status: "sas-generated"
    };

    await cosmosContainer.items.upsert(metadata);

    return res.status(200).json({
      uploadUrl,
      fileName,
      message: "SAS token generated and metadata stored"
    });
  } catch (err) {
    console.error("ERROR in /upload-request:", err);
    return res.status(500).json({ error: "Failed to generate SAS token" });
  }
});

// ======================================================
// 2) POST /confirm-upload  (accepts fileName OR id)
// ======================================================
app.post("/confirm-upload", async (req, res) => {
  console.log("Received confirm-upload:", req.body);

  try {
    const fileName = req.body?.fileName || req.body?.id;
    const optionalTitle = req.body?.title;

    if (!fileName) {
      return res.status(400).json({ error: "Missing fileName (or id)" });
    }

    if (!cosmosConnection) {
      return res.status(500).json({ error: "Cosmos DB is not configured" });
    }

    const cosmosContainer = getCosmosContainer();

    let existing = null;
    try {
      const { resource } = await cosmosContainer.item(fileName, fileName).read();
      existing = resource || null;
    } catch {
      existing = null;
    }

    const updated = {
      ...(existing || {}),
      id: fileName,
      title: optionalTitle || existing?.title || "Untitled video",
      uploadTime: existing?.uploadTime || new Date().toISOString(),
      status: "uploaded",
      lastUpdated: new Date().toISOString()
    };

    await cosmosContainer.items.upsert(updated);

    return res.status(200).json({
      message: "Upload confirmed and metadata updated",
      fileName
    });
  } catch (err) {
    console.error("ERROR in /confirm-upload:", err);
    return res.status(500).json({ error: "Failed to confirm upload" });
  }
});

// ======================================================
// 3) GET /videos
// ======================================================
app.get("/videos", async (req, res) => {
  console.log("Received request: GET /videos");

  try {
    if (!cosmosConnection) {
      return res.status(500).json({ error: "Cosmos DB is not configured" });
    }

    const cosmosContainer = getCosmosContainer();
    const query = "SELECT * FROM c ORDER BY c.uploadTime DESC";

    const { resources } = await cosmosContainer.items.query(query).fetchAll();
    return res.status(200).json(resources);
  } catch (err) {
    console.error("ERROR in GET /videos:", err);
    return res.status(500).json({ error: "Failed to fetch videos" });
  }
});

// ======================================================
// 4) GET /videos/:id/download
// ======================================================
app.get("/videos/:id/download", async (req, res) => {
  const id = req.params.id;

  try {
    if (!accountName || !accountKey) {
      return res.status(500).json({ error: "Storage account is not configured" });
    }
    if (!cosmosConnection) {
      return res.status(500).json({ error: "Cosmos DB is not configured" });
    }

    const cosmosContainer = getCosmosContainer();
    const querySpec = {
      query: "SELECT * FROM c WHERE c.id = @id",
      parameters: [{ name: "@id", value: id }]
    };
    const { resources } = await cosmosContainer.items.query(querySpec).fetchAll();
    if (!resources || resources.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const containerClient = getBlobContainerClient();
    const blobClient = containerClient.getBlockBlobClient(id);
    const exists = await blobClient.exists();
    if (!exists) {
      return res.status(404).json({ error: "Video file not found in blob storage" });
    }

    const { url: downloadUrl } = buildSasUrl(id, "r", 10);
    return res.status(200).json({ id, downloadUrl, expiresInMinutes: 10 });
  } catch (err) {
    console.error("ERROR in GET /videos/:id/download:", err);
    return res.status(500).json({ error: "Failed to generate download link" });
  }
});

// ======================================================
// 5) DELETE /videos/:id
// ======================================================
app.delete("/videos/:id", async (req, res) => {
  const id = req.params.id;

  try {
    if (!cosmosConnection) {
      return res.status(500).json({ error: "Cosmos DB is not configured" });
    }
    if (!accountName || !accountKey) {
      return res.status(500).json({ error: "Storage account is not configured" });
    }

    const containerClient = getBlobContainerClient();
    const blobClient = containerClient.getBlockBlobClient(id);
    const deleteBlobResult = await blobClient.deleteIfExists();

    const cosmosContainer = getCosmosContainer();
    try {
      await cosmosContainer.item(id, id).delete();
    } catch (cosmosErr) {
      console.warn("Cosmos delete warning (may not exist):", cosmosErr.message);
    }

    return res.status(200).json({
      message: "Video deleted (metadata and blob where present)",
      blobDeleted: deleteBlobResult.succeeded
    });
  } catch (err) {
    console.error("ERROR in DELETE /videos/:id:", err);
    return res.status(500).json({ error: "Failed to delete video" });
  }
});

// ----------------- START SERVER -----------------
const server = app.listen(port, () => {
  console.log(`Video API listening on port ${port}`);
});

// Export for automated tests
module.exports = { app, server };
