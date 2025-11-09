// Full-featured quiz script
let questions = [], chapters = [], progress = {}, settings = {sound:true, confirm:true};
const QUESTIONS_PER_LEVEL = 12;
const TIME_PER_Q = 15;

fetch('questions.json').then(r=>r.json()).then(d=>{ questions = d; chapters = Array.from(new Set(questions.map(q=>q.chapter))); boot(); });

// Audio helpers (WebAudio)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function beep(freq, duration=0.08, type='sine', gain=0.08){
  if(!settings.sound) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); setTimeout(()=>{ o.stop(); }, duration*1000);
}

// UI helpers
const $ = id => document.getElementById(id);
function show(screen){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); $(screen).classList.add('active'); }

// State
let curChapter=0, curLevel=1, levelQs=[], qIndex=0, timerId=null, timeLeft=TIME_PER_Q;
let levelScore = {correct:0, timeBonus:0}, levelStartTime=0;

// Progress & Leaderboard stored in localStorage
function loadState(){
  progress = JSON.parse(localStorage.getItem('cq_progress')||'{}');
  settings = JSON.parse(localStorage.getItem('cq_settings')||JSON.stringify(settings));
  if(Object.keys(progress).length===0){
    // init unlocks: chapter0 level1 unlocked
    for(let i=0;i<chapters.length;i++) progress[i]=[];
    progress[0]=[1];
    saveProgress();
  }
}
function saveProgress(){ localStorage.setItem('cq_progress', JSON.stringify(progress)); }
function saveSettings(){ localStorage.setItem('cq_settings', JSON.stringify(settings)); }

// Boot
function boot(){
  loadState(); bindUI(); renderLeaderboardPreview(); show('startScreen');
  // matrix init
  initMatrix();
}

function bindUI(){
  $('startBtn').onclick = ()=> showChapters();
  $('dailyBtn').onclick = ()=> startDaily();
  $('backFromChapters').onclick = ()=> show('startScreen');
  $('backFromLevels').onclick = ()=> show('chaptersScreen');
  $('retryBtn').onclick = ()=> startLevel(curChapter, curLevel);
  $('nextBtn').onclick = ()=> { stopTimer(); qIndex++; nextQuestion(); }
  $('btnSettings').onclick = ()=> { show('settingsScreen'); $('soundToggle').checked = settings.sound; }
  $('closeSettings').onclick = ()=> { settings.sound = $('soundToggle').checked; saveSettings(); show('startScreen'); }
  $('clearProgress').onclick = ()=> { if(settings.confirm && !confirm('Clear progress?')) return; localStorage.removeItem('cq_progress'); loadState(); renderChapters(); show('startScreen'); }
  $('btnExport').onclick = exportProgress;
  $('btnImport').onclick = ()=> $('importFile').click();
  $('importFile').onchange = importProgress;
  $('btnExport').title = 'Export your progress and leaderboard as JSON';
  document.getElementById('soundToggle').onchange = e=> settings.sound = e.target.checked;
  renderChapters();
}

// Chapters & Levels rendering
function renderChapters(){
  const grid = document.getElementById('chaptersGrid'); grid.innerHTML='';
  chapters.forEach((c,idx)=>{
    const div = document.createElement('div'); div.className='card'; div.innerHTML = `<strong>Chapter ${idx+1}</strong><div style="font-size:13px;margin-top:6px">${c}</div>`;
    const unlocked = progress[idx] && progress[idx].length>0;
    if(!unlocked) { div.classList.add('locked'); }
    div.onclick = ()=> unlocked ? openLevels(idx) : beep(220,0.05);
    grid.appendChild(div);
  });
}
function showChapters(){ renderChapters(); show('chaptersScreen'); }
function openLevels(chIdx){
  curChapter = chIdx; const title = document.getElementById('chapterTitle'); title.innerText = `Chapter ${chIdx+1}: ${chapters[chIdx]}`;
  const grid = document.getElementById('levelsGrid'); grid.innerHTML='';
  for(let lv=1; lv<=10; lv++){
    const div = document.createElement('div'); div.className='card'; div.innerHTML=`<strong>Level ${lv}</strong><div style="font-size:12px">Difficulty: ${lv<=3?'Easy':(lv<=7?'Medium':'Hard')}</div>`;
    const unlocked = progress[chIdx] && progress[chIdx].includes(lv);
    if(!unlocked) div.classList.add('locked');
    div.onclick = ()=> unlocked ? startLevel(chIdx, lv) : beep(180,0.05);
    grid.appendChild(div);
  }
  show('levelsScreen');
}

// Start level
function startLevel(ch, lv){
  curChapter = ch; curLevel = lv; levelScore = {correct:0, timeBonus:0}; qIndex=0;
  // select QUESTIONS_PER_LEVEL unique questions for this level
  const pool = questions.filter(q=>q.chapterIndex===ch && q.level===lv);
  // shuffle and slice
  levelQs = shuffleArray(pool).slice(0, QUESTIONS_PER_LEVEL);
  renderQuestionCount();
  show('quizScreen'); nextQuestion();
}

function startDaily(){
  // daily practice: pick random chapter/level
  const ch = Math.floor(Math.random()*chapters.length);
  const lv = Math.floor(Math.random()*10)+1;
  // ensure unlocked or unlock for daily
  if(!progress[ch] || !progress[ch].includes(lv)){ if(!progress[ch]) progress[ch]=[]; progress[ch].push(lv); saveProgress(); }
  startLevel(ch, lv);
}

// Question loop
function nextQuestion(){
  if(qIndex>=levelQs.length){ levelComplete(); return; }
  renderProgressBar();
  const q = levelQs[qIndex];
  document.getElementById('qInfo').innerText = `Chap ${curChapter+1} • Level ${curLevel} • Q ${qIndex+1}/${levelQs.length}`;
  document.getElementById('questionText').innerText = q.question;
  const opts = document.getElementById('options'); opts.innerHTML='';
  q.options.forEach((o,idx)=>{
    const b = document.createElement('div'); b.className='option'; b.innerText = o; b.onclick = ()=> selectOption(idx);
    opts.appendChild(b);
  });
  document.getElementById('feedback').innerText='';
  // timer
  timeLeft = TIME_PER_Q; document.getElementById('timer').innerText = timeLeft; stopTimer();
  timerId = setInterval(()=>{ timeLeft--; document.getElementById('timer').innerText = timeLeft; if(timeLeft<=0) { stopTimer(); autoSkip(); } }, 1000);
  levelStartTime = Date.now();
}

function selectOption(idx){
  stopTimer();
  const q = levelQs[qIndex];
  const opts = document.querySelectorAll('.option');
  opts.forEach((el,i)=>{ if(i===q.answer) el.classList.add('correct'); if(i===idx && i!==q.answer) el.classList.add('wrong'); });
  if(idx===q.answer){ levelScore.correct++; const tb = Math.max(0, Math.floor(timeLeft/1)); levelScore.timeBonus += tb; beep(900,0.06); } else beep(200,0.06,'sawtooth');
  document.getElementById('feedback').innerText = (idx===q.answer)?'Correct':'Incorrect';
  // show next button
  document.getElementById('nextBtn').style.display='inline-block';
}

function autoSkip(){ document.getElementById('feedback').innerText='Time up'; beep(300,0.06); document.getElementById('nextBtn').style.display='inline-block'; }

function stopTimer(){ if(timerId) clearInterval(timerId); timerId = null; }

function levelComplete(){
  stopTimer();
  // compute score percent
  const total = levelQs.length;
  const percent = Math.round((levelScore.correct/total)*100);
  // save leaderboard entry
  saveLeaderboardEntry({chapter:curChapter,level:curLevel,correct:levelScore.correct,total:total,percent:percent,time:new Date().toISOString()});
  // unlock next level
  if(!progress[curChapter]) progress[curChapter]=[];
  if(curLevel<10 && !progress[curChapter].includes(curLevel+1)) progress[curChapter].push(curLevel+1);
  if(curLevel===10 && curChapter<chapters.length-1){ if(!progress[curChapter+1]) progress[curChapter+1]=[]; if(!progress[curChapter+1].includes(1)) progress[curChapter+1].push(1); }
  saveProgress();
  renderChapters();
  // show results and leaderboard preview
  alert(`Level complete!\nCorrect: ${levelScore.correct}/${total}\nScore: ${percent}%`);
  renderLeaderboardPreview();
  show('chaptersScreen');
}

// utilities
function shuffleArray(a){ const arr=a.slice(); for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]] } return arr; }

// Leaderboard (local simple)
function leaderboardKey(){ return 'cq_leaderboard_v1'; }
function saveLeaderboardEntry(entry){
  const lb = JSON.parse(localStorage.getItem(leaderboardKey())||'[]');
  lb.push(entry);
  // keep top 50 sorted by percent desc then recent
  lb.sort((a,b)=> b.percent - a.percent || new Date(b.time)-new Date(a.time));
  localStorage.setItem(leaderboardKey(), JSON.stringify(lb.slice(0,200)));
  renderLeaderboardPreview();
}
function renderLeaderboardPreview(){
  const lb = JSON.parse(localStorage.getItem(leaderboardKey())||'[]');
  const el = $('leaderPreview'); el.innerHTML='';
  lb.slice(0,5).forEach(e=>{ const li=document.createElement('li'); li.innerText = `Ch${e.chapter+1}L${e.level}: ${e.percent}% (${e.correct}/${e.total})`; el.appendChild(li); });
}
function renderLeaderboardFull(){
  const lb = JSON.parse(localStorage.getItem(leaderboardKey())||'[]');
  const container = $('leaderboardList'); container.innerHTML='';
  if(lb.length===0) container.innerHTML='<div class="muted">No entries yet</div>';
  lb.forEach(e=>{ const d=document.createElement('div'); d.className='card'; d.innerText = `Ch${e.chapter+1} L${e.level} — ${e.percent}% — ${e.correct}/${e.total} — ${new Date(e.time).toLocaleString()}`; container.appendChild(d); });
}

// Export / Import progress + leaderboard
function exportProgress(){
  const data = {progress: progress, leaderboard: JSON.parse(localStorage.getItem(leaderboardKey())||'[]'), settings: settings};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'c_quiz_export.json'; a.click(); URL.revokeObjectURL(url);
}
function importProgress(e){
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader(); reader.onload = ev=>{
    try{
      const data = JSON.parse(ev.target.result);
      if(data.progress) progress = data.progress;
      if(data.leaderboard) localStorage.setItem(leaderboardKey(), JSON.stringify(data.leaderboard));
      if(data.settings) settings = data.settings;
      saveProgress(); saveSettings();
      alert('Import successful');
      renderChapters(); renderLeaderboardPreview();
      show('startScreen');
    }catch(err){ alert('Invalid file'); }
  }; reader.readAsText(f);
}

// Progress bar render
function renderProgressBar(){ const pct = Math.round((qIndex/QUESTIONS_PER_LEVEL)*100); $('progressFill').style.width = pct + '%'; }

// Matrix animation
function initMatrix(){
  const canvas = document.getElementById('matrixCanvas'); const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = window.innerWidth; canvas.height = window.innerHeight; cols = Math.floor(canvas.width/18)+1; drops = new Array(cols).fill(0); }
  let cols, drops, chars='01abcdefghijklmnopqrstuvwxyz@#$%&*()*+-/?<>', fps=30;
  window.addEventListener('resize', resize); resize();
  function draw(){
    ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#0f0'; ctx.font = '14px monospace';
    for(let i=0;i<drops.length;i++){
      const text = chars[Math.floor(Math.random()*chars.length)];
      ctx.fillText(text, i*18, drops[i]*18);
      if(drops[i]*18 > canvas.height && Math.random() > 0.975) drops[i]=0;
      drops[i]++;
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// export for console-free use (do nothing)
window.addEventListener('load', ()=>{ /* nothing */ });

// initial render
function renderQuestionCount(){/* placeholder, can show progress per level */}

// keyboard accessibility & touch helpers
document.addEventListener('keydown', e=>{
  if(e.key==='Enter' && document.getElementById('nextBtn').style.display!=='none'){ document.getElementById('nextBtn').click(); }
});

// Expose small functions for UI templates
window.openLevels = openLevels;
window.startLevel = startLevel;
window.showChapters = showChapters;
window.startDaily = startDaily;
