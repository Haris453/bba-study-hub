require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error("DATABASE_URL and SESSION_SECRET are required in .env");
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: true }
    : false
});

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "20kb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) =>
      cb(null, crypto.randomUUID() + ".pdf")
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf" ||
        path.extname(file.originalname).toLowerCase() !== ".pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  }
});

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_TOKEN;
  const supplied = req.get("x-admin-token") || "";

  if (!expected || supplied.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "BBA Study Hub API" });
});

app.get("/api/posts", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, category, description, pdf_name, created_at
       FROM posts ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string" ||
        email.length > 254 || password.length > 200) {
      return res.status(400).json({ error: "Invalid credentials format" });
    }

    const result = await pool.query(
      "SELECT id, password_hash FROM admins WHERE email = $1 LIMIT 1",
      [email.trim().toLowerCase()]
    );

    const admin = result.rows[0];
    const valid = admin &&
      await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // This starter uses a private API token for admin endpoints.
    // A production browser login should use secure server-side sessions.
    res.json({
      message: "Credentials verified",
      adminId: admin.id
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/posts", requireAdmin, upload.single("pdf"),
  async (req, res, next) => {
    let savedFile = req.file?.filename;

    try {
      const { title, category, description } = req.body;
      const allowed = ["Assignments", "Articles & Notes", "Chapters"];

      if (typeof title !== "string" || !title.trim() ||
          title.length > 120 ||
          !allowed.includes(category) ||
          typeof description !== "string" ||
          !description.trim() || description.length > 1000) {
        if (savedFile) fs.unlinkSync(path.join(uploadDir, savedFile));
        return res.status(400).json({ error: "Invalid post details" });
      }

      const result = await pool.query(
        `INSERT INTO posts (title, category, description, pdf_name, pdf_path)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, category, description, pdf_name, created_at`,
        [
          title.trim(),
          category,
          description.trim(),
          req.file?.originalname || null,
          savedFile || null
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (savedFile) {
        fs.unlink(path.join(uploadDir, savedFile), () => {});
      }
      next(err);
    }
  }
);

app.get("/api/posts/:id/pdf", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT pdf_path, pdf_name FROM posts WHERE id = $1",
      [req.params.id]
    );

    if (!result.rows[0]?.pdf_path) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const filePath = path.join(uploadDir, path.basename(result.rows[0].pdf_path));

    res.download(filePath, result.rows[0].pdf_name || "study-resource.pdf");
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err.message);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "PDF upload failed or exceeds 5 MB" });
  }

  if (err.message === "Only PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: "Server error" });
});

const port = Number(process.env.PORT) || 4000;
const API_URL = "http://127.0.0.1:4000";

pool.query("SELECT 1")
  .then(() => {
    app.listen(port, () => {
      console.log(`BBA Study Hub API running on port ${port}`);
    });
  })
  .catch(err => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });