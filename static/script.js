// --- GLOBAL VARIABLES ---
let videoStream = null;
let recognitionInterval = null;
let html5QrCode = null;
const charts = {}; // Manages all Chart.js instances
let analyticsDataCache = null; // Cache data for CSV export
const mainView = document.getElementById('mainView');

// --- PWA SERVICE WORKER REGISTRATION (Essential for Offline) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // The service worker file must be in the static folder
    navigator.serviceWorker.register('/static/sw.js') 
      .then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      })
      .catch(err => {
        console.log('ServiceWorker registration failed: ', err);
      });
  });
}

// --- CUSTOM MODALS (Replaces browser alerts) ---
function showAlertModal(title, message) {
    document.getElementById('alertModalTitle').textContent = title;
    document.getElementById('alertModalMessage').textContent = message;
    document.getElementById('alertModal').style.display = 'flex';
}

function closeAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
}

function closeQrModal() {
    document.getElementById('qrModal').style.display = 'none';
    stopCamera();
    showPage('dashboard');
}


// --- DYNAMIC PAGE LOADER ---
function showPage(pageId) {
    stopAllProcesses();
    const template = document.getElementById(`${pageId}-template`);
    if (template) {
        mainView.innerHTML = '';
        mainView.appendChild(template.content.cloneNode(true));
        
        // Handle different layout for the Analytics Page
        mainView.style.display = (pageId === 'analyticsPage') ? 'block' : 'flex';

        // Run page-specific logic
        if (pageId === 'liveAttendancePage') startLiveCamera();
        else if (pageId === 'qrScannerPage') startQrScanner();
        else if (pageId === 'analyticsPage') renderAnalytics();
        else if (pageId === 'attendanceRecord') renderAttendance();
    }
}

function stopAllProcesses() {
    stopCamera();
    stopQrScanner();
}

// --- CAMERA & QR CONTROLS ---
async function startCamera(containerId) {
    if (videoStream) return;
    
    // Select elements
    const container = document.getElementById(containerId);
    const video = document.getElementById('video');
    const overlayCanvas = document.getElementById('overlayCanvas');
    
    if (!container || !video || !overlayCanvas) { 
        console.error("Camera elements not found!"); 
        return; 
    }
    
    // Move video and canvas to the current container
    container.appendChild(video); 
    container.appendChild(overlayCanvas);
    
    video.style.display = 'block'; 
    overlayCanvas.style.display = 'block';
    
    try {
        // Request the environment camera first (back camera on mobile)
        videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment' 
            } 
        });
        video.srcObject = videoStream;
        // Wait for video to load before drawing
        await new Promise(resolve => video.onloadedmetadata = resolve);
        
    } catch (err) { 
        console.error("Could not access webcam (tried environment):", err);
        // Fallback to user-facing camera
        try {
             videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
             video.srcObject = videoStream;
             await new Promise(resolve => video.onloadedmetadata = resolve);
        } catch (err) {
            showAlertModal("Camera Error", "Could not access any camera. Please check permissions.");
            return;
        }
    }
}

function stopCamera() {
    const video = document.getElementById('video');
    const overlayCanvas = document.getElementById('overlayCanvas');
    
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (recognitionInterval) {
        clearInterval(recognitionInterval);
        recognitionInterval = null;
    }
    
    // Hide and move elements back to body (to clean up the current view)
    if (video) video.style.display = 'none';
    if (overlayCanvas) {
        overlayCanvas.style.display = 'none';
        overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    document.body.appendChild(video);
    document.body.appendChild(overlayCanvas);
}

// --- QR SCANNER ---
function startQrScanner() {
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    const resultDiv = document.getElementById('qr-scan-result');
    
    try {
        html5QrCode = new Html5Qrcode("qr-reader");
        const successCallback = async (decodedText) => {
            // Stop scanner immediately after first successful read
            if (html5QrCode && html5QrCode.isScanning) html5QrCode.stop().catch(err => console.warn("Stop error:", err));
            
            resultDiv.textContent = `Scanned ID: ${decodedText}. Verifying...`;
            resultDiv.className = 'status-box'; // Reset status
            
            const response = await fetch('/qr_scan', {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: decodedText })
            });
            const result = await response.json();
            
            if (response.ok) {
                resultDiv.className = 'status-box status-success';
                resultDiv.textContent = `SUCCESS: ${result.message}`;
            } else {
                resultDiv.className = 'status-box status-error';
                resultDiv.textContent = `ERROR: ${result.message}`;
            }
            
            // Re-enable scanner after a short delay for next scan
            setTimeout(() => {
                resultDiv.textContent = "Waiting for next scan...";
                if (html5QrCode) html5QrCode.start({ facingMode: "environment" }, config, successCallback).catch(err => console.error("Restart error:", err));
            }, 3000); 
        };
        // Start with environment camera
        html5QrCode.start({ facingMode: "environment" }, config, successCallback).catch(err => {
             showAlertModal("QR Camera Error", "Could not access back camera for QR scanning. Falling back to user camera.");
             // Fallback to user camera
             html5QrCode.start({ facingMode: "user" }, config, successCallback);
        });
    } catch (e) { 
        showAlertModal("QR Scanner Initialization Error", "The QR scanner failed to start. Check library loading or camera access.");
        console.error("QR Scanner failed to start:", e);
    }
}

function stopQrScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.warn("QR scanner stop error:", err));
    }
    html5QrCode = null;
}

// --- AUTHENTICATION ---
async function register() {
    const username = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPass').value;
    if (password !== document.getElementById('regCPass').value) return showAlertModal("Error", "Passwords do not match!");
    if (!username || !password) return showAlertModal("Error", "Username and Password cannot be empty!");
    
    const response = await fetch('/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const result = await response.json();
    showAlertModal(response.ok ? "Success" : "Error", result.message);
    if (response.ok) showPage('loginPage');
}

async function login() {
    const username = document.getElementById('loginName').value.trim();
    const password = document.getElementById('loginPass').value;
    if (!username || !password) return showAlertModal("Error", "Username and Password cannot be empty!");
    
    const response = await fetch('/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const result = await response.json();
    
    if (response.ok) showPage('dashboard');
    else showAlertModal("Login Failed", result.message);
}

function logout() { showPage('loginPage'); }

// --- STUDENT ENROLLMENT ---
function startEnrollmentCamera() { startCamera('webcam-container'); }

async function saveStudent() {
    const studentName = document.getElementById('stuName').value.trim();
    if (!studentName) return showAlertModal("Error", "Student name cannot be empty.");
    if (studentName.includes(' ')) return showAlertModal("Error", "Student name cannot have spaces.");
    if (!videoStream) return showAlertModal("Error", "Please start the camera first.");

    // 1. Capture image from video stream
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataURL = canvas.toDataURL('image/jpeg', 0.8); // Use 0.8 quality for smaller, faster transfer

    // 2. Call backend to enroll
    const response = await fetch('/enroll', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentName, imageDataURL: imageDataURL }),
    });
    const result = await response.json();
    
    // 3. Display result
    if (response.ok) {
        document.getElementById('qrModalTitle').textContent = `Student ${studentName} Enrolled!`;
        document.getElementById('qrModalImage').src = result.qrCode;
        document.getElementById('qrModal').style.display = 'flex';
    } else { 
        showAlertModal("Enrollment Failed", result.message); 
    }
}

// --- LIVE ATTENDANCE (Optimized for faster UI update) ---
function startLiveCamera() {
    startCamera('live-webcam-container');
    
    // Use requestAnimationFrame for smoother video frame capture, but API call is still timed
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const overlayCtx = overlayCanvas.getContext('2d');
    const statusDiv = document.getElementById('recognition-status');
    
    let lastApiCall = 0;
    const recognitionRate = 2000; // 2 seconds delay between API calls
    
    function gameLoop(timestamp) {
        if (!videoStream) return;
        
        // 1. Draw video frame to hidden canvas
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
             canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        }

        // 2. Only call API every X milliseconds
        if (timestamp - lastApiCall > recognitionRate) {
            lastApiCall = timestamp;
            
            // Show scanning status immediately
            if (!statusDiv.textContent.includes('...')) {
                 statusDiv.textContent = "Processing frame...";
                 statusDiv.className = 'status-box';
            }
            
            // Trigger API call (fire-and-forget for speed)
            const imageDataURL = canvas.toDataURL('image/jpeg', 0.7); // Low quality for max speed
            fetch('/recognize', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageDataURL })
            })
            .then(res => res.json())
            .then(recognizedFaces => {
                // 3. Draw bounding boxes on overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                const knownNames = new Set();
                
                recognizedFaces.forEach(face => {
                    const [top, right, bottom, left] = face.location;
                    const isKnown = face.name !== "Unknown";
                    
                    overlayCtx.strokeStyle = isKnown ? 'var(--color-success)' : 'var(--color-danger)';
                    overlayCtx.lineWidth = 3;
                    overlayCtx.strokeRect(left, top, right - left, bottom - top);
                    
                    // Draw name tag
                    overlayCtx.fillStyle = overlayCtx.strokeStyle;
                    overlayCtx.fillRect(left, bottom, right - left, 30);
                    overlayCtx.fillStyle = 'white';
                    overlayCtx.font = '16px Inter';
                    overlayCtx.fillText(face.name, left + 5, bottom + 20);
                    
                    if (isKnown) knownNames.add(face.name);
                });
                
                // 4. Update status display
                if (knownNames.size > 0) {
                    statusDiv.textContent = `Present: ${[...knownNames].join(', ')}`;
                    statusDiv.className = 'status-box status-success';
                } else {
                    statusDiv.textContent = recognizedFaces.length > 0 ? "Face detected, unknown..." : "Scanning...";
                    statusDiv.className = 'status-box';
                }
            })
            .catch(err => {
                console.error("Recognition API error:", err);
                statusDiv.textContent = "Network Error. Check connection.";
                statusDiv.className = 'status-box status-error';
            });
        }
        
        // Continue the loop
        requestAnimationFrame(gameLoop);
    }
    
    // Start the game loop
    requestAnimationFrame(gameLoop);
}


// --- PROFESSIONAL ANALYTICS FUNCTIONS ---

function createOrUpdateChart(chartId, type, data, options = {}) {
    const ctx = document.getElementById(chartId)?.getContext('2d');
    if (!ctx) return;
    
    if (charts[chartId]) {
        charts[chartId].destroy();
    }
    
    charts[chartId] = new Chart(ctx, { type, data, options });
}

async function renderAnalytics(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    const response = await fetch(`/analytics?${query}`);
    const data = await response.json();
    analyticsDataCache = data; // Cache the data

    // Populate student filter dropdown (only on first load)
    const studentFilter = document.getElementById('studentFilter');
    if (studentFilter && studentFilter.options.length <= 1) {
        // Add an "All Students" option
        studentFilter.innerHTML = '<option value="">All Students</option>';
        data.allStudents.forEach(name => {
            studentFilter.innerHTML += `<option value="${name}">${name}</option>`;
        });
    }

    // Update KPI Cards (using updated property names from app.py)
    document.getElementById('totalStudentsPresent').textContent = data.summary.totalStudentsPresent || 0;
    document.getElementById('totalDaysInPeriod').textContent = data.summary.totalDaysInPeriod || 0;
    document.getElementById('totalRecords').textContent = data.summary.totalRecords || 0;
    document.getElementById('busiestDay').textContent = data.summary.busiestDay || 'N/A';
    
    // --- Create/Update Charts ---
    
    // 1. Attendance Trend by Date (Line Chart)
    createOrUpdateChart('dateChart', 'line', {
        labels: data.byDate.map(d => d.Date),
        datasets: [{ 
            label: 'Total Records per Day', 
            data: data.byDate.map(d => d.count), 
            borderColor: 'rgb(0, 123, 255)', 
            backgroundColor: 'rgba(0, 123, 255, 0.1)',
            tension: 0.3,
            fill: true
        }]
    }, {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
    });

    // 2. Attendance Percentage per Student (Bar Chart)
    createOrUpdateChart('studentChart', 'bar', {
        labels: data.byStudent.map(s => s.Name),
        datasets: [{ 
            label: 'Attendance %', 
            data: data.byStudent.map(s => s.Percentage), 
            backgroundColor: data.byStudent.map(s => s.Percentage > 75 ? 'var(--color-success)' : 'var(--color-secondary)'),
            borderWidth: 1
        }]
    }, { 
        indexAxis: 'y', // Horizontal bars for better readability
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: 'Attendance Percentage' } } }
    });
    
    // 3. Attendance by Source (Pie Chart)
    createOrUpdateChart('sourceChart', 'pie', {
        labels: data.bySource.map(s => s.Source),
        datasets: [{ 
            label: 'Attendance Source', 
            data: data.bySource.map(s => s.count), 
            backgroundColor: ['var(--color-success)', 'var(--color-secondary)'],
            hoverOffset: 4
        }]
    });

    // Populate details table
    const detailsTable = document.querySelector('#detailsTable tbody');
    if(detailsTable) {
        detailsTable.innerHTML = '';
        data.details.forEach(rec => {
            detailsTable.innerHTML += `<tr><td>${rec.ID}</td><td>${rec.Name}</td><td>${rec.Date}</td><td>${rec.Timestamp}</td><td>${rec.Source}</td></tr>`;
        });
    }
}

function applyAnalyticsFilters() {
    const filters = {
        student: document.getElementById('studentFilter').value,
        start_date: document.getElementById('startDate').value,
        end_date: document.getElementById('endDate').value
    };
    // Remove empty filters
    Object.keys(filters).forEach(key => filters[key] === '' && delete filters[key]);
    renderAnalytics(filters);
}

function resetAnalyticsFilters() {
    document.getElementById('studentFilter').value = '';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    renderAnalytics();
}

function exportAnalyticsToCSV() {
    if (!analyticsDataCache || analyticsDataCache.details.length === 0) {
        showAlertModal("Export Error", "No data to export. Apply filters or ensure records exist.");
        return;
    }
    const headers = "ID,Name,Date,Timestamp,Source\n";
    // Sanitize data (remove commas/newlines) before joining
    const rows = analyticsDataCache.details.map(rec => 
        `"${rec.ID}","${rec.Name}","${rec.Date}","${rec.Timestamp}","${rec.Source}"`
    ).join("\n");
    
    const csvContent = "data:text/csv;charset=utf-8," + headers + rows;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "attendance_report.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// --- SIMPLE ATTENDANCE RECORD PAGE ---
async function renderAttendance() {
    const response = await fetch('/records');
    const records = await response.json();
    const tbody = document.getElementById('attendanceTable');
    tbody.innerHTML = "";
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No attendance records found.</td></tr>';
        return;
    }
    records.forEach(rec => {
        tbody.innerHTML += `<tr><td>${rec.ID}</td><td>${rec.Name}</td><td>${rec.Date}</td><td><span class="status-present">${rec.Status}</span></td><td>${rec.Timestamp}</td><td>${rec.Source || 'N/A'}</td></tr>`;
    });
}

// --- INITIAL LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    showPage('createAccount');
});
