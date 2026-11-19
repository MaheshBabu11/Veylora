import { link } from "node:fs/promises";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hasArchivePromotionMarker,
  isArchivePromotionComplete,
  promoteStagedArchive,
  removePromotedArchive,
} from "@/server/archive-promotion";

const booksRoot = process.env.VEYLORA_BOOKS_DIR!;
let testRoot = "";
let stagingDirectory = "";
let destinationDirectory = "";
let stagedName = "";
let targetPath = "";
const archiveBytes = Buffer.from("validated archive fixture");

const unsupportedHardLink: typeof link = async () => {
  throw Object.assign(new Error("Hard links are not supported."), { code: "EPERM" });
};

beforeAll(async () => {
  testRoot = await mkdtemp(path.join(booksRoot, ".archive-promotion-test-"));
  stagingDirectory = path.join(testRoot, "staging");
  destinationDirectory = path.join(testRoot, "series");
  stagedName = `${randomUUID()}.cbz`;
  targetPath = path.join(destinationDirectory, "Chapter 001.cbz");
  await Promise.all([
    mkdir(stagingDirectory, { recursive: true }),
    mkdir(destinationDirectory, { recursive: true }),
  ]);
  await writeFile(path.join(stagingDirectory, stagedName), archiveBytes);
});

afterAll(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
});

describe("archive promotion on filesystems without hard links", () => {
  it("uses an exclusive copy, recognizes its retry by hash, and removes only its own promoted copy", async () => {
    await promoteStagedArchive(stagingDirectory, stagedName, targetPath, unsupportedHardLink);
    await expect(readFile(targetPath)).resolves.toEqual(archiveBytes);
    await expect(isArchivePromotionComplete(stagingDirectory, stagedName, targetPath)).resolves.toBe(true);

    await promoteStagedArchive(stagingDirectory, stagedName, targetPath);
    await removePromotedArchive(stagingDirectory, stagedName, targetPath);

    await expect(isArchivePromotionComplete(stagingDirectory, stagedName, targetPath)).resolves.toBe(false);
    await expect(readFile(path.join(stagingDirectory, stagedName))).resolves.toEqual(archiveBytes);
    await expect(hasArchivePromotionMarker(stagingDirectory, [stagedName])).resolves.toBe(false);
  });

  it("does not overwrite or delete an identical pre-existing archive", async () => {
    await writeFile(targetPath, archiveBytes);
    await expect(isArchivePromotionComplete(stagingDirectory, stagedName, targetPath)).resolves.toBe(false);
    await expect(promoteStagedArchive(stagingDirectory, stagedName, targetPath, unsupportedHardLink))
      .rejects.toThrow("already exists");
    await removePromotedArchive(stagingDirectory, stagedName, targetPath);

    await expect(readFile(targetPath)).resolves.toEqual(archiveBytes);
    await expect(hasArchivePromotionMarker(stagingDirectory, [stagedName])).resolves.toBe(false);
  });
});
