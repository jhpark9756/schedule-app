// Firebase 프로젝트 정보로 아래 값을 교체하세요.
// 1) https://console.firebase.google.com 접속 → 프로젝트 만들기
// 2) 좌측 메뉴 "Realtime Database" → 데이터베이스 만들기 (테스트 모드)
// 3) 프로젝트 설정 (톱니바퀴) → 일반 → "내 앱" → 웹 앱 추가
// 4) 표시되는 firebaseConfig 객체의 값들을 그대로 복사해서 아래에 붙여넣기

// Import the functions you need from the SDKs you need
//import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDVZan3xTVJvvinLgePys-s41ZkzB5GBTs",
  authDomain: "schedule-web-87a52.firebaseapp.com",
  databaseURL: "https://schedule-web-87a52-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "schedule-web-87a52",
  storageBucket: "schedule-web-87a52.firebasestorage.app",
  messagingSenderId: "872796379038",
  appId: "1:872796379038:web:b5db652f9d5ef81ef7288f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// 관리자 키.
//   첫 방문 시 https://<배포주소>/?admin=여기에설정한키 로 한 번 접속하면
//   해당 브라우저는 이후 관리자 모드로 동작합니다 (localStorage 저장).
// 주의: GitHub 저장소가 public이면 이 값은 공개됩니다. 다른 곳에서 쓰지 않는 고유한 값으로 설정하세요.
window.ADMIN_KEY = "jhpark_hslee_0912";
