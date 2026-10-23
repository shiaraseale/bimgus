const crypto = require("crypto");
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = "127.0.0.1";

const COC_API_TOKEN = process.env.COC_API_TOKEN || "";
const PROXY_KEY = process.env.PROXY_KEY || "";

if (!COC_API_TOKEN) {
  console.warn("[WARNING] COC_API_TOKEN is not set in environment.");
}
if (!PROXY_KEY) {
  console.warn("[WARNING] PROXY_KEY is not set in environment.");
}

// Disable Express fingerprint
app.disable("x-powered-by");

// Simple sliding-window rate limiter: max 20 requests per second
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requestTimestamps = [];

function checkRateLimit() {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  requestTimestamps.push(now);
  return true;
}

// Request timing & logging middleware (never logs headers or query tokens)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check endpoint (public, unauthenticated for uptime checks)
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", proxy: "Bimgus CoC Proxy Active", hardened: true });
});

// Timing-safe secret verification
function isProxyKeyValid(providedKey) {
  if (!PROXY_KEY || !providedKey) {
    return false;
  }
  const expectedBuf = Buffer.from(PROXY_KEY);
  const providedBuf = Buffer.from(providedKey);

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// Path allow-list verification: GET requests to /v1/clans/*, /v1/players/*, /v1/clanwarleagues/*
function isAllowedPathAndMethod(method, path) {
  if (method !== "GET") {
    return false;
  }
  return (
    path.startsWith("/v1/clans") ||
    path.startsWith("/v1/players") ||
    path.startsWith("/v1/clanwarleagues")
  );
}

// Proxy handler for /v1/*
app.all("/v1/*", async (req, res) => {
  // 1. Enforce rate limit
  if (!checkRateLimit()) {
    return res.status(429).json({ error: "Too Many Requests", message: "Rate limit exceeded (max 20 req/s)" });
  }

  // 2. Validate X-Proxy-Key shared secret
  const incomingKey = req.headers["x-proxy-key"];
  if (!isProxyKeyValid(incomingKey)) {
    return res.status(401).json({ error: "Unauthorized", message: "Missing or invalid X-Proxy-Key" });
  }

  // 3. Enforce path and method allow-list
  if (!isAllowedPathAndMethod(req.method, req.path)) {
    return res.status(403).json({ error: "Forbidden", message: "Method or path not permitted by proxy policy" });
  }

  if (!COC_API_TOKEN) {
    return res.status(500).json({ error: "Internal Server Error", message: "COC_API_TOKEN is not configured on proxy" });
  }

  // 4. Forward to Supercell API using the VM's locked token
  const targetUrl = `https://api.clashofclans.com${req.originalUrl}`;

  try {
    const upstreamRes = await axios({
      method: "GET",
      url: targetUrl,
      params: req.query,
      headers: {
        Authorization: `Bearer ${COC_API_TOKEN}`,
        Accept: "application/json",
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    return res.status(upstreamRes.status).json(upstreamRes.data);
  } catch (err) {
    return res.status(502).json({ error: "Bad Gateway", message: err.message });
  }
});

// Any other route not matched
app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[Bimgus Proxy] Hardened server listening on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
