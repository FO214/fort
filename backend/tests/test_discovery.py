"""Guns find the server by UDP broadcast."""
import asyncio
import socket

from app import discovery


def _free_udp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _ask(port: int, payload: bytes) -> bytes | None:
    loop = asyncio.get_running_loop()
    got: asyncio.Future[bytes] = loop.create_future()

    class Client(asyncio.DatagramProtocol):
        def datagram_received(self, data, addr):
            if not got.done():
                got.set_result(data)

    transport, _ = await loop.create_datagram_endpoint(Client, remote_addr=("127.0.0.1", port))
    try:
        transport.sendto(payload)
        return await asyncio.wait_for(got, 0.5)
    except asyncio.TimeoutError:
        return None
    finally:
        transport.close()


def test_probe_gets_ws_port_and_junk_is_ignored():
    async def run():
        port = _free_udp_port()
        t = await discovery.start(port=port, ws_port=8123, host="127.0.0.1")
        assert t is not None
        try:
            assert await _ask(port, b"LOONIE?") == b"LOONIE 8123"
            assert await _ask(port, b"LOONIE?\n") == b"LOONIE 8123"
            assert await _ask(port, b"hello") is None
        finally:
            t.close()
    asyncio.run(run())


def test_port_in_use_does_not_crash():
    async def run():
        port = _free_udp_port()
        first = await discovery.start(port=port, host="127.0.0.1")
        try:
            assert await discovery.start(port=port, host="127.0.0.1") is None
        finally:
            first.close()
    asyncio.run(run())
