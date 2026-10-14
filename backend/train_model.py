import os
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
import joblib

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

# Maximum theoretical raw score = (5.0 * 5.0 * 1.0) + 3.0 + 3.0 + 3.0 = 34.0
MAX_RAW_SCORE = 34.0

def generate_hospital_dataset(n_samples: int = 10000) -> pd.DataFrame:
    """Generates synthetic clinical electrical events based on the user's RiskScore formula."""
    np.random.seed(42)
    
    zones = np.random.choice(["Life Safety", "Critical", "Equipment"], n_samples, p=[0.40, 0.35, 0.25])
    faults = np.random.choice(list(FAULT_WEIGHTS.keys()), n_samples, p=[0.20, 0.15, 0.20, 0.15, 0.15, 0.15])
    severities = np.random.uniform(0.05, 1.00, n_samples)
    occupancies = np.random.choice([0, 1], n_samples, p=[0.25, 0.75])
    backups = np.random.choice(["on_mains", "on_backup"], n_samples, p=[0.70, 0.30])
    times = np.random.choice(["day", "night", "surgery-hours"], n_samples, p=[0.45, 0.25, 0.30])

    data = []
    for z, f, s, o, b, t in zip(zones, faults, severities, occupancies, backups, times):
        cw = CAT_WEIGHTS[z]
        fw = FAULT_WEIGHTS[f]
        occ_val = OCCUPANCY_WEIGHT if o == 1 else 0.0
        bk_val = BACKUP_WEIGHTS[b]
        tm_val = TIME_WEIGHTS[t]

        # Ground truth formula:
        raw_score = (cw * fw * s) + occ_val + bk_val + tm_val
        normalized_score = round((raw_score / MAX_RAW_SCORE) * 100.0, 1)

        # Categorize into Risk Tiers:
        # High: >= 60.0 (Immediate audio/visual alert, dispatch < 3 min)
        # Medium: 35.0 - 59.9 (Elevated advisory, 15 min SLA)
        # Low: < 35.0 (Routine telemetry log)
        if normalized_score >= 60.0:
            tier = "High"
        elif normalized_score >= 35.0:
            tier = "Medium"
        else:
            tier = "Low"

        data.append({
            "zone_criticality": z,
            "fault_type": f,
            "severity_raw": round(s, 2),
            "occupancy": o,
            "time_bucket": t,
            "backup_status": b,
            "risk_score": normalized_score,
            "risk_tier": tier
        })

    return pd.DataFrame(data)

def main():
    print("=" * 60)
    print("IntelliAlarm ML Training: Formula-Based Risk Classifier")
    print("Formula: RiskScore = CategoryWeight * FaultWeight * Severity + Occupancy + Backup + Time")
    print("=" * 60)

    dataset_path = "intellialarm_training_data.csv"
    df = generate_hospital_dataset(10000)
    df.to_csv(dataset_path, index=False)
    print(f"Generated {len(df)} samples and saved to {dataset_path}")
    print("\nClass distribution:")
    print(df["risk_tier"].value_counts())

    # Features for ML Model (excluding target columns)
    X = df.drop(columns=["risk_tier", "risk_score"])
    y = df["risk_tier"]

    # One-hot encode categorical features
    X = pd.get_dummies(X)
    feature_columns = list(X.columns)
    print(f"\nModel features ({len(feature_columns)}): {feature_columns}")

    # Split dataset
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=42
    )

    # Train Random Forest Classifier
    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_split=4,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1
    )
    clf.fit(X_train, y_train)

    # Evaluate
    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print(f"\nModel Test Accuracy: {acc * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))

    # Feature Importances
    importances = pd.Series(clf.feature_importances_, index=feature_columns).sort_values(ascending=False)
    print("Top Feature Importances:")
    print(importances.head(8))

    # Save model artifact
    model_path = "intellialarm_risk_model.pkl"
    joblib.dump(clf, model_path)
    print(f"\nTrained model successfully serialized to {model_path}")

if __name__ == "__main__":
    main()