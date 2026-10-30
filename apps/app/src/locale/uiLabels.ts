/** Labels retained in shared control tables and translated when rendered. */
const KO: Record<string, string> = {
  "Canvas": "화면", "Export": "출력", "Preview": "미리보기",
  "Export video": "영상 출력", "Export progress": "출력 진행 상황",
  "Select": "선택", "Text": "글자", "Cursor": "편집 도구",
  "Add a shape": "도형 추가", "Zoom out": "축소", "Zoom in": "확대",
  "Zoom presets": "확대 비율", "Fit to frame": "화면에 맞추기",
  "Lock keyboard shortcuts": "단축키 잠금", "Fit": "맞춤",
  "Undo": "실행 취소", "Redo": "다시 실행", "Split at playhead": "현재 위치에서 나누기",
  "Merge clips": "클립 합치기", "Cut": "잘라내기", "Copy": "복사",
  "Paste": "붙여넣기", "Rotate 90°": "90도 회전", "Detach audio": "오디오 분리",
  "Crop": "자르기", "Delete": "삭제", "Add track": "트랙 추가",
  "Go to start": "처음으로", "Play": "재생", "Stop": "정지",
  "Record": "화면 녹화", "Audio Record": "음성 녹음", "Proxy": "프록시",
  "Auto Track": "자동 추적", "Video": "영상", "Audio": "오디오",
  "Effect": "효과", "Group": "그룹", "Mute preview": "미리보기 음소거",
  "Playback preview": "재생 미리보기", "Stopping…": "중지 중", "Finalizing…": "마무리 중",
  "Close": "닫기", "Stop export": "출력 중지", "Square": "정사각형", "Portrait": "세로",
  "1920×1080 (desktop)": "1920×1080 (가로 화면)",
  "1080×1080 (square)": "1080×1080 (정사각형)",
  "1080×1920 (portrait)": "1080×1920 (세로 화면)",
  "Start Recording": "녹화 시작", "Starting…": "시작 중", "Cancel": "취소",
  "Finishing the recording…": "녹화 마무리 중", "Stop Recording": "녹화 중지",
  "Resume": "계속 녹화", "Pause": "일시 정지", "Discard Recording": "녹화 버리기",
  "Screen": "화면", "Camera": "카메라", "Microphone": "마이크", "None": "없음",
  "System Audio": "시스템 소리", "Bubble": "카메라 화면", "Quality": "화질",
  "Native (sharpest)": "원본 해상도 (최고 화질)", "Off": "끄기", "On": "켜기",
  "Small": "작게", "Medium": "보통", "Large": "크게", "Top Left": "왼쪽 위",
  "Top Right": "오른쪽 위", "Bottom Left": "왼쪽 아래", "Bottom Right": "오른쪽 아래",
  "Circle": "원형", "Rounded Rectangle": "모서리가 둥근 사각형",
  "Auto Zoom": "자동 확대", "Drawing Mode": "그리기 모드", "Highlight Clicks": "클릭 강조",
  "Open Recordings Folder": "녹화 폴더 열기", "Close Recorder": "녹화 도구 닫기",
  "Stop the recording first.": "먼저 녹화를 중지하세요.",
  "Capturing system audio is only available on Windows.": "시스템 소리 녹음은 Windows에서 지원합니다.",
  "No screen is available to capture. Check Screen Recording permission for Narae Movie Maker.":
    "녹화할 화면이 없습니다. 나래 무비메이커의 화면 녹화 권한을 확인하세요.",
  "Narae Movie Maker: recording": "나래 무비메이커: 녹화 중",
  "Narae Movie Maker: paused": "나래 무비메이커: 녹화 일시 정지",
  "Narae Movie Maker: starting": "나래 무비메이커: 녹화 시작 중",
  "Narae Movie Maker Recorder": "나래 무비메이커 녹화 도구",
  "Recovered": "복구됨", "unsaved": "저장되지 않음",
  "Could not show the screen. Check Screen Recording permission for Narae Movie Maker in System Settings → Privacy & Security.":
    "화면을 표시할 수 없습니다. 시스템 설정의 개인정보 보호 및 보안에서 나래 무비메이커의 화면 녹화 권한을 확인하세요.",
};

export function uiLabel(label: string): string {
  if (typeof document === "undefined" || document.documentElement.lang.startsWith("en")) return label;
  return KO[label] ?? label;
}
