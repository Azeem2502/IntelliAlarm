import os
import joblib
import json
import sqlite3
import asyncio
import time
import pandas as pd
import paho.mqtt.client as mqtt
from fastapi import FastAPI, WebSocket, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = joblib.load("intellialarm_risk_model.pkl")

connected_websockets = []
active_alerts = {}   # key = zone_id, value = alert dict
main_loop = None
ws_lock = None

DEFAULT_SENSORS = {
    "OT": {
        "zone": "OT",
        "name": "Operation Theatre",
        "voltage": 230.0,
        "current": 1.2,
        "power_watts": 276.0,
        "fault_type": "nominal",
        "tier": "Normal",
        "criticality": "Life Safety",
        "is_online": True,
        "timestamp": datetime.now().isoformat(timespec="seconds")
    },
    "ICU": {
        "zone": "ICU",
        "name": "Intensive Care Unit",
        "voltage": 230.0,
        "current": 0.9,
        "power_watts": 207.0,
        "fault_type": "nominal",
        "tier": "Normal",
        "criticality": "Life Safety",
        "is_online": True,
        "timestamp": datetime.now().isoformat(timespec="seconds")
    },
    "ER": {
        "zone": "ER",
        "name": "Emergency Room",
        "voltage": 228.0,
        "current": 1.5,
        "power_watts": 342.0,
        "fault_type": "nominal",
        "tier": "Normal",
        "criticality": "Critical",
        "is_online": True,
        "timestamp": datetime.now().isoformat(timespec="seconds")
    },
}
latest_sensors = {}

db = sqlite3.connect("intellialarm_history.db", check_same_thread=False)
db.execute("""
CREATE TABLE IF NOT EXISTS alert_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone TEXT, fault_type TEXT, tier TEXT,
    created_at TEXT, status TEXT,
    engaged_by TEXT, engaged_at TEXT,
    completed_by TEXT, completed_at TEXT,
    criticality TEXT,
    priority_score REAL,
    occupancy INTEGER,
    timestamp REAL
)
""")

# Ensure columns exist if migrating existing DB
for col, col_type in [("criticality", "TEXT"), ("priority_score", "REAL"), ("occupancy", "INTEGER"), ("timestamp", "REAL")]:
    try:
        db.execute(f"ALTER TABLE alert_log ADD COLUMN {col} {col_type}")
    except Exception:
        pass

db.execute("""
CREATE TABLE IF NOT EXISTS login_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    technician_id TEXT,
    logged_in_at TEXT,
    device_info TEXT,
    status TEXT
)
""")
db.commit()

RISK_RANK = {"High": 3, "Medium": 2, "Low": 1}
ZONE_RANK = {"Life Safety": 3, "Critical": 2, "Equipment": 1, "Equipment Safety": 1}

def priority_key(fault):
    """
    User-specified priority tuple:
    1. RISK_RANK[risk_tier]: High (3) > Medium (2) > Low (1)
    2. ZONE_RANK[zone_criticality]: Life Safety (3) > Critical (2) > Equipment (1)
    3. occupancy: 1 (occupied) ranks above 0 (vacant)
    4. -timestamp: earlier timestamp ranks first (when sorted with reverse=True)
    """
    tier = fault.get("risk_tier") or fault.get("tier", "Low")
    crit = fault.get("zone_criticality") or fault.get("criticality", "Equipment")
    if crit == "Equipment Safety":
        crit = "Equipment"
    occ = int(fault.get("occupancy", 0))
    ts = fault.get("timestamp")
    if ts is None:
        try:
            ts = datetime.fromisoformat(fault.get("created_at", "")).timestamp()
        except Exception:
            ts = 0.0
    return (
        RISK_RANK.get(tier, 1),
        ZONE_RANK.get(crit, 1),
        occ,
        -float(ts),
    )

def get_sorted_active_alerts():
    """Returns active alerts sorted by user priority_key in reverse=True order."""
    return sorted(list(active_alerts.values()), key=priority_key, reverse=True)

def default_zone_criticality(zone: str) -> str:
    """Standard healthcare safety branch assignment."""
    if zone in ["OT", "OR"]:
        return "Life Safety"
    elif zone == "ICU":
        return "Life Safety"
    elif zone == "ER":
        return "Critical"
    elif zone in ["Imaging", "Radiology"]:
        return "Equipment"
    return "Critical"

# ---------------------------------------------------------
# Weight Configuration for the Formula:
# RiskScore = CategoryWeight * FaultWeight * Severity + Occupancy + Backup + Time
# ---------------------------------------------------------
CAT_WEIGHTS = {
    "Life Safety": 5.0,    # OT, ICU, Life Support
    "Critical": 3.0,       # ER, Trauma, Acute Care
    "Equipment": 1.5       # Imaging, Radiology, HVAC
}

FAULT_WEIGHTS = {
    "short_circuit": 5.0,  # Arc flash, fire hazard
    "outage": 4.5,         # Complete blackout
    "earth_leakage": 4.0,  # Electric shock risk in medical areas
    "overload": 3.5,       # Cable overheating & failure
    "voltage_surge": 2.5,  # Equipment stress
    "voltage_sag": 2.0     # Power brownout
}

BACKUP_WEIGHTS = {
    "on_backup": 3.0,      # Running on secondary UPS/generator (vulnerable)
    "on_mains": 0.0        # Running on standard grid
}

TIME_WEIGHTS = {
    "surgery-hours": 3.0,  # High-stakes daytime surgeries (08:00 - 18:00)
    "night": 2.0,          # Reduced emergency response staff
    "day": 1.0             # Normal working hours
}

OCCUPANCY_WEIGHT = 3.0     # Active patient / clinical presence
MAX_RAW_SCORE = 34.0       # (5.0 * 5.0 * 1.0) + 3.0 + 3.0 + 3.0

def evaluate_risk(event: dict) -> dict:
    """Evaluates risk tier using ML model and the formula:
    RiskScore = CategoryWeight * FaultWeight * Severity + Occupancy + Backup + Time
    """
    raw_criticality = event.get("zone_criticality") or default_zone_criticality(event.get("zone_id", ""))
    if raw_criticality in ["Equipment", "Equipment Safety"]:
        criticality = "Equipment"
    elif raw_criticality == "Life Safety":
        criticality = "Life Safety"
    else:
        criticality = "Critical"

    fault_type = event.get("fault_type", "voltage_sag")
    severity = float(event.get("severity_raw", 0.5))
    occupancy = int(event.get("occupancy", 1))
    backup = event.get("backup_status", "on_mains")
    time_bucket = event.get("time_bucket", "day")

    # Formula Calculation
    cw = CAT_WEIGHTS.get(criticality, 1.5)
    fw = FAULT_WEIGHTS.get(fault_type, 2.0)
    occ_w = OCCUPANCY_WEIGHT if occupancy else 0.0
    bk_w = BACKUP_WEIGHTS.get(backup, 0.0)
    tm_w = TIME_WEIGHTS.get(time_bucket, 1.0)

    raw_score = (cw * fw * severity) + occ_w + bk_w + tm_w
    risk_score = round((raw_score / MAX_RAW_SCORE) * 100.0, 1)

    # ML Model Prediction for Risk Tier
    row = pd.DataFrame([{
        "zone_criticality": criticality,
        "fault_type": fault_type,
        "severity_raw": severity,
        "occupancy": occupancy,
        "time_bucket": time_bucket,
        "backup_status": backup
    }])
    row = pd.get_dummies(row).reindex(columns=model.feature_names_in_, fill_value=0)
    ml_predicted_tier = model.predict(row)[0]

    # Clinical Safety Guardrail Override:
    # Life Safety branch with severe short circuit or blackout must never drop below High
    final_tier = ml_predicted_tier
    if criticality == "Life Safety" and fault_type in ["short_circuit", "outage"] and severity >= 0.4:
        final_tier = "High"

    return {
        "tier": final_tier,
        "criticality": criticality,
        "priority_score": risk_score,
        "risk_score": risk_score,
        "raw_score": round(raw_score, 2),
        "breakdown": {
            "category_weight": cw,
            "fault_weight": fw,
            "severity": severity,
            "occupancy_weight": occ_w,
            "backup_weight": bk_w,
            "time_weight": tm_w
        }
    }

def load_active_alerts_from_db():
    cursor = db.execute("""
        SELECT id, zone, fault_type, tier, created_at, status, engaged_by, completed_by, criticality, priority_score, occupancy, timestamp
        FROM alert_log
        WHERE id IN (
            SELECT MAX(id) FROM alert_log WHERE status IN ('open', 'engaged') GROUP BY zone
        )
    """)
    for r in cursor.fetchall():
        zone_crit = r[8] or default_zone_criticality(r[1])
        if zone_crit == "Equipment Safety":
            zone_crit = "Equipment"
        tier = r[3]
        occ = r[10] if (len(r) > 10 and r[10] is not None) else 1
        ts = r[11] if (len(r) > 11 and r[11] is not None) else 0.0
        if not ts and r[4]:
            try:
                ts = datetime.fromisoformat(r[4]).timestamp()
            except Exception:
                ts = 0.0

        active_alerts[r[1]] = {
            "id": r[0],
            "zone": r[1],
            "fault_type": r[2],
            "tier": tier,
            "risk_tier": tier,
            "created_at": r[4],
            "status": r[5],
            "engaged_by": r[6],
            "completed_by": r[7],
            "criticality": zone_crit,
            "zone_criticality": zone_crit,
            "priority_score": r[9] if r[9] is not None else 100.0,
            "occupancy": occ,
            "timestamp": ts
        }
    print(f"Loaded {len(active_alerts)} active alerts from DB: {list(active_alerts.keys())}")

def predict_risk(event: dict) -> str:
    return evaluate_risk(event)["tier"]

async def broadcast_alerts():
    global ws_lock
    if ws_lock is None:
        ws_lock = asyncio.Lock()

    async with ws_lock:
        sorted_data = get_sorted_active_alerts()
        merged_sensors = dict(DEFAULT_SENSORS)
        merged_sensors.update(latest_sensors)
        payload = json.dumps({
            "type": "alerts",
            "data": sorted_data,
            "sensors": list(merged_sensors.values()),
            "server_time": datetime.now().isoformat(timespec="seconds"),
        })
        for ws in list(connected_websockets):
            try:
                await ws.send_text(payload)
            except Exception:
                try:
                    connected_websockets.remove(ws)
                except ValueError:
                    pass

def notify_broadcast():
    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast_alerts(), main_loop)
    else:
        try:
            asyncio.run(broadcast_alerts())
        except Exception:
            pass

def parse_sensor_payload(topic: str, payload_bytes: bytes) -> dict:
    try:
        text = payload_bytes.decode('utf-8', errors='replace').strip()
        data = json.loads(text)
    except Exception as e:
        print(f"[MQTT] Failed to decode JSON from {topic}: {e} (raw: {payload_bytes[:60]})", flush=True)
        return None

    # 1. Determine Zone: check 'zone', 'zone_id', or deduce from topic like 'intellialarm/sensors/OT'
    zone = data.get("zone") or data.get("zone_id")
    if not zone:
        parts = topic.split("/")
        for p in parts:
            if p.upper() in ["OT", "ICU", "ER", "IMAGING", "RADIOLOGY"]:
                zone = p.upper()
                break
    if not zone:
        zone = "OT"

    zone = zone.strip().upper()
    if zone == "OR":
        zone = "OT"

    # 2. Extract or Infer Fault Type & Severity
    voltage = data.get("voltage")
    current = data.get("current")
    explicit_fault = data.get("fault_type")

    if explicit_fault:
        fault_type = explicit_fault
        severity = float(data.get("severity_raw", 0.65))
    elif voltage is not None or current is not None:
        v = float(voltage) if voltage is not None else 1200.0
        c = float(current) if current is not None else 0.0

        # Infer fault based on real electrical parameters
        if v <= 300.0:
            fault_type = "outage"
            severity = 0.95
        elif c >= 7.0:
            fault_type = "short_circuit"
            severity = 0.95
        elif c >= 3.0:
            fault_type = "overload"
            severity = round(min(0.95, max(0.5, (c / 6.0) * 0.9)), 2)
        elif v < 900.0:
            fault_type = "voltage_sag"
            severity = round(min(0.85, max(0.4, (1200.0 - v) / 800.0)), 2)
        elif v > 1350.0:
            fault_type = "voltage_surge"
            severity = round(min(0.90, max(0.4, (v - 1200.0) / 800.0)), 2)
        elif c > 1.2:
            fault_type = "overload"
            severity = 0.50
        else:
            fault_type = "voltage_sag"
            severity = 0.35
    else:
        fault_type = "unknown"
        severity = float(data.get("severity_raw", 0.5))

    # 3. Occupancy & Criticality
    criticality = data.get("zone_criticality") or default_zone_criticality(zone)
    occupancy = int(data.get("occupancy", 1 if zone in ["OT", "ICU"] else 0))
    backup_status = data.get("backup_status", "on_mains")
    time_bucket = data.get("time_bucket", "surgery-hours" if zone in ["OT", "ICU"] else "day")

    event = {
        "zone_id": zone,
        "zone": zone,
        "zone_criticality": criticality,
        "fault_type": fault_type,
        "severity_raw": severity,
        "occupancy": occupancy,
        "backup_status": backup_status,
        "time_bucket": time_bucket,
        "voltage": voltage,
        "current": current,
        "timestamp": data.get("timestamp") or round(time.time(), 2)
    }
    return event

def on_message(client, userdata, msg):
    try:
        # Ignore buzzer command topics to avoid loops and parse errors
        if "/buzzer" in msg.topic:
            return

        event = parse_sensor_payload(msg.topic, msg.payload)
        if not event:
            return

        risk_info = evaluate_risk(event)
        tier = risk_info["tier"]
        criticality = risk_info["criticality"]
        priority_score = risk_info["priority_score"]

        zone = event["zone_id"]
        fault_type = event.get("fault_type", "unknown")
        occupancy = int(event.get("occupancy", 0))
        ts = event.get("timestamp")
        now = datetime.now().isoformat(timespec="seconds")
        if ts is None:
            ts = round(time.time(), 2)

        cursor = db.execute(
            "INSERT INTO alert_log (zone, fault_type, tier, created_at, status, criticality, priority_score, occupancy, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (zone, fault_type, tier, now, "open", criticality, priority_score, occupancy, ts)
        )
        db.commit()
        alert_id = cursor.lastrowid

        active_alerts[zone] = {
            "id": alert_id,
            "zone": zone,
            "fault_type": fault_type,
            "tier": tier,
            "risk_tier": tier,
            "criticality": criticality,
            "zone_criticality": criticality,
            "priority_score": priority_score,
            "occupancy": occupancy,
            "timestamp": ts,
            "created_at": now,
            "status": "open",
            "engaged_by": None,
            "completed_by": None
        }

        # Update real-time sensor telemetry dictionary
        v = round(float(event["voltage"]), 2) if event.get("voltage") is not None else 230.0
        c = round(float(event["current"]), 2) if event.get("current") is not None else 0.0
        p = round((v * c) if v < 1000 else (v / 1000.0) * c * 230.0, 1)

        zone_names = {
            "OT": "Operation Theatre",
            "ICU": "Intensive Care Unit",
            "ER": "Emergency Room",
            "IMAGING": "Radiology & Imaging",
        }

        latest_sensors[zone] = {
            "zone": zone,
            "name": zone_names.get(zone, zone),
            "voltage": v,
            "current": c,
            "power_watts": p,
            "fault_type": fault_type,
            "tier": tier,
            "criticality": criticality,
            "timestamp": now,
            "last_seen_ts": time.time(),
            "is_online": True,
        }

        sort_tuple = priority_key(active_alerts[zone])
        print(f"[MQTT] Received from {msg.topic}: {zone} [{fault_type.upper()}] Tier: {tier}, Zone: {criticality}, Occ: {occupancy}, Score: {priority_score} -> Key: {sort_tuple}", flush=True)

        # Publish evaluated risk tier to the ESP32 buzzer topic
        try:
            buzzer_payload = json.dumps({"risk": tier, "zone": zone, "fault_type": fault_type})
            client.publish(f"intellialarm/buzzer/{zone}", buzzer_payload)
            print(f"[MQTT] Published buzzer control -> intellialarm/buzzer/{zone}: {buzzer_payload}", flush=True)
        except Exception as b_err:
            print(f"[MQTT ERROR] Failed to publish buzzer payload: {b_err}", flush=True)

        notify_broadcast()
    except Exception as err:
        print(f"[MQTT ERROR] Processing message from {msg.topic}: {err}", flush=True)

def on_connect(client, userdata, flags, rc, properties=None):
    print("MQTT connected to broker. Subscribing to intellialarm/#, esp32/#, sensors/# ...", flush=True)
    client.subscribe([("intellialarm/#", 0), ("esp32/#", 0), ("sensors/#", 0)])

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

heartbeat_task = None

async def websocket_heartbeat_loop():
    """Broadcasts live sensors and alerts every 2 seconds to keep all mobile WebSockets warm and connected."""
    while True:
        try:
            await asyncio.sleep(2.0)
            if connected_websockets:
                await broadcast_alerts()
        except asyncio.CancelledError:
            break
        except Exception:
            pass

@app.on_event("startup")
async def startup_event():
    global main_loop, heartbeat_task
    main_loop = asyncio.get_running_loop()
    load_active_alerts_from_db()
    try:
        mqtt_client.connect("localhost", 1883)
        mqtt_client.loop_start()
    except Exception as e:
        print(f"Failed to connect to MQTT: {e}", flush=True)

    heartbeat_task = asyncio.create_task(websocket_heartbeat_loop())

@app.on_event("shutdown")
async def shutdown_event():
    global heartbeat_task
    if heartbeat_task:
        heartbeat_task.cancel()
    mqtt_client.loop_stop()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_websockets.append(websocket)
    await broadcast_alerts()
    try:
        while True:
            msg = await websocket.receive_text()
            try:
                command = json.loads(msg)
            except Exception:
                continue

            if command.get("type") == "ping" or command.get("action") == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "time": datetime.now().isoformat(timespec="seconds")}))
                continue

            zone = command.get("zone")
            now = datetime.now().isoformat(timespec="seconds")

            if zone not in active_alerts:
                continue
            alert_id = active_alerts[zone]["id"]

            if command["action"] == "engage":
                active_alerts[zone]["status"] = "engaged"
                active_alerts[zone]["engaged_by"] = command.get("technician")
                db.execute("UPDATE alert_log SET status='engaged', engaged_by=?, engaged_at=? WHERE id=?",
                           (command.get("technician"), now, alert_id))
                db.commit()
                await broadcast_alerts()

            elif command["action"] == "silence":
                # Explicitly silence the buzzer without completing the alert
                try:
                    mqtt_client.publish(f"intellialarm/buzzer/{zone}", json.dumps({"risk": "Normal", "zone": zone}))
                    print(f"[MQTT] Silenced buzzer for zone {zone}", flush=True)
                except Exception as s_err:
                    print(f"[MQTT ERROR] Failed to silence buzzer: {s_err}", flush=True)

            elif command["action"] == "complete":
                active_alerts[zone]["status"] = "completed"
                active_alerts[zone]["completed_by"] = command.get("technician")
                db.execute("UPDATE alert_log SET status='completed', completed_by=?, completed_at=? WHERE id=?",
                           (command.get("technician"), now, alert_id))
                db.commit()
                del active_alerts[zone]
                # Turn off the buzzer when alert is cleared
                try:
                    mqtt_client.publish(f"intellialarm/buzzer/{zone}", json.dumps({"risk": "Normal", "zone": zone}))
                    print(f"[MQTT] Cleared alert & silenced buzzer for zone {zone}", flush=True)
                except Exception as s_err:
                    print(f"[MQTT ERROR] Failed to silence buzzer on complete: {s_err}", flush=True)
                await broadcast_alerts()
    except Exception:
        pass
    finally:
        try:
            connected_websockets.remove(websocket)
        except ValueError:
            pass

@app.get("/history")
def get_history():
    rows = db.execute("SELECT zone, fault_type, tier, created_at, status, engaged_by, engaged_at, completed_by, completed_at, criticality, priority_score, occupancy, timestamp FROM alert_log ORDER BY id DESC LIMIT 100").fetchall()
    cols = ["zone", "fault_type", "tier", "created_at", "status", "engaged_by", "engaged_at", "completed_by", "completed_at", "criticality", "priority_score", "occupancy", "timestamp"]
    return [dict(zip(cols, r)) for r in rows]

@app.get("/alerts")
def get_alerts():
    return get_sorted_active_alerts()

@app.get("/sensors")
def get_sensors():
    merged = dict(DEFAULT_SENSORS)
    merged.update(latest_sensors)
    esp32_active = any((time.time() - s.get("last_seen_ts", 0)) < 30 for s in latest_sensors.values())
    return {
        "status": "online",
        "esp32_connected": esp32_active,
        "sensors": list(merged.values()),
        "last_updated": datetime.now().isoformat(timespec="seconds"),
    }

class LoginPayload(BaseModel):
    technician_id: str
    device_info: str = "Web Client"

ADMIN_PASSCODE = "admin123"

class AdminVerifyPayload(BaseModel):
    passcode: str

@app.post("/verify-admin")
def verify_admin(payload: AdminVerifyPayload):
    if payload.passcode == ADMIN_PASSCODE:
        return {"authorized": True, "role": "admin"}
    raise HTTPException(status_code=401, detail="Invalid admin passcode")

@app.post("/login")
def record_login(payload: LoginPayload):
    now = datetime.now().isoformat(timespec="seconds")
    cursor = db.execute(
        "INSERT INTO login_log (technician_id, logged_in_at, device_info, status) VALUES (?, ?, ?, ?)",
        (payload.technician_id, now, payload.device_info, "active")
    )
    db.commit()
    return {"status": "success", "id": cursor.lastrowid, "technician_id": payload.technician_id, "logged_in_at": now}

@app.get("/login-history")
def get_login_history(admin_key: str = Query(default=None)):
    if admin_key != ADMIN_PASSCODE:
        raise HTTPException(status_code=403, detail="Admin authorization required to access login history")
    rows = db.execute(
        "SELECT id, technician_id, logged_in_at, device_info, status FROM login_log ORDER BY id DESC LIMIT 50"
    ).fetchall()
    cols = ["id", "technician_id", "logged_in_at", "device_info", "status"]
    return [dict(zip(cols, r)) for r in rows]

@app.delete("/login-history")
def clear_login_history(admin_key: str = Query(default=None)):
    if admin_key != ADMIN_PASSCODE:
        raise HTTPException(status_code=403, detail="Admin authorization required to clear login history")
    db.execute("DELETE FROM login_log")
    db.commit()
    return {"status": "cleared"}

@app.get("/")
def home():
    return {
        "status": "IntelliAlarm backend is running",
        "priority_key": "RISK_RANK[risk_tier], ZONE_RANK[zone_criticality], occupancy, -timestamp",
        "active_alerts": len(active_alerts)
    }

@app.get("/download-apk")
@app.get("/download-apk-v2")
def download_apk():
    apk_release = r"C:\Users\mohda\Downloads\IntelliAlarm-main\IntelliAlarm-main\app\android\app\build\outputs\apk\release\app-release.apk"
    apk_debug = r"C:\Users\mohda\Downloads\IntelliAlarm-main\IntelliAlarm-main\app\android\app\build\outputs\apk\debug\app-debug.apk"
    target = apk_release if os.path.exists(apk_release) else (apk_debug if os.path.exists(apk_debug) else None)
    if target:
        headers = {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
        return FileResponse(target, media_type="application/vnd.android.package-archive", filename="IntelliAlarm_v1.1.0.apk", headers=headers)
    return {"status": "compiling", "message": "APK is currently compiling. Please wait a moment and refresh."}

@app.get("/download-esp32-code")
def download_esp32_code():
    ino_path = r"C:\Users\mohda\Downloads\IntelliAlarm-main\IntelliAlarm-main\esp32_s3_firmware\esp32_s3_firmware.ino"
    if os.path.exists(ino_path):
        return FileResponse(ino_path, media_type="text/plain", filename="esp32_s3_firmware.ino")
    raise HTTPException(status_code=404, detail="Firmware sketch not found")

@app.get("/risk-formula")
def get_risk_formula():
    return {
        "formula": "RiskScore = CategoryWeight * FaultWeight * Severity + Occupancy + Backup + Time",
        "category_weights": CAT_WEIGHTS,
        "fault_weights": FAULT_WEIGHTS,
        "backup_weights": BACKUP_WEIGHTS,
        "time_weights": TIME_WEIGHTS,
        "occupancy_weight": OCCUPANCY_WEIGHT,
        "max_raw_score": MAX_RAW_SCORE,
        "tiers": {
            "High": "RiskScore >= 60.0",
            "Medium": "35.0 <= RiskScore < 60.0",
            "Low": "RiskScore < 35.0"
        }
    }

class EvaluateRiskPayload(BaseModel):
    zone_criticality: str = "Life Safety"
    fault_type: str = "short_circuit"
    severity_raw: float = 0.5
    occupancy: int = 1
    backup_status: str = "on_mains"
    time_bucket: str = "surgery-hours"

@app.post("/evaluate-risk")
def api_evaluate_risk(payload: EvaluateRiskPayload):
    return evaluate_risk(payload.dict())