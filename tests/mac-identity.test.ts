import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const {
  rewriteMachOUuid,
  default: afterPack,
}: {
  rewriteMachOUuid: (binary: Buffer, identity: string) => Buffer;
  default: (context: {
    electronPlatformName: string;
    appOutDir: string;
    packager: {
      appInfo: { id: string; version: string; productFilename: string };
      info: { framework: { version: string } };
    };
  }) => Promise<void>;
} = createRequire(import.meta.url)("../scripts/mac-identity.mjs");

function executable(cpu = 0x0100000c) {
  const binary = Buffer.alloc(96, 0xab);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(cpu, 4);
  binary.writeUInt32LE(0, 8);
  binary.writeUInt32LE(2, 16);
  binary.writeUInt32LE(48, 20);
  binary.writeUInt32LE(0x8000001c, 32);
  binary.writeUInt32LE(24, 36);
  binary.writeUInt32LE(0x1b, 56);
  binary.writeUInt32LE(24, 60);
  return binary;
}

test("apps sharing an Electron executable receive different UUIDs without changing other bytes", () => {
  const original = executable();
  const sqlstudio = rewriteMachOUuid(original, "dev.sqlstudio.desktop:0.1.0");
  const mypost = rewriteMachOUuid(original, "dev.mypost.desktop:0.1.0");
  assert.notDeepEqual(sqlstudio.subarray(64, 80), mypost.subarray(64, 80));
  assert.notDeepEqual(sqlstudio.subarray(64, 80), original.subarray(64, 80));
  assert.deepEqual(sqlstudio.subarray(0, 64), original.subarray(0, 64));
  assert.deepEqual(sqlstudio.subarray(80), original.subarray(80));
  assert.deepEqual(original, executable());
});

test("UUID assignment is reproducible and idempotent, with a different UUID per architecture", () => {
  const identity = "dev.sqlstudio.desktop:0.1.0";
  const arm = rewriteMachOUuid(executable(), identity);
  assert.deepEqual(rewriteMachOUuid(executable(), identity), arm);
  assert.deepEqual(rewriteMachOUuid(arm, identity), arm);
  const intel = rewriteMachOUuid(executable(0x01000007), identity);
  assert.notDeepEqual(arm.subarray(64, 80), intel.subarray(64, 80));
  const framework = rewriteMachOUuid(
    executable(),
    `${identity}:electron-framework`,
  );
  assert.notDeepEqual(arm.subarray(64, 80), framework.subarray(64, 80));
  assert.equal(arm[70] >> 4, 5);
  assert.equal(arm[72] >> 6, 2);
});

test("invalid or ambiguous Mach-O metadata is rejected before any bytes are changed", () => {
  const truncated = executable().subarray(0, 70);
  assert.throws(() => rewriteMachOUuid(truncated, "sqlstudio"), /Mach-O/);
  const malformed = executable();
  malformed.writeUInt32LE(0, 36);
  const before = Buffer.from(malformed);
  assert.throws(() => rewriteMachOUuid(malformed, "sqlstudio"), /Mach-O/);
  assert.deepEqual(malformed, before);
  const missing = executable();
  missing.writeUInt32LE(0x8000001c, 56);
  assert.throws(() => rewriteMachOUuid(missing, "sqlstudio"), /LC_UUID/);
  const duplicate = executable();
  duplicate.writeUInt32LE(0x1b, 32);
  assert.throws(() => rewriteMachOUuid(duplicate, "sqlstudio"), /LC_UUID/);
});

test("packaging application updates preserves the working local-network UUIDs", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sqlstudio-identity-"),
  );
  try {
    const outputs: Buffer[][] = [];
    for (const version of ["0.1.1", "0.1.2", "0.1.3"]) {
      const appOutDir = path.join(directory, version);
      const contents = path.join(appOutDir, "SQLStudio.app", "Contents");
      const main = path.join(contents, "MacOS", "SQLStudio");
      const framework = path.join(
        contents,
        "Frameworks",
        "Electron Framework.framework",
        "Versions",
        "A",
        "Electron Framework",
      );
      for (const filename of [main, framework]) {
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, executable());
      }
      await afterPack({
        electronPlatformName: "darwin",
        appOutDir,
        packager: {
          appInfo: {
            id: "dev.sqlstudio.desktop",
            version,
            productFilename: "SQLStudio",
          },
          info: { framework: { version: "44.6.0" } },
        },
      });
      outputs.push(
        await Promise.all([fs.readFile(main), fs.readFile(framework)]),
      );
    }
    assert.equal(
      outputs[0][0].subarray(64, 80).toString("hex"),
      "d2bde567dc8d549a92278611f9e95d7d",
    );
    assert.equal(
      outputs[0][1].subarray(64, 80).toString("hex"),
      "92b6114ec80f52919123eea7a583d8dd",
    );
    assert.deepEqual(
      outputs[1],
      outputs[0],
      "changing app version must preserve executable and framework identities",
    );
    assert.deepEqual(
      outputs[2],
      outputs[0],
      "subsequent updates must preserve those identities too",
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
