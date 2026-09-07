dv.container.classList.add('review-future');
const today = new Date();
today.setHours(0, 0, 0, 0);

const dayMs = 24 * 60 * 60 * 1000;
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};
const toDate = value => {
  if (!value) return null;
  const date = new Date(String(value).includes('T') ? String(value) : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};
const fmt = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const relativeLabel = date => {
  const days = Math.round((date.getTime() - today.getTime()) / dayMs);
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  return `${days} 天后`;
};

const stageLabels = {
  D0: '阶段 1（基准 D0）',
  D1: '阶段 2（基准 D1）',
  D3: '阶段 3（基准 D3）',
  D7: '阶段 4（基准 D7）',
  D14: '阶段 5（基准 D14）',
  D30: '阶段 6（基准 D30）',
  D60: '阶段 7（基准 D60）'
};
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const legacyIntervals = { D0: 0, D1: 1, D3: 3, D7: 7, D14: 14, D30: 30, D60: 60 };
const legacyStageOrder = ['D0', 'D1', 'D3', 'D7', 'D14', 'D30', 'D60'];
const categoryOf = path => {
  const page = dv.page(path);
  const explicit = page?.子分类;
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const parts = String(path).split('/');
  return parts.length > 2 ? parts[parts.length - 2].replace(/^\d+\s*/, '') : '未分类';
};

const pages = dv.pages().where(p => {
  const tags = Array.from(p.file.tags ?? []).map(tag => String(tag));
  const isReviewCard = tags.some(tag => tag === '#复习/待复习');
  return isReviewCard &&
    p.file.path !== '模板/间隔复习模板.md' &&
    p.file.path !== '复习/复习总表.md';
});
const items = [];
const categories = new Set();

for (const p of pages) {
  const isAdaptive = String(p.调度类型 ?? '') === '自适应' || p.下次复习日;
  if (isAdaptive) {
    if (String(p.状态 ?? '') === '已完成') continue;
    const category = categoryOf(p.file.path);
    categories.add(category);
    const due = toDate(p.下次复习日);
    if (!due || due <= today) continue;
    const stage = String(p.当前阶段 ?? 'D0');
    items.push({
      due,
      link: p.file.link,
      path: p.file.path,
      category,
      schedule: '自适应',
      stage: stageLabels[stage] ?? stage,
      mode: String(p.复习模式 ?? '完整复习')
    });
    continue;
  }

  const start = toDate(p.复习起始日 ?? p.学习日期);
  if (!start) continue;
  const category = categoryOf(p.file.path);
  categories.add(category);
  const content = await dv.io.load(p.file.path);
  const records = [...String(content ?? '').matchAll(/-\s*\[([ xX])\]\s*(?:\*\*)?(D\d+)\b/g)];
  const checked = Object.fromEntries(records.map(m => [m[2], m[1].toLowerCase() === 'x']));
  const firstUnchecked = legacyStageOrder.filter(key => key !== 'D3' || 'D3' in checked).find(key => !checked[key]);
  if (!firstUnchecked) continue;
  const due = addDays(start, legacyIntervals[firstUnchecked]);
  if (due <= today) continue;
  items.push({
    due,
    link: p.file.link,
    path: p.file.path,
    category,
    schedule: '旧卡',
    stage: `节点 ${firstUnchecked}`,
    mode: firstUnchecked === 'D0' ? '完整复习' : '按旧卡记录'
  });
}

items.sort((a, b) =>
  a.due - b.due || String(a.path).localeCompare(String(b.path), 'zh-CN')
);

function render(selectedDays, selectedCategory) {
  // 保留 Dataview 加载的 view.css，筛选切换只清除渲染内容。
  Array.from(dv.container.children).filter(el => el.tagName !== 'STYLE').forEach(el => el.remove());

  const controls = dv.container.createDiv({ cls: 'future-review-controls' });
  for (const days of [3, 7]) {
    const button = controls.createEl('button', { text: `未来 ${days} 天` });
    button.setAttr('aria-pressed', String(days === selectedDays));
    if (days === selectedDays) button.addClass('is-active');
    button.addEventListener('click', () => render(days, selectedCategory));
  }

  const categoryControls = dv.container.createDiv({ cls: 'future-review-category-controls' });
  categoryControls.createSpan({ cls: 'future-review-control-label', text: '分类：' });
  const categoryList = ['全部', ...Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'))];
  for (const category of categoryList) {
    const button = categoryControls.createEl('button', { text: category });
    button.setAttr('aria-pressed', String(category === selectedCategory));
    if (category === selectedCategory) button.addClass('is-active');
    button.addEventListener('click', () => render(selectedDays, category));
  }

  const start = addDays(today, 1);
  const end = addDays(today, selectedDays);
  const visible = items.filter(item =>
    item.due >= start &&
    item.due <= end &&
    (selectedCategory === '全部' || item.category === selectedCategory)
  );

  const summary = dv.container.createEl('p', { cls: 'future-review-summary' });
  summary.createSpan({ text: `${fmt(start)} 至 ${fmt(end)} · ${selectedCategory}，` });
  summary.createEl('strong', { text: `共 ${visible.length} 项` });

  if (visible.length === 0) {
    dv.paragraph('🎉 这段时间没有已安排的复习项目。');
    return;
  }

  const dailyCounts = new Map();
  for (const item of visible) {
    const key = fmt(item.due);
    dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }
  const loadText = Array.from(dailyCounts.entries())
    .map(([date, count]) => `${date.slice(5)}：${count} 项`)
    .join('　');
  dv.container.createEl('p', { cls: 'future-review-load', text: `每日数量：${loadText}` });

  dv.table(
    ['日期', '知识点', '分类', '调度', '当前阶段', '模式'],
    visible.map(item => [
      `${fmt(item.due)} · ${weekdays[item.due.getDay()]} · ${relativeLabel(item.due)}`,
      item.link,
      item.category,
      item.schedule,
      item.stage,
      item.mode
    ])
  );
}

render(3, '全部');
