const { Notice } = require('obsidian');
const stages = ['D0', 'D1', 'D3', 'D7', 'D14', 'D30', 'D60'];
const stageLabels = {
  D0: '阶段 1（基准 D0）',
  D1: '阶段 2（基准 D1）',
  D3: '阶段 3（基准 D3）',
  D7: '阶段 4（基准 D7）',
  D14: '阶段 5（基准 D14）',
  D30: '阶段 6（基准 D30）',
  D60: '阶段 7（基准 D60）'
};
const baseGaps = [1, 2, 4, 7, 16, 30];
const fullStages = new Set(['D0', 'D7', 'D60']);
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
};
const toDate = value => {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const labelOf = stage => stageLabels[stage] ?? stage;
const modeFor = stage => fullStages.has(stage) ? '完整复习' : '轻量复习';

const calculateSchedule = ({ score, stage, round, streak, today }) => {
  const currentIndex = Math.max(0, stages.indexOf(stage));
  const currentStage = stages[currentIndex];
  if (score === 1) {
    const nextDate = addDays(today, 1);
    return {
      stage: 'D0',
      nextDate,
      streak: 0,
      round: round + 1,
      mode: '完整复习',
      status: '进行中',
      cycleStart: nextDate,
      action: `次日从阶段 1（基准 D0）开始第 ${round + 1} 轮`
    };
  }
  if (score === 2) {
    return {
      stage: currentStage,
      nextDate: addDays(today, 2),
      streak: 0,
      round,
      mode: '完整复习',
      status: '进行中',
      cycleStart: null,
      action: `2 天后加测，仍停留在${labelOf(currentStage)}`
    };
  }

  const nextStreak = score === 4 ? streak + 1 : 0;
  if (currentIndex === stages.length - 1) {
    return {
      stage: '已完成',
      nextDate: null,
      streak: nextStreak,
      round,
      mode: '',
      status: '已完成',
      cycleStart: null,
      action: '通过最后阶段，完成本轮复习并进入归档'
    };
  }

  const nextStage = stages[currentIndex + 1];
  const baseGap = baseGaps[currentIndex];
  const interval = score === 4 && nextStreak >= 2
    ? Math.min(Math.ceil(baseGap * 1.25), 45)
    : baseGap;
  const extended = interval > baseGap;
  return {
    stage: nextStage,
    nextDate: addDays(today, interval),
    streak: nextStreak,
    round,
    mode: modeFor(nextStage),
    status: '进行中',
    cycleStart: null,
    action: `进入${labelOf(nextStage)}，${interval} 天后复习${extended ? `（连续两次为 4，由标准 ${baseGap} 天适度延长）` : ''}`
  };
};

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const frontmatterValue = (content, key, fallback = '') => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fallback;
  const field = match[1].match(new RegExp(`^${escapeRegExp(key)}:[ \\t]*(.*)$`, 'm'));
  return field ? field[1].trim().replace(/^['"]|['"]$/g, '') : fallback;
};
const upsertFrontmatter = (content, key, value) => {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!match) return content;
  let frontmatter = match[0].replace(/\r?\n---$/, '');
  const rest = content.slice(match[0].length);
  const pattern = new RegExp(`^${escapeRegExp(key)}:.*$`, 'm');
  frontmatter = pattern.test(frontmatter)
    ? frontmatter.replace(pattern, `${key}: ${value ?? ''}`)
    : `${frontmatter}\n${key}: ${value ?? ''}`;
  return `${frontmatter}\n---${rest}`;
};
const reviewTextValue = (content, key) => {
  const match = content.match(new RegExp(`^${escapeRegExp(key)}(?:::|：)[ \\t]*(.*)$`, 'm'));
  return match ? match[1].trim() : '';
};
const clearReviewTextValue = (content, key) => content.replace(
  new RegExp(`^${escapeRegExp(key)}(?:::|：).*$`, 'm'),
  `${key}：`
);
const appendHistory = (content, entry) => {
  const marker = ['<!-- REVIEW_HISTORY', '_END -->'].join('');
  const markerIndex = content.lastIndexOf(marker);
  return markerIndex >= 0
    ? `${content.slice(0, markerIndex)}${entry}\n${content.slice(markerIndex)}`
    : `${content.trimEnd()}\n\n## 复习历史\n\n${entry}\n${marker}\n`;
};

const page = dv.current();
if (!page?.file?.path) return;
const file = app.vault.getAbstractFileByPath(page.file.path);
const pageStage = stages.includes(String(page.当前阶段)) ? String(page.当前阶段) : 'D0';
const pageRound = Number(page.复习轮次 ?? 1) || 1;
const pageStreak = Number(page.连续熟练次数 ?? 0) || 0;
const pageMode = String(page.复习模式 ?? modeFor(pageStage));
const pageStatus = String(page.状态 ?? '进行中');
const dueDate = toDate(page.下次复习日);
const today = new Date();
today.setHours(0, 0, 0, 0);
const dueText = dueDate ? fmt(dueDate) : '—';

dv.table(
  ['当前阶段', '本轮模式', '下次复习日', '连续 4 次数', '复习轮次'],
  [[labelOf(pageStage), pageMode || '—', dueText, pageStreak, pageRound]]
);

if (pageStatus === '已完成') {
  dv.paragraph('🎉 本轮复习已经完成，可在「复习完成归档」中重新开始。');
} else {
  if (dueDate) {
    const diffDays = Math.round((dueDate - today) / 86400000);
    if (diffDays > 0) dv.paragraph(`⏳ 距离下次复习还有 **${diffDays} 天**。提前复习也可以，但日期会从实际评分当天重新计算。`);
    else if (diffDays < 0) dv.paragraph(`⚠️ 已逾期 **${Math.abs(diffDays)} 天**，完成后直接评分即可。`);
    else dv.paragraph('🔴 今天到期。完成复习、填写漏洞和纠正后，请点击一个评分按钮。');
  }

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.flexWrap = 'wrap';
  controls.style.gap = '8px';
  controls.style.margin = '12px 0';
  dv.container.appendChild(controls);
  const buttons = [];

  const applyScore = async score => {
    if (!file) {
      new Notice('没有找到当前笔记文件');
      return;
    }
    buttons.forEach(button => button.disabled = true);
    try {
      let content = await app.vault.read(file);
      const currentStageRaw = frontmatterValue(content, '当前阶段', 'D0');
      const currentStage = stages.includes(currentStageRaw) ? currentStageRaw : 'D0';
      const currentRound = Number(frontmatterValue(content, '复习轮次', '1')) || 1;
      const currentStreak = Number(frontmatterValue(content, '连续熟练次数', '0')) || 0;
      const currentMode = frontmatterValue(content, '复习模式', modeFor(currentStage));
      const lastReview = frontmatterValue(content, '最近复习日', '');
      const gap = reviewTextValue(content, '本轮最大漏洞');
      const correction = reviewTextValue(content, '一句话纠正');
      const reviewedAt = new Date();
      reviewedAt.setHours(0, 0, 0, 0);
      const result = calculateSchedule({
        score,
        stage: currentStage,
        round: currentRound,
        streak: currentStreak,
        today: reviewedAt
      });
      const missing = !gap || !correction ? '\n\n注意：漏洞或纠正尚未填写。' : '';
      const duplicate = lastReview === fmt(reviewedAt) ? '\n\n今天已经评分过一次，本次会再追加一条记录。' : '';
      const ok = confirm(
        `确认评分 ${score}？\n\n当前：${labelOf(currentStage)}\n处理：${result.action}${missing}${duplicate}`
      );
      if (!ok) return;

      const nextText = result.nextDate ? fmt(result.nextDate) : '';
      const entry = `### ${fmt(reviewedAt)} · 第 ${currentRound} 轮 · ${labelOf(currentStage)} · 评分 ${score}\n\n` +
        `- 复习模式：${currentMode}\n` +
        `- 本轮最大漏洞：${gap || '未填写'}\n` +
        `- 一句话纠正：${correction || '未填写'}\n` +
        `- 调度处理：${result.action}\n` +
        `- 下次安排：${result.status === '已完成' ? '本轮完成' : `${nextText} · ${labelOf(result.stage)} · ${result.mode}`}`;

      content = upsertFrontmatter(content, '当前阶段', result.stage);
      content = upsertFrontmatter(content, '下次复习日', nextText);
      content = upsertFrontmatter(content, '连续熟练次数', result.streak);
      content = upsertFrontmatter(content, '复习轮次', result.round);
      content = upsertFrontmatter(content, '复习模式', result.mode);
      content = upsertFrontmatter(content, '最后评分', score);
      content = upsertFrontmatter(content, '最近复习日', fmt(reviewedAt));
      content = upsertFrontmatter(content, '状态', result.status);
      if (result.cycleStart) content = upsertFrontmatter(content, '复习起始日', fmt(result.cycleStart));
      content = clearReviewTextValue(content, '本轮最大漏洞');
      content = clearReviewTextValue(content, '一句话纠正');
      content = appendHistory(content, entry);

      await app.vault.modify(file, content);
      new Notice(`评分 ${score} 已保存：${result.action}`);
    } catch (error) {
      console.error(error);
      new Notice(`评分保存失败：${error.message ?? error}`);
    } finally {
      buttons.forEach(button => button.disabled = false);
    }
  };

  [
    [1, '1 完全不会', '#c0392b'],
    [2, '2 不完整', '#d97706'],
    [3, '3 基本掌握', '#2563eb'],
    [4, '4 熟练掌握', '#16803a']
  ].forEach(([score, text, color]) => {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.borderColor = color;
    button.style.color = color;
    button.onclick = () => applyScore(score);
    controls.appendChild(button);
    buttons.push(button);
  });
}
