import paho.mqtt.client as mqtt
import time

def on_message(client, userdata, msg):
    print(f"[{msg.topic}] -> {msg.payload.decode('utf-8', errors='replace')}", flush=True)

def on_connect(client, userdata, flags, rc, properties=None):
    print("Connected. Listening to '#' for 25s...", flush=True)
    client.subscribe("#")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message
client.connect("localhost", 1883)
client.loop_start()
time.sleep(25)
client.loop_stop()
