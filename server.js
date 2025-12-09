import express from "express";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import responseTime from "response-time";
import fs from "fs";
import path from "path";

import chatRoutes from "./routes/chatRoutes.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

// CORS: allow any origin (public)
app.use(cors({ origin: true }));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(compression());
app.use(responseTime());

const logDir = path.resolve("./logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const accessLogStream = fs.createWriteStream(path.join(logDir, "requests.log"), { flags: "a" });
app.use(morgan("combined", { stream: accessLogStream }));
app.use(morgan("dev"));

// Rate limit (adjust for your needs)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 200 : 2000,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get("/", (req, res) => {
  res.json({
    name: "THX AI (THX Coder)",
    by: "World of Technology Team",
    powered_by: "Tcroneb Hackx",
    note: "POST /api/chat to use the AI. Visit /about for team details."
  });
});

app.get("/about", (req, res) => {
  res.json({
    ai_name: "THX AI (THX Coder)",
    built_by: "World of Technology Team",
    powered_by: "Tcroneb Hackx",
    world_of_technology: {
      primary_base: "Zimbabwe",
      global_team: true,
      note: "World of Technology Team has members in multiple countries."
    },
    tcroneb_hackx: {
      location: "unknown"
    }
  });
});

app.use("/api/chat", chatRoutes);

// Health
app.get("/healthz", (req, res) => res.sendStatus(200));

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🔥 THX AI backend running on port ${PORT}`);
});
