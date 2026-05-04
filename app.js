(function () {
  let db = null;
  let calendar = null;
  let currentGroupId = null;
  let currentGroupName = null;
  let groupEventsRef = null;
  let events = {};
  let editingEventId = null;
  let isAdmin = false;

  function init() {
    if (!validateConfig()) return;
    firebase.initializeApp(window.firebaseConfig);
    db = firebase.database();

    handleAdminParam();
    isAdmin = localStorage.getItem("isAdmin") === "1";
    document.getElementById("admin-nav").classList.toggle("hidden", !isAdmin);

    initCalendar();
    bindUI();
    route();

    window.addEventListener("popstate", route);
  }

  function validateConfig() {
    const cfg = window.firebaseConfig;
    if (!cfg || !cfg.databaseURL || cfg.databaseURL.includes("YOUR_PROJECT")) {
      const main = document.querySelector("main");
      main.innerHTML =
        '<div class="card error"><b>Firebase 설정이 비어있습니다.</b><br>' +
        "<code>firebase-config.js</code>를 본인 프로젝트 정보로 교체하세요.</div>";
      return false;
    }
    return true;
  }

  function handleAdminParam() {
    const params = new URLSearchParams(location.search);
    if (!params.has("admin")) return;
    const key = params.get("admin");
    if (key && key === window.ADMIN_KEY) {
      localStorage.setItem("isAdmin", "1");
    } else {
      alert("잘못된 관리자 키입니다.");
    }
    params.delete("admin");
    const newSearch = params.toString();
    history.replaceState({}, "", location.pathname + (newSearch ? "?" + newSearch : ""));
  }

  function route() {
    const params = new URLSearchParams(location.search);
    const groupId = params.get("g");
    if (groupId) {
      showView("calendar");
      loadGroup(groupId);
    } else if (isAdmin) {
      showView("list");
      loadGroupList();
    } else {
      showView("empty");
    }
  }

  function showView(name) {
    ["empty", "list", "calendar"].forEach((v) => {
      document.getElementById("view-" + v).classList.toggle("hidden", v !== name);
    });
  }

  function navigate(search) {
    history.pushState({}, "", search || location.pathname);
    route();
  }

  function bindUI() {
    document.getElementById("logo").addEventListener("click", (e) => {
      e.preventDefault();
      navigate(location.pathname);
    });
    document.getElementById("nav-list").addEventListener("click", (e) => {
      e.preventDefault();
      navigate(location.pathname);
    });
    document.getElementById("logout-admin").addEventListener("click", () => {
      if (!confirm("관리자 모드에서 로그아웃합니다. 다시 들어오려면 admin URL로 재방문해야 합니다.")) return;
      localStorage.removeItem("isAdmin");
      isAdmin = false;
      document.getElementById("admin-nav").classList.add("hidden");
      navigate(location.pathname);
    });

    document.getElementById("create-group-btn").addEventListener("click", () => {
      document.getElementById("group-name-input").value = "";
      document.getElementById("group-modal").classList.remove("hidden");
      setTimeout(() => document.getElementById("group-name-input").focus(), 50);
    });
    document.getElementById("group-cancel-btn").addEventListener("click", closeGroupModal);
    document.getElementById("group-form").addEventListener("submit", (e) => {
      e.preventDefault();
      createGroup();
    });
    document.getElementById("group-modal").addEventListener("click", (e) => {
      if (e.target.id === "group-modal") closeGroupModal();
    });

    document.getElementById("copy-link-btn").addEventListener("click", copyShareLink);
    document.getElementById("back-list-btn").addEventListener("click", () => navigate(location.pathname));
    document.getElementById("delete-group-btn").addEventListener("click", deleteGroup);

    document.getElementById("event-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveEvent();
    });
    document.getElementById("event-cancel-btn").addEventListener("click", closeEventModal);
    document.getElementById("event-delete-btn").addEventListener("click", deleteEvent);
    document.getElementById("event-modal").addEventListener("click", (e) => {
      if (e.target.id === "event-modal") closeEventModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeEventModal();
        closeGroupModal();
      }
    });
  }

  function initCalendar() {
    const el = document.getElementById("calendar");
    calendar = new FullCalendar.Calendar(el, {
      locale: "ko",
      initialView: "dayGridMonth",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay",
      },
      selectable: true,
      selectMirror: true,
      nowIndicator: true,
      height: "auto",
      slotMinTime: "06:00:00",
      slotMaxTime: "24:00:00",
      select: (info) => {
        openEventModal({ start: info.start, end: info.end });
        calendar.unselect();
      },
      eventClick: (info) => {
        const ev = events[info.event.id];
        if (ev) openEventModal(ev, info.event.id);
      },
      eventDidMount: (info) => {
        const memo = info.event.extendedProps.memo;
        if (memo) info.el.title = memo;
      },
    });
    calendar.render();
  }

  // ----- Group list (admin) -----

  function loadGroupList() {
    const ul = document.getElementById("group-list");
    const empty = document.getElementById("empty-list");
    ul.innerHTML = "";
    empty.classList.add("hidden");

    db.ref("groupIndex")
      .once("value")
      .then((snap) => {
        const data = snap.val() || {};
        const ids = Object.keys(data);
        if (ids.length === 0) {
          empty.classList.remove("hidden");
          return;
        }
        ids.sort((a, b) => (data[b].createdAt || 0) - (data[a].createdAt || 0));
        ids.forEach((id) => {
          const g = data[id] || {};
          const name = g.name || "(이름 없음)";
          const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString("ko-KR") : "";
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = "?g=" + encodeURIComponent(id);
          a.innerHTML =
            '<span class="group-name"></span><span class="group-meta"></span>';
          a.querySelector(".group-name").textContent = name;
          a.querySelector(".group-meta").textContent = date;
          a.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("?g=" + encodeURIComponent(id));
          });
          li.appendChild(a);
          ul.appendChild(li);
        });
      })
      .catch((err) => alert("목록을 불러오지 못했습니다: " + err.message));
  }

  function createGroup() {
    const name = document.getElementById("group-name-input").value.trim();
    if (!name) return;
    const ref = db.ref("groupIndex").push();
    const id = ref.key;
    ref
      .set({ name, createdAt: firebase.database.ServerValue.TIMESTAMP })
      .then(() => {
        closeGroupModal();
        navigate("?g=" + encodeURIComponent(id));
      })
      .catch((err) => alert("생성 실패: " + err.message));
  }

  function deleteGroup() {
    if (!isAdmin || !currentGroupId) return;
    if (!confirm(`"${currentGroupName}" 모임과 모든 일정을 삭제합니다. 계속할까요?`)) return;
    Promise.all([
      db.ref("groupIndex/" + currentGroupId).remove(),
      db.ref("groups/" + currentGroupId).remove(),
    ])
      .then(() => navigate(location.pathname))
      .catch((err) => alert("삭제 실패: " + err.message));
  }

  function closeGroupModal() {
    document.getElementById("group-modal").classList.add("hidden");
  }

  // ----- Calendar (group) -----

  function loadGroup(groupId) {
    if (groupEventsRef) {
      groupEventsRef.off();
      groupEventsRef = null;
    }
    events = {};
    calendar.removeAllEvents();

    currentGroupId = groupId;
    currentGroupName = "";

    document.getElementById("back-list-btn").classList.toggle("hidden", !isAdmin);
    document.getElementById("delete-group-btn").classList.toggle("hidden", !isAdmin);

    db.ref("groupIndex/" + groupId)
      .once("value")
      .then((snap) => {
        const meta = snap.val();
        currentGroupName = (meta && meta.name) || "(알 수 없는 모임)";
        document.getElementById("group-name").textContent = currentGroupName;
      })
      .catch(() => {
        document.getElementById("group-name").textContent = "(이름 로드 실패)";
      });

    groupEventsRef = db.ref("groups/" + groupId + "/events");
    groupEventsRef.on(
      "value",
      (snap) => {
        events = snap.val() || {};
        refreshCalendar();
      },
      (err) => alert("일정을 불러오지 못했습니다: " + err.message)
    );
  }

  function refreshCalendar() {
    calendar.removeAllEvents();
    Object.entries(events).forEach(([id, ev]) => {
      if (!ev || !ev.start || !ev.end) return;
      const color = colorFromString(ev.author || "");
      calendar.addEvent({
        id,
        title: `${ev.title}${ev.author ? " (" + ev.author + ")" : ""}`,
        start: ev.start,
        end: ev.end,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { memo: ev.memo, author: ev.author },
      });
    });
  }

  function openEventModal(data, id) {
    if (!currentGroupId) return;
    editingEventId = id || null;
    document.getElementById("event-modal-title").textContent = id ? "일정 수정" : "일정 등록";
    document.getElementById("event-title").value = data.title || "";
    document.getElementById("event-author").value =
      data.author || localStorage.getItem("lastAuthor") || "";
    document.getElementById("event-start").value = toLocalInputValue(data.start);
    document.getElementById("event-end").value = toLocalInputValue(data.end);
    document.getElementById("event-memo").value = data.memo || "";
    document.getElementById("event-delete-btn").classList.toggle("hidden", !id);
    document.getElementById("event-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("event-title").focus(), 50);
  }

  function closeEventModal() {
    document.getElementById("event-modal").classList.add("hidden");
    editingEventId = null;
  }

  function saveEvent() {
    const title = document.getElementById("event-title").value.trim();
    const author = document.getElementById("event-author").value.trim();
    const startStr = document.getElementById("event-start").value;
    const endStr = document.getElementById("event-end").value;
    const memo = document.getElementById("event-memo").value.trim();

    if (!title || !author || !startStr || !endStr) {
      alert("제목, 등록자, 시작, 종료 시간은 필수입니다.");
      return;
    }
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    if (endDate <= startDate) {
      alert("종료 시간은 시작 시간 이후여야 합니다.");
      return;
    }

    const event = {
      title,
      author,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      memo,
      updatedAt: Date.now(),
    };
    localStorage.setItem("lastAuthor", author);

    const op = editingEventId
      ? groupEventsRef.child(editingEventId).set(event)
      : groupEventsRef.push(event);
    op.catch((err) => alert("저장 실패: " + err.message));
    closeEventModal();
  }

  function deleteEvent() {
    if (!editingEventId) return;
    if (!confirm("이 일정을 삭제할까요?")) return;
    groupEventsRef
      .child(editingEventId)
      .remove()
      .catch((err) => alert("삭제 실패: " + err.message));
    closeEventModal();
  }

  function copyShareLink() {
    if (!currentGroupId) return;
    const url = `${location.origin}${location.pathname}?g=${encodeURIComponent(currentGroupId)}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(
        () => alert("공유 링크가 복사되었습니다:\n" + url),
        () => prompt("아래 링크를 복사하세요:", url)
      );
    } else {
      prompt("아래 링크를 복사하세요:", url);
    }
  }

  // ----- helpers -----

  function colorFromString(s) {
    if (!s) return "#3498db";
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 48%)`;
  }

  function toLocalInputValue(dateLike) {
    if (!dateLike) return "";
    const d = new Date(dateLike);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
