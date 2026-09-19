import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

/**
 * Media storage for admin-uploaded images (product photos, promotion
 * visuals).
 *
 * This project has no object storage today: the backend talks to its own
 * PostgreSQL and nothing else, and the Supabase containers in the compose
 * file are not wired into this API. Rather than silently adopting a
 * third-party service, this is the smallest production-appropriate
 * abstraction: an interface plus a local-disk implementation. Swapping in
 * S3/GCS/Supabase later means adding one class here, not touching the
 * modules that call it.
 *
 * The database stores the URL only - image bytes never go into Postgres.
 */
export interface StoredMedia {
  /** Storage key, e.g. "products/ab12….webp" - what delete() takes. */
  key: string;
  /** What the database stores and clients fetch. */
  url: string;
}

export interface MediaStorage {
  save(buffer: Buffer, contentType: string, folder: string): Promise<StoredMedia>;
  delete(key: string): Promise<void>;
  /** Extracts a storage key from a stored URL, or null if it isn't ours. */
  keyFromUrl(url: string): string | null;
}

/** Content types we accept, and the extension each is stored under. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 2 MB. The admin UI downscales before upload, so this is a backstop. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export class LocalDiskStorage implements MediaStorage {
  /** Absolute, so path containment checks below are meaningful. */
  private readonly root: string;

  constructor(
    root: string = env.MEDIA_ROOT,
    private readonly publicPath: string = '/uploads',
    private readonly baseUrl: string = env.PUBLIC_BASE_URL
  ) {
    this.root = path.resolve(root);
  }

  async save(buffer: Buffer, contentType: string, folder: string): Promise<StoredMedia> {
    const extension = ALLOWED_IMAGE_TYPES[contentType];
    if (!extension) {
      throw new Error(`Unsupported image type: ${contentType}`);
    }

    const safeFolder = folder.replace(/[^a-z0-9_-]/gi, '');
    const name = `${crypto.randomUUID()}.${extension}`;
    const key = `${safeFolder}/${name}`;
    const destination = path.join(this.root, safeFolder);

    await fs.promises.mkdir(destination, { recursive: true });
    await fs.promises.writeFile(path.join(destination, name), buffer);

    return { key, url: `${this.baseUrl}${this.publicPath}/${key}` };
  }

  async delete(key: string): Promise<void> {
    // Keys come from keyFromUrl or save; normalize anyway so a crafted
    // value can't escape the media root.
    const normalized = path
      .normalize(key)
      .replace(/^(\.\.(\/|\\|$))+/, '')
      .replace(/^[/\\]+/, '');
    const target = path.resolve(this.root, normalized);
    if (!target.startsWith(this.root)) return;

    await fs.promises.rm(target, { force: true });
  }

  keyFromUrl(url: string): string | null {
    if (!url) return null;
    const marker = `${this.publicPath}/`;
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length) || null;
  }
}

export const mediaStorage: MediaStorage = new LocalDiskStorage();
