import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Electron apps share executable and framework UUIDs. Assign app-specific
// identities before signing so macOS local network privacy can distinguish them.
export function rewriteMachOUuid(binary, identity) {
  if (binary.length < 32 || binary.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error("Expected a thin 64-bit Mach-O executable");
  const commandCount = binary.readUInt32LE(16);
  const commandsEnd = 32 + binary.readUInt32LE(20);
  if (commandsEnd > binary.length || commandCount > (commandsEnd - 32) / 8)
    throw new Error("Truncated Mach-O load commands");
  const uuidOffsets = [];
  let offset = 32;
  for (let index = 0; index < commandCount; index++) {
    if (offset + 8 > commandsEnd)
      throw new Error("Truncated Mach-O load command");
    const command = binary.readUInt32LE(offset);
    const size = binary.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > commandsEnd)
      throw new Error("Invalid Mach-O load command size");
    if (command === 0x1b) {
      if (size !== 24) throw new Error("Invalid Mach-O LC_UUID size");
      uuidOffsets.push(offset + 8);
    }
    offset += size;
  }
  if (offset !== commandsEnd || uuidOffsets.length !== 1)
    throw new Error("Expected exactly one Mach-O LC_UUID command");

  // RFC 4122 UUID v5 with the DNS namespace; keep builds reproducible and
  // separate applications, Electron versions, and executable architectures.
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const architecture = binary.subarray(4, 12);
  const uuid = createHash("sha1")
    .update(namespace)
    .update(identity)
    .update(architecture)
    .digest()
    .subarray(0, 16);
  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  const result = Buffer.from(binary);
  uuid.copy(result, uuidOffsets[0]);
  return result;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const info = context.packager.appInfo;
  const executable = path.join(
    context.appOutDir,
    `${info.productFilename}.app`,
    "Contents",
    "MacOS",
    info.productFilename,
  );
  // Keep the seed used by the first working local-network build (0.1.1).
  // App-only updates must retain these UUIDs: the Electron binaries are unchanged,
  // and changing their identities invalidates macOS's existing network rules.
  const identity = `${info.id}:0.1.1:${context.packager.info.framework.version}`;
  const binary = await fs.readFile(executable);
  await fs.writeFile(executable, rewriteMachOUuid(binary, identity));
  const framework = path.join(
    context.appOutDir,
    `${info.productFilename}.app`,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Electron Framework",
  );
  const frameworkBinary = await fs.readFile(framework);
  await fs.writeFile(
    framework,
    rewriteMachOUuid(frameworkBinary, `${identity}:electron-framework`),
  );
}
