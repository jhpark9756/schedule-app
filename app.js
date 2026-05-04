(function () {
  let db = null;
  let calendar = null;
  let currentGroupId = null;
  let currentGroupMeta = null;
  let groupEventsRef = null;
  let events = {};
  let editingEventId = null;
  let editingGroupId = null;
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
      openGroupModal();
    });
    document.getElementById("edit-group-btn").addEventListener("click", () => {
      if (!isAdmin || !currentGroupId) return;
      openGroupModal(currentGroupMeta, currentGroupId);
    });
    document.getElementById("group-cancel-btn").addEventListener("click", closeGroupModal);
    document.getElementById("group-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveGroup();
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

  function isMobile() {
    return window.innerWidth < 640;
  }

  function getHeaderToolbar() {
    return isMobile()
      ? { left: "prev,next", center: "title", right: "today" }
      : { left: "prev,next today", center: "title", right: "dayGridMonth,dayGridWeek,listMonth" };
  }

  function initCalendar() {
    const el = document.getElementById("calendar");
    calendar = new FullCalendar.Calendar(el, {
      locale: "ko",
      initialView: "dayGridMonth",
      headerToolbar: getHeaderToolbar(),
      buttonText: { today: "오늘", month: "월", week: "주", list: "목록" },
      selectable: true,
      selectMirror: true,
      displayEventTime: false,
      height: "auto",
      fixedWeekCount: false,
      dayMaxEvents: 4,
      moreLinkText: (n) => `+${n}개 더보기`,
      noEventsText: "등록된 일정이 없습니다.",
      select: (info) => {
        const startYMD = dateToYMD(info.start);
        const endDate = new Date(info.end);
        endDate.setDate(endDate.getDate() - 1);
        const endYMD = dateToYMD(endDate);
        openEventModal({ start: startYMD, end: endYMD });
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
      windowResize: () => {
        calendar.setOption("headerToolbar", getHeaderToolbar());
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
          const range = g.startDate && g.endDate ? `${g.startDate} ~ ${g.endDate}` : "";
          const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString("ko-KR") : "";
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = "?g=" + encodeURIComponent(id);
          a.innerHTML =
            '<div class="group-list-main"><span class="group-name"></span><span class="group-list-range"></span></div>' +
            '<span class="group-meta"></span>';
          a.querySelector(".group-name").textContent = name;
          a.querySelector(".group-list-range").textContent = range;
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

  // ----- Group modal (create + edit) -----

  function openGroupModal(meta, groupId) {
    editingGroupId = groupId || null;
    document.getElementById("group-modal-title").textContent = groupId ? "모임 정보 수정" : "새 모임 만들기";
    document.getElementById("group-save-btn").textContent = groupId ? "저장" : "만들기";
    document.getElementById("group-name-input").value = (meta && meta.name) || "";
    document.getElementById("group-start-input").value = (meta && meta.startDate) || "";
    document.getElementById("group-end-input").value = (meta && meta.endDate) || "";
    document.getElementById("group-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("group-name-input").focus(), 50);
  }

  function closeGroupModal() {
    document.getElementById("group-modal").classList.add("hidden");
    editingGroupId = null;
  }

  function saveGroup() {
    const name = document.getElementById("group-name-input").value.trim();
    const startDate = document.getElementById("group-start-input").value;
    const endDate = document.getElementById("group-end-input").value;
    if (!name) return;
    if ((startDate && !endDate) || (!startDate && endDate)) {
      alert("기간을 지정하려면 시작일과 종료일을 모두 입력하세요.");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      alert("종료일은 시작일 이후여야 합니다.");
      return;
    }

    if (editingGroupId) {
      const update = {
        name,
        startDate: startDate || null,
        endDate: endDate || null,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
      };
      db.ref("groupIndex/" + editingGroupId)
        .update(update)
        .then(() => {
          closeGroupModal();
          if (currentGroupId === editingGroupId) loadGroup(currentGroupId);
        })
        .catch((err) => alert("저장 실패: " + err.message));
    } else {
      const newData = { name, createdAt: firebase.database.ServerValue.TIMESTAMP };
      if (startDate) newData.startDate = startDate;
      if (endDate) newData.endDate = endDate;
      const ref = db.ref("groupIndex").push();
      ref
        .set(newData)
        .then(() => {
          closeGroupModal();
          navigate("?g=" + encodeURIComponent(ref.key));
        })
        .catch((err) => alert("생성 실패: " + err.message));
    }
  }

  function deleteGroup() {
    if (!isAdmin || !currentGroupId) return;
    if (!confirm(`"${(currentGroupMeta && currentGroupMeta.name) || ""}" 모임과 모든 일정을 삭제합니다. 계속할까요?`)) return;
    Promise.all([
      db.ref("groupIndex/" + currentGroupId).remove(),
      db.ref("groups/" + currentGroupId).remove(),
    ])
      .then(() => navigate(location.pathname))
      .catch((err) => alert("삭제 실패: " + err.message));
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
    currentGroupMeta = null;

    document.getElementById("back-list-btn").classList.toggle("hidden", !isAdmin);
    document.getElementById("edit-group-btn").classList.toggle("hidden", !isAdmin);
    document.getElementById("delete-group-btn").classList.toggle("hidden", !isAdmin);

    db.ref("groupIndex/" + groupId)
      .once("value")
      .then((snap) => {
        const meta = snap.val() || {};
        currentGroupMeta = meta;
        document.getElementById("group-name").textContent = meta.name || "(알 수 없는 모임)";
        applyGroupRange(meta);
      })
      .catch(() => {
        document.getElementById("group-name").textContent = "(이름 로드 실패)";
        applyGroupRange({});
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

  function applyGroupRange(meta) {
    const rangeEl = document.getElementById("group-range");
    if (meta && meta.startDate && meta.endDate) {
      rangeEl.textContent = `등록 가능 기간 · ${meta.startDate} ~ ${meta.endDate}`;
      rangeEl.classList.remove("hidden");
      calendar.setOption("validRange", {
        start: meta.startDate,
        end: addDays(meta.endDate, 1),
      });
      const today = ymdFromDate(new Date());
      calendar.gotoDate(today >= meta.startDate && today <= meta.endDate ? today : meta.startDate);
    } else {
      rangeEl.textContent = "";
      rangeEl.classList.add("hidden");
      calendar.setOption("validRange", null);
      calendar.gotoDate(new Date());
    }
  }

  function refreshCalendar() {
    calendar.removeAllEvents();
    Object.entries(events).forEach(([id, ev]) => {
      if (!ev || !ev.start || !ev.end) return;
      const color = colorFromString(ev.author || "");
      const startYMD = dateToYMD(ev.start);
      const endYMD = dateToYMD(ev.end);
      const displayEnd = addDays(endYMD, 1);
      calendar.addEvent({
        id,
        title: `${ev.title}${ev.author ? " · " + ev.author : ""}`,
        start: startYMD,
        end: displayEnd,
        allDay: true,
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
    document.getElementById("event-start").value = data.start ? dateToYMD(data.start) : "";
    document.getElementById("event-end").value = data.end ? dateToYMD(data.end) : "";
    document.getElementById("event-memo").value = data.memo || "";
    document.getElementById("event-delete-btn").classList.toggle("hidden", !id);
    applyEventInputBounds();
    document.getElementById("event-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("event-title").focus(), 50);
  }

  function applyEventInputBounds() {
    const startEl = document.getElementById("event-start");
    const endEl = document.getElementById("event-end");
    const meta = currentGroupMeta || {};
    if (meta.startDate) {
      startEl.min = meta.startDate;
      endEl.min = meta.startDate;
    } else {
      startEl.removeAttribute("min");
      endEl.removeAttribute("min");
    }
    if (meta.endDate) {
      startEl.max = meta.endDate;
      endEl.max = meta.endDate;
    } else {
      startEl.removeAttribute("max");
      endEl.removeAttribute("max");
    }
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
      alert("제목, 등록자, 시작일, 종료일은 필수입니다.");
      return;
    }
    if (endStr < startStr) {
      alert("종료일은 시작일 이후여야 합니다.");
      return;
    }
    const meta = currentGroupMeta || {};
    if (meta.startDate && meta.endDate) {
      if (startStr < meta.startDate || endStr > meta.endDate) {
        alert(`이 모임은 ${meta.startDate} ~ ${meta.endDate} 기간만 일정 등록 가능합니다.`);
        return;
      }
    }

    const event = {
      title,
      author,
      start: startStr,
      end: endStr,
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
    if (!s) return "#4f46e5";
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 52%)`;
  }

  function dateToYMD(d) {
    if (!d) return "";
    if (typeof d === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return "";
      return ymdFromDate(dt);
    }
    if (d instanceof Date && !isNaN(d.getTime())) return ymdFromDate(d);
    return "";
  }

  function ymdFromDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function addDays(ymd, n) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return ymdFromDate(dt);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
