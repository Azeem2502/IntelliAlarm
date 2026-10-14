import asyncio
import websockets
import json

async def test():
    uri = "ws://localhost:8000/ws"
    async with websockets.connect(uri) as ws:
        initial = await ws.recv()
        print("Current alerts:\n", initial, "\n")

        data = json.loads(initial)
        if not data["data"]:
            print("No active alerts right now — run fake_esp32.py first, then try this again.")
            return

        zone = data["data"][0]["zone"]
        print(f"Testing with zone: {zone}\n")

        await ws.send(json.dumps({"action": "engage", "zone": zone, "technician": "TestTech"}))
        print("After ENGAGE:\n", await ws.recv(), "\n")

        await asyncio.sleep(2)

        await ws.send(json.dumps({"action": "complete", "zone": zone, "technician": "TestTech"}))
        print("After COMPLETE:\n", await ws.recv(), "\n")

asyncio.run(test())