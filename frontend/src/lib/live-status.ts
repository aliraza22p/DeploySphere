import { useEffect, useSyncExternalStore } from "react";

export type LiveStatus = "connecting" | "connected" | "disconnected";

type Listener = () => void;

/** Singleton WebSocket connection shared by the whole app. */
class LiveClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private status: LiveStatus = "connecting";
  private attempts = 0;
  private timer: number | null = null;
  private token: string | null = null;

  setToken(token: string | null) {
    if (token === this.token) return;
    this.token = token;
    this.attempts = 0;
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (token) this.connect();
    else this.disconnect();
  }

  getStatus(): LiveStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(status: LiveStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((l) => l());
  }

  private connect() {
    if (!this.token || this.ws) return;
    this.setStatus("connecting");
    try {
      const backendUrl = new URL(
        import.meta.env.VITE_API_BASE_URL || window.location.origin,
      );
      backendUrl.protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
      backendUrl.pathname = "/ws/events";
      backendUrl.search = `token=${encodeURIComponent(this.token)}`;
      const url = backendUrl.toString();
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.attempts = 0;
        this.setStatus("connected");
      };
      ws.onmessage = (event) => {
        // Server events arrive as { type, payload } and are re-dispatched as
        // `deploy:<type>` CustomEvents for useServerEvent() subscribers.
        try {
          const msg = JSON.parse(String(event.data)) as { type?: string; payload?: unknown };
          if (msg.type) {
            window.dispatchEvent(
              new CustomEvent(`deploy:${msg.type}`, { detail: msg.payload }),
            );
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.token || this.timer) return;
    this.attempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts, 5));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private disconnect() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
    this.setStatus("disconnected");
  }
}

export const liveClient = new LiveClient();

/** Re-render whenever the connection status changes. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (cb) => liveClient.subscribe(cb),
    () => liveClient.getStatus(),
    () => "connecting" as LiveStatus,
  );
}

/** Subscribe to a named server event (`telemetry`, `alert.created`, …). */
export function useServerEvent<T = unknown>(event: string, handler: (data: T) => void) {
  useEffect(() => {
    const name = `deploy:${event}`;
    const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [event, handler]);
}
