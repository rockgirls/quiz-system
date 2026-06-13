/**
 * 在线答题系统 v2 - 完整版
 * 支持: 刷题/模拟考试/背题/错题本/统计看板
 */
// ============================================================
// 数据存储层
// ============================================================
const DB = {
    KEY: 'quiz3600_data',
    _data: null,

    _defaults() {
        return {
            // 刷题模式
            practice: { mode: 'seq', answered: {}, correctMap: {}, chapter: 'all' },
            // 模拟考试
            exams: [],
            // 背题模式
            flashcard: { mode: 'seq', mastered: {}, idx: 0 },
            // 错题本
            wrongBook: [],
            // 统计
            stats: { totalAnswered: 0, totalCorrect: 0, sessions: 0, studySeconds: 0, lastActive: null, dailyLog: {} },
            // 当前状态
            currentPage: 'practice'
        };
    },

    load() {
        if (this._data) return this._data;
        try {
            const raw = localStorage.getItem(this.KEY);
            this._data = raw ? { ...this._defaults(), ...JSON.parse(raw) } : this._defaults();
        } catch { this._data = this._defaults(); }
        return this._data;
    },

    save() {
        try { localStorage.setItem(this.KEY, JSON.stringify(this._data)); } catch {}
    },

    get(k) { return this.load()[k]; },
    set(k, v) { this.load()[k] = v; this.save(); },
    update(k, fn) { const d = this.load(); d[k] = fn(d[k]); this.save(); },

    reset() {
        this._data = this._defaults();
        this.save();
    }
};

// ============================================================
// 全局状态
// ============================================================
const STATE = {
    questions: [],
    chapters: [],
    practice: {
        list: [], idx: 0, answered: {}, correctMap: {}, chapter: 'all', mode: 'seq'
    },
    exam: {
        list: [], idx: 0, answers: {}, startTime: null, timerId: null, remaining: 0,
        finished: false, TIMER_MINUTES: 30
    },
    flashcard: {
        list: [], idx: 0, mode: 'seq', mastered: {}, showAnswer: false
    },
    wrongBook: [],
    stats: { totalAnswered: 0, totalCorrect: 0, sessions: 0, studySeconds: 0 },
    currentPage: 'practice'
};

// ============================================================
// DOM 辅助
// ============================================================
const $id = id => document.getElementById(id);
const $q = (sel, ctx=document) => ctx.querySelector(sel);
const $qa = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];

function showPage(id) {
    $qa('.page').forEach(p => p.classList.remove('active'));
    const el = $id(id);
    if (el) el.classList.add('active');
    $qa('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === id));
    STATE.currentPage = id;
    DB.set('currentPage', id);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showConfirm(title, msg, onOk) {
    const modal = $id('confirmModal');
    $q('.modal-box h3', modal).textContent = title;
    $q('.modal-box p', modal).textContent = msg;
    modal.classList.add('show');
    modal._onOk = onOk;
}

function hideConfirm() {
    $id('confirmModal').classList.remove('show');
}

// ============================================================
// 初始化
// ============================================================
async function init() {
    try {
        const resp = await fetch('data/questions.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        let data = await resp.json();
        if (!data || !Array.isArray(data) || data.length === 0) throw new Error('空题库');
        
        STATE.questions = data;
        
        // 自动分章（每约150题为一章，基于TOC）
        buildChapters();
        
        // 恢复存储数据
        const saved = DB.load();
        STATE.stats = saved.stats;
        STATE.wrongBook = saved.wrongBook;
        STATE.practice.chapter = saved.practice.chapter;
        STATE.practice.mode = saved.practice.mode;
        STATE.practice.answered = saved.practice.answered;
        STATE.practice.correctMap = saved.practice.correctMap;
        STATE.flashcard.mode = saved.flashcard.mode;
        STATE.flashcard.mastered = saved.flashcard.mastered;
        STATE.flashcard.idx = saved.flashcard.idx;
        
        // 更新统计
        updateStatsFromWrongBook();
        
        const targetPage = saved.currentPage || 'practice';
        
        // 渲染各模块
        renderChapterSelect();
        renderStats();
        renderWrongBook();
        
        // 跳转到最后访问的页面
        showPage(targetPage);
        if (targetPage === 'practice') startPractice();
        else if (targetPage === 'exam') showExamPrepare();
        else if (targetPage === 'flashcard') startFlashcard();
        else if (targetPage === 'wrongbook') renderWrongBook();
        else if (targetPage === 'stats') renderStats();
        
        updateHeaderStats();
        
        // 更新学习时长
        trackStudyTime();
        
    } catch (err) {
        $id('practicePage').innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>加载题库失败</h3><p>${err.message}</p></div>`;
    }
}

function buildChapters() {
    const total = STATE.questions.length;
    // 根据题型分布自动分段
    const chapterNames = [
        '教育学基础', '心理学基础', '教育心理学',
        '教育政策法规', '新课程改革', '教师职业道德', '教育教学技能'
    ];
    // 按比例分配
    const ratios = [0.25, 0.15, 0.20, 0.12, 0.10, 0.08, 0.10];
    const chapters = [];
    let start = 0;
    for (let i = 0; i < chapterNames.length; i++) {
        const count = Math.floor(total * ratios[i]);
        const end = Math.min(start + count, total);
        if (end > start) {
            chapters.push({ name: chapterNames[i], start: start, end: end - 1, count: end - start });
            start = end;
        }
    }
    // 剩余归入最后一章
    if (start < total && chapters.length > 0) {
        chapters[chapters.length - 1].end = total - 1;
        chapters[chapters.length - 1].count = total - chapters[chapters.length - 1].start;
    }
    STATE.chapters = chapters;
}

function getChapterForIdx(idx) {
    for (const ch of STATE.chapters) {
        if (idx >= ch.start && idx <= ch.end) return ch.name;
    }
    return '其他';
}

// ============================================================
// 顶部统计更新
// ============================================================
function updateHeaderStats() {
    const total = STATE.questions.length;
    const wrong = STATE.wrongBook.length;
    $id('hdrTotal').textContent = total;
    $id('hdrWrong').textContent = wrong;
}

// ============================================================
// 学习时长追踪
// ============================================================
function trackStudyTime() {
    const now = Date.now();
    const last = STATE.stats.lastActive;
    if (last && (now - last) < 300000) { // 5分钟内算同一次学习
        STATE.stats.studySeconds += Math.round((now - last) / 1000);
    }
    STATE.stats.lastActive = now;
    DB.set('stats', STATE.stats);
    
    // 每30秒更新一次
    setInterval(() => {
        const n = Date.now();
        const l = STATE.stats.lastActive;
        if (l && (n - l) < 60000) {
            STATE.stats.studySeconds += 30;
        }
        STATE.stats.lastActive = n;
        DB.set('stats', STATE.stats);
        renderStats();
    }, 30000);
}

// ============================================================
// 章节渲染
// ============================================================
function renderChapterSelect() {
    const container = $id('chapterList');
    if (!container) return;
    let html = `<div class="chapter-item ${STATE.practice.chapter === 'all' ? 'active' : ''}" onclick="selectChapter('all')">
        <div class="ch-name">📚 全部章节</div>
        <div class="ch-count">${STATE.questions.length} 题</div>
    </div>`;
    STATE.chapters.forEach((ch, i) => {
        const isActive = STATE.practice.chapter === ch.name;
        html += `<div class="chapter-item ${isActive ? 'active' : ''}" onclick="selectChapter('${ch.name}')">
            <div class="ch-name">${ch.name}</div>
            <div class="ch-count">${ch.count} 题</div>
        </div>`;
    });
    container.innerHTML = html;
}

function selectChapter(name) {
    STATE.practice.chapter = name;
    STATE.practice.answered = {};
    STATE.practice.correctMap = {};
    DB.set('practice', STATE.practice);
    renderChapterSelect();
    startPractice();
}

// ============================================================
// 刷题模式
// ============================================================
function startPractice() {
    const page = $id('practicePage');
    const ch = STATE.practice.chapter;
    let list;
    if (ch === 'all') {
        list = [...STATE.questions];
    } else {
        const chapter = STATE.chapters.find(c => c.name === ch);
        if (chapter) {
            list = STATE.questions.slice(chapter.start, chapter.end + 1);
        } else {
            list = [...STATE.questions];
        }
    }
    
    if (STATE.practice.mode === 'rand') {
        list = shuffle(list);
    }
    
    STATE.practice.list = list;
    STATE.practice.idx = Math.min(STATE.practice.idx, list.length - 1);
    if (STATE.practice.idx < 0) STATE.practice.idx = 0;
    
    renderPracticeQuestion();
    updatePracticeProgress();
}

function setPracticeMode(mode) {
    STATE.practice.mode = mode;
    DB.set('practice', STATE.practice);
    $qa('.practice-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    startPractice();
}

function renderPracticeQuestion() {
    const { list, idx, answered, correctMap } = STATE.practice;
    if (!list || list.length === 0) {
        $id('practiceQuestion').innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>暂无题目</h3></div>`;
        return;
    }
    
    const q = list[idx];
    const isAnswered = answered[q.id] !== undefined;
    const selectedIdx = answered[q.id];
    const isCorrect = correctMap[q.id];
    const labels = ['A','B','C','D'];
    
    let optsHtml = q.options.map((opt, oi) => {
        let cls = 'option';
        if (isAnswered) {
            cls += ' disabled';
            if (q.answer >= 0) {
                if (oi === selectedIdx && isCorrect) cls += ' correct';
                else if (oi === selectedIdx && !isCorrect) cls += ' wrong';
                else if (oi === q.answer && !isCorrect) cls += ' show-correct';
            } else if (selectedIdx === oi) {
                cls += ' selected';
            }
        } else if (STATE.showAllAnswers && q.answer >= 0 && oi === q.answer) {
            cls += ' show-correct';
        }
        return `<div class="${cls}" onclick="practiceSelect(${q.id}, ${oi})">
            <span class="label">${labels[oi]}</span><span>${opt.replace(/^[A-D][.、]\s*/, '')}</span>
        </div>`;
    }).join('');
    
    let ansHtml = '';
    if (isAnswered) {
        const status = q.answer >= 0 ? (isCorrect ? '✅ 回答正确！' : '❌ 回答错误') : '📝 已选择';
        const cls = q.answer >= 0 ? (isCorrect ? 'right' : 'wrong') : '';
        ansHtml = `<div class="answer-section show">
            <div class="ans-status ${cls}">${status}</div>
            ${q.answer >= 0 ? `<div class="ans-correct">正确答案：${labels[q.answer]}</div>` : ''}
            ${q.analysis ? `<div class="analysis">📖 ${q.analysis}</div>` : ''}
        </div>`;
    }
    
    const chName = getChapterForIdx(q.id - 1);
    const total = list.length;
    
    $id('practiceQuestion').innerHTML = `
        <div class="q-number">第 ${idx+1} / ${total} 题 · ${chName}</div>
        <div class="q-text">${q.question}</div>
        <div class="options">${optsHtml}</div>
        <div class="q-actions">
            <button class="btn-outline" onclick="practicePrev()" ${idx === 0 ? 'disabled' : ''}>⬅ 上一题</button>
            <div>
                ${!isAnswered ? `<button class="btn-warning" onclick="practiceShowAnswer(${q.id})">👁 看答案</button> ` : ''}
                <button class="${idx === total-1 ? 'btn-success' : 'btn-primary'}" onclick="practiceNext()">
                    ${idx === total-1 ? '✅ 完成' : '下一题 ➡'}
                </button>
            </div>
        </div>
        ${ansHtml}`;
}

function practiceSelect(qId, optIdx) {
    if (STATE.practice.answered[qId] !== undefined) return;
    const q = STATE.practice.list.find(x => x.id === qId);
    if (!q) return;
    
    STATE.practice.answered[qId] = optIdx;
    const correct = q.answer >= 0 ? (optIdx === q.answer) : true;
    STATE.practice.correctMap[qId] = correct || false;
    
    STATE.stats.totalAnswered++;
    if (correct) STATE.stats.totalCorrect++;
    STATE.stats.sessions++;
    
    DB.set('practice', STATE.practice);
    DB.set('stats', STATE.stats);
    
    // 答错加入错题本
    if (!correct && q.answer >= 0) {
        addToWrongBook(q, optIdx);
    }
    
    renderPracticeQuestion();
    updatePracticeProgress();
    updateHeaderStats();
}

function practiceShowAnswer(qId) {
    // 在不选答案的情况下显示答案
    const q = STATE.practice.list.find(x => x.id === qId);
    if (!q) return;
    // 临时标记答案
    STATE.showAllAnswers = true;
    renderPracticeQuestion();
    STATE.showAllAnswers = false;
}

function practiceNext() {
    const { list, idx } = STATE.practice;
    if (idx < list.length - 1) {
        STATE.practice.idx++;
        renderPracticeQuestion();
        updatePracticeProgress();
    } else {
        showConfirm('🎉 完成！', `你已完成本节所有 ${list.length} 题`, () => {});
    }
}

function practicePrev() {
    if (STATE.practice.idx > 0) {
        STATE.practice.idx--;
        renderPracticeQuestion();
        updatePracticeProgress();
    }
}

function updatePracticeProgress() {
    const { list, answered, idx } = STATE.practice;
    const total = list.length;
    const done = Object.keys(answered).length;
    const pct = total > 0 ? (done / total * 100) : 0;
    $id('practiceProgress').style.width = `${pct}%`;
    $id('practiceInfo').textContent = `已完成 ${done}/${total} 题 · 当前第 ${idx+1} 题`;
    
    // 正确率
    let correct = 0;
    Object.values(STATE.practice.correctMap).forEach(v => { if (v) correct++; });
    const acc = done > 0 ? Math.round(correct/done*100) : 0;
    $id('practiceAccuracy').textContent = `正确率 ${acc}%`;
}

// ============================================================
// 模拟考试
// ============================================================
const EXAM_TIMER = 30; // 30分钟

function showExamPrepare() {
    $id('examPage').innerHTML = `
        <div class="card" style="text-align:center;padding:40px 20px;">
            <div style="font-size:48px;margin-bottom:12px;">📝</div>
            <h2 style="margin-bottom:8px;">模拟考试</h2>
            <p style="color:#777;margin-bottom:6px;">从全部题目中随机抽取 <strong>30</strong> 题</p>
            <p style="color:#777;margin-bottom:20px;">考试时间 <strong>${EXAM_TIMER}</strong> 分钟，超时自动交卷</p>
            <button class="btn btn-primary" onclick="startExam()" style="padding:12px 40px;font-size:16px;">开始考试</button>
        </div>
        <div id="examResult"></div>`;
}

function startExam() {
    const total = STATE.questions.length;
    const count = Math.min(30, total);
    const shuffled = shuffle([...STATE.questions]);
    STATE.exam.list = shuffled.slice(0, count);
    STATE.exam.answers = {};
    STATE.exam.idx = 0;
    STATE.exam.finished = false;
    STATE.exam.remaining = EXAM_TIMER * 60;
    STATE.exam.startTime = Date.now();
    
    renderExam();
    startExamTimer();
}

function renderExam() {
    const { list, idx, answers } = STATE.exam;
    const q = list[idx];
    if (!q) return;
    const labels = ['A','B','C','D'];
    const selected = answers[q.id];
    
    let optsHtml = q.options.map((opt, oi) => {
        const cls = selected === oi ? 'selected' : '';
        return `<div class="option ${cls}" onclick="examSelect(${q.id}, ${oi})">
            <span class="label">${labels[oi]}</span><span>${opt.replace(/^[A-D][.、]\s*/, '')}</span>
        </div>`;
    }).join('');
    
    let navHtml = list.map((item, i) => {
        let cls = '';
        if (answers[item.id] !== undefined) cls = 'answered';
        if (i === idx) cls += ' current';
        return `<button class="${cls}" onclick="examGoTo(${i})">${i+1}</button>`;
    }).join('');
    
    $id('examPage').innerHTML = `
        <div class="exam-header">
            <div class="exam-info">📝 模拟考试</div>
            <div class="exam-timer" id="examTimer">${formatTime(STATE.exam.remaining)}</div>
        </div>
        <div class="exam-nav">${navHtml}</div>
        <div class="question-card">
            <div class="q-number">第 ${idx+1} / ${list.length} 题</div>
            <div class="q-text">${q.question}</div>
            <div class="options">${optsHtml}</div>
            <div class="q-actions">
                <button class="btn-outline" onclick="examPrev()" ${idx === 0 ? 'disabled' : ''}>⬅ 上一题</button>
                <button class="btn-primary" onclick="examNext()">${idx === list.length-1 ? '📋 最后一题' : '下一题 ➡'}</button>
            </div>
        </div>
        <button class="btn btn-danger btn-block" onclick="submitExam()" style="margin-top:8px;">
            📩 交卷
        </button>`;
}

function examSelect(qId, optIdx) {
    STATE.exam.answers[qId] = optIdx;
    renderExam();
}

function examGoTo(i) {
    STATE.exam.idx = i;
    renderExam();
}

function examPrev() {
    if (STATE.exam.idx > 0) { STATE.exam.idx--; renderExam(); }
}

function examNext() {
    if (STATE.exam.idx < STATE.exam.list.length - 1) {
        STATE.exam.idx++;
        renderExam();
    }
}

function startExamTimer() {
    clearInterval(STATE.exam.timerId);
    STATE.exam.timerId = setInterval(() => {
        STATE.exam.remaining--;
        const el = $id('examTimer');
        if (el) {
            el.textContent = formatTime(STATE.exam.remaining);
            if (STATE.exam.remaining < 60) el.classList.add('warning');
        }
        if (STATE.exam.remaining <= 0) {
            clearInterval(STATE.exam.timerId);
            submitExam();
        }
    }, 1000);
}

function submitExam() {
    if (STATE.exam.finished) return;
    if (Object.keys(STATE.exam.answers).length < STATE.exam.list.length) {
        const un = STATE.exam.list.length - Object.keys(STATE.exam.answers).length;
        showConfirm('⚠️ 还有未答题', `还有 ${un} 题未作答，确定要交卷吗？`, () => doSubmit());
    } else {
        doSubmit();
    }
}

function doSubmit() {
    clearInterval(STATE.exam.timerId);
    STATE.exam.finished = true;
    
    const { list, answers } = STATE.exam;
    let correct = 0;
    const wrongs = [];
    
    list.forEach(q => {
        const ans = answers[q.id];
        if (ans === q.answer) {
            correct++;
        } else {
            wrongs.push({ q, userAns: ans });
            addToWrongBook(q, ans);
        }
    });
    
    const total = list.length;
    const score = Math.round(correct / total * 100);
    const labels = ['A','B','C','D'];
    
    let wrongHtml = '';
    if (wrongs.length > 0) {
        wrongHtml = `<div class="wrong-list"><h4 style="margin-bottom:10px;">❌ 错题回顾</h4>`;
        wrongs.forEach(w => {
            wrongHtml += `<div class="wrong-item">
                <div style="font-weight:500;margin-bottom:4px;">${w.q.question}</div>
                <div style="font-size:13px;color:var(--danger);">你的答案：${w.userAns !== undefined ? labels[w.userAns] : '未答'}</div>
                <div style="font-size:13px;color:var(--success);">正确答案：${labels[w.q.answer]}</div>
                ${w.q.analysis ? `<div style="font-size:13px;color:#555;margin-top:4px;">📖 ${w.q.analysis}</div>` : ''}
            </div>`;
        });
        wrongHtml += `</div>`;
    }
    
    $id('examPage').innerHTML = `
        <div class="exam-result">
            <div class="score-big">${score}%</div>
            <div class="score-label">正确 ${correct} / ${total} 题 · 用时 ${formatTime(EXAM_TIMER*60 - STATE.exam.remaining)}</div>
            <div style="display:flex;gap:10px;justify-content:center;margin-bottom:20px;">
                <button class="btn btn-primary" onclick="showExamPrepare()">🔄 重新考试</button>
                <button class="btn btn-outline" onclick="showPage('practice');startPractice();">📖 去刷题</button>
            </div>
            ${wrongHtml}
        </div>`;
    
    updateHeaderStats();
    renderStats();
}

// ============================================================
// 背题模式
// ============================================================
function startFlashcard() {
    const page = $id('flashcardPage');
    const { mode, mastered } = STATE.flashcard;
    let list;
    
    if (mode === 'weak') {
        // 只背未掌握的
        list = STATE.questions.filter(q => !mastered[q.id]);
        if (list.length === 0) list = [...STATE.questions];
    } else if (mode === 'rand') {
        list = shuffle([...STATE.questions]);
    } else {
        list = [...STATE.questions];
    }
    
    STATE.flashcard.list = list;
    STATE.flashcard.idx = Math.min(STATE.flashcard.idx, list.length - 1);
    if (STATE.flashcard.idx < 0) STATE.flashcard.idx = 0;
    STATE.flashcard.showAnswer = false;
    
    renderFlashcard();
}

function setFlashcardMode(mode) {
    STATE.flashcard.mode = mode;
    DB.set('flashcard', STATE.flashcard);
    $qa('.flash-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.fmode === mode));
    startFlashcard();
}

function renderFlashcard() {
    const { list, idx, showAnswer, mastered } = STATE.flashcard;
    if (!list || list.length === 0) {
        $id('flashcardContent').innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>暂无题目</h3></div>`;
        return;
    }
    
    const q = list[idx];
    const labels = ['A','B','C','D'];
    const isMastered = mastered[q.id];
    const isWeak = !isMastered;
    
    let optsHtml = q.options.map((opt, oi) => {
        const hl = showAnswer && q.answer >= 0 && oi === q.answer ? 'style="color:var(--success);font-weight:600;"' : '';
        return `<div class="co" ${hl}>${opt}</div>`;
    }).join('');
    
    $id('flashcardContent').innerHTML = `
        <div class="flash-card" onclick="toggleFlashAnswer()">
            <div class="card-q">${q.question}</div>
            <div class="card-options">${optsHtml}</div>
            <div class="card-answer ${showAnswer ? 'show' : ''}">
                ${q.answer >= 0 ? `<div class="ca-label">✅ 正确答案：${labels[q.answer]}</div>` : ''}
                <div class="ca-options">
                    ${q.options.map((opt,oi) => `<div class="co" style="${q.answer >= 0 && oi === q.answer ? 'color:var(--success);font-weight:600;' : ''}">${opt}</div>`).join('')}
                </div>
                ${q.analysis ? `<div class="ca-analysis">📖 ${q.analysis}</div>` : ''}
            </div>
            ${!showAnswer ? '<div class="card-hint">👆 点击卡片显示答案</div>' : ''}
        </div>
        <div class="flash-mastery">
            <button class="btn-nomaster" onclick="setFlashMastery(${q.id}, false)" ${isWeak ? 'style="opacity:0.5;"' : ''}>❌ 未掌握</button>
            <button class="btn-master" onclick="setFlashMastery(${q.id}, true)" ${isMastered ? 'style="opacity:0.5;"' : ''}>✅ 已掌握</button>
        </div>
        <div class="q-number" style="display:inline-block;margin:0 auto 12px;text-align:center;width:auto;">
            ${idx+1} / ${list.length} · ${isMastered ? '✅已掌握' : '📖学习中'}
        </div>
        <div class="flash-nav">
            <button class="btn-outline" onclick="flashPrev()" ${idx === 0 ? 'disabled' : ''}>⬅ 上一张</button>
            <button class="btn-primary" onclick="flashNext()">下一张 ➡</button>
        </div>`;
}

function toggleFlashAnswer() {
    STATE.flashcard.showAnswer = !STATE.flashcard.showAnswer;
    renderFlashcard();
}

function setFlashMastery(qId, mastered) {
    STATE.flashcard.mastered[qId] = mastered;
    DB.set('flashcard', STATE.flashcard);
    renderFlashcard();
}

function flashPrev() {
    if (STATE.flashcard.idx > 0) {
        STATE.flashcard.idx--;
        STATE.flashcard.showAnswer = false;
        renderFlashcard();
    }
}

function flashNext() {
    if (STATE.flashcard.idx < STATE.flashcard.list.length - 1) {
        STATE.flashcard.idx++;
        STATE.flashcard.showAnswer = false;
        renderFlashcard();
    }
    DB.set('flashcard', STATE.flashcard);
}

// ============================================================
// 错题本
// ============================================================
function addToWrongBook(q, userAns) {
    const existing = STATE.wrongBook.findIndex(w => w.id === q.id);
    if (existing >= 0) {
        STATE.wrongBook[existing].count = (STATE.wrongBook[existing].count || 1) + 1;
        STATE.wrongBook[existing].lastWrong = Date.now();
    } else {
        STATE.wrongBook.unshift({
            id: q.id,
            question: q.question,
            options: q.options,
            answer: q.answer,
            analysis: q.analysis,
            userAnswer: userAns,
            count: 1,
            lastWrong: Date.now()
        });
    }
    DB.set('wrongBook', STATE.wrongBook);
    renderWrongBook();
    renderStats();
}

function renderWrongBook() {
    const container = $id('wrongbookContent');
    const wrongs = STATE.wrongBook;
    const labels = ['A','B','C','D'];
    
    if (wrongs.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="icon">🎉</div><h3>错题本为空</h3><p>继续保持！</p></div>`;
        $id('wrongCount').textContent = '0';
        return;
    }
    
    $id('wrongCount').textContent = wrongs.length;
    
    let html = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button class="btn btn-success btn-sm" onclick="redoWrong()">🔄 重做错题</button>
        <button class="btn btn-danger btn-sm" onclick="if(confirm('确定清空错题本？')){STATE.wrongBook=[];DB.set('wrongBook',[]);renderWrongBook();renderStats();}">🗑 清空</button>
    </div>`;
    
    wrongs.forEach(w => {
        const ua = w.userAnswer !== undefined ? labels[w.userAnswer] : '未答';
        html += `<div class="wrong-item-card">
            <div class="wi-header">
                <span class="badge badge-danger">错 ${w.count || 1} 次</span>
                <button class="btn btn-sm btn-outline" onclick="removeFromWrong(${w.id})">✕</button>
            </div>
            <div class="wi-q">${w.question}</div>
            <div class="wi-detail">
                <div class="wrong-ans">你的答案：${ua}</div>
                <div class="right-ans">正确答案：${labels[w.answer]}</div>
                ${w.analysis ? `<div style="margin-top:4px;">📖 ${w.analysis}</div>` : ''}
            </div>
            <div class="wi-actions">
                <button class="btn btn-sm btn-primary" onclick="redoWrongItem(${w.id})">重做此题</button>
            </div>
        </div>`;
    });
    
    container.innerHTML = html;
}

function removeFromWrong(id) {
    STATE.wrongBook = STATE.wrongBook.filter(w => w.id !== id);
    DB.set('wrongBook', STATE.wrongBook);
    renderWrongBook();
    renderStats();
}

function redoWrong() {
    const wrongs = STATE.wrongBook;
    if (wrongs.length === 0) return;
    
    const list = shuffle(wrongs.map(w => STATE.questions.find(q => q.id === w.id)).filter(Boolean));
    if (list.length === 0) return;
    
    STATE.practice.list = list;
    STATE.practice.answered = {};
    STATE.practice.correctMap = {};
    STATE.practice.idx = 0;
    
    showPage('practice');
    renderPracticeQuestion();
    updatePracticeProgress();
}

function redoWrongItem(id) {
    const q = STATE.questions.find(x => x.id === id);
    if (!q) return;
    
    STATE.practice.list = [q];
    STATE.practice.answered = {};
    STATE.practice.correctMap = {};
    STATE.practice.idx = 0;
    
    showPage('practice');
    renderPracticeQuestion();
    updatePracticeProgress();
}

function updateStatsFromWrongBook() {
    // Recalculate total answered/correct from stored data
}

// ============================================================
// 统计看板
// ============================================================
function renderStats() {
    const total = STATE.questions.length;
    const wrongCount = STATE.wrongBook.length;
    const totalAns = STATE.stats.totalAnswered || 0;
    const totalCor = STATE.stats.totalCorrect || 0;
    const acc = totalAns > 0 ? Math.round(totalCor / totalAns * 100) : 0;
    const hours = Math.floor((STATE.stats.studySeconds || 0) / 3600);
    const mins = Math.floor(((STATE.stats.studySeconds || 0) % 3600) / 60);
    
    $id('statTotal').textContent = total;
    $id('statAnswered').textContent = totalAns;
    $id('statAccuracy').textContent = `${acc}%`;
    $id('statTime').textContent = `${hours}h${mins}m`;
    $id('statWrongCount').textContent = wrongCount;
    
    // 各章节正确率
    let chHtml = '';
    STATE.chapters.forEach(ch => {
        const qs = STATE.questions.slice(ch.start, ch.end + 1);
        let correct = 0, answered = 0;
        qs.forEach(q => {
            const res = STATE.practice.correctMap[q.id];
            if (res !== undefined) { answered++; if (res) correct++; }
            // Also check wrongBook
            const w = STATE.wrongBook.find(w => w.id === q.id);
            if (w && !w.cleared) { answered++; }
        });
        const pct = answered > 0 ? Math.round(correct/answered*100) : 0;
        chHtml += `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                <span>${ch.name}</span><span>${pct}% (${correct}/${answered})</span>
            </div>
            <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
        </div>`;
    });
    $id('statChapters').innerHTML = chHtml || '<div style="color:#999;">暂无数据</div>';
}

// ============================================================
// 导入导出
// ============================================================
function exportData() {
    const data = {
        version: 2,
        timestamp: Date.now(),
        wrongBook: STATE.wrongBook,
        stats: STATE.stats,
        practice: STATE.practice,
        flashcard: STATE.flashcard
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz3600_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData() {
    $id('importFileInput').click();
}

function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data.version) throw new Error('无效文件');
            
            showConfirm('导入数据', '将覆盖当前所有学习记录，确定？', () => {
                if (data.wrongBook) STATE.wrongBook = data.wrongBook;
                if (data.stats) STATE.stats = data.stats;
                if (data.practice) {
                    STATE.practice.answered = data.practice.answered || {};
                    STATE.practice.correctMap = data.practice.correctMap || {};
                }
                if (data.flashcard) STATE.flashcard = data.flashcard;
                
                DB.set('wrongBook', STATE.wrongBook);
                DB.set('stats', STATE.stats);
                DB.set('practice', STATE.practice);
                DB.set('flashcard', STATE.flashcard);
                
                renderWrongBook();
                renderStats();
                updateHeaderStats();
                alert('✅ 导入成功！');
            });
        } catch (err) {
            alert('❌ 导入失败：' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// ============================================================
// 重置数据
// ============================================================
function resetAllData() {
    showConfirm('⚠️ 确认重置', '将清除所有学习记录、错题本和统计数据，此操作不可撤销。', () => {
        DB.reset();
        STATE.wrongBook = [];
        STATE.stats = DB._defaults().stats;
        STATE.practice.answered = {};
        STATE.practice.correctMap = {};
        STATE.flashcard.mastered = {};
        renderWrongBook();
        renderStats();
        updateHeaderStats();
        startPractice();
        hideConfirm();
        alert('✅ 数据已重置');
    });
}

// ============================================================
// 工具函数
// ============================================================
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ============================================================
// 启动
// ============================================================
document.addEventListener('DOMContentLoaded', init);
