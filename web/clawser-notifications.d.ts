/**
 * Type definitions for clawser-notifications.js
 * Centralized notification system with batching and permission flow.
 */

// ── Notification Types ──────────────────────────────────────────

export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface NotificationPreferences {
  info: boolean;
  warning: boolean;
  error: boolean;
  success: boolean;
}

export interface QuietHoursConfig {
  start: number;
  end: number;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: unknown | null;
  timestamp: number;
}

// ── NotificationManager ─────────────────────────────────────────

export declare class NotificationManager {
  constructor(opts?: {
    batchWindow?: number;
    onNotify?: (notif: Notification) => void;
    preferences?: Partial<NotificationPreferences>;
    quietHours?: QuietHoursConfig | null;
  });

  /** Per-type notification preferences. */
  get preferences(): NotificationPreferences;

  /** Get current quiet hours config or null. */
  getQuietHours(): QuietHoursConfig | null;

  /** Set quiet hours config, or null to disable. */
  setQuietHours(config: QuietHoursConfig | null): void;

  /** Update a single type preference. */
  setPreference(type: NotificationType, enabled: boolean): void;

  /** Set the notification delivery callback. */
  set onNotify(fn: ((notif: Notification) => void) | null);

  /** Number of pending (undelivered batched) notifications. */
  get pending(): number;

  /** Enqueue a notification. */
  notify(opts: {
    type?: NotificationType;
    title?: string;
    body?: string;
    data?: unknown;
  }): void;

  /** List all notifications in history. */
  list(): Notification[];

  /** Dismiss (remove) a notification by ID. */
  dismiss(id: string): void;

  /** Clear all notifications. */
  clear(): void;

  /** Force-deliver all batched notifications immediately. */
  flush(): void;

  /** Request browser notification permission. */
  requestPermission(): Promise<'granted' | 'denied' | 'unavailable'>;
}
