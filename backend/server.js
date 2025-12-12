const express = require("express");
const cors = require("cors");
const {
  StorageSharedKeyCredential,
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters
} = require("@azure/storage-blob");
const { CosmosClient } = require("@azure/cosmos");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("Video API is running");
});

/* ===============================
   POST /upload-request
================================ */
app.post("/upload-request", async (req, res) => {
  try {
    const { title, fileName } = req.body || {};

    if (!title || !fileName) {
      return res.status(400).json({ error: "Missing title or fileName" });
    }

    const accountName = process.env.STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.STORAGE_ACCOUNT_KEY;
    const containerName = "videos";

    const credential = new StorageSharedKeyCredential(accountName, accountKey);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: fileName,
        permissions: BlobSASPermissions.parse("cw"),
        expiresOn: new Date(Date.now() + 10 * 60 * 1000)
      },
      credential
    ).toString();

    const uploadUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${fileName}?${sasToken}`;

    const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION);
    const container = cosmosClient.database("VideoDB").container("Videos");

    await container.items.create({
      id: fileName,
      title,
      uploadTime: new Date().toISOString(),
      status: "uploaded"
    });

    res.status(200).json({ uploadUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload request failed" });
  }
});

/* ===============================
   GET /videos
================================ */
app.get("/videos", async (req, res) => {
  try {
    const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION);
    const container = cosmosClient.database("VideoDB").container("Videos");

    const query = "SELECT * FROM c ORDER BY c.uploadTime DESC";
    const { resources } = await container.items.query(query).fetchAll();

    res.status(200).json(resources);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

/* ===============================
   GET /videos/:id/download
================================ */
app.get("/videos/:id/download", async (req, res) => {
  try {
    const fileName = req.params.id;

    const accountName = process.env.STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.STORAGE_ACCOUNT_KEY;
    const containerName = "videos";

    const credential = new StorageSharedKeyCredential(accountName, accountKey);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: fileName,
        permissions: BlobSASPermissions.parse("r"),
        expiresOn: new Date(Date.now() + 5 * 60 * 1000)
      },
      credential
    ).toString();

    const downloadUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${fileName}?${sasToken}`;

    res.status(200).json({ downloadUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate download link" });
  }
});

/* ===============================
   DELETE /videos/:id
================================ */
app.delete("/videos/:id", async (req, res) => {
  try {
    const fileName = req.params.id;

    // Blob delete
    const blobClient = BlobServiceClient
      .fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING)
      .getContainerClient("videos")
      .getBlobClient(fileName);

    await blobClient.deleteIfExists();

    // Cosmos delete
    const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION);
    const container = cosmosClient.database("VideoDB").container("Videos");

    await container.item(fileName, fileName).delete();

    res.status(200).json({ message: "Video deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

app.listen(port, () => {
  console.log(`Video API running on port ${port}`);
});
