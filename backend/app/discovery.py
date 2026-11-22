"""LAN discovery: guns find the server without a hard-coded IP.

A gun broadcasts the datagram b"LOONIE?" to UDP port DISCOVERY_PORT. The server
replies to the sender with b"LOONIE <ws-port>", and the gun connects to the
reply's source address on that port. Anything else is ignored.

LOONIE_DISCOVERY_PORT (default 8001) and LOONIE_PORT (default 8000, the port
uvicorn serves on) can be set in the environment.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

log = logging.getLogger("loonie.discovery")

PROBE = b"LOONIE?"
DISCOVERY_PORT = int(os.environ.get("LOONIE_DISCOVERY_PORT", "8001"))
WS_PORT = int(os.environ.get("LOONIE_PORT", "8000"))


class _Responder(asyncio.DatagramProtocol):
    def __init__(self, ws_port: int) -> None:
        self.reply = f"LOONIE {ws_port}".encode()
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        if data.strip() == PROBE and self.transport is not None:
            self.transport.sendto(self.reply, addr)


async def start(port: int = DISCOVERY_PORT, ws_port: int = WS_PORT,
                host: str = "0.0.0.0") -> Optional[asyncio.DatagramTransport]:
    """Start answering probes. Returns None (and logs) if the port is taken,
    so a second server on the same machine still runs, just undiscoverable."""
    loop = asyncio.get_running_loop()
    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _Responder(ws_port), local_addr=(host, port))
    except OSError as e:
        log.warning("discovery: UDP %d unavailable (%s); guns will need the server set by hand", port, e)
        return None
    log.info("discovery: answering on UDP %d (ws port %d)", port, ws_port)
    return transport
