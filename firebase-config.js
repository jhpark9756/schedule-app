// Firebase 프로젝트 정보. 값을 바꾸려면 https://console.firebase.google.com 의
// 프로젝트 설정 → 내 앱 → 웹 앱 구성에서 다시 복사해서 교체하세요.
window.firebaseConfig = {
  apiKey: "AIzaSyDVZan3xTVJvvinLgePys-s41ZkzB5GBTs",
  authDomain: "schedule-web-87a52.firebaseapp.com",
  databaseURL: "https://schedule-web-87a52-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "schedule-web-87a52",
  storageBucket: "schedule-web-87a52.firebasestorage.app",
  messagingSenderId: "872796379038",
  appId: "1:872796379038:web:b5db652f9d5ef81ef7288f",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// 관리자 키.
//   첫 방문 시 https://<배포주소>/?admin=여기에설정한키 로 한 번 접속하면
//   해당 브라우저는 이후 관리자 모드로 동작합니다 (localStorage 저장).
window.ADMIN_KEY = "jhpark_hslee_0912";
