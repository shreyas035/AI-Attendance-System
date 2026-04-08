from flask import Flask, render_template, request, jsonify
import os
import pandas as pd
import cv2
import face_recognition
import numpy as np
import base64
from datetime import datetime
import qrcode
from PIL import Image
import io

# --- INITIALIZATION & SETUP ---
app = Flask(__name__, static_url_path='/static', static_folder='static') 
KNOWN_FACES_DIR = 'known_faces'
QR_CODES_DIR = 'qrcodes'
ATTENDANCE_FILE = 'attendance_records.xlsx'
USERS_FILE = 'users.xlsx'

# Create necessary directories
for dir_path in [KNOWN_FACES_DIR, QR_CODES_DIR, 'static']:
    if not os.path.exists(dir_path): os.makedirs(dir_path)

def get_users_df():
    """Reads or creates the users DataFrame."""
    required_columns = ['Username', 'Password']
    try:
        df = pd.read_excel(USERS_FILE)
        df = df[required_columns]
    except (FileNotFoundError, KeyError):
        df = pd.DataFrame(columns=required_columns)
        df.to_excel(USERS_FILE, index=False)
    return df

# --- AUTHENTICATION ENDPOINTS ---
@app.route('/register', methods=['POST'])
def register_user():
    data = request.json
    username, password = data.get('username'), data.get('password')
    df = get_users_df()
    if username in df['Username'].values: 
        return jsonify({'status': 'error', 'message': 'Username already exists.'}), 409
    
    new_user = pd.DataFrame([{'Username': username, 'Password': str(password)}])
    df = pd.concat([df, new_user], ignore_index=True)
    df.to_excel(USERS_FILE, index=False)
    return jsonify({'status': 'success', 'message': 'Registration successful! Please login.'})

@app.route('/login', methods=['POST'])
def login_user():
    data = request.json
    username, password = data.get('username'), data.get('password')
    df = get_users_df()
    if df.empty: 
        return jsonify({'status': 'error', 'message': 'Invalid credentials.'}), 401
    
    df['Password'] = df['Password'].astype(str)
    user = df[(df['Username'] == username) & (df['Password'] == str(password))]
    
    if not user.empty: 
        return jsonify({'status': 'success', 'message': 'Login successful!'})
    else: 
        return jsonify({'status': 'error', 'message': 'Invalid credentials.'}), 401

# --- CORE ATTENDANCE LOGIC ---
def log_attendance_to_excel(student_id, source="Face Recognition"):
    """Logs attendance, preventing duplicate entries for the same day."""
    student_name = student_id 
    today_str = datetime.now().strftime("%Y-%m-%d")
    timestamp = datetime.now().strftime("%H:%M:%S")
    
    try:
        df = pd.read_excel(ATTENDANCE_FILE)
    except FileNotFoundError:
        df = pd.DataFrame(columns=['ID', 'Name', 'Date', 'Status', 'Timestamp', 'Source'])
    
    existing_entry = df[(df['ID'] == student_id) & (df['Date'] == today_str)]
    
    if existing_entry.empty:
        new_record = pd.DataFrame([{'ID': student_id, 'Name': student_name, 'Date': today_str, 'Status': 'Present', 'Timestamp': timestamp, 'Source': source}])
        df = pd.concat([df, new_record], ignore_index=True)
        print(f"✅ Logged new attendance for {student_name} via {source}.")
    else:
        print(f"ℹ️ {student_name} already marked present today.")
        
    df.to_excel(ATTENDANCE_FILE, index=False)

@app.route('/qr_scan', methods=['POST'])
def handle_qr_scan():
    data = request.json
    student_id = data.get('studentId')
    if not student_id: 
        return jsonify({'status': 'error', 'message': 'Invalid QR data.'}), 400
    
    is_enrolled = os.path.exists(os.path.join(KNOWN_FACES_DIR, f"{student_id}.jpg"))
    if not is_enrolled: 
        return jsonify({'status': 'error', 'message': f'Student {student_id} not enrolled.'}), 404
    
    log_attendance_to_excel(student_id, source="QR Scan")
    return jsonify({'status': 'success', 'message': f'Attendance marked for {student_id}!'})

# --- ENROLLMENT & FACE RECOGNITION ---
def load_known_faces():
    """Loads all known face encodings and names from the directory.
    Uses 'cnn' model for highest quality templates."""
    known_face_encodings, known_face_names = [], []
    for filename in os.listdir(KNOWN_FACES_DIR):
        if filename.endswith((".jpg", ".png")):
            image = face_recognition.load_image_file(os.path.join(KNOWN_FACES_DIR, filename))
            # CRITICAL FIX: Use 'cnn' for enrollment template creation
            encodings = face_recognition.face_encodings(image, model="cnn") 
            if encodings:
                known_face_encodings.append(encodings[0])
                known_face_names.append(os.path.splitext(filename)[0])
    return known_face_encodings, known_face_names

@app.route('/enroll', methods=['POST'])
def enroll_student():
    """Saves a captured face image and generates a QR code."""
    data = request.json
    student_id = data.get('studentId')
    image_data_url = data.get('imageDataURL')
    
    if not student_id or not image_data_url: 
        return jsonify({'status': 'error', 'message': 'Missing data.'}), 400
    
    # 1. Save Face Image
    header, encoded = image_data_url.split(",", 1)
    binary_data = base64.b64decode(encoded)
    filepath = os.path.join(KNOWN_FACES_DIR, f"{student_id}.jpg")
    with open(filepath, 'wb') as f: f.write(binary_data)
    
    # 2. Generate and Save QR Code
    qr_img = qrcode.make(student_id)
    qr_filepath = os.path.join(QR_CODES_DIR, f"{student_id}.png")
    qr_img.save(qr_filepath)
    
    # 3. Convert QR code to base64 for modal display
    buffered = io.BytesIO()
    qr_img.save(buffered, format="PNG")
    qr_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    return jsonify({'status': 'success', 'message': f'Student {student_id} enrolled successfully!', 'qrCode': f'data:image/png;base64,{qr_base64}'})

def process_image_for_recognition(image_data_url):
    """Processes a base64 image, finds faces, and identifies known ones."""
    
    # 1. Decode Base64 Data (Robust)
    try:
        header, encoded = image_data_url.split(",", 1)
        binary_data = base64.b64decode(encoded)
    except ValueError:
        return []
    
    # 2. Convert to OpenCV Frame (Robust)
    try:
        nparr = np.frombuffer(binary_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception:
        return []

    if frame is None:
        print("🔴 ERROR: Final frame is None (Decoding failed).")
        return []
    
    print(f"✅ Received frame with shape: {frame.shape}") 

    known_encodings, known_names = load_known_faces()
    
    # Use BGR to RGB conversion for face_recognition library
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # CRITICAL: Use 'cnn' model on the full image frame for highest detection accuracy
    face_locations = face_recognition.face_locations(rgb_frame, model="cnn") 
    face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
    
    recognized_faces = []
    
    if not face_locations:
        print("🟡 Face_recognition did not find any face in the image.")
        return []

    for loc, face_encoding in zip(face_locations, face_encodings):
        name = "Unknown"
        if known_names:
            # CRITICAL FIX: Ensure the face encoding is float64 for stable comparison
            face_encoding_array = np.array(face_encoding, dtype=np.float64) 
            
            # Match against known faces (now guaranteed to be CNN-encoded)
            matches = face_recognition.compare_faces(known_encodings, face_encoding_array, tolerance=0.6)
            face_distances = face_recognition.face_distance(known_encodings, face_encoding_array)
            best_match_index = np.argmin(face_distances)
            
            if matches[best_match_index]:
                name = known_names[best_match_index]

        # Locations (loc) are already in full resolution
        recognized_faces.append({"name": name, "location": list(loc)})
    return recognized_faces

@app.route('/recognize', methods=['POST'])
def recognize_and_log():
    image_data_url = request.json.get('imageDataURL')
    if not image_data_url: return jsonify([]), 400
    
    recognized_faces = process_image_for_recognition(image_data_url)
    
    for face in recognized_faces:
        if face["name"] != "Unknown": log_attendance_to_excel(face["name"])
        
    return jsonify(recognized_faces)

# --- PROFESSIONAL ANALYTICS ENDPOINT (UNCHANGED) ---
@app.route('/analytics', methods=['GET'])
def get_analytics():
    try:
        df = pd.read_excel(ATTENDANCE_FILE)
    except FileNotFoundError:
        return jsonify({'allStudents': [], 'summary': {}, 'byDate': [], 'byStudent': [], 'bySource': [], 'details': []})

    if df.empty:
        return jsonify({'allStudents': [], 'summary': {}, 'byDate': [], 'byStudent': [], 'bySource': [], 'details': []})

    all_students = df['Name'].unique().tolist()
    
    # --- Apply Filters ---
    df_filtered = df.copy()
    student_filter = request.args.get('student')
    start_date_filter = request.args.get('start_date')
    end_date_filter = request.args.get('end_date')

    if student_filter:
        df_filtered = df_filtered[df_filtered['Name'] == student_filter]
        
    if start_date_filter:
        df_filtered = df_filtered[df_filtered['Date'] >= start_date_filter]
        
    if end_date_filter:
        df_filtered = df_filtered[df_filtered['Date'] <= end_date_filter]

    if df_filtered.empty: 
        return jsonify({
            'allStudents': all_students, 'summary': {'totalStudentsPresent': 0, 'totalDaysInPeriod': 0, 'totalRecords': 0, 'busiestDay': 'N/A'}, 
            'byDate': [], 'byStudent': [], 'bySource': [], 'details': []
        })

    # --- Calculations on Filtered Data ---
    total_students_present = df_filtered['ID'].nunique()
    all_unique_days = df_filtered['Date'].unique()
    total_days_in_period = len(all_unique_days)
    total_records_in_filter = len(df_filtered)
    busiest_day = df_filtered['Date'].mode()[0] if not df_filtered['Date'].mode().empty else 'N/A'

    # 1. By Date (Attendance count per day)
    by_date = df_filtered.groupby('Date').size().reset_index(name='count').to_dict('records')
    
    # 2. By Student (Attendance Percentage)
    attendance_days_per_student = df_filtered.groupby('Name')['Date'].nunique().reset_index()
    attendance_days_per_student.rename(columns={'Date': 'DaysAttended'}, inplace=True)
    
    if total_days_in_period > 0:
        attendance_days_per_student['Percentage'] = round((attendance_days_per_student['DaysAttended'] / total_days_in_period) * 100, 2)
    else:
        attendance_days_per_student['Percentage'] = 0
        
    by_student = attendance_days_per_student.to_dict('records')
    
    # 3. By Source (Pie Chart)
    by_source = df_filtered.groupby('Source').size().reset_index(name='count').to_dict('records')

    return jsonify({
        'allStudents': all_students,
        'summary': {
            'totalStudentsPresent': total_students_present, 
            'totalDaysInPeriod': total_days_in_period, 
            'totalRecords': total_records_in_filter,
            'busiestDay': busiest_day
        },
        'byDate': by_date,
        'byStudent': by_student,
        'bySource': by_source,
        'details': df_filtered.to_dict('records')
    })

# --- UTILITY ENDPOINTS (UNCHANGED) ---
@app.route('/records', methods=['GET'])
def get_records():
    """Returns all raw attendance records."""
    try: 
        df = pd.read_excel(ATTENDANCE_FILE)
        df['Date'] = df['Date'].astype(str)
        return jsonify(df.to_dict('records'))
    except FileNotFoundError: 
        return jsonify([])

@app.route('/')
def index(): 
    """Renders the main HTML page."""
    return render_template('index.html')

# --- LOCAL DEVELOPMENT RUN BLOCK (UNCHANGED) ---
if __name__ == '__main__': 
    app.run(debug=True, port=int(os.environ.get('PORT', 5000)))
