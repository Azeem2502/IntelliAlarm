"""
IntelliAlarm Background Service Manager
Automatically starts and monitors:
1. MQTT Broker (amqtt on 0.0.0.0:1883)
2. FastAPI Backend (uvicorn on 0.0.0.0:8000)
If either service stops or crashes, it automatically restarts it.
"""

import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PYTHON_EXE = sys.executable

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

def start_broker():
    return subprocess.Popen(
        [PYTHON_EXE, "run_broker.py"],
        cwd=str(BACKEND_DIR),
        creationflags=CREATE_NO_WINDOW
    )

def start_backend():
    return subprocess.Popen(
        [PYTHON_EXE, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=str(BACKEND_DIR),
        creationflags=CREATE_NO_WINDOW
    )

def main():
    print("[IntelliAlarm] Service Manager starting background servers...")
    broker_proc = start_broker()
    time.sleep(1.5)
    backend_proc = start_backend()

    try:
        while True:
            time.sleep(3)
            # Auto-restart broker if stopped
            if broker_proc.poll() is not None:
                print("[IntelliAlarm] Broker process exited. Restarting...")
                broker_proc = start_broker()

            # Auto-restart backend if stopped
            if backend_proc.poll() is not None:
                print("[IntelliAlarm] Backend process exited. Restarting...")
                backend_proc = start_backend()

    except (KeyboardInterrupt, SystemExit):
        if broker_proc.poll() is None:
            broker_proc.terminate()
        if backend_proc.poll() is None:
            backend_proc.terminate()

if __name__ == "__main__":
    main()
