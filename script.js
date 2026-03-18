// ===== DATA & STATE =====
const DIRECTIONS = ["north", "south", "east", "west"];

let tasks = [
  { id: "t1", name: "North Lane", type: "normal", direction: "north", arrivalTime: 0, burstTime: 4, deadline: 18, priority: 3 },
  { id: "t2", name: "Ambulance (South)", type: "emergency", direction: "south", arrivalTime: 1, burstTime: 3, deadline: 8, priority: 1 },
  { id: "t3", name: "Firetruck (South)", type: "firetruck", direction: "south", arrivalTime: 2, burstTime: 4, deadline: 10, priority: 0 },
  { id: "t4", name: "East Lane", type: "normal", direction: "east", arrivalTime: 2, burstTime: 4, deadline: 20, priority: 3 },
  { id: "t5", name: "Normal West", type: "normal", direction: "west", arrivalTime: 4, burstTime: 3, deadline: 30, priority: 3 }
];

let algorithm = "round-robin";
let quantum = 2;
let speed = 3;
let currentTime = 0;
let isRunning = false;
let intervalId = null;
let rrResult = emptyResult();
let edfResult = emptyResult();

const COLOR_PALETTE = [
  "hsl(199,89%,48%)", "hsl(142,71%,45%)", "hsl(262,83%,58%)",
  "hsl(38,92%,50%)", "hsl(180,70%,45%)", "hsl(320,70%,50%)",
  "hsl(50,90%,50%)", "hsl(210,70%,55%)"
];
const taskColorMap = {};
function getTaskColor(taskId, taskType) {
  if (taskType === "emergency") return "hsl(0,72%,51%)";
  if (taskType === "firetruck") return "hsl(15,90%,55%)";
  if (!taskColorMap[taskId]) {
    const idx = Object.keys(taskColorMap).length % COLOR_PALETTE.length;
    taskColorMap[taskId] = COLOR_PALETTE[idx];
  }
  return taskColorMap[taskId];
}

// ===== SCHEDULING ALGORITHMS =====
function emptyResult() { return { gantt: [], avgWaitingTime: 0, avgTurnaroundTime: 0, deadlineMisses: 0, utilization: 0, taskDetails: {} }; }

function runRoundRobin(tasks, quantum) {
  if (!tasks.length) return emptyResult();
  const queue = tasks.map(t => ({ ...t, remainingTime: t.burstTime }));
  queue.sort((a, b) => a.arrivalTime - b.arrivalTime);
  const gantt = [], completionTime = {};
  let time = 0, idx = 0;
  const ready = [];

  while (idx < queue.length || ready.length > 0) {
    // Add arrived tasks
    while (idx < queue.length && queue[idx].arrivalTime <= time) {
      ready.push(queue[idx]);
      idx++;
    }

    // Jump time if idle
    if (ready.length === 0) {
      time = queue[idx]?.arrivalTime ?? time + 1;
      continue;
    }

    // In strict Round Robin, there is NO PRIORITY sorting. We just take the front of the queue.
    const task = ready.shift();
    const execTime = Math.min(quantum, task.remainingTime);

    gantt.push({ taskId: task.id, taskName: task.name, taskType: task.type, startTime: time, endTime: time + execTime, direction: task.direction });
    time += execTime;
    task.remainingTime -= execTime;

    // Check arrivals during execution
    while (idx < queue.length && queue[idx].arrivalTime <= time) {
      ready.push(queue[idx]);
      idx++;
    }

    // Re-queue task if not finished
    if (task.remainingTime > 0) {
      ready.push(task);
    } else {
      completionTime[task.id] = time;
    }
  }
  return computeMetrics(tasks, gantt, completionTime, time);
}

function runEDF(tasks) {
  if (!tasks.length) return emptyResult();
  const queue = tasks.map(t => ({ ...t, remainingTime: t.burstTime }));
  queue.sort((a, b) => a.arrivalTime - b.arrivalTime);
  const gantt = [], completionTime = {};
  let time = 0, idx = 0;
  const ready = [];

  let currentTask = null;
  let curStart = 0;

  const sortReady = (q) => {
    q.sort((a, b) => {
      if (a.type === "firetruck" && b.type !== "firetruck") return -1;
      if (b.type === "firetruck" && a.type !== "firetruck") return 1;
      if (a.type === "emergency" && b.type !== "emergency" && b.type !== "firetruck") return -1;
      if (b.type === "emergency" && a.type !== "emergency" && a.type !== "firetruck") return 1;
      return a.deadline - b.deadline;
    });
  };

  while (idx < queue.length || ready.length > 0 || currentTask) {
    let arrived = false;
    while (idx < queue.length && queue[idx].arrivalTime <= time) {
      ready.push(queue[idx]);
      idx++;
      arrived = true;
    }

    if (arrived && currentTask) {
      const isCurrentNonPreemptive = currentTask.type === "firetruck" || currentTask.type === "emergency";
      if (!isCurrentNonPreemptive) {
        sortReady(ready);
        const best = ready[0];
        const isBestEmergency = best.type === "firetruck" || best.type === "emergency";
        if (isBestEmergency || best.deadline < currentTask.deadline) {
          gantt.push({ taskId: currentTask.id, taskName: currentTask.name, taskType: currentTask.type, startTime: curStart, endTime: time, direction: currentTask.direction });
          ready.push(currentTask);
          currentTask = null;
        }
      }
    }

    if (!currentTask) {
      if (ready.length > 0) {
        sortReady(ready);
        currentTask = ready.shift();
        curStart = time;
      } else {
        if (idx < queue.length) {
          time = queue[idx].arrivalTime;
          continue;
        }
      }
    }

    if (currentTask) {
      let nextCompleteTime = time + currentTask.remainingTime;
      let nextArrivalTime = (idx < queue.length) ? queue[idx].arrivalTime : Infinity;

      const isCurrentNonPreemptive = currentTask.type === "firetruck" || currentTask.type === "emergency";
      let runUntil = nextCompleteTime;
      if (!isCurrentNonPreemptive && nextArrivalTime < nextCompleteTime) {
        runUntil = nextArrivalTime;
      }

      const execTime = runUntil - time;
      currentTask.remainingTime -= execTime;
      time = runUntil;

      if (currentTask.remainingTime <= 0) {
        gantt.push({ taskId: currentTask.id, taskName: currentTask.name, taskType: currentTask.type, startTime: curStart, endTime: time, direction: currentTask.direction });
        completionTime[currentTask.id] = time;
        currentTask = null;
      }
    }
  }
  return computeMetrics(tasks, gantt, completionTime, time);
}

function computeMetrics(tasks, gantt, completionTime, totalTime) {
  let totalWaiting = 0, totalTurnaround = 0, deadlineMisses = 0;
  const totalBurst = tasks.reduce((s, t) => s + t.burstTime, 0);
  const taskDetails = {};
  tasks.forEach(t => {
    const ct = completionTime[t.id] ?? totalTime;
    const turnaround = ct - t.arrivalTime;
    const waiting = turnaround - t.burstTime;
    taskDetails[t.id] = { waiting: Math.max(0, waiting) };
    totalTurnaround += turnaround;
    totalWaiting += Math.max(0, waiting);
    if (ct > t.deadline) deadlineMisses++;
  });
  return {
    gantt,
    avgWaitingTime: +(totalWaiting / tasks.length).toFixed(2),
    avgTurnaroundTime: +(totalTurnaround / tasks.length).toFixed(2),
    deadlineMisses,
    utilization: totalTime > 0 ? +((totalBurst / totalTime) * 100).toFixed(1) : 0,
    taskDetails
  };
}

// ===== RENDERING =====
function computeSchedules() {
  rrResult = runRoundRobin(tasks, quantum);
  edfResult = runEDF(tasks);
}

function getActiveGantt() {
  if (algorithm === "edf") return edfResult.gantt;
  return rrResult.gantt;
}

function renderIntersection() {
  const gantt = getActiveGantt();
  const active = gantt.find(g => g.startTime <= currentTime && g.endTime > currentTime);
  const state = { north: "red", south: "red", east: "red", west: "red", activeTask: null };
  if (active) {
    const task = tasks.find(t => t.id === active.taskId);
    state[active.direction] = "green";
    state.activeTask = task || null;
  }

  // Time display
  document.getElementById("sim-time").textContent = currentTime;
  const badgeEl = document.getElementById("active-task-badge");
  if (state.activeTask) {
    badgeEl.textContent = state.activeTask.name;
    badgeEl.className = "task-badge " + (state.activeTask.type === "emergency" ? "emergency" : (state.activeTask.type === "firetruck" ? "firetruck" : "normal"));
    badgeEl.style.display = "inline";
  } else {
    badgeEl.style.display = "none";
  }

  // Traffic lights
  DIRECTIONS.forEach(dir => {
    const color = state[dir];
    document.querySelectorAll(`.tl-${dir} .tl-bulb`).forEach(b => {
      b.className = "tl-bulb";
      const bulbColor = b.dataset.color;
      if (bulbColor === color) b.classList.add("on-" + color);
    });
    // Status dots
    const dot = document.querySelector(`.status-${dir} .dir-dot`);
    if (dot) dot.className = "dir-dot " + color;
    const label = document.querySelector(`.status-${dir} .dir-state`);
    if (label) label.textContent = color.toUpperCase();
  });

  // Vehicle
  const vehicleEl = document.getElementById("vehicle");
  if (state.activeTask) {
    vehicleEl.style.display = "block";
    vehicleEl.className = "vehicle " + state.activeTask.type + " dir-" + state.activeTask.direction;
  } else {
    vehicleEl.style.display = "none";
  }
}

function renderGantt(gantt, containerId, title) {
  const container = document.getElementById(containerId);
  if (!gantt.length) {
    container.innerHTML = `<div class="card gantt-card"><h3>${title}</h3><p class="gantt-empty">No schedule data. Run the simulation.</p></div>`;
    return;
  }
  const maxTime = Math.max(...gantt.map(g => g.endTime), currentTime + 1);
  const uniqueTasks = [...new Set(gantt.map(g => g.taskId))];

  let html = `<div class="card gantt-card"><h3>${title}</h3>`;
  // Time axis
  html += `<div class="gantt-time-axis">`;
  for (let i = 0; i <= maxTime; i++) {
    html += `<span style="width:${100 / maxTime}%">${i}</span>`;
  }
  html += `</div>`;

  uniqueTasks.forEach(taskId => {
    const entries = gantt.filter(g => g.taskId === taskId);
    const color = getTaskColor(taskId, entries[0].taskType);
    html += `<div class="gantt-row"><span class="gantt-label">${entries[0].taskName}</span><div class="gantt-track">`;
    entries.forEach(e => {
      const left = (e.startTime / maxTime) * 100;
      const width = ((e.endTime - e.startTime) / maxTime) * 100;
      const opacity = e.endTime <= currentTime ? 1 : 0.4;
      let cls = "gantt-bar";
      let icon = "🚗";
      if (e.taskType === "emergency") { cls += " emergency-bar"; icon = "🚑"; }
      else if (e.taskType === "firetruck") { cls += " firetruck-bar"; icon = "🚒"; }
      html += `<div class="${cls}" style="left:${left}%;width:${width}%;background:${color};opacity:${opacity}"><span class="gantt-icon">${icon}</span></div>`;
    });
    html += `<div class="gantt-marker" style="left:${(currentTime / maxTime) * 100}%"></div>`;
    html += `</div></div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

function renderMetrics(result, containerId, label, compareResult) {
  const metrics = [
    { icon: "⏱", label: "Avg Wait", value: result.avgWaitingTime, unit: "t", compare: compareResult?.avgWaitingTime, lowerBetter: true },
    { icon: "⏳", label: "Avg Turnaround", value: result.avgTurnaroundTime, unit: "t", compare: compareResult?.avgTurnaroundTime, lowerBetter: true },
    { icon: "⚠", label: "Deadline Misses", value: result.deadlineMisses, unit: "", compare: compareResult?.deadlineMisses, lowerBetter: true },
    { icon: "⚡", label: "Utilization", value: result.utilization, unit: "%", compare: compareResult?.utilization, lowerBetter: false },
  ];
  let html = `<div class="metrics-section"><span class="metrics-label">${label}</span><div class="metrics-grid">`;
  metrics.forEach(m => {
    let winner = false;
    if (compareResult !== undefined) {
      winner = m.lowerBetter ? m.value <= m.compare : m.value >= m.compare;
    }
    html += `<div class="card metric-card ${winner && compareResult !== undefined ? 'winner' : ''}">
      <span class="metric-icon">${m.icon}</span>
      <span class="metric-value">${m.value}${m.unit}</span>
      <span class="metric-name">${m.label}</span>
    </div>`;
  });
  html += `</div></div>`;
  document.getElementById(containerId).innerHTML = html;
}

function renderComparison() {
  const container = document.getElementById("comparison");
  if (algorithm !== "compare") { container.innerHTML = ""; return; }
  const metrics = [
    { name: "Avg Wait", rr: rrResult.avgWaitingTime, edf: edfResult.avgWaitingTime, lowerBetter: true },
    { name: "Avg Turn.", rr: rrResult.avgTurnaroundTime, edf: edfResult.avgTurnaroundTime, lowerBetter: true },
    { name: "Deadline Miss", rr: rrResult.deadlineMisses, edf: edfResult.deadlineMisses, lowerBetter: true },
    { name: "Utilization %", rr: rrResult.utilization, edf: edfResult.utilization, lowerBetter: false },
  ];
  let rrWins = 0, edfWins = 0;
  metrics.forEach(m => {
    if (m.lowerBetter) { if (m.rr < m.edf) rrWins++; else if (m.edf < m.rr) edfWins++; }
    else { if (m.rr > m.edf) rrWins++; else if (m.edf > m.rr) edfWins++; }
  });
  const winner = rrWins > edfWins ? "Round Robin" : edfWins > rrWins ? "EDF" : "Tie";
  const maxVal = Math.max(...metrics.map(m => Math.max(m.rr, m.edf)), 1);

  let html = `<div class="card comparison-card"><h3><span class="trophy">🏆</span> Comparison Summary — Winner: <span class="text-primary">${winner}</span></h3><div class="bar-chart">`;
  metrics.forEach(m => {
    html += `<div class="bar-group"><span class="label">${m.name}</span><div class="bars">
      <div class="bar-item"><div class="bar-fill rr" style="width:${(m.rr / maxVal) * 100}%"></div><span class="bar-val">${m.rr}</span></div>
      <div class="bar-item"><div class="bar-fill edf" style="width:${(m.edf / maxVal) * 100}%"></div><span class="bar-val">${m.edf}</span></div>
    </div></div>`;
  });
  html += `</div><div class="bar-legend"><span><span class="dot" style="background:var(--primary)"></span> Round Robin</span><span><span class="dot" style="background:var(--accent)"></span> EDF</span></div></div>`;
  container.innerHTML = html;
}

function renderTaskTable() {
  const tbody = document.getElementById("task-tbody");
  tbody.innerHTML = "";

  let activeDetails = null;
  if (algorithm === "round-robin" && rrResult.taskDetails) activeDetails = rrResult.taskDetails;
  else if (algorithm === "edf" && edfResult.taskDetails) activeDetails = edfResult.taskDetails;

  tasks.forEach(t => {
    const tr = document.createElement("tr");
    if (t.type === "emergency") tr.className = "emergency-row";
    else if (t.type === "firetruck") tr.className = "firetruck-row";

    let waitText = "-";
    if (activeDetails && activeDetails[t.id]) {
      waitText = activeDetails[t.id].waiting;
    } else if (algorithm === "compare") {
      let rrWait = rrResult.taskDetails && rrResult.taskDetails[t.id] ? rrResult.taskDetails[t.id].waiting : "-";
      let edfWait = edfResult.taskDetails && edfResult.taskDetails[t.id] ? edfResult.taskDetails[t.id].waiting : "-";
      waitText = `${rrWait} / ${edfWait}`;
    }

    tr.innerHTML = `
      <td><input value="${t.name}" data-id="${t.id}" data-field="name" ${isRunning ? 'disabled' : ''}></td>
      <td><select data-id="${t.id}" data-field="type" ${isRunning ? 'disabled' : ''}>
        <option value="normal" ${t.type === 'normal' ? 'selected' : ''}>Normal</option>
        <option value="emergency" ${t.type === 'emergency' ? 'selected' : ''}>Ambulance</option>
        <option value="firetruck" ${t.type === 'firetruck' ? 'selected' : ''}>Firetruck</option>
      </select></td>
      <td><select data-id="${t.id}" data-field="direction" ${isRunning ? 'disabled' : ''}>
        ${DIRECTIONS.map(d => `<option value="${d}" ${t.direction === d ? 'selected' : ''}>${d[0].toUpperCase()}</option>`).join('')}
      </select></td>
      <td><input type="number" min="0" value="${t.arrivalTime}" data-id="${t.id}" data-field="arrivalTime" ${isRunning ? 'disabled' : ''}></td>
      <td><input type="number" min="1" value="${t.burstTime}" data-id="${t.id}" data-field="burstTime" ${isRunning ? 'disabled' : ''}></td>
      <td><input type="number" min="1" value="${t.deadline}" data-id="${t.id}" data-field="deadline" ${isRunning ? 'disabled' : ''}></td>
      <td class="wait-time-col"><span>${waitText}</span></td>
      <td><button class="del-btn" data-id="${t.id}" ${isRunning ? 'disabled' : ''}>✕</button></td>
    `;
    tbody.appendChild(tr);
  });
