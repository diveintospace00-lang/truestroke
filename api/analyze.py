from flask import Flask, request, jsonify
import json
import os
import tempfile
import cv2
import mediapipe as mp
import numpy as np
import requests

app = Flask(__name__)

# Config variable for the LLM
LLM_MODEL = "deepseek/deepseek-chat-v3.1:free"

def analyze_video_logic(video_url):
    # Download the video to a temp file
    temp_video_path = tempfile.mktemp(suffix=".mp4")
    try:
        response = requests.get(video_url, stream=True)
        response.raise_for_status()
        with open(temp_video_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
    except Exception as e:
        return {"error": f"Failed to download video: {str(e)}"}

    # Initialize MediaPipe Pose
    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=1, smooth_landmarks=True)
    
    cap = cv2.VideoCapture(temp_video_path)
    if not cap.isOpened():
        return {"error": "Failed to open video."}

    landmarks_list = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(image)
        
        if results.pose_landmarks:
            landmarks_list.append(results.pose_landmarks.landmark)

    cap.release()
    pose.close()
    os.remove(temp_video_path)

    if len(landmarks_list) < 5:
        return {"error": "Could not detect enough pose data in the video. Ensure the entire body is visible."}

    # --- METRIC CALCULATION ---
    def calculate_angle(a, b, c):
        a = np.array([a.x, a.y])
        b = np.array([b.x, b.y])
        c = np.array([c.x, c.y])
        radians = np.arctan2(c[1]-b[1], c[0]-b[0]) - np.arctan2(a[1]-b[1], a[0]-b[0])
        angle = np.abs(radians*180.0/np.pi)
        if angle > 180.0:
            angle = 360 - angle
        return angle

    wrist_y = [lm[mp_pose.PoseLandmark.LEFT_WRIST.value].y for lm in landmarks_list]
    top_index = np.argmin(wrist_y) 
    impact_index = np.argmax(wrist_y) 

    if impact_index < top_index:
        impact_index = min(len(landmarks_list)-1, top_index + 5)

    top_lm = landmarks_list[top_index]
    impact_lm = landmarks_list[impact_index]

    shoulder = impact_lm[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
    hip = impact_lm[mp_pose.PoseLandmark.LEFT_HIP.value]
    knee = impact_lm[mp_pose.PoseLandmark.LEFT_KNEE.value]
    spine_angle = calculate_angle(shoulder, hip, knee)

    left_hip = top_lm[mp_pose.PoseLandmark.LEFT_HIP.value]
    right_hip = top_lm[mp_pose.PoseLandmark.RIGHT_HIP.value]
    hip_rotation = abs(np.arctan2(left_hip.y - right_hip.y, left_hip.x - right_hip.x) * 180.0 / np.pi)

    left_shoulder_imp = impact_lm[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
    left_wrist_imp = impact_lm[mp_pose.PoseLandmark.LEFT_WRIST.value]
    left_hip_imp = impact_lm[mp_pose.PoseLandmark.LEFT_HIP.value]
    arm_extension = calculate_angle(left_shoulder_imp, left_hip_imp, left_wrist_imp)

    metrics = {
        "spine_angle_impact": round(spine_angle, 1),
        "hip_rotation_top": round(hip_rotation, 1),
        "arm_extension_impact": round(arm_extension, 1)
    }

    # --- LLM ANALYSIS ---
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        return {"error": "OPENROUTER_API_KEY not set in environment."}

    prompt = f"""You are an expert PGA golf coach. I have extracted biomechanical data from a right-handed golfer's swing video using computer vision.
    Here are the key metrics:
    - Spine Angle at Impact (degrees from vertical, 180 is standing straight up): {metrics['spine_angle_impact']}
    - Hip Rotation at Top of Backswing (degrees from horizontal, 0 is parallel to target line): {metrics['hip_rotation_top']}
    - Arm Extension at Impact (angle between shoulder, hip, and wrist, 180 is fully extended): {metrics['arm_extension_impact']}

    Based strictly on these metrics, provide a brief summary, identify 2 critical flaws, and provide 2 specific drills to fix them. Format your response EXACTLY like this, using HTML tags:

    SUMMARY:
    <p>your summary here</p>

    FLAWS:
    <ul><li>flaw 1</li><li>flaw 2</li></ul>

    DRILLS:
    <ul><li>drill 1</li><li>drill 2</li></ul>"""

    try:
        llm_response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": LLM_MODEL,
                "messages": [{"role": "user", "content": prompt}]
            }
        )
        llm_data = llm_response.json()
        if llm_response.status_code != 200:
            return {"error": f"LLM API Error: {llm_data.get('error', {}).get('message', 'Unknown error')}"}
        
        ai_text = llm_data['choices'][0]['message']['content']
    except Exception as e:
        return {"error": f"Failed to get LLM response: {str(e)}"}

    return {"text": ai_text, "metrics": metrics}

@app.route('/api/analyze', methods=['POST'])
def analyze_endpoint():
    data = request.get_json()
    if not data or 'videoUrl' not in data:
        return jsonify({"error": "Missing videoUrl"}), 400
        
    result = analyze_video_logic(data['videoUrl'])
    
    if "error" in result:
        return jsonify(result), 500
        
    return jsonify(result)
