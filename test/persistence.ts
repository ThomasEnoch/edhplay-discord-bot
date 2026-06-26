import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

// The stores read config (which requires Discord creds) and open the SQLite
// database at import time, so set env BEFORE dynamically importing them.
process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_CLIENT_ID = "test-client";
const dbPath = join(tmpdir(), `edhplay-test-${process.pid}.db`);
process.env.DB_PATH = dbPath;

const { Pod } = await import("../src/pods/pod.ts");
const { podStore } = await import("../src/store/podStore.ts");
const { tokenStore } = await import("../src/store/tokenStore.ts");
const { db } = await import("../src/store/db.ts");

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok ${name}`);
}

function makePod(scheduledAt: number | null = null) {
  return new Pod({
    guildId: "g1",
    channelId: "c1",
    hostId: "host",
    title: "Persisted pod",
    format: "commander",
    maxPlayers: 4,
    scheduledAt,
    voice: true,
    bracket: 3,
    proxiesOk: true,
  });
}

try {
  console.log("podStore persistence (reload simulates a bot restart)");

  await check("add + reload rehydrates a pod with identical state", () => {
    const p = makePod(1_700_000_000_000);
    p.join("alice");
    podStore.add(p);

    podStore.load();
    const r = podStore.get(p.id);
    assert.ok(r, "pod should reload from SQLite");
    assert.equal(r.id, p.id);
    assert.deepEqual(r.seats, ["host", "alice"]);
    assert.equal(r.opts.bracket, 3);
    assert.equal(r.isInstant, false);
  });

  await check("getByMessage resolves after reload", () => {
    const p = makePod();
    p.messageId = "message-xyz";
    podStore.add(p);

    podStore.load();
    const r = podStore.getByMessage("message-xyz");
    assert.ok(r);
    assert.equal(r.id, p.id);
  });

  await check("save() persists later mutations", () => {
    const p = makePod();
    podStore.add(p);
    p.join("bob");
    podStore.save(p);

    podStore.load();
    assert.deepEqual(podStore.get(p.id)?.seats, ["host", "bob"]);
  });

  await check("remove() deletes from SQLite", () => {
    const p = makePod();
    podStore.add(p);
    const { id } = p;
    podStore.remove(id);

    podStore.load();
    assert.equal(podStore.get(id), undefined);
  });

  console.log("tokenStore persistence");

  await check("set/get/isLinked/delete round-trip", async () => {
    await tokenStore.set("user1", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 123,
    });
    assert.deepEqual(await tokenStore.get("user1"), {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 123,
    });
    assert.equal(await tokenStore.isLinked("user1"), true);

    await tokenStore.delete("user1");
    assert.equal(await tokenStore.get("user1"), undefined);
    assert.equal(await tokenStore.isLinked("user1"), false);
  });

  await check("set upserts an existing user's tokens", async () => {
    await tokenStore.set("user2", { accessToken: "a2", refreshToken: "r2", expiresAt: 1 });
    await tokenStore.set("user2", { accessToken: "a3", refreshToken: "r3", expiresAt: 2 });
    assert.equal((await tokenStore.get("user2"))?.accessToken, "a3");
  });

  console.log(`\n${passed} checks passed.`);
} finally {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(dbPath + suffix);
    } catch {
      /* temp file; ignore cleanup failure */
    }
  }
}
