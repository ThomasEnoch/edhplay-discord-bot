import { Pod } from "../pods/pod.js";
import { db } from "./db.js";

// In-memory cache of active pods (keyed by id, and indexed by Discord message id
// for fast button routing) with write-through to SQLite. The cache is the
// runtime source of truth; SQLite is what lets pods survive a bot restart.
//
// Call load() once on startup to rehydrate the cache.

const upsertStmt = db.prepare(
  `INSERT INTO pods (id, message_id, data) VALUES (@id, @messageId, @data)
   ON CONFLICT(id) DO UPDATE SET message_id = @messageId, data = @data`,
);
const deleteStmt = db.prepare("DELETE FROM pods WHERE id = ?");
const allStmt = db.prepare("SELECT data FROM pods");

class PodStore {
  private byId = new Map<string, Pod>();
  private byMessage = new Map<string, string>(); // messageId -> podId

  /** Rehydrate the cache from SQLite. Call once on startup. */
  load(): void {
    this.byId.clear();
    this.byMessage.clear();
    for (const row of allStmt.all() as { data: string }[]) {
      const pod = Pod.restore(JSON.parse(row.data));
      this.byId.set(pod.id, pod);
      if (pod.messageId) this.byMessage.set(pod.messageId, pod.id);
    }
  }

  private persist(pod: Pod): void {
    upsertStmt.run({
      id: pod.id,
      messageId: pod.messageId,
      data: JSON.stringify(pod.toSnapshot()),
    });
  }

  add(pod: Pod): void {
    this.byId.set(pod.id, pod);
    if (pod.messageId) this.byMessage.set(pod.messageId, pod.id);
    this.persist(pod);
  }

  /** Persist a pod's current state after mutating it (seats, status, etc.). */
  save(pod: Pod): void {
    if (pod.messageId) this.byMessage.set(pod.messageId, pod.id);
    this.persist(pod);
  }

  get(podId: string): Pod | undefined {
    return this.byId.get(podId);
  }

  getByMessage(messageId: string): Pod | undefined {
    const id = this.byMessage.get(messageId);
    return id ? this.byId.get(id) : undefined;
  }

  remove(podId: string): void {
    const pod = this.byId.get(podId);
    if (pod?.messageId) this.byMessage.delete(pod.messageId);
    this.byId.delete(podId);
    deleteStmt.run(podId);
  }

  all(): Pod[] {
    return [...this.byId.values()];
  }
}

export const podStore = new PodStore();
