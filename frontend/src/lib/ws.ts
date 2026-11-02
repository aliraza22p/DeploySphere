/**
 * WebSocket client for live events (documented in docs/WEBSOCKET.md).
 *
 * - Connects to /ws/events with the access token
 * - Auto-reconnects with exponential backoff (max 15s)
 * - Sends application-level pings to keep the connection warm
 */

import { tokens } from "./api";

export type WsEventType =
  | "connected"
  | "metric.sample"
  | "alert.created"
  | "alert.updated"
  | "pipeline.run.updated"
  | "deployment.updated"
  | "application.health"
  | "log.created"
  | "pong";

export interface WsEvent {
  type: WsEventType;
  payload: Record<string, unknown>;
}

type Handler = (event: WsEvent) => void;

const PING_INTERVAL_MS = 25_000;

export class EventsClient {
  private socket: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private backoff = 1000;
  private pingTimer: number | null = null;
  private closedByUser = false;
  private attempt = 0;

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = tokens.access;
    if (!token) return;
    this.closedByUser = false;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/events?token=${encodeURIComponent(token)}`;

    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.backoff = 1000;
      this.attempt = 0;
      this.pingTimer = window.setInterval(() => {
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send("ping");
        }
      }, PING_INTERVAL_MS);
    };

    this.socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as WsEvent;
        if (event.type === "pong") return;
        this.handlers.forEach((handler) => handler(event));
      } catch {
        /* ignore malformed frames */
      }
    };

    this.socket.onclose = () => {
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  private scheduleReconnect() {
    this.attempt += 1;
    const delay = Math.min(this.backoff, 15_000);
    this.backoff = Math.min(this.backoff * 1.7, 15_000);
    window.setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delay + Math.random() * 400 * this.attempt);
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    this.connect();
    return () => {
      this.handlers.delete(handler);
    };
  }

  close() {
    this.closedByUser = true;
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export const eventsClient = new EventsClient();
