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

