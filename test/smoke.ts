import assert from "node:assert/strict";
import { Pod } from "../src/pods/pod.ts";
import { podCustomId, parsePodCustomId } from "../src/pods/ids.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok ${name}`);
}

function newPod(maxPlayers = 4, scheduledAt: number | null = null) {
  return new Pod({
    guildId: "g",
    channelId: "c",
    hostId: "host",
    title: "Test pod",
    format: "commander",
    maxPlayers,
    scheduledAt,
    voice: true,
  });
}

console.log("Pod seating logic");

check("host is auto-seated in seat 0", () => {
  const p = newPod();
  assert.deepEqual(p.seats, ["host"]);
  assert.equal(p.isFull, false);
});

check("players fill open seats then overflow to waitlist", () => {
  const p = newPod(4);
  assert.equal(p.join("a"), "seated");
  assert.equal(p.join("b"), "seated");
  assert.equal(p.join("c"), "seated");
  assert.equal(p.isFull, true);
  assert.equal(p.join("d"), "waitlisted");
  assert.deepEqual(p.seats, ["host", "a", "b", "c"]);
  assert.deepEqual(p.waitlist, ["d"]);
});

check("double-join is rejected (seat or waitlist)", () => {
  const p = newPod(2);
  p.join("a");
  assert.equal(p.join("a"), "already-in");
  p.join("b");
  assert.equal(p.join("b"), "already-in");
});

check("leaving a seat auto-promotes the next waitlisted player", () => {
  const p = newPod(2);
  p.join("a");
  p.join("b");
  p.join("c");
  const r = p.leave("a");
  assert.equal(r.left, true);
  assert.equal(r.promoted, "b");
  assert.deepEqual(p.seats, ["host", "b"]);
  assert.deepEqual(p.waitlist, ["c"]);
});

check("leaving from the waitlist removes without promotion", () => {
  const p = newPod(2);
  p.join("a");
  p.join("b");
  const r = p.leave("b");
  assert.equal(r.left, true);
  assert.equal(r.promoted, null);
  assert.deepEqual(p.waitlist, []);
});

check("leaving when not present is a no-op", () => {
  const p = newPod();
  const r = p.leave("nobody");
  assert.equal(r.left, false);
  assert.equal(r.promoted, null);
});

check("instant vs scheduled flag", () => {
  assert.equal(newPod(4, null).isInstant, true);
  assert.equal(newPod(4, Date.now() + 1000).isInstant, false);
});

console.log("Pod cancel");

check("cancel sets status and returns seated + waitlisted", () => {
  const p = newPod(2);
  p.join("a"); // seats: host, a (full)
  p.join("b"); // waitlist: b
  p.join("c"); // waitlist: b, c
  const notify = p.cancel();
  assert.deepEqual(notify, ["host", "a", "b", "c"]);
  assert.equal(p.status, "cancelled");
});

console.log("Pod snapshot round-trip");

check("toSnapshot/restore preserves identity and state", () => {
  const p = newPod(4, 1_700_000_000_000);
  p.join("a");
  p.join("b");
  p.messageId = "msg1";
  p.roomId = "room1";
  p.status = "launched";
  p.launchedAt = 999;
  p.reminderSent = true;

  const restored = Pod.restore(p.toSnapshot());
  assert.equal(restored.id, p.id);
  assert.deepEqual(restored.seats, ["host", "a", "b"]);
  assert.deepEqual(restored.waitlist, []);
  assert.equal(restored.messageId, "msg1");
  assert.equal(restored.roomId, "room1");
  assert.equal(restored.status, "launched");
  assert.equal(restored.launchedAt, 999);
  assert.equal(restored.reminderSent, true);
  assert.equal(restored.isInstant, false);
  assert.equal(restored.opts.maxPlayers, 4);
});

console.log("Button custom_id round-trip");

check("round-trips action + pod id", () => {
  const id = "ab12cd34";
  for (const action of ["seat", "waitlist", "leave", "launch"]) {
    const parsed = parsePodCustomId(podCustomId(action, id));
    assert.deepEqual(parsed, { action, podId: id });
  }
});

check("rejects malformed ids", () => {
  assert.equal(parsePodCustomId("not-a-pod-button"), null);
  assert.equal(parsePodCustomId("pod:seat:"), null);
  assert.equal(parsePodCustomId("other:seat:abc"), null);
});

console.log(`\n${passed} checks passed.`);
