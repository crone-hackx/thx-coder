import express from "express";
import { uploadController, downloadProcessedController, generateImageController } from "../controllers/fileController.js";
import apiKeyCheck from "../middleware/apiKeyCheck.js";

const router = express.Router();

// Upload a single file (zip/pdf/docx/txt/image). Form field: "file"
router.post("/upload", apiKeyCheck, uploadController);

// Download a processed file or combined zip by filename query ?file=...
router.get("/download", apiKeyCheck, downloadProcessedController);

// Create image from prompt (JSON body: { prompt, model?, size? })
router.post("/images/generate", apiKeyCheck, generateImageController);

export default router;
