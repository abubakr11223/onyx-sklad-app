// Shared env for the training-video pipeline (seed-video.ts, capture.ts).
//
// The video stand uses its OWN database `onyx_video` on the same local Postgres
// server as the dev DB. The URL is derived from DATABASE_URL in `.env` by
// swapping the database name — credentials are never printed. Override with
// VIDEO_DATABASE_URL if the stand lives elsewhere.
//
// Safety: every consumer calls `assertVideoDb()` — the scripts refuse to touch
// a database whose name is not `onyx_video` or that is not on localhost.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(__dirname, "..");
export const VIDEO_DIR = join(REPO_ROOT, "video");
export const VIDEO_DB_NAME = "onyx_video";
/** Local photo store for the stand (PHOTO_STORAGE=local). Gitignored. */
export const PHOTO_STORE_DIR = join(VIDEO_DIR, ".photo-store");
/** Generated demo logins (gitignored). */
export const AUTH_FILE = join(VIDEO_DIR, ".auth.local.json");
export const STONE_ASSETS_DIR = join(VIDEO_DIR, "assets", "stones");
export const CAPTURES_DIR = join(VIDEO_DIR, "captures");
export const VIDEO_PORT = Number(process.env.VIDEO_PORT ?? 3100);
export const VIDEO_BASE_URL =
  process.env.VIDEO_BASE_URL ?? `http://localhost:${VIDEO_PORT}`;

function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(join(REPO_ROOT, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** postgresql://…/onyx_video?schema=public */
export function videoDatabaseUrl(): string {
  if (process.env.VIDEO_DATABASE_URL) return process.env.VIDEO_DATABASE_URL;
  const base = readDotEnv().DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL not found in .env (needed to derive onyx_video URL)");
  const u = new URL(base);
  u.pathname = "/" + VIDEO_DB_NAME;
  return u.toString();
}

/** Admin URL (database `postgres`) on the same server — for drop/create. */
export function adminDatabaseUrl(): string {
  const u = new URL(videoDatabaseUrl());
  u.pathname = "/postgres";
  u.search = "";
  return u.toString();
}

export function assertVideoDb(url: string): void {
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, "");
  const host = u.hostname;
  if (name !== VIDEO_DB_NAME || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      `Refusing to run: target DB must be ${VIDEO_DB_NAME} on localhost (got ${name}@${host})`,
    );
  }
}

/**
 * Env for the app process (seed + dev server) pointed at the video stand.
 * Telegram / AI keys are blanked so nothing leaves the machine.
 */
export function videoAppEnv(): Record<string, string> {
  const url = videoDatabaseUrl();
  assertVideoDb(url);
  return {
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: url,
    PHOTO_STORAGE: "local",
    PHOTO_STORAGE_DIR: PHOTO_STORE_DIR,
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_WEBHOOK_SECRET: "video-stand",
    TELEGRAM_BOT_USERNAME: "",
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: "",
    ANTHROPIC_API_KEY: "",
    BLOB_READ_WRITE_TOKEN: "",
  };
}

export interface DemoAccount {
  key: string;
  role: string;
  name: string;
  email: string;
  password: string;
}

export type AuthFile = Record<string, DemoAccount>;
