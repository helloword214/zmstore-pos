import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

type SaveResult = {
  url: string;
  key: string;
  contentType: string;
  size: number;
};

type SaveOptions = {
  keyPrefix?: string;
};

export interface StorageDriver {
  save(file: File, opts?: SaveOptions): Promise<SaveResult>;
  delete(key: string): Promise<void>;
  saveBuffer(
    buf: Buffer,
    opts: { ext: string; contentType: string; keyPrefix?: string }
  ): Promise<SaveResult>;
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

function normalizeKeyPrefix(raw: string | undefined) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function resolveSafeLocalPath(rootDir: string, key: string) {
  const root = path.resolve(rootDir);
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error("Unsafe storage key path");
  }
  return full;
}

class LocalStorage implements StorageDriver {
  constructor(
    private dir = process.env.UPLOADS_DIR ||
      // resolve against project root to avoid CWD surprises
      path.resolve(process.cwd(), "public/uploads")
  ) {}

  private buildKey(ext: string, keyPrefix?: string) {
    const safePrefix = normalizeKeyPrefix(keyPrefix);
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    return safePrefix ? `${safePrefix}/${filename}` : filename;
  }

  async ensureDirForKey(key: string) {
    const fullPath = resolveSafeLocalPath(this.dir, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    return fullPath;
  }

  async save(file: File, opts?: SaveOptions): Promise<SaveResult> {
    const type = file.type || "application/octet-stream";
    const ext = MIME_EXT[type] || "bin";
    const key = this.buildKey(ext, opts?.keyPrefix);
    const buf = Buffer.from(await file.arrayBuffer());
    const fullPath = await this.ensureDirForKey(key);
    await fs.writeFile(fullPath, buf);
    console.log(`[upload] wrote ${fullPath} (${buf.length}B)`);
    return {
      url: `/uploads/${key}`,
      key,
      contentType: type,
      size: buf.length,
    };
  }
  async saveBuffer(
    buf: Buffer,
    opts: { ext: string; contentType: string; keyPrefix?: string }
  ): Promise<SaveResult> {
    const key = this.buildKey(opts.ext, opts.keyPrefix);
    const fullPath = await this.ensureDirForKey(key);
    await fs.writeFile(fullPath, buf);
    console.log(`[upload] wrote ${fullPath} (${buf.length}B)`);
    return {
      url: `/uploads/${key}`,
      key,
      contentType: opts.contentType,
      size: buf.length,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      const fullPath = resolveSafeLocalPath(this.dir, key);
      await fs.unlink(fullPath);
    } catch {
      // ignore if missing
    }
  }
}
// ---------- S3 Driver ----------
class S3Storage implements StorageDriver {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private basePrefix: string;
  private publicUrlPrefix?: string;
  private usePathStyle: boolean;
  private endpoint?: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET!;
    this.region = process.env.S3_REGION!;
    this.basePrefix = normalizeKeyPrefix(process.env.UPLOADS_PREFIX || "uploads");
    this.publicUrlPrefix = process.env.PUBLIC_URL_PREFIX;
    this.endpoint = process.env.S3_ENDPOINT;
    this.usePathStyle =
      String(process.env.S3_USE_PATH_STYLE || "false") === "true";

    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint || undefined,
      forcePathStyle: this.usePathStyle || Boolean(this.endpoint),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  private buildUrl(key: string) {
    if (this.publicUrlPrefix) {
      return `${this.publicUrlPrefix.replace(/\/+$/, "")}/${key}`;
    }
    if (this.endpoint) {
      // generic S3-compatible endpoint
      return this.usePathStyle
        ? `${this.endpoint.replace(/\/+$/, "")}/${this.bucket}/${key}`
        : `${this.endpoint.replace(/\/+$/, "")}/${key}`;
    }
    // aws s3
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private buildObjectKey(ext: string, keyPrefix?: string) {
    const runtimePrefix = normalizeKeyPrefix(keyPrefix);
    const prefix = [this.basePrefix, runtimePrefix].filter(Boolean).join("/");
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    return prefix ? `${prefix}/${filename}` : filename;
  }

  async save(file: File, opts?: SaveOptions): Promise<SaveResult> {
    const type = file.type || "application/octet-stream";
    const ext = MIME_EXT[type] || "bin";
    const key = this.buildObjectKey(ext, opts?.keyPrefix);
    const body = Buffer.from(await file.arrayBuffer());

    // If your bucket blocks ACLs (recommended), omit ACL entirely.
    const put = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: type,
      // ACL: "public-read", // only if your bucket requires it
    });
    await this.client.send(put);
    return {
      url: this.buildUrl(key),
      key,
      contentType: type,
      size: body.length,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async saveBuffer(
    buf: Buffer,
    opts: { ext: string; contentType: string; keyPrefix?: string }
  ): Promise<SaveResult> {
    const key = this.buildObjectKey(opts.ext, opts.keyPrefix);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buf,
        ContentType: opts.contentType,
      })
    );
    return {
      url: this.buildUrl(key),
      key,
      contentType: opts.contentType,
      size: buf.length,
    };
  }
}

// ---------- Driver selector ----------
const DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();
export const storage: StorageDriver =
  DRIVER === "s3" ? new S3Storage() : new LocalStorage();
