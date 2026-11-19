import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, lstat, link, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const promotionRecordSchema = z.object({
  targetPath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});

type PromotionRecord = z.infer<typeof promotionRecordSchema>;
type LinkFunction = typeof link;

function promotionRecordPath(stagingDirectory: string, stagedName: string) {
  return path.join(stagingDirectory, `.${stagedName}.promotion.json`);
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readPromotionRecord(stagingDirectory: string, stagedName: string) {
  try {
    const contents = await readFile(promotionRecordPath(stagingDirectory, stagedName), "utf8");
    const parsed: unknown = JSON.parse(contents);
    return promotionRecordSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writePromotionRecord(stagingDirectory: string, stagedName: string, record: PromotionRecord) {
  const recordPath = promotionRecordPath(stagingDirectory, stagedName);
  const contents = JSON.stringify(record);
  try {
    await writeFile(recordPath, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(recordPath, "utf8");
    if (existing !== contents) throw new Error("The staged archive already has a different promotion record.");
  }
}

async function removePromotionRecord(stagingDirectory: string, stagedName: string) {
  try {
    await unlink(promotionRecordPath(stagingDirectory, stagedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function hasArchivePromotionMarker(stagingDirectory: string, stagedNames: string[]) {
  const markers = await Promise.all(stagedNames.map(async (stagedName) => {
    try {
      await readFile(promotionRecordPath(stagingDirectory, stagedName));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }));
  return markers.some(Boolean);
}

export async function isArchivePromotionComplete(stagingDirectory: string, stagedName: string, targetPath: string) {
  const stagedPath = path.join(stagingDirectory, stagedName);
  let stagedInfo;
  let targetInfo;
  try {
    [stagedInfo, targetInfo] = await Promise.all([lstat(stagedPath), lstat(targetPath)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!stagedInfo.isFile() || stagedInfo.isSymbolicLink()
    || !targetInfo.isFile() || targetInfo.isSymbolicLink()) return false;
  if (stagedInfo.dev === targetInfo.dev && stagedInfo.ino === targetInfo.ino) return true;

  const record = await readPromotionRecord(stagingDirectory, stagedName);
  if (!record || record.targetPath !== targetPath
    || record.size !== stagedInfo.size || stagedInfo.size !== targetInfo.size) return false;
  const [stagedHash, targetHash] = await Promise.all([hashFile(stagedPath), hashFile(targetPath)]);
  return stagedHash === record.sha256 && targetHash === record.sha256;
}

function supportsCopyFallback(error: unknown) {
  return ["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EMLINK"].includes((error as NodeJS.ErrnoException).code ?? "");
}

export async function promoteStagedArchive(
  stagingDirectory: string,
  stagedName: string,
  targetPath: string,
  createHardLink: LinkFunction = link,
) {
  const stagedPath = path.join(stagingDirectory, stagedName);
  try {
    await createHardLink(stagedPath, targetPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (await isArchivePromotionComplete(stagingDirectory, stagedName, targetPath)) return;
      throw new Error(`Chapter archive already exists at "${path.basename(targetPath)}".`, { cause: error });
    }
    if (!supportsCopyFallback(error)) throw error;
  }

  const stagedInfo = await lstat(stagedPath);
  if (!stagedInfo.isFile() || stagedInfo.isSymbolicLink()) throw new Error("The staged archive is not a regular file.");
  const record: PromotionRecord = {
    targetPath,
    sha256: await hashFile(stagedPath),
    size: stagedInfo.size,
  };
  try {
    await copyFile(stagedPath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (await isArchivePromotionComplete(stagingDirectory, stagedName, targetPath)) return;
      throw new Error(`Chapter archive already exists at "${path.basename(targetPath)}".`, { cause: error });
    }
    throw error;
  }
  await writePromotionRecord(stagingDirectory, stagedName, record);
}

export async function removePromotedArchive(stagingDirectory: string, stagedName: string, targetPath: string) {
  const record = await readPromotionRecord(stagingDirectory, stagedName);
  if (record) {
    if (record.targetPath !== targetPath) throw new Error("The archive promotion record points to a different target.");
    try {
      const targetInfo = await lstat(targetPath);
      if (targetInfo.isFile() && !targetInfo.isSymbolicLink()) {
        const matchesRecord = targetInfo.size === record.size && await hashFile(targetPath) === record.sha256;
        if (matchesRecord || targetInfo.size < record.size) {
          await unlink(targetPath);
        } else {
          console.error("[upload] promoted archive changed; leaving it in place", { targetPath });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await removePromotionRecord(stagingDirectory, stagedName);
    return;
  }

  try {
    const stagedPath = path.join(stagingDirectory, stagedName);
    const [stagedInfo, targetInfo] = await Promise.all([lstat(stagedPath), lstat(targetPath)]);
    if (stagedInfo.dev === targetInfo.dev && stagedInfo.ino === targetInfo.ino) await unlink(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function removeArchivePromotionMarker(stagingDirectory: string, stagedName: string) {
  await removePromotionRecord(stagingDirectory, stagedName);
}
