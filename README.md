# 🎓 AI Attendance System

A smart AI-based attendance system using Face Recognition and QR Backup.

## 🚀 Features
- Face Recognition Attendance
- Live Camera Feed (Flask)
- QR Code Backup System
- Excel-based Attendance Logging
- Web Dashboard UI

## 🛠️ Tech Stack
- Python (Flask)
- OpenCV
- face_recognition (dlib)
- HTML, CSS, JavaScript

## 📸 How It Works
1. Register student (face + QR generated)
2. Start live attendance
3. Face detected → attendance marked
4. If face fails → scan QR → attendance marked

## ▶️ Run Locally

```bash
pip install -r requirements.txt
python app.py
