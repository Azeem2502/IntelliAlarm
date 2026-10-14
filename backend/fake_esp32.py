import paho.mqtt.publish as publish
import json, random, time

zones = ["ICU", "OT", "ER"]

# Realistic healthcare hospital safety branch associations
ZONE_DEFAULT_BRANCH = {
    "OT": "Life Safety",         # Operating theatre / surgical life support
    "ICU": "Life Safety",        # Intensive care life preservation
    "ER": "Critical",            # Emergency acute care
}

while True:
    zone = random.choice(zones)
    # Default to its designated branch, with occasional variation to simulate equipment-branch issues
    branch_pool = [ZONE_DEFAULT_BRANCH.get(zone, "Critical")] * 3 + ["Equipment", "Critical", "Life Safety"]
    crit = random.choice(branch_pool)

    event = {
        "zone_id": zone,
        "zone_criticality": crit,
        "fault_type": random.choice(["outage", "overload", "voltage_sag", "voltage_surge", "short_circuit", "earth_leakage"]),
        "severity_raw": round(random.uniform(0.15, 0.95), 2),
        "occupancy": random.choice([0, 1]),
        "time_bucket": random.choice(["day", "night", "surgery-hours"]),
        "backup_status": random.choice(["on_mains", "on_backup"]),
        "timestamp": round(time.time(), 2)
    }
    publish.single("intellialarm/sensordata", json.dumps(event), hostname="localhost")
    print("Sent:", event, flush=True)
    time.sleep(3)