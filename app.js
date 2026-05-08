(function () {
  let db = null;
  let calendar = null;
  let allCalendar = null;
  let currentGroupId = null;
  let currentGroupMeta = null;
  let groupEventsRef = null;
  let globalEventsRef = null;

  // 현재 모임 캘린더의 데이터 분리: 모임 이벤트 + 전역 이벤트
  let groupEventsMap = {};
  let globalEventsMap = {};
  let events = {}; // merged: id (group push id) or "global:<id>"

  let unavailableDatesSet = new Set();
  let editingEventId = null;
  let editingGroupId = null;
  let isAdmin = false;

  let currentMemo = "";

  // 전체 캘린더 뷰 상태
  let allGroupsMeta = {}; // groupId -> meta
  let allGroupsEvents = {}; // groupId -> { eventId -> ev }
  let allGlobalsEvents = {}; // eventId -> ev
  let filterEnabled = {}; // groupId or "_global" -> true/false

  const DEFAULT_TITLE = "청모 일정 취합";

  const KOREAN_HOLIDAYS = {
    "2026-01-01": "신정",
    "2026-02-16": "설날", "2026-02-17": "설날", "2026-02-18": "설날",
    "2026-03-01": "삼일절",
    "2026-03-02": "대체공휴일",
    "2026-05-05": "어린이날",
    "2026-05-24": "부처님오신날",
    "2026-05-25": "대체공휴일",
    "2026-06-03": "지방선거",
    "2026-06-06": "현충일",
    "2026-07-17": "제헌절",
    "2026-08-15": "광복절",
    "2026-08-17": "대체공휴일",
    "2026-09-24": "추석", "2026-09-25": "추석", "2026-09-26": "추석",
    "2026-10-03": "개천절",
    "2026-10-05": "대체공휴일",
    "2026-10-09": "한글날",
    "2026-12-25": "크리스마스",
    "2027-01-01": "신정",
    "2027-03-01": "삼일절",
    "2027-05-05": "어린이날",
    "2027-06-06": "현충일",
    "2027-07-17": "제헌절",
    "2027-08-15": "광복절",
    "2027-08-16": "대체공휴일",
    "2027-10-03": "개천절",
    "2027-10-04": "대체공휴일",
    "2027-10-09": "한글날",
    "2027-10-11": "대체공휴일",
    "2027-12-25": "크리스마스",
    "2027-12-27": "대체공휴일",
  };

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
    window.addEventListener("resize", () => {
      const opts = getHeaderToolbar();
      if (calendar) calendar.setOption("headerToolbar", opts);
      if (allCalendar) allCalendar.setOption("headerToolbar", opts);
    });
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
    document.title = DEFAULT_TITLE;
    teardownGroupListeners();
    teardownAllListeners();

    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    const groupId = params.get("g");

    if (groupId) {
      showView("calendar");
      loadGroup(groupId);
    } else if (view === "all" && isAdmin) {
      showView("all");
      loadAllView();
    } else if (isAdmin) {
      showView("list");
      loadGroupList();
    } else {
      showView("empty");
    }
  }

  function showView(name) {
    ["empty", "list", "calendar", "all"].forEach((v) => {
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
    document.getElementById("nav-all").addEventListener("click", (e) => {
      e.preventDefault();
      navigate("?view=all");
    });
    document.getElementById("logout-admin").addEventListener("click", () => {
      if (!confirm("관리자 모드에서 로그아웃합니다. 다시 들어오려면 admin URL로 재방문해야 합니다.")) return;
      localStorage.removeItem("isAdmin");
      isAdmin = false;
      document.getElementById("admin-nav").classList.add("hidden");
      navigate(location.pathname);
    });

    document.getElementById("create-group-btn").addEventListener("click", () => openGroupModal());
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

    // Memo + AI prompt copy
    document.getElementById("memo-save-btn").addEventListener("click", saveMemo);
    document.getElementById("ai-copy-prompt-btn").addEventListener("click", copyPrompt);

    // 전역 일정 등록 (전체 캘린더 뷰)
    document.getElementById("register-global-btn").addEventListener("click", () => {
      openEventModal({ _newGlobal: true });
    });

    // 필터 헬퍼 버튼
    document.getElementById("filter-all-btn").addEventListener("click", () => setAllFilters(true));
    document.getElementById("filter-none-btn").addEventListener("click", () => setAllFilters(false));
  }

  function isMobile() {
    return window.innerWidth < 640;
  }

  function getHeaderToolbar() {
    return isMobile()
      ? { left: "prev,next", center: "title", right: "today" }
      : { left: "prev,next today", center: "title", right: "dayGridMonth,dayGridWeek,listMonth" };
  }

  function buildCalendarOptions(elId, eventClickHandler, dateClickHandler) {
    return {
      locale: "ko",
      initialView: "dayGridMonth",
      headerToolbar: getHeaderToolbar(),
      buttonText: { today: "오늘", month: "월", week: "주", list: "목록" },
      selectable: !!dateClickHandler,
      selectMirror: true,
      displayEventTime: false,
      height: "auto",
      fixedWeekCount: false,
      dayMaxEvents: 4,
      moreLinkText: (n) => `+${n}개 더보기`,
      noEventsText: "등록된 불가 일정이 없습니다.",
      longPressDelay: 250,
      selectLongPressDelay: 250,
      eventClick: eventClickHandler,
      dateClick: dateClickHandler,
      eventDidMount: (info) => {
        const memo = info.event.extendedProps.memo;
        if (memo) info.el.title = memo;
        if (info.event.extendedProps.isGlobal) {
          info.el.classList.add("event-global");
        }
      },
      datesSet: () => refreshDayHighlights(),
    };
  }

  function initCalendar() {
    const el = document.getElementById("calendar");
    const opts = buildCalendarOptions(
      "calendar",
      (info) => {
        const ev = events[info.event.id];
        if (!ev) return;
        if (ev._global && !isAdmin) return; // 비관리자는 전역 일정 상세 조회 불가
        openEventModal(ev, info.event.id);
      },
      (info) => {
        const ymd = dateToYMD(info.date);
        openEventModal({ start: ymd, end: ymd });
      }
    );
    opts.select = (info) => {
      const startYMD = dateToYMD(info.start);
      const endDate = new Date(info.end);
      endDate.setDate(endDate.getDate() - 1);
      const endYMD = dateToYMD(endDate);
      openEventModal({ start: startYMD, end: endYMD });
      calendar.unselect();
    };
    calendar = new FullCalendar.Calendar(el, opts);
    calendar.render();
  }

  function ensureAllCalendar() {
    if (allCalendar) return;
    const el = document.getElementById("all-calendar");
    const opts = buildCalendarOptions("all-calendar", (info) => {
      const props = info.event.extendedProps;
      if (props.isGlobal) {
        // Open global event in modal directly
        const realId = info.event.id.replace("global:", "");
        const ev = allGlobalsEvents[realId];
        if (ev) openEventModal({ ...ev, _global: true }, "global:" + realId);
      } else {
        // Navigate to that group's calendar
        navigate("?g=" + encodeURIComponent(props.groupId));
      }
    }, null);
    opts.selectable = false;
    allCalendar = new FullCalendar.Calendar(el, opts);
    allCalendar.render();
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

  // ----- Group modal -----

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
    if (!confirm(`"${(currentGroupMeta && currentGroupMeta.name) || ""}" 모임과 모든 일정/메모를 삭제합니다. 계속할까요?`)) return;
    Promise.all([
      db.ref("groupIndex/" + currentGroupId).remove(),
      db.ref("groups/" + currentGroupId).remove(),
      db.ref("groupMemos/" + currentGroupId).remove(),
    ])
      .then(() => navigate(location.pathname))
      .catch((err) => alert("삭제 실패: " + err.message));
  }

  // ----- Calendar (group) -----

  function teardownGroupListeners() {
    if (groupEventsRef) {
      groupEventsRef.off();
      groupEventsRef = null;
    }
    if (globalEventsRef) {
      globalEventsRef.off();
      globalEventsRef = null;
    }
    groupEventsMap = {};
    globalEventsMap = {};
    events = {};
  }

  function loadGroup(groupId) {
    teardownGroupListeners();
    if (calendar) calendar.removeAllEvents();
    unavailableDatesSet = new Set();

    currentGroupId = groupId;
    currentGroupMeta = null;

    document.getElementById("back-list-btn").classList.toggle("hidden", !isAdmin);
    document.getElementById("edit-group-btn").classList.toggle("hidden", !isAdmin);
    document.getElementById("delete-group-btn").classList.toggle("hidden", !isAdmin);
    document.getElementById("admin-memo-section").classList.toggle("hidden", !isAdmin);

    db.ref("groupIndex/" + groupId)
      .once("value")
      .then((snap) => {
        const meta = snap.val() || {};
        currentGroupMeta = meta;
        const name = meta.name || "(알 수 없는 모임)";
        document.getElementById("group-name").textContent = name;
        document.title = `${name} ${DEFAULT_TITLE}`;
        applyGroupRange(meta);
      })
      .catch(() => {
        document.getElementById("group-name").textContent = "(이름 로드 실패)";
        applyGroupRange({});
      });

    if (isAdmin) loadMemo(groupId);

    groupEventsRef = db.ref("groups/" + groupId + "/events");
    groupEventsRef.on(
      "value",
      (snap) => {
        groupEventsMap = snap.val() || {};
        refreshCalendar();
      },
      (err) => alert("일정을 불러오지 못했습니다: " + err.message)
    );

    globalEventsRef = db.ref("globalEvents");
    globalEventsRef.on(
      "value",
      (snap) => {
        globalEventsMap = snap.val() || {};
        refreshCalendar();
      },
      (err) => console.warn("전역 일정 로드 실패: " + err.message)
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
    refreshDayHighlights();
  }

  function refreshCalendar() {
    // Merge events
    events = {};
    Object.entries(groupEventsMap).forEach(([id, ev]) => {
      if (ev) events[id] = ev;
    });
    Object.entries(globalEventsMap).forEach(([id, ev]) => {
      if (ev) events["global:" + id] = { ...ev, _global: true };
    });

    unavailableDatesSet = computeUnavailable(events);

    calendar.removeAllEvents();
    Object.entries(events).forEach(([id, ev]) => {
      if (!ev || !ev.start || !ev.end) return;
      const isGlobal = !!ev._global;
      const hideDetails = isGlobal && !isAdmin;
      const color = isGlobal ? "#dc2626" : colorFromString(ev.author || "");
      const startYMD = dateToYMD(ev.start);
      const endYMD = dateToYMD(ev.end);
      const displayEnd = addDays(endYMD, 1);
      const titleText = hideDetails
        ? "불가"
        : `${ev.title}${ev.author ? " · " + ev.author : ""}`;
      calendar.addEvent({
        id,
        title: titleText,
        start: startYMD,
        end: displayEnd,
        allDay: true,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          memo: hideDetails ? "" : ev.memo,
          author: hideDetails ? "" : ev.author,
          isGlobal,
          hideDetails,
        },
      });
    });
    refreshDayHighlights();
  }

  function computeUnavailable(eventMap) {
    const set = new Set();
    Object.values(eventMap || {}).forEach((ev) => {
      if (!ev || !ev.start || !ev.end) return;
      const startStr = dateToYMD(ev.start);
      const endStr = dateToYMD(ev.end);
      if (!startStr || !endStr) return;
      let d = startStr;
      while (d <= endStr) {
        set.add(d);
        d = addDays(d, 1);
      }
    });
    return set;
  }

  // ----- 전체 캘린더 (admin overview) -----

  function teardownAllListeners() {
    db && db.ref("groupIndex").off();
    db && db.ref("globalEvents").off();
    Object.keys(allGroupsEvents).forEach((id) => {
      db && db.ref("groups/" + id + "/events").off();
    });
    allGroupsMeta = {};
    allGroupsEvents = {};
    allGlobalsEvents = {};
  }

  function loadAllView() {
    if (!isAdmin) {
      navigate(location.pathname);
      return;
    }
    ensureAllCalendar();
    teardownAllListeners();

    db.ref("groupIndex").on("value", (snap) => {
      const data = snap.val() || {};
      allGroupsMeta = data;

      // Subscribe to events for each group
      Object.keys(data).forEach((gid) => {
        if (!allGroupsEvents[gid]) {
          db.ref("groups/" + gid + "/events").on("value", (s) => {
            allGroupsEvents[gid] = s.val() || {};
            renderAllCalendar();
          });
        }
      });
      // Drop subscriptions for removed groups
      Object.keys(allGroupsEvents).forEach((gid) => {
        if (!data[gid]) {
          db.ref("groups/" + gid + "/events").off();
          delete allGroupsEvents[gid];
        }
      });

      // Re-render filter
      renderFilter();
      renderAllCalendar();
    });

    db.ref("globalEvents").on("value", (snap) => {
      allGlobalsEvents = snap.val() || {};
      renderAllCalendar();
    });
  }

  function renderFilter() {
    const list = document.getElementById("filter-list");
    list.innerHTML = "";

    // Global filter row
    const globalKey = "_global";
    if (filterEnabled[globalKey] === undefined) filterEnabled[globalKey] = true;
    list.appendChild(makeFilterRow(globalKey, "전역 불가일정", "#dc2626"));

    Object.entries(allGroupsMeta).forEach(([gid, meta]) => {
      if (filterEnabled[gid] === undefined) filterEnabled[gid] = true;
      list.appendChild(makeFilterRow(gid, meta.name || "(이름 없음)", colorFromGroupId(gid)));
    });
  }

  function makeFilterRow(key, label, color) {
    const row = document.createElement("label");
    row.className = "filter-item";
    row.innerHTML =
      '<input type="checkbox"><span class="filter-color"></span><span class="filter-name"></span>';
    const cb = row.querySelector("input");
    const colorEl = row.querySelector(".filter-color");
    const nameEl = row.querySelector(".filter-name");
    cb.checked = !!filterEnabled[key];
    colorEl.style.background = color;
    nameEl.textContent = label;
    cb.addEventListener("change", () => {
      filterEnabled[key] = cb.checked;
      renderAllCalendar();
    });
    return row;
  }

  function setAllFilters(value) {
    Object.keys(filterEnabled).forEach((k) => (filterEnabled[k] = value));
    Object.keys(allGroupsMeta).forEach((gid) => (filterEnabled[gid] = value));
    filterEnabled["_global"] = value;
    renderFilter();
    renderAllCalendar();
  }

  function colorFromGroupId(gid) {
    return colorFromString("group:" + gid);
  }

  function renderAllCalendar() {
    if (!allCalendar) return;
    allCalendar.removeAllEvents();

    // Group events
    Object.entries(allGroupsEvents).forEach(([gid, evMap]) => {
      if (!filterEnabled[gid]) return;
      const meta = allGroupsMeta[gid] || {};
      const groupColor = colorFromGroupId(gid);
      Object.entries(evMap || {}).forEach(([eid, ev]) => {
        if (!ev || !ev.start || !ev.end) return;
        allCalendar.addEvent({
          id: gid + ":" + eid,
          title: `[${meta.name || "?"}] ${ev.title}${ev.author ? " · " + ev.author : ""}`,
          start: dateToYMD(ev.start),
          end: addDays(dateToYMD(ev.end), 1),
          allDay: true,
          backgroundColor: groupColor,
          borderColor: groupColor,
          extendedProps: { memo: ev.memo, groupId: gid, isGlobal: false },
        });
      });
    });

    // Global events
    if (filterEnabled["_global"]) {
      Object.entries(allGlobalsEvents).forEach(([eid, ev]) => {
        if (!ev || !ev.start || !ev.end) return;
        allCalendar.addEvent({
          id: "global:" + eid,
          title: `${ev.title}${ev.author ? " · " + ev.author : ""}`,
          start: dateToYMD(ev.start),
          end: addDays(dateToYMD(ev.end), 1),
          allDay: true,
          backgroundColor: "#dc2626",
          borderColor: "#dc2626",
          extendedProps: { memo: ev.memo, isGlobal: true },
        });
      });
    }
  }

  // ----- Memo + AI advice -----

  function loadMemo(groupId) {
    db.ref("groupMemos/" + groupId)
      .once("value")
      .then((snap) => {
        const data = snap.val();
        currentMemo = (data && data.text) || "";
        document.getElementById("memo-input").value = currentMemo;
      })
      .catch(() => {
        currentMemo = "";
      });
  }

  function saveMemo() {
    if (!isAdmin || !currentGroupId) return;
    const text = document.getElementById("memo-input").value.trim();
    db.ref("groupMemos/" + currentGroupId)
      .set({ text, updatedAt: firebase.database.ServerValue.TIMESTAMP })
      .then(() => {
        currentMemo = text;
        const btn = document.getElementById("memo-save-btn");
        const original = btn.textContent;
        btn.textContent = "저장됨";
        setTimeout(() => (btn.textContent = original), 1500);
      })
      .catch((err) => alert("저장 실패: " + err.message));
  }

  function buildPrompt() {
    const meta = currentGroupMeta || {};
    const memo = document.getElementById("memo-input").value.trim();

    const groupList = Object.values(groupEventsMap)
      .filter((ev) => ev && ev.start && ev.end)
      .map((ev) => `- ${ev.author}: ${ev.start} ~ ${ev.end} (${ev.title})${ev.memo ? " — " + ev.memo : ""}`)
      .join("\n") || "(없음)";

    const globalList = Object.values(globalEventsMap)
      .filter((ev) => ev && ev.start && ev.end)
      .map((ev) => `- ${ev.start} ~ ${ev.end}: ${ev.title}${ev.memo ? " — " + ev.memo : ""}`)
      .join("\n") || "(없음)";

    return `당신은 모임 일정 코디네이터입니다. 한국어로 간결하게 답변해주세요.

[모임 정보]
이름: ${meta.name || "(이름 없음)"}
가능 기간: ${meta.startDate || "(미지정)"} ~ ${meta.endDate || "(미지정)"}

[관리자 메모]
${memo || "(없음)"}

[등록된 개인 불가 일정]
${groupList}

[전역 불가 일정]
${globalList}

[참고 — 한국 휴일 컨텍스트]
다음날이 토/일 또는 공휴일인 날짜가 모임에 유리합니다 (다음날 쉴 수 있어서).

[요청]
1. 가장 추천하는 모임 날짜 1-3개와 그 이유 (다음날 휴일 여부 가산점)
2. 메모와 충돌하거나 주의할 점
3-5문장 이내, 마크다운 없이.`;
  }

  function copyPrompt() {
    const text = buildPrompt();
    const onSuccess = () =>
      alert("프롬프트가 복사되었습니다.\nChatGPT 또는 Claude.ai에 붙여넣어 모임 추천 날짜를 받아보세요.");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onSuccess, () => window.prompt("복사하세요:", text));
    } else {
      window.prompt("복사하세요:", text);
    }
  }

  // ----- Holiday / range / highlights -----

  function dayOfWeek(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  }

  function isRestDay(ymd) {
    const day = dayOfWeek(ymd);
    if (day === 0 || day === 6) return true;
    return ymd in KOREAN_HOLIDAYS;
  }

  function isNextDayRestDay(ymd) {
    return isRestDay(addDays(ymd, 1));
  }

  function isRedDay(ymd) {
    return dayOfWeek(ymd) === 0 || ymd in KOREAN_HOLIDAYS;
  }

  function isInGroupRange(ymd) {
    const meta = currentGroupMeta;
    if (!meta || !meta.startDate || !meta.endDate) return false;
    return ymd >= meta.startDate && ymd <= meta.endDate;
  }

  function refreshDayHighlights() {
    const cells = document.querySelectorAll(".fc-daygrid-day[data-date], .fc-day[data-date]");
    cells.forEach((cell) => {
      cell.classList.remove("day-priority", "day-holiday");
      const oldLabel = cell.querySelector(".holiday-label");
      if (oldLabel) oldLabel.remove();

      const ymd = cell.getAttribute("data-date");
      if (!ymd) return;

      if (isRedDay(ymd)) cell.classList.add("day-holiday");

      const holidayName = KOREAN_HOLIDAYS[ymd];
      if (holidayName && dayOfWeek(ymd) !== 0) {
        const top = cell.querySelector(".fc-daygrid-day-top");
        if (top && top.parentNode) {
          const label = document.createElement("div");
          label.className = "holiday-label";
          label.textContent = holidayName;
          top.parentNode.insertBefore(label, top.nextSibling);
        }
      }

      if (!isInGroupRange(ymd)) return;
      if (unavailableDatesSet.has(ymd)) return;
      if (!isNextDayRestDay(ymd)) return;
      cell.classList.add("day-priority");
    });
  }

  // ----- Event modal -----

  function openEventModal(data, id) {
    const isNewGlobal = data && data._newGlobal;
    const idIsGlobal = typeof id === "string" && id.startsWith("global:");
    const isGlobal = isNewGlobal || idIsGlobal || (data && data._global);

    // Allow opening from all-view for new global; don't require currentGroupId then
    if (!currentGroupId && !isNewGlobal && !isGlobal) {
      alert("모임 캘린더에서 일정을 등록해주세요.");
      return;
    }

    editingEventId = id || null;

    const myName = localStorage.getItem("lastAuthor") || "";
    const isExisting = !!id;
    const isMine = !isExisting || (!!myName && data.author === myName);
    const canDelete = isExisting && (isAdmin || isMine);
    const authorLocked = isExisting && !isMine && !isAdmin;

    const modalTitle = !isExisting
      ? isGlobal
        ? "전역 불가일정 등록"
        : "불가 일정 등록"
      : isGlobal
      ? "전역 불가일정 수정"
      : "불가 일정 수정";
    document.getElementById("event-modal-title").textContent = modalTitle;

    document.getElementById("event-title").value = data.title || "";

    const authorEl = document.getElementById("event-author");
    authorEl.value = data.author || myName || (isGlobal ? "관리자" : "");
    authorEl.readOnly = authorLocked;
    authorEl.classList.toggle("readonly", authorLocked);

    document.getElementById("event-start").value = data.start ? dateToYMD(data.start) : "";
    document.getElementById("event-end").value = data.end ? dateToYMD(data.end) : "";
    document.getElementById("event-memo").value = data.memo || "";
    document.getElementById("event-delete-btn").classList.toggle("hidden", !canDelete);
    document.getElementById("event-other-hint").classList.toggle("hidden", !authorLocked);

    // 전역 체크박스: 관리자만, 신규 등록 시에만 토글 가능
    const globalRow = document.getElementById("event-global-row");
    const globalCheck = document.getElementById("event-global-check");
    if (isAdmin && !isExisting) {
      globalRow.classList.remove("hidden");
      globalCheck.checked = !!isNewGlobal;
      globalCheck.disabled = false;
    } else if (isAdmin && isExisting && isGlobal) {
      globalRow.classList.remove("hidden");
      globalCheck.checked = true;
      globalCheck.disabled = true;
    } else {
      globalRow.classList.add("hidden");
      globalCheck.checked = false;
    }

    applyEventInputBounds(isGlobal);
    document.getElementById("event-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("event-title").focus(), 50);
  }

  function applyEventInputBounds(isGlobal) {
    const startEl = document.getElementById("event-start");
    const endEl = document.getElementById("event-end");
    const meta = isGlobal ? {} : currentGroupMeta || {};
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
    const isExistingGlobal = typeof editingEventId === "string" && editingEventId.startsWith("global:");
    const newGlobalChecked = document.getElementById("event-global-check").checked;
    const isGlobal = isExistingGlobal || (!editingEventId && isAdmin && newGlobalChecked);

    if (!title || !author || !startStr || !endStr) {
      alert("제목, 등록자, 시작일, 종료일은 필수입니다.");
      return;
    }
    if (endStr < startStr) {
      alert("종료일은 시작일 이후여야 합니다.");
      return;
    }

    if (!isGlobal) {
      const meta = currentGroupMeta || {};
      if (meta.startDate && meta.endDate) {
        if (startStr < meta.startDate || endStr > meta.endDate) {
          alert(`이 모임은 ${meta.startDate} ~ ${meta.endDate} 기간만 등록 가능합니다.`);
          return;
        }
      }
    }

    if (editingEventId) {
      const orig = isExistingGlobal
        ? globalEventsMap[editingEventId.replace("global:", "")] || allGlobalsEvents[editingEventId.replace("global:", "")]
        : groupEventsMap[editingEventId];
      const myName = localStorage.getItem("lastAuthor") || "";
      if (orig && !isAdmin && (!myName || orig.author !== myName) && orig.author !== author) {
        alert("다른 분이 등록한 일정의 등록자명은 변경할 수 없습니다.");
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

    let op;
    if (isExistingGlobal) {
      const realId = editingEventId.replace("global:", "");
      op = db.ref("globalEvents/" + realId).set(event);
    } else if (editingEventId) {
      op = db.ref("groups/" + currentGroupId + "/events/" + editingEventId).set(event);
    } else if (isGlobal) {
      op = db.ref("globalEvents").push(event);
    } else {
      op = db.ref("groups/" + currentGroupId + "/events").push(event);
    }
    Promise.resolve(op).catch((err) => alert("저장 실패: " + err.message));
    closeEventModal();
  }

  function deleteEvent() {
    if (!editingEventId) return;
    const isExistingGlobal = editingEventId.startsWith("global:");
    let ev;
    if (isExistingGlobal) {
      const realId = editingEventId.replace("global:", "");
      ev = globalEventsMap[realId] || allGlobalsEvents[realId];
    } else {
      ev = groupEventsMap[editingEventId];
    }
    const myName = localStorage.getItem("lastAuthor") || "";
    if (ev && !isAdmin && (!myName || ev.author !== myName)) {
      alert("다른 분이 등록한 일정은 삭제할 수 없습니다.");
      return;
    }
    if (isExistingGlobal && !isAdmin) {
      alert("전역 일정은 관리자만 삭제할 수 있습니다.");
      return;
    }
    if (!confirm("이 일정을 삭제할까요?")) return;

    let op;
    if (isExistingGlobal) {
      const realId = editingEventId.replace("global:", "");
      op = db.ref("globalEvents/" + realId).remove();
    } else {
      op = db.ref("groups/" + currentGroupId + "/events/" + editingEventId).remove();
    }
    op.catch((err) => alert("삭제 실패: " + err.message));
    closeEventModal();
  }

  function copyShareLink() {
    if (!currentGroupId) return;
    const url = `${location.origin}${location.pathname}?g=${encodeURIComponent(currentGroupId)}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(
        () => alert("공유 링크가 복사되었습니다:\n" + url),
        () => window.prompt("아래 링크를 복사하세요:", url)
      );
    } else {
      window.prompt("아래 링크를 복사하세요:", url);
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
