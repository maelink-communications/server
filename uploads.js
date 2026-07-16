import { extname, join, resolve } from "@std/path";
import { authenticateToken } from "./access.js";
import { log } from "./logging.js";

if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Uploads module loaded", "gray");
}
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;
const UPLOADS_PORT = Number(Deno.env.get("UPLOADS_PORT") || 7002);
const UPLOADS_DIR = resolve(Deno.env.get("UPLOADS_DIR") || "uploads");

export class UploadError extends Error {
  constructor(message, status = 400, code = "UPLOAD_ERROR") {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.code = code;
  }
}

function envFlag(name) {
  return ["1", "true", "yes", "on"].includes(
    (Deno.env.get(name) || "").trim().toLowerCase(),
  );
}

export function uploadsOnlyMode() {
  return envFlag("UPLOADS_ONLY");
}

export function uploadsUpstreamUrl() {
  const value = (Deno.env.get("UPLOADS_UPSTREAM_URL") || "").trim();
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UploadError(
      "UPLOADS_UPSTREAM_URL must be a valid URL",
      500,
      "INVALID_UPLOADS_UPSTREAM",
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UploadError(
      "UPLOADS_UPSTREAM_URL must use HTTP or HTTPS",
      500,
      "INVALID_UPLOADS_UPSTREAM",
    );
  }
  return value.replace(/\/$/, "");
}

export function uploadsEnabled() {
  return uploadsOnlyMode() || envFlag("UPLOADS_ENABLED") ||
    Boolean((Deno.env.get("UPLOADS_UPSTREAM_URL") || "").trim());
}

export function uploadsPublicUrl() {
  const defaultPort = uploadsUpstreamUrl() && !uploadsOnlyMode()
    ? Number(Deno.env.get("PORT") || 7000)
    : UPLOADS_PORT;
  return (Deno.env.get("UPLOADS_PUBLIC_URL") ||
    `http://localhost:${defaultPort}`).replace(/\/$/, "");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, content-length, x-file-name",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function uploadError(error) {
  const status = Number(error?.status) || 500;
  return json({
    error: true,
    message: error instanceof Error ? error.message : String(error),
    code: error?.code || "UPLOAD_ERROR",
  }, status);
}

function bearerToken(req) {
  const authorization = req.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" ? token : null;
}

function internalUploadPrincipal(req) {
  const expectedSecret = Deno.env.get("UPLOADS_INTERNAL_SECRET") || "";
  const presentedSecret = req.headers.get("x-maelink-uploads-secret") || "";
  const uploadedBy = req.headers.get("x-maelink-uploaded-by") || "";
  if (!expectedSecret || presentedSecret !== expectedSecret || !uploadedBy) {
    return null;
  }
  return { uuid: uploadedBy };
}

function safeExtension(filename) {
  const extension = extname(filename || "").toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

async function writeLimitedBody(body, path, maxBytes = MAX_UPLOAD_BYTES) {
  if (!body) {
    throw new UploadError("Upload body is required", 400, "EMPTY_UPLOAD");
  }
  const file = await Deno.open(path, { createNew: true, write: true });
  let size = 0;
  try {
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        throw new UploadError(
          "Files must be 10 MB or smaller",
          413,
          "FILE_TOO_LARGE",
        );
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await file.write(chunk.subarray(offset));
        if (written === 0) throw new Error("Could not write uploaded file");
        offset += written;
      }
    }
  } catch (error) {
    file.close();
    await Deno.remove(path).catch(() => {});
    throw error;
  }
  file.close();
  if (size === 0) {
    await Deno.remove(path).catch(() => {});
    throw new UploadError("Upload body is empty", 400, "EMPTY_UPLOAD");
  }
  return size;
}

async function readLimitedBody(body, maxBytes) {
  if (!body) {
    throw new UploadError("Upload body is required", 400, "EMPTY_UPLOAD");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new UploadError(
        "Files must be 10 MB or smaller",
        413,
        "FILE_TOO_LARGE",
      );
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function receiveUpload(req) {
  const requestType = req.headers.get("content-type") || "";
  const isMultipart = requestType.toLowerCase().startsWith(
    "multipart/form-data",
  );
  const length = Number(req.headers.get("content-length"));
  const requestLimit = isMultipart ? MAX_MULTIPART_BYTES : MAX_UPLOAD_BYTES;
  if (Number.isFinite(length) && length > requestLimit) {
    throw new UploadError(
      "Files must be 10 MB or smaller",
      413,
      "FILE_TOO_LARGE",
    );
  }
  let principal = internalUploadPrincipal(req);
  if (!principal) {
    const token = bearerToken(req);
    if (!token) {
      throw new UploadError("Authentication required", 401, "AUTH_REQUIRED");
    }
    principal = await authenticateToken(token, { requiredType: "access" });
  }
  let filename = req.headers.get("x-file-name") || "";
  let type = requestType.split(";", 1)[0].trim().toLowerCase() ||
    "application/octet-stream";
  let body = req.body;
  if (isMultipart) {
    const encoded = await readLimitedBody(req.body, MAX_MULTIPART_BYTES);
    const parsed = new Request(req.url, {
      method: "POST",
      headers: { "content-type": requestType },
      body: encoded,
    });
    const form = await parsed.formData();
    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) {
      throw new UploadError(
        "Multipart uploads require a file field",
        400,
        "FILE_REQUIRED",
      );
    }
    if (uploaded.size > MAX_UPLOAD_BYTES) {
      throw new UploadError(
        "Files must be 10 MB or smaller",
        413,
        "FILE_TOO_LARGE",
      );
    }
    filename = uploaded.name;
    type = uploaded.type || "application/octet-stream";
    body = uploaded.stream();
  }
  const id = `${crypto.randomUUID()}${safeExtension(filename)}`;
  await Deno.mkdir(UPLOADS_DIR, { recursive: true });
  const size = await writeLimitedBody(body, join(UPLOADS_DIR, id));
  return {
    id,
    url: `${uploadsPublicUrl()}/files/${id}`,
    size,
    type,
    uploadedBy: principal.uuid,
  };
}

async function serveUpload(req, id) {
  if (!/^[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/.test(id)) {
    return json({ error: true, message: "File not found" }, 404);
  }
  try {
    const file = await Deno.open(join(UPLOADS_DIR, id), { read: true });
    const stat = await file.stat();
    const headers = new Headers({
      ...corsHeaders(),
      "content-length": String(stat.size),
      "content-type": contentTypeFor(id),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") {
      file.close();
      return new Response(null, { headers });
    }
    return new Response(file.readable, { headers });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return json({ error: true, message: "File not found" }, 404);
    }
    throw error;
  }
}

function contentTypeFor(filename) {
  const types = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
  };
  return types[extname(filename).toLowerCase()] || "application/octet-stream";
}

export function normalizeMediaUrl(value, field = "media") {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new UploadError(`${field} must be a URL`, 400, "INVALID_MEDIA_URL");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UploadError(`${field} must be a URL`, 400, "INVALID_MEDIA_URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UploadError(
      `${field} must use HTTP or HTTPS`,
      400,
      "INVALID_MEDIA_URL",
    );
  }
  if (
    uploadsEnabled() && !value.trim().startsWith(`${uploadsPublicUrl()}/files/`)
  ) {
    throw new UploadError(
      `${field} must be uploaded to this server first`,
      400,
      "UNMANAGED_MEDIA_URL",
    );
  }
  return value.trim();
}

export function normalizeAttachments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new UploadError(
      "attachments must be an array",
      400,
      "INVALID_ATTACHMENTS",
    );
  }
  if (value.length > 10) {
    throw new UploadError(
      "A post can have at most 10 attachments",
      400,
      "TOO_MANY_ATTACHMENTS",
    );
  }
  return [
    ...new Set(value.map((item) => normalizeMediaUrl(item, "attachment"))),
  ];
}

export async function uploadsHandler(req) {
  if (!uploadsEnabled()) {
    return json({ error: true, message: "Uploads are disabled" }, 404);
  }
  const url = new URL(req.url);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    if (url.pathname === "/upload" && req.method === "POST") {
      return json({ error: false, file: await receiveUpload(req) }, 201);
    }
    const match = url.pathname.match(/^\/files\/([^/]+)$/);
    if (match && ["GET", "HEAD"].includes(req.method)) {
      return await serveUpload(req, decodeURIComponent(match[1]));
    }
    if (url.pathname === "/health" && req.method === "GET") {
      return json({
        error: false,
        enabled: true,
        maxFileSize: MAX_UPLOAD_BYTES,
      });
    }
    return json({ error: true, message: "Route not found" }, 404);
  } catch (error) {
    return uploadError(error);
  }
}

export async function proxyUploadsRequest(req, uploadedBy = null) {
  const upstreamValue = uploadsUpstreamUrl();
  if (!upstreamValue) {
    throw new UploadError(
      "Uploads upstream is not configured",
      503,
      "UPLOADS_UPSTREAM_NOT_CONFIGURED",
    );
  }

  const source = new URL(req.url);
  const target = new URL(upstreamValue);
  target.pathname = target.pathname.replace(/\/$/, "") + source.pathname;
  target.search = source.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-maelink-uploads-secret");
  headers.delete("x-maelink-uploaded-by");
  const internalSecret = Deno.env.get("UPLOADS_INTERNAL_SECRET") || "";
  if (uploadedBy && internalSecret) {
    headers.set("x-maelink-uploads-secret", internalSecret);
    headers.set("x-maelink-uploaded-by", uploadedBy);
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual",
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    log("Uploads upstream request failed: " + String(error), "red");
    throw new UploadError(
      "Uploads upstream is unavailable",
      502,
      "UPLOADS_UPSTREAM_UNAVAILABLE",
    );
  }
}

export function startUploadsServer() {
  if (!uploadsEnabled() || (!uploadsOnlyMode() && uploadsUpstreamUrl())) {
    return null;
  }
  Deno.mkdirSync(UPLOADS_DIR, { recursive: true });
  const server = Deno.serve(
    { port: UPLOADS_PORT, onListen() {} },
    uploadsHandler,
  );
  return server;
}
