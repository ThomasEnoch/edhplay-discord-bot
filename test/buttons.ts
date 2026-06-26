import assert from "node:assert/strict";

// embed.ts transitively loads config (needs creds) and opens the DB, so set env
// before importing it. An in-memory DB keeps this test off disk.
process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_CLIENT_ID = "test-client";
process.env.DB_PATH = ":memory:";

const { Pod } = await import("../src/pods/pod.ts");
const { buildPodButtons } = await import("../src/pods/embed.ts");

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok ${name}`);
}

function makePod() {
  return new Pod({
    guildId: "g",
    channelId: "c",
    hostId: "host",
    title: "t",
    format: "commander",
    maxPlayers: 4,
    scheduledAt: null,
    voice: false,
  });
}

// Every (non-link) button's custom_id across all rows.
function customIds(rows: ReturnType<typeof buildPodButtons>): string[] {
  return rows.flatMap((r) =>
    (r.toJSON().components as Array<{ custom_id?: string }>)
      .map((c) => c.custom_id)
      .filter((id): id is string => typeof id === "string"),
  );
}

console.log("Pod buttons");

check("open pod offers a seat", () => {
  const ids = customIds(buildPodButtons(makePod()));
  assert.ok(ids.some((id) => id.startsWith("pod:seat:")));
});

check("launched pod still offers a seat (rejoin after leaving)", () => {
  const p = makePod();
  p.status = "launched";
  p.roomId = "room1";
  const ids = customIds(buildPodButtons(p));
  assert.ok(
    ids.some((id) => id.startsWith("pod:seat:")),
    "launched pod must keep a seat button so players can rejoin",
  );
  assert.ok(ids.some((id) => id.startsWith("pod:leave:")));
});

check("full launched pod offers the waitlist", () => {
  const p = makePod();
  p.status = "launched";
  p.join("a");
  p.join("b");
  p.join("c"); // host, a, b, c = 4/4
  const ids = customIds(buildPodButtons(p));
  assert.ok(ids.some((id) => id.startsWith("pod:waitlist:")));
});

check("cancelled pod has no buttons", () => {
  const p = makePod();
  p.status = "cancelled";
  assert.equal(buildPodButtons(p).length, 0);
});

console.log(`\n${passed} checks passed.`);
