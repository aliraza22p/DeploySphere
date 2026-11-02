"""WebSocket connection manager for live dashboard events.

Event names and payloads are documented in docs/WEBSOCKET.md and in the API
documentation served at /docs. The browser must present a valid access token
when connecting; server-published events are broadcast to every connected user.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Connection:
    socket: WebSocket
    user_email: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=200))


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: list[Connection] = []
        self._lock = asyncio.Lock()

    async def connect(self, socket: WebSocket, user_email: str) -> Connection:
        await socket.accept()
        conn = Connection(socket=socket, user_email=user_email)
        async with self._lock:
            self._connections.append(conn)
        return conn

    async def disconnect(self, conn: Connection) -> None:
        async with self._lock:
            if conn in self._connections:
                self._connections.remove(conn)

    @property
    def count(self) -> int:
        return len(self._connections)

    async def send(self, conn: Connection, event: dict) -> None:
        try:
            await conn.socket.send_json(event)
        except Exception:
            await self.disconnect(conn)

    async def broadcast(self, event: dict) -> None:
        """Fan an event out to every connected client (best effort)."""
        async with self._lock:
            targets = list(self._connections)
        for conn in targets:
            with contextlib.suppress(Exception):
                await conn.socket.send_json(event)

    async def broadcast_many(self, events: list[dict]) -> None:
        for event in events:
            await self.broadcast(event)


manager = ConnectionManager()
