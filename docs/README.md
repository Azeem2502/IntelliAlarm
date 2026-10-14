# 📊 IntelliAlarm: Presentation & Architecture Documents

This directory contains the presentation deck and architecture assets for the **IntelliAlarm** project submission.

## 📁 Presentation & Architecture Links:
* 🌐 **Public Presentation Slide Deck**: [Open in Google Drive / PPT](https://drive.google.com/file/d/1Fj_wRnzF6YVaewgPF47qo5zUa0Wdg-uG/view?usp=sharing)
* 🎥 **Public Project Demo Video**: [Watch on Google Drive](https://drive.google.com/file/d/1M1VUsUkoPwGZ2_2zd3JIyHQ_0jN4htr5/view?usp=drive_link)
* 🏗️ **System Architecture**: Available in main [README.md](../README.md#-6-system-architecture-diagram)

---

## 📑 Slide Deck Outline (For Hackathon Pitch)

* **Slide 1: Title & Team**: IntelliAlarm — AI-Powered Critical Hospital Electrical Resilience Twin (Team Members, College/Institution, Hackathon Track).
* **Slide 2: The Healthcare Crisis**: Electrical outages, brownouts, and ground leakages in hospitals leading to patient mortality in ICUs and OTs.
* **Slide 3: The Gap**: Why legacy BMS and SCADA fail — flat alarms, alarm fatigue, and lack of clinical context.
* **Slide 4: Our Solution**: End-to-end cyber-physical IoT + AI system with context-aware risk scoring and edge-to-mobile alerting.
* **Slide 5: System Architecture**: Physical ESP32-S3 sensor layer $\to$ MQTT Broker $\to$ FastAPI Backend $\to$ Machine Learning Core $\to$ Mobile App.
* **Slide 6: Mathematical Innovation**:
  $$\text{RiskScore} = (\text{CategoryWeight} \times \text{FaultWeight} \times \text{Severity}) + \text{Occupancy} + \text{Backup} + \text{Time}$$
* **Slide 7: Machine Learning Results**: Random Forest Classifier, 10,000 synthetic hospital power vectors, **99.15% Test Accuracy**, F1-score 0.98–1.00.
* **Slide 8: Live Prototype & Mobile App**: Offline-resilient React Native APK, sub-second WebSocket updates, technician audit trail.
* **Slide 9: Clinical & Financial Impact**: 80% reduction in alarm noise, sub-3-minute dispatch response, equipment damage prevention.
* **Slide 10: Scalability & Future Roadmap**: Multi-hospital federated learning, LoRaWAN expansion, integration with hospital Epic/Cerner EHR systems.
