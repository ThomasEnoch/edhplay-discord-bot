import { randomUUID } from "node:crypto";

export interface PodOptions {
  guildId: string;
  channelId: string;
  hostId: string;
  title: string;
  format: string;
  maxPlayers: number;
  /** Scheduled start as epoch ms, or null for an instant ("now") pod. */
  scheduledAt: number | null;
  voice: boolean;
  bracket?: number | null;
  proxiesOk?: boolean;
  restrictions?: string[];
  description?: string | null;
}

export type PodStatus = "open" | "launched" | "cancelled";
export type JoinResult = "seated" | "waitlisted" | "already-in";

export interface LeaveResult {
  left: boolean;
  promoted: string | null;
}

/** Flat, JSON-serialisable form of a Pod for persistence. */
export interface PodSnapshot {
  id: string;
  messageId: string | null;
  roomId: string | null;
  voiceChannelId: string | null;
  status: PodStatus;
  reminderSent: boolean;
  launchedAt: number | null;
  launchFailures: number;
  nextPodId: string | null;
  seats: string[];
  waitlist: string[];
  opts: PodOptions;
}

export class Pod {
  readonly id = randomUUID().slice(0, 8);
  messageId: string | null = null;
  roomId: string | null = null;
  voiceChannelId: string | null = null;
  status: PodStatus = "open";
  reminderSent = false;
  /** Epoch ms the pod launched, or null while still open. Drives cleanup. */
  launchedAt: number | null = null;
  /** Consecutive failed auto-launch attempts; bounded so we don't retry forever. */
  launchFailures = 0;
  /** Id of the "one more game" pod spawned from this one, if any. */
  nextPodId: string | null = null;

  /** Discord user IDs in join order; index 0 is the host. */
  readonly seats: string[] = [];
  readonly waitlist: string[] = [];
  readonly opts: PodOptions;

  constructor(opts: PodOptions) {
    this.opts = opts;
    this.seats.push(opts.hostId);
  }

  /** Rebuild a Pod from a persisted snapshot, preserving its original id. */
  static restore(s: PodSnapshot): Pod {
    const pod = new Pod(s.opts);
    (pod as { id: string }).id = s.id; // id is readonly post-construction
    pod.seats.length = 0;
    pod.seats.push(...s.seats);
    pod.waitlist.push(...s.waitlist);
    pod.messageId = s.messageId;
    pod.roomId = s.roomId;
    pod.voiceChannelId = s.voiceChannelId;
    pod.status = s.status;
    pod.reminderSent = s.reminderSent;
    pod.launchedAt = s.launchedAt;
    pod.launchFailures = s.launchFailures;
    pod.nextPodId = s.nextPodId ?? null;
    return pod;
  }

  get isFull(): boolean {
    return this.seats.length >= this.opts.maxPlayers;
  }

  get isInstant(): boolean {
    return this.opts.scheduledAt === null;
  }

  has(userId: string): boolean {
    return this.seats.includes(userId) || this.waitlist.includes(userId);
  }

  /** Seat a user, or waitlist them if the pod is full. */
  join(userId: string): JoinResult {
    if (this.has(userId)) return "already-in";
    if (this.isFull) {
      this.waitlist.push(userId);
      return "waitlisted";
    }
    this.seats.push(userId);
    return "seated";
  }

  /**
   * Remove a user. If a seat opened and the waitlist is non-empty, auto-promote
   * the next person and return their ID so the caller can ping them.
   */
  leave(userId: string): LeaveResult {
    const seatIdx = this.seats.indexOf(userId);
    if (seatIdx !== -1) {
      this.seats.splice(seatIdx, 1);
      const promoted = this.waitlist.shift() ?? null;
      if (promoted) this.seats.push(promoted);
      return { left: true, promoted };
    }
    const waitIdx = this.waitlist.indexOf(userId);
    if (waitIdx !== -1) {
      this.waitlist.splice(waitIdx, 1);
      return { left: true, promoted: null };
    }
    return { left: false, promoted: null };
  }

  /**
   * Mark the pod cancelled. Returns everyone who was in it (seated + waitlisted)
   * so the caller can notify them. No-op-safe: only an open pod can be cancelled.
   */
  cancel(): string[] {
    const notify = [...this.seats, ...this.waitlist];
    this.status = "cancelled";
    return notify;
  }

  /**
   * Build a fresh "one more game" pod: same settings and roster, new id, open
   * and instant (starts now). The caller posts and launches it.
   */
  rematch(): Pod {
    const next = new Pod({ ...this.opts, scheduledAt: null });
    next.seats.length = 0;
    next.seats.push(...this.seats);
    next.waitlist.push(...this.waitlist);
    return next;
  }

  toSnapshot(): PodSnapshot {
    return {
      id: this.id,
      messageId: this.messageId,
      roomId: this.roomId,
      voiceChannelId: this.voiceChannelId,
      status: this.status,
      reminderSent: this.reminderSent,
      launchedAt: this.launchedAt,
      launchFailures: this.launchFailures,
      nextPodId: this.nextPodId,
      seats: [...this.seats],
      waitlist: [...this.waitlist],
      opts: this.opts,
    };
  }
}
