// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "fs";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();
const app = express();

// 🧩 Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(express.static("public")); // serve frontend

// 🧩 Cloudinary Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 🔒 Authentication Middleware (for secure route)
function authenticate(req, res, next) {
    const clientKey = req.headers["x-api-key"];
    if (clientKey !== process.env.UPLOAD_SECRET_KEY) {
        return res.status(401).json({ message: "Unauthorized: Invalid API key" });
    }
    next();
}

// ⚙️ Rate Limiter (for public endpoints)
const publicLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // limit per IP
    message: { message: "Too many uploads. Please wait a minute." },
});
app.use("/public-upload", publicLimiter);
app.use("/public-upload-url", publicLimiter);

// 🧰 Multer Setup
const upload = multer({
    dest: "uploads/",
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/", "video/"];
        if (allowedTypes.some((t) => file.mimetype.startsWith(t))) cb(null, true);
        else cb(new Error("Only image and video files are allowed!"));
    },
});

// Helper: Safe delete
const safeDelete = (path) => {
    fs.unlink(path, (err) => {
        if (err) console.warn("⚠️ Failed to delete temp file:", path);
    });
};

// ✅ SECURE Upload (with API key)
app.post("/upload", authenticate, upload.array("files", 5), async(req, res) => {
    try {
        const uploads = req.files.map(async(file) => {
            const resourceType = file.mimetype.startsWith("video/") ? "video" : "image";
            const result = await cloudinary.uploader.upload(file.path, {
                folder: "secure_uploads",
                resource_type: resourceType,
            });
            safeDelete(file.path);
            console.log(`📦 Uploaded by secure client → ${result.secure_url}`);
            return { url: result.secure_url, type: resourceType };
        });

        const uploaded = await Promise.all(uploads);
        res.json({ message: "✅ Secure upload successful!", uploaded });
    } catch (err) {
        console.error("❌ Upload error:", err);
        res.status(500).json({ message: "Upload failed", error: err.message });
    }
});

// ✅ PUBLIC Upload (no key)
app.post("/public-upload", upload.array("files", 5), async(req, res) => {
    try {
        const uploads = req.files.map(async(file) => {
            const type = file.mimetype.startsWith("video/") ? "video" : "image";
            const result = await cloudinary.uploader.upload(file.path, {
                folder: "public_uploads",
                resource_type: type,
            });
            safeDelete(file.path);
            console.log(`🌍 Public upload: ${result.secure_url}`);
            return { url: result.secure_url, type };
        });

        const uploaded = await Promise.all(uploads);
        res.json({ message: "✅ Public upload successful!", uploaded });
    } catch (err) {
        console.error("❌ Upload error:", err);
        res.status(500).json({ message: "Failed to upload", error: err.message });
    }
});

// ✅ PUBLIC Upload via URL
app.post("/public-upload-url", async(req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ message: "No URL provided" });

        const type = url.match(/\.(mp4|mov|avi|mkv)$/i) ? "video" : "image";
        const result = await cloudinary.uploader.upload(url, {
            folder: "public_uploads",
            resource_type: type,
        });

        res.json({
            message: "✅ Uploaded from URL successfully!",
            uploaded: { url: result.secure_url, type },
        });
    } catch (err) {
        console.error("❌ URL upload error:", err);
        res.status(500).json({ message: "Failed to upload URL", error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));