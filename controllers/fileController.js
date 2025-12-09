import fs from "fs";
import path from "path";
import multer from "multer";
import AdmZip from "adm-zip";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import fetch from "node-fetch";
import { pipeline } from "stream/promises";

// upload storage
const UPLOAD_DIR = path.resolve("./uploads");
const PROCESSED_DIR = path.resolve("./uploads/processed");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${ts}_${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // up to 200MB

// Helper: read text from different files
async function readTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const data = await fs.promises.readFile(filePath);
    const parsed = await pdfParse(data);
    return parsed.text;
  } else if (ext === ".docx" || ext === ".doc") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if ([".txt", ".md", ".csv", ".json"].includes(ext)) {
    return await fs.promises.readFile(filePath, "utf-8");
  } else if ([".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"].includes(ext)) {
    // OCR using tesseract.js
    const { data: { text } } = await Tesseract.recognize(filePath, "eng", { logger: m => {} });
    return text;
  } else {
    return "";
  }
}

// Extract zip and read files inside
async function extractZipAndRead(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const ext = path.extname(name).toLowerCase();
    // extract to temp
    const outPath = path.join(PROCESSED_DIR, `${Date.now()}_${path.basename(name)}`);
    fs.writeFileSync(outPath, entry.getData());
    const text = await readTextFromFile(outPath);
    results.push({ filename: name, extracted_to: outPath, text });
  }
  return results;
}

// Controller: upload
export const uploadController = [
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required (multipart/form-data field name 'file')" });

      const uploadedPath = req.file.path;
      const ext = path.extname(uploadedPath).toLowerCase();

      let extracted = [];
      if (ext === ".zip") {
        extracted = await extractZipAndRead(uploadedPath);
      } else {
        const text = await readTextFromFile(uploadedPath);
        // Save extracted text to processed folder for download
        const outName = `${Date.now()}_${path.basename(uploadedPath)}.txt`;
        const outPath = path.join(PROCESSED_DIR, outName);
        await fs.promises.writeFile(outPath, text || "");
        extracted = [{ filename: req.file.originalname, extracted_to: outPath, text }];
      }

      // Build response with links (download endpoints)
      const baseUrl = (req.protocol + "://" + req.get("host")).replace(/:\\d+$/, `:${process.env.PORT || 8080}`);
      const processedFiles = extracted.map(e => ({
        filename: e.filename,
        text_preview: (e.text || "").slice(0, 2000),
        download_url: `${baseUrl}/api/files/download?file=${encodeURIComponent(path.basename(e.extracted_to))}`
      }));

      res.json({
        ok: true,
        original_file: req.file.filename,
        processed: processedFiles
      });
    } catch (err) {
      next(err);
    }
  }
];

// Controller: download processed file
export const downloadProcessedController = (req, res, next) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: "file query param required" });
  const filePath = path.join(PROCESSED_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file not found" });
  res.download(filePath);
};

// Controller: generate image from prompt
export const generateImageController = async (req, res, next) => {
  try {
    const { prompt, model = "sd-1", size = "1024x1024" } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OpenRouter API key missing in server" });

    // Example OpenRouter image generation endpoint (raw fetch)
    const resp = await fetch("https://openrouter.ai/api/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.SITE_URL || "",
        "X-Title": process.env.SITE_NAME || ""
      },
      body: JSON.stringify({
        model,
        prompt,
        size
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: "image generation failed", details: text });
    }

    // Response likely returns JSON with base64 images or URLs depending on provider
    const data = await resp.json();

    // Attempt to save returned images if base64 present
    const saved = [];
    if (Array.isArray(data.data)) {
      for (const item of data.data) {
        // item could be {b64_json: "..."} or {url: "..."}
        if (item.b64_json) {
          const buffer = Buffer.from(item.b64_json, "base64");
          const outName = `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}.png`;
          const outPath = path.join(UPLOAD_DIR, outName);
          await fs.promises.writeFile(outPath, buffer);
          saved.push({ filename: outName, url: `${req.protocol}://${req.get("host")}/uploads/${outName}` });
        } else if (item.url) {
          saved.push({ url: item.url });
        } else {
          saved.push({ raw: item });
        }
      }
    } else {
      // unknown shape — return raw
      return res.json({ ok: true, raw: data });
    }

    return res.json({ ok: true, images: saved });
  } catch (err) {
    next(err);
  }
};
