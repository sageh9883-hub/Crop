const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.BUILDER_API_KEY || "";

const ROOT = "/builder";
const JOBS_DIR = path.join(ROOT, "jobs");
const BUILDS_DIR = path.join(ROOT, "builds");
const TEMPLATE_DIR = "/builder/template";

fs.mkdirSync(JOBS_DIR, { recursive: true });
fs.mkdirSync(BUILDS_DIR, { recursive: true });

app.use(helmet({
  crossOriginResourcePolicy: false
}));

app.use(cors({
  origin: true
}));

app.use(express.json({
  limit: "1mb"
}));

function createId() {
  return crypto.randomBytes(12).toString("hex");
}

function saveJob(job) {
  fs.writeFileSync(
    path.join(JOBS_DIR, `${job.id}.json`),
    JSON.stringify(job, null, 2)
  );
}

function loadJob(id) {
  const file = path.join(JOBS_DIR, `${id}.json`);

  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function updateJob(id, changes) {
  const job = loadJob(id);

  if (!job) {
    return null;
  }

  Object.assign(job, changes, {
    updatedAt: new Date().toISOString()
  });

  saveJob(job);
  return job;
}

function validateUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      return false;
    }

    if (url.username || url.password) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function validatePackage(value) {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value);
}

function cleanName(value) {
  return String(value || "Generated App")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .slice(0, 80) || "Generated App";
}

function cleanVersion(value) {
  const version = String(value || "1.0.0")
    .trim()
    .replace(/[^0-9A-Za-z._-]/g, "")
    .slice(0, 30);

  return version || "1.0.0";
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return next();
  }

  const supplied =
    req.get("x-api-key") ||
    req.query.apiKey ||
    "";

  if (supplied !== API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Invalid API key"
    });
  }

  next();
}

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "gabinarou-webview-apk-builder",
    version: "2.0.0",
    status: "online",
    time: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "gabinarou-webview-apk-builder",
    version: "2.0.0",
    status: "online"
  });
});

app.post("/api/build", requireApiKey, (req, res) => {
  const {
    url,
    appUrl,
    name,
    appName,
    packageName,
    packageId,
    iconUrl,
    version,
    versionName
  } = req.body || {};

  const finalUrl = String(url || appUrl || "").trim();
  const finalName = cleanName(name || appName);
  const finalPackage = String(packageName || packageId || "").trim();
  const finalIcon = String(iconUrl || "").trim();
  const finalVersion = cleanVersion(version || versionName);

  if (!finalUrl) {
    return res.status(400).json({
      success: false,
      error: "Missing URL"
    });
  }

  if (!validateUrl(finalUrl)) {
    return res.status(400).json({
      success: false,
      error: "URL must use HTTPS and cannot contain credentials"
    });
  }

  if (!validatePackage(finalPackage)) {
    return res.status(400).json({
      success: false,
      error: "Invalid Android package name"
    });
  }

  if (finalIcon && !/^https:\/\//i.test(finalIcon)) {
    return res.status(400).json({
      success: false,
      error: "iconUrl must use HTTPS"
    });
  }

  const id = createId();
  const now = new Date().toISOString();

  const job = {
    id,
    status: "queued",
    progress: 0,

    url: finalUrl,
    name: finalName,
    packageName: finalPackage,
    iconUrl: finalIcon,
    versionName: finalVersion,

    createdAt: now,
    updatedAt: now,

    downloadUrl: null,
    apk: null,
    zip: null,
    error: null
  };

  saveJob(job);

  processBuild(job).catch((error) => {
    console.error("Build error:", error);

    updateJob(id, {
      status: "failed",
      progress: 0,
      error: error.message || String(error)
    });
  });

  res.status(202).json({
    success: true,
    jobId: id,
    status: "queued",
    statusUrl: `/api/build/${id}`
  });
});

app.get("/api/build/:id", requireApiKey, (req, res) => {
  const job = loadJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: "Build job not found"
    });
  }

  res.json({
    success: true,
    ...job
  });
});

app.get("/api/download/:id", requireApiKey, (req, res) => {
  const job = loadJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: "Build job not found"
    });
  }

  if (job.status !== "completed") {
    return res.status(409).json({
      success: false,
      error: "Build is not completed",
      status: job.status,
      progress: job.progress
    });
  }

  const file = path.join(
    BUILDS_DIR,
    job.id,
    `${job.packageName}-${job.versionName}.zip`
  );

  if (!fs.existsSync(file)) {
    return res.status(404).json({
      success: false,
      error: "Build archive not found"
    });
  }

  res.download(
    file,
    `${job.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`
  );
});

async function processBuild(job) {
  const id = job.id;
  const workDir = path.join(BUILDS_DIR, id);

  fs.mkdirSync(workDir, { recursive: true });

  updateJob(id, {
    status: "building",
    progress: 5
  });

  if (!fs.existsSync(TEMPLATE_DIR)) {
    throw new Error("Android WebView template not found");
  }

  const properties = [
    `app.url=${job.url}`,
    `app.package=${job.packageName}`,
    `app.name=${job.name}`,
    `app.icon_url=${job.iconUrl}`
  ].join("\n") + "\n";

  fs.writeFileSync(
    path.join(TEMPLATE_DIR, "app.properties"),
    properties
  );

  updateJob(id, {
    status: "building",
    progress: 15
  });

  await runCommand(
    "./gradlew",
    [
      "assembleDebug",
      "--no-daemon",
      "--stacktrace"
    ],
    {
      cwd: TEMPLATE_DIR,
      env: {
        ...process.env,
        GRADLE_OPTS: "-Xmx256m -Dorg.gradle.daemon=false"
      },
      onOutput: (text) => {
        console.log(`[${id}] ${text}`);
      }
    }
  );

  updateJob(id, {
    status: "packaging",
    progress: 85
  });

  const apkSource = path.join(
    TEMPLATE_DIR,
    "app/build/outputs/apk/debug/app-debug.apk"
  );

  if (!fs.existsSync(apkSource)) {
    throw new Error("APK was not generated");
  }

  const apkDestination = path.join(
    workDir,
    `${job.packageName}-${job.versionName}.apk`
  );

  fs.copyFileSync(apkSource, apkDestination);

  const info = {
    jobId: job.id,
    name: job.name,
    packageName: job.packageName,
    versionName: job.versionName,
    url: job.url,
    iconUrl: job.iconUrl,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(workDir, "build.json"),
    JSON.stringify(info, null, 2)
  );

  fs.writeFileSync(
    path.join(workDir, "README.txt"),
    [
      "Gabinarou WebView APK",
      "",
      `Application: ${job.name}`,
      `Package: ${job.packageName}`,
      `Version: ${job.versionName}`,
      `URL: ${job.url}`,
      "",
      "Generated automatically by Gabinarou."
    ].join("\n")
  );

  const zipName =
    `${job.packageName}-${job.versionName}.zip`;

  const zipPath = path.join(workDir, zipName);

  await runCommand(
    "zip",
    [
      "-j",
      zipPath,
      apkDestination,
      path.join(workDir, "build.json"),
      path.join(workDir, "README.txt")
    ],
    {
      cwd: workDir
    }
  );

  updateJob(id, {
    status: "completed",
    progress: 100,
    apk: `/api/download/${id}?format=apk`,
    zip: `/api/download/${id}`,
    downloadUrl: `/api/download/${id}`,
    error: null
  });

  console.log(`[${id}] BUILD COMPLETED`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;

      if (options.onOutput) {
        options.onOutput(text);
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;

      if (options.onOutput) {
        options.onOutput(text);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr
        });
      } else {
        reject(
          new Error(
            `${command} exited with code ${code}\n${stderr.slice(-8000)}`
          )
        );
      }
    });
  });
}

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("========================================");
  console.log(" Gabinarou WebView APK Builder");
  console.log("========================================");
  console.log(`PORT: ${PORT}`);
  console.log("Host: 0.0.0.0");
  console.log("API:  /api/build");
  console.log("Health: /health");
  console.log("========================================");
});
