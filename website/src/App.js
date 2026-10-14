import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

function tierColor(tier) {
  if (tier === "High") return "red";
  if (tier === "Medium") return "orange";
  return "green";
}

function tierRank(tier) {
  if (tier === "High") return 0;
  if (tier === "Medium") return 1;
  return 2;
}

const zonePositions = {
  ICU: { x: 20, y: 20 },
  OT: { x: 220, y: 20 },
  Imaging: { x: 20, y: 220 },
  ER: { x: 220, y: 220 },
};

const nodeCoords = {
  nurse_station: { x: 200, y: 380 },
  corridor_a: { x: 100, y: 210 },
  corridor_b: { x: 300, y: 210 },
  ICU: { x: 100, y: 100 },
  OT: { x: 300, y: 100 },
  Imaging: { x: 100, y: 300 },
  ER: { x: 300, y: 300 },
};

const hubY = { corridor_a: 190, corridor_b: 210 };

const doorCoords = {
  ICU: { x: 180, y: 100 },
  OT: { x: 220, y: 100 },
  Imaging: { x: 180, y: 300 },
  ER: { x: 220, y: 300 },
};

function buildRoutePoints(path) {
  if (!path || path.length === 0) return [];
  const points = [];
  path.forEach((node) => {
    if (node === "nurse_station") {
      points.push({ x: 200, y: 400 });
    } else if (node === "corridor_a" || node === "corridor_b") {
      points.push({ x: 200, y: hubY[node] });
    } else if (doorCoords[node]) {
      const hub = points[points.length - 1];
      const door = doorCoords[node];
      points.push({ x: door.x, y: hub.y });
      points.push({ x: door.x, y: door.y });
    }
  });
  return points;
}

const checkpoints = ["nurse_station", "corridor_a", "corridor_b"];

function MobileView({ start }) {
  const [zones, setZones] = useState([]);
  const [selected, setSelected] = useState(null);
  const [route, setRoute] = useState(null);

  useEffect(() => {
    const fetchStatus = () => {
      fetch(`https://icy-cities-stay.loca.lt/status`)
        .then(res => res.json())
        .then(data => setZones(data))
        .catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const getDirections = (zone) => {
    setSelected(zone);
    fetch(`https://icy-cities-stay.loca.lt/route?start=${start}&target=${zone}`)
      .then(res => res.json())
      .then(data => setRoute(data))
      .catch(() => {});
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 400 }}>
      <h2>IntelliAlarm Navigation</h2>
      <p>Starting point: <b>{start.replace("_", " ")}</b></p>

      <h3>Zones by risk</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {zones.map((z, i) => (
          <li key={z.zone} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 12px", marginBottom: 8, borderRadius: 6,
            background: selected === z.zone ? "#eee" : "#fafafa",
            border: "1px solid #ddd"
          }}>
            <span>
              <b>{i + 1}. {z.zone}</b> —{" "}
              <span style={{
                color: tierColor(z.tier) === "green" ? "#2a7a2a" : tierColor(z.tier),
                fontWeight: "bold"
              }}>
                {z.tier === "green" ? "Healthy" : z.tier}
              </span>
            </span>
            <button onClick={() => getDirections(z.zone)} style={{ padding: "6px 12px" }}>
              Get directions
            </button>
          </li>
        ))}
      </ul>

      {selected && route && (
        <div style={{ marginTop: 20, padding: 12, background: "#f0f4ff", borderRadius: 6 }}>
          <h3 style={{ marginTop: 0 }}>Route to {selected}</h3>
          {route.path && route.path.length > 0 ? (
            <ol>
              {route.path.map((node, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{node.replace("_", " ")}</li>
              ))}
            </ol>
          ) : (
            <p>No route available.</p>
          )}
        </div>
      )}

      <p style={{ color: "#666", marginTop: 20 }}>
        The list above updates automatically. Tap a zone anytime to get directions from here.
      </p>
    </div>
  );
}

function Dashboard() {
  const [zoneStatus, setZoneStatus] = useState({
    ICU: "green", OT: "green", Imaging: "green", ER: "green"
  });

  const [log, setLog] = useState([]);
  const [route, setRoute] = useState(null);

  useEffect(() => {
    const socket = new WebSocket("wss://icy-cities-stay.loca.lt/ws");
    socket.onopen = () => console.log("Connected to backend");
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setZoneStatus(prev => ({ ...prev, [data.zone]: data.tier }));
      setLog(prev => [{ ...data, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
    };
    return () => socket.close();
  }, []);

  useEffect(() => {
    const fetchRoute = () => {
      fetch(`https://icy-cities-stay.loca.lt/route?start=nurse_station`)
        .then(res => res.json())
        .then(data => setRoute(data))
        .catch(() => {});
    };
    fetchRoute();
    const interval = setInterval(fetchRoute, 2000);
    return () => clearInterval(interval);
  }, []);

  const priorityOrder = Object.entries(zoneStatus)
    .map(([zone, tier]) => ({ zone, tier }))
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

  const routePoints = route && route.path ? buildRoutePoints(route.path) : [];

  return (
    <div style={{ display: "flex", padding: 20, fontFamily: "sans-serif", gap: 40, flexWrap: "wrap" }}>

      <div>
        <h2>IntelliAlarm — Live Digital Twin</h2>
        <svg viewBox="0 0 400 440" width="400" height="440" style={{ border: "1px solid #ccc" }}>
          <rect x="0" y="180" width="400" height="40" fill="#e8e8e8" />
          <rect x="180" y="0" width="40" height="400" fill="#e8e8e8" />

          {Object.entries(zonePositions).map(([zone, pos]) => (
            <g key={zone}>
              <rect x={pos.x} y={pos.y} width="160" height="160"
                fill={tierColor(zoneStatus[zone])} stroke="black" rx="8" />
              <text x={pos.x + 80} y={pos.y + 85} textAnchor="middle" fill="white" fontWeight="bold">
                {zone}
              </text>
            </g>
          ))}

          <circle cx="200" cy="400" r="8" fill="blue" />
          <text x="200" y="420" textAnchor="middle" fontSize="12">Entrance</text>

          {routePoints.length > 1 && (
            <polyline
              points={routePoints.map(p => `${p.x},${p.y}`).join(" ")}
              stroke="blue" strokeWidth="4" fill="none" strokeDasharray="6 4"
            />
          )}
        </svg>
        {route && route.target && (
          <p>Current route: entrance → <b>{route.target}</b> (risk: {route.tier})</p>
        )}
      </div>

      <div>
        <h2>Priority Queue (risk order)</h2>
        <p style={{ color: "#666", marginTop: -8 }}>
          Sorted by risk tier, not by time — this is what staff should act on first.
        </p>
        <table style={{ borderCollapse: "collapse", width: 320 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #333" }}>
              <th style={{ padding: "6px 10px" }}>Rank</th>
              <th style={{ padding: "6px 10px" }}>Zone</th>
              <th style={{ padding: "6px 10px" }}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {priorityOrder.map((item, i) => (
              <tr key={item.zone} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 10px", fontWeight: "bold" }}>{i + 1}</td>
                <td style={{ padding: "6px 10px" }}>{item.zone}</td>
                <td style={{
                  padding: "6px 10px",
                  fontWeight: "bold",
                  color: tierColor(item.tier) === "green" ? "#2a7a2a" : tierColor(item.tier)
                }}>
                  {item.tier === "green" ? "Healthy" : item.tier}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ marginTop: 30 }}>Recent Events (by time)</h3>
        <ul>
          {log.map((entry, i) => (
            <li key={i}>{entry.time} — {entry.zone}: <b>{entry.tier}</b></li>
          ))}
        </ul>
      </div>

      <div>
        <h2>Scan to navigate from a checkpoint</h2>
        {checkpoints.map(cp => (
          <div key={cp} style={{ marginBottom: 24 }}>
            <p style={{ marginBottom: 6 }}>{cp.replace("_", " ")}</p>
            <QRCodeSVG value={`${window.location.origin}${window.location.pathname}?start=${cp}`} size={120} />
          </div>
        ))}
      </div>

    </div>
  );
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start");

  if (start && checkpoints.includes(start)) {
    return <MobileView start={start} />;
  }
  return <Dashboard />;
}

export default App;