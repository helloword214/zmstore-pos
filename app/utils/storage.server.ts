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

export interface StorageDriver {
  save(file: File): Promise<SaveResult>;
  delete(key: string): Promise<void>;
  saveBuffer(
    buf: Buffer,
    opts: { ext: string; contentType: string }
  ): Promise<SaveResult>;
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

class LocalStorage implements StorageDriver {
  constructor(
    private dir = process.env.UPLOADS_DIR ||
      // resolve against project root to avoid CWD surprises
      path.resolve(process.cwd(), "public/uploads")
  ) {}
  async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async save(file: File): Promise<SaveResult> {
    const type = file.type || "application/octet-stream";
    const ext = MIME_EXT[type] || "bin";
    const name = `${Date.now()}-${crypto
      .randomBytes(8)
      .toString("hex")}.${ext}`;
    await this.ensureDir();
    const buf = Buffer.from(await file.arrayBuffer());
    const fullPath = path.join(this.dir, name);
    await fs.writeFile(fullPath, buf);
    console.log(`[upload] wrote ${fullPath} (${buf.length}B)`);
    return {
      url: `/uploads/${name}`,
      key: name,
      contentType: type,
      size: buf.length,
    };
  }
  async saveBuffer(
    buf: Buffer,
    opts: { ext: string; contentType: string }
  ): Promise<SaveResult> {
    await this.ensureDir();
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${
      opts.ext
    }`;
    const fullPath = path.join(this.dir, name);
    await fs.writeFile(fullPath, buf);
    console.log(`[upload] wrote ${fullPath} (${buf.length}B)`);
    return {
      url: `/uploads/${name}`,
      key: name,
      contentType: opts.contentType,
      size: buf.length,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.dir, key));
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
  private prefix: string;
  private publicUrlPrefix?: string;
  private usePathStyle: boolean;
  private endpoint?: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET!;
    this.region = process.env.S3_REGION!;
    this.prefix =
      (process.env.UPLOADS_PREFIX || "uploads/").replace(/^\/+|\/+$/g, "") +
      "/";
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

  async save(file: File): Promise<SaveResult> {
    const type = file.type || "application/octet-stream";
    const ext = MIME_EXT[type] || "bin";
    const key = `${this.prefix}${Date.now()}-${crypto
      .randomBytes(8)
      .toString("hex")}.${ext}`;
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
    opts: { ext: string; contentType: string }
  ): Promise<SaveResult> {
    const key = `${this.prefix}${Date.now()}-${crypto
      .randomBytes(8)
      .toString("hex")}.${opts.ext}`;
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
