
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 4000;

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error("DATABASE_URL and SESSION_SECRET are required in .env");
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: true }
    : false
});

pool.on("error", (err) => {
  console.error("PostgreSQL error:", err.message);
});

// Frontend origins allowed during local development
const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

app.use(cors({
  origin(origin, callback) {
    // Allow requests without an Origin header, such as local health checks.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(helmet());
app.use(express.json({ limit: "20kb" }));

// PostgreSQL-backed sessions
app.use(session({
  name: "bba.sid",
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: false, // Local HTTP only; use true with HTTPS in production.
    sameSite: "lax",
    maxAge: 2 * 60 * 60 * 1000
  }
}));

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => {
      callback(null, crypto.randomUUID() + ".pdf");
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    const valid =
      file.mimetype === "application/pdf" &&
      path.extname(file.originalname).toLowerCase() === ".pdf";

    if (!valid) {
      return callback(new Error("Only PDF files are allowed"));
    }

    callback(null, true);
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({
      authenticated: false,
      error: "Please sign in first"
    });
  }

  next();
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "BBA Study Hub API"
  });
});

// Public study posts
app.get("/api/posts", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, title, category, description, pdf_name, created_at
      FROM posts
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Login
app.post("/api/admin/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 200
    ) {
      return res.status(400).json({
        authenticated: false,
        error: "Please enter a valid email and password"
      });
    }

    const result = await pool.query(
      `SELECT id, password_hash
       FROM admins
       WHERE email = $1
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    const admin = result.rows[0];
    const valid = admin
      ? await bcrypt.compare(password, admin.password_hash)
      : false;

    if (!valid) {
      return res.status(401).json({
        authenticated: false,
        error: "Invalid email or password"
      });
    }

    // Create a fresh session after successful authentication.
    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.adminId = admin.id;

      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);

        res.json({
          authenticated: true,
          message: "Login successful"
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

// Check current login session
app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({
    authenticated: true,
    adminId: req.session.adminId
  });
});

// Logout
app.post("/api/admin/logout", (req, res, next) => {
  if (!req.session) {
    return res.json({ message: "Logged out" });
  }

  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie("bba.sid", {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    });

    res.json({ message: "Logged out successfully" });
  });
});

// Create a post with an optional PDF
app.post(
  "/api/admin/posts",
  requireAdmin,
  upload.single("pdf"),
  async (req, res, next) => {
    const savedFile = req.file?.filename;

    try {
      const { title, category, description } = req.body || {};
      const allowedCategories = [
        "Assignments",
        "Articles & Notes",
        "Chapters"
      ];

      if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 120 ||
        !allowedCategories.includes(category) ||
        typeof description !== "string" ||
        !description.trim() ||
        description.trim().length > 1000
      ) {
        if (savedFile) {
          fs.unlink(path.join(uploadDir, savedFile), () => {});
        }

        return res.status(400).json({
          error: "Please check the post title, category and description"
        });
      }

      const result = await pool.query(
        `INSERT INTO posts
          (title, category, description, pdf_name, pdf_path)
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

// Download PDF
app.get("/api/posts/:id/pdf", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const result = await pool.query(
      `SELECT pdf_path, pdf_name
       FROM posts
       WHERE id = $1`,
      [req.params.id]
    );

    const post = result.rows[0];

    if (!post || !post.pdf_path) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const filePath = path.join(
      uploadDir,
      path.basename(post.pdf_path)
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "PDF file is missing" });
    }

    res.download(
      filePath,
      path.basename(post.pdf_name || "study-resource.pdf"),
      (err) => {
        if (err && !res.headersSent) next(err);
      }
    );
  } catch (err) {
    next(err);
  }
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("API error:", err.message);

  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: "PDF upload failed. Maximum size is 5 MB."
    });
  }

  if (err.message === "Only PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }

  if (err.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: "Frontend origin not allowed" });
  }

  res.status(500).json({ error: "Server error" });
});

// Start after database connection succeeds
async function startServer() {
  try {
    await pool.query("SELECT 1");

    app.listen(PORT, () => {
      console.log(`BBA Study Hub API running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  }
}

startServer();
