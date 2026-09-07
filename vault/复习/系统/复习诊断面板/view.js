dv.container.classList.add('review-diagnostics');
const today = new Date();
today.setHours(0, 0, 0, 0);

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
};
const toDate = value => {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text}T00:00:00`);
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
const pct = (value, total) => total > 0 ? `${(value * 100 / total).toFixed(1)}%` : '0%';
const asArray = value => {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.array === 'function') return value.array();
  return [value];
};
// Optional legacy directory repair. Disabled unless explicitly configured.
const grammarPrefix = String(input?.grammarPrefix ?? '');
const categoryOf = path => {
  const page = dv.page(path);
  const explicit = page?.子分类;
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const parts = String(path).split('/');
  return parts.length > 2 ? parts[parts.length - 2].replace(/^\d+\s*/, '') : '未分类';
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

const pageArray = Array.from(dv.pages().where(p => {
  const tags = Array.from(p.file.tags ?? []).map(tag => String(tag));
  const isReviewCard = tags.some(tag => tag === '#复习/待复习');
  const isGrammarCard = Boolean(grammarPrefix) && String(p.file.path).startsWith(grammarPrefix) && String(p.file.path).endsWith('.md');
  return (isReviewCard || isGrammarCard) &&
    p.file.path !== '模板/间隔复习模板.md' &&
    p.file.path !== '复习/复习总表.md';
}));

const cards = await Promise.all(pageArray.map(async p => {
  let content = null;
  try {
    content = await dv.io.load(p.file.path);
  } catch (error) {
    content = null;
  }
  content = typeof content === 'string' ? content : '';

  const events = [];
  const historyPattern = /^###\s+(\d{4}-\d{2}-\d{2})\s+·.*?评分\s+([1-4])\s*$/gm;
  let match;
  let order = 0;
  const rawEvents = [];
  while ((match = historyPattern.exec(content)) !== null) {
    const date = toDate(match[1]);
    if (date) {
      rawEvents.push({
        date,
        score: Number(match[2]),
        order: order++,
        start: match.index,
        bodyStart: historyPattern.lastIndex
      });
    }
  }
  const historyEnd = content.lastIndexOf('<!-- REVIEW_HISTORY_END -->');
  const readHistoryField = (body, label) => {
    const pattern = new RegExp(`^-\\s*${label}[：:]\\s*(.*?)\\s*$`, 'm');
    return body.match(pattern)?.[1]?.trim() ?? '';
  };
  for (let index = 0; index < rawEvents.length; index++) {
    const event = rawEvents[index];
    const end = rawEvents[index + 1]?.start ?? (historyEnd >= event.bodyStart ? historyEnd : content.length);
    const body = content.slice(event.bodyStart, end);
    events.push({
      date: event.date,
      score: event.score,
      order: event.order,
      weakness: readHistoryField(body, '本轮最大漏洞'),
      correction: readHistoryField(body, '一句话纠正'),
      reviewMode: readHistoryField(body, '复习模式')
    });
  }
  events.sort((a, b) => a.date - b.date || a.order - b.order);

  const tagTexts = Array.from(p.file.tags ?? []).map(tag => String(tag).replace(/^#/, ''));
  const explicitCategory = asArray(p.分类).map(value => String(value).trim()).filter(Boolean)[0] ?? '';
  const isGrammarCard = Boolean(grammarPrefix) && String(p.file.path).startsWith(grammarPrefix);

  return {
    page: p,
    link: p.file.link,
    name: p.file.name,
    path: p.file.path,
    category: categoryOf(p.file.path),
    explicitCategory,
    isGrammarCard,
    hasReviewTag: tagTexts.some(tag => tag === '复习/待复习'),
    content,
    readable: content.length > 0,
    status: String(p.状态 ?? '进行中'),
    stage: String(p.当前阶段 ?? ''),
    mode: String(p.复习模式 ?? ''),
    due: toDate(p.下次复习日),
    events
  };
}));

const weakCards = cards.map(card => {
  const recent = card.events.slice(-3);
  const lowCount = recent.filter(event => event.score <= 2).length;
  const lastTwoLow = recent.length >= 2 && recent.slice(-2).every(event => event.score <= 2);
  if (recent.length < 2 || lowCount < 2) return null;
  return {
    ...card,
    recent,
    lowCount,
    severity: lowCount === 3 || lastTwoLow ? '🔴 持续薄弱' : '⚠️ 不稳定'
  };
}).filter(Boolean).sort((a, b) =>
  b.lowCount - a.lowCount ||
  b.recent[b.recent.length - 1].date - a.recent[a.recent.length - 1].date ||
  String(a.path).localeCompare(String(b.path), 'zh-CN')
);

dv.header(3, '🔥 薄弱知识点');
dv.paragraph('判定规则：最近 3 次评分中至少 2 次为 1 或 2。这里只做诊断，不改变复习日期。');
if (weakCards.length === 0) {
  dv.paragraph('✅ 当前没有达到薄弱提醒条件的卡片。');
} else {
  dv.table(
    ['知识点', '分类', '最近评分', '当前阶段', '模式', '判断'],
    weakCards.map(card => [
      card.link,
      card.category,
      card.recent.map(event => event.score).join(' → '),
      stageLabels[card.stage] ?? card.stage ?? '—',
      card.mode || '—',
      card.severity
    ])
  );
}

const mondayOffset = (today.getDay() + 6) % 7;
const weekStart = addDays(today, -mondayOffset);
const weekEnd = addDays(weekStart, 6);
const nextWeekStart = addDays(weekStart, 7);
const nextWeekEnd = addDays(nextWeekStart, 6);
const weeklyEvents = cards.flatMap(card =>
  card.events
    .filter(event => event.date >= weekStart && event.date <= today)
    .map(event => ({ ...event, path: card.path }))
);
const scoreCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
for (const event of weeklyEvents) scoreCounts[event.score]++;
const uniqueCards = new Set(weeklyEvents.map(event => event.path)).size;
const activeCards = cards.filter(card => card.status !== '已完成');
const overdueCount = activeCards.filter(card => card.due && card.due < today).length;
const dueTodayCount = activeCards.filter(card => card.due && card.due.getTime() === today.getTime()).length;
const nextWeekCount = activeCards.filter(card =>
  card.due && card.due >= nextWeekStart && card.due <= nextWeekEnd
).length;
const lowCount = scoreCounts[1] + scoreCounts[2];

dv.header(3, '📊 本周复习情况');
dv.paragraph(`统计范围：${fmt(weekStart)} 至 ${fmt(weekEnd)}；今天之后的本周日期暂不计入完成量。`);
dv.table(
  ['本周复习次数', '涉及卡片', '低分率（1+2）', '熟练率（4）', '当前薄弱卡', '下周预计'],
  [[
    weeklyEvents.length,
    uniqueCards,
    pct(lowCount, weeklyEvents.length),
    pct(scoreCounts[4], weeklyEvents.length),
    weakCards.length,
    `${nextWeekCount} 项`
  ]]
);
dv.table(
  ['1 完全不会', '2 不完整', '3 基本掌握', '4 熟练掌握', '当前逾期', '今日到期'],
  [[
    `${scoreCounts[1]}（${pct(scoreCounts[1], weeklyEvents.length)}）`,
    `${scoreCounts[2]}（${pct(scoreCounts[2], weeklyEvents.length)}）`,
    `${scoreCounts[3]}（${pct(scoreCounts[3], weeklyEvents.length)}）`,
    `${scoreCounts[4]}（${pct(scoreCounts[4], weeklyEvents.length)}）`,
    overdueCount,
    dueTodayCount
  ]]
);
dv.paragraph(`下周预计按当前已安排的 ${fmt(nextWeekStart)} 至 ${fmt(nextWeekEnd)} 计算；本周后续评分可能继续改变该数量。`);

const average = values => values.length > 0
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;
const cleanEvidenceText = value => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return !text || text === '未填写' ? '无记录' : text;
};
const allReviewDates = cards.flatMap(card => card.events.map(event => event.date));
const cumulativeStart = allReviewDates.length > 0
  ? new Date(Math.min(...allReviewDates.map(date => date.getTime())))
  : today;
const periodRange = kind => {
  if (kind === 'cumulative') {
    return { label: '累计至今', reportType: '累计分析', start: cumulativeStart, end: today };
  }
  if (kind === 'month') {
    return {
      label: '本月',
      reportType: '月报',
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: new Date(today.getFullYear(), today.getMonth() + 1, 0)
    };
  }
  return { label: '本周', reportType: '周报', start: weekStart, end: weekEnd };
};
const buildAnalysisData = (kind, selectedType, selectedSubcategory) => {
  const range = periodRange(kind);
  const typeCards = cards.filter(card => card.explicitCategory === selectedType);
  const selectedCards = typeCards.filter(card =>
    selectedSubcategory === '全部内容' || card.category === selectedSubcategory
  );
  const periodEvents = selectedCards.flatMap(card => card.events
    .filter(event => event.date >= range.start && event.date <= today)
    .map(event => ({ ...event, card }))
  );
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const event of periodEvents) counts[event.score]++;
  const categories = [...new Set(selectedCards.map(card => card.category))]
    .sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
  const categoryRows = categories.map(category => {
    const categoryEvents = periodEvents.filter(event => event.card.category === category);
    const categoryScores = categoryEvents.map(event => event.score);
    return {
      category,
      cards: selectedCards.filter(card => card.category === category).length,
      reviewedCards: new Set(categoryEvents.map(event => event.card.path)).size,
      reviews: categoryEvents.length,
      mean: average(categoryScores),
      lowRate: pct(categoryScores.filter(score => score <= 2).length, categoryScores.length),
      fluentRate: pct(categoryScores.filter(score => score === 4).length, categoryScores.length)
    };
  });
  const activeSelected = selectedCards.filter(card => card.status !== '已完成');
  const evidenceCards = selectedCards.map(card => {
    const events = periodEvents.filter(event => event.card.path === card.path);
    const latest = events[events.length - 1] ?? null;
    return {
      card,
      periodScores: events.map(event => event.score),
      recentScores: card.events.slice(-3).map(event => event.score),
      weakness: cleanEvidenceText(latest?.weakness),
      correction: cleanEvidenceText(latest?.correction)
    };
  }).filter(item => item.periodScores.length > 0 || item.recentScores.some(score => score <= 2));

  return {
    kind,
    range,
    selectedType,
    selectedSubcategory,
    scopeLabel: selectedSubcategory === '全部内容'
      ? selectedType
      : `${selectedType}／${selectedSubcategory}`,
    selectedCards,
    periodEvents,
    counts,
    categoryRows,
    evidenceCards,
    reviewedCards: new Set(periodEvents.map(event => event.card.path)).size,
    mean: average(periodEvents.map(event => event.score)),
    overdue: activeSelected.filter(card => card.due && card.due < today).length,
    dueToday: activeSelected.filter(card => card.due && card.due.getTime() === today.getTime()).length
  };
};
const buildEvidenceMarkdown = data => {
  const { range, counts, periodEvents, categoryRows, evidenceCards } = data;
  const low = counts[1] + counts[2];
  const lines = [
    `## 分析范围`,
    `- 周期：${range.label}（${fmt(range.start)} 至 ${fmt(range.end)}，统计截至 ${fmt(today)}）`,
    `- 学科类型：${data.selectedType}`,
    `- 子分类：${data.selectedSubcategory}`,
    `- 范围内卡片：${data.selectedCards.length} 张`,
    `- 本期复习：${periodEvents.length} 次，涉及 ${data.reviewedCards} 张卡`,
    `- 平均评分：${data.mean == null ? '无数据' : data.mean.toFixed(2)}`,
    `- 评分分布：1 分 ${counts[1]} 次；2 分 ${counts[2]} 次；3 分 ${counts[3]} 次；4 分 ${counts[4]} 次`,
    `- 低分率（1+2）：${pct(low, periodEvents.length)}`,
    `- 熟练率（4）：${pct(counts[4], periodEvents.length)}`,
    `- 当前逾期：${data.overdue} 张；今日到期：${data.dueToday} 张`,
    '',
    `## 分类证据`,
    '| 分类 | 范围内卡片 | 本期涉及卡片 | 复习次数 | 平均分 | 低分率 | 熟练率 |',
    '|---|---:|---:|---:|---:|---:|---:|'
  ];
  for (const row of categoryRows) {
    lines.push(`| ${row.category} | ${row.cards} | ${row.reviewedCards} | ${row.reviews} | ${row.mean == null ? '—' : row.mean.toFixed(2)} | ${row.lowRate} | ${row.fluentRate} |`);
  }
  lines.push('', '## 逐卡证据');
  if (evidenceCards.length === 0) {
    lines.push('- 本期没有评分记录，也没有最近低分卡；请明确说明数据不足。');
  } else {
    for (const item of evidenceCards) {
      const dueText = item.card.status === '已完成' ? '已完成' : (item.card.due ? fmt(item.card.due) : '日期无效');
      lines.push(
        `- ${item.card.name}｜${item.card.category}｜本期评分 ${item.periodScores.join('→') || '无'}｜最近 3 次 ${item.recentScores.join('→') || '无'}｜当前 ${item.card.stage || '—'}／${item.card.mode || '—'}｜下次 ${dueText}`,
        `  - 最大漏洞：${item.weakness}`,
        `  - 一句话纠正：${item.correction}`
      );
    }
  }
  return lines.join('\n');
};
const buildAnalysisPrompt = data => `你是一名严谨的学习科学分析助手。请只依据下面的复习证据，分析“${data.scopeLabel}”的掌握情况，不要补写不存在的学习行为或知识错误。\n\n分析规则：\n1. 把 1～4 分视为学习者的单次提取表现，不把阶段高、复习次数多或到期日远直接等同于真正掌握。\n2. 结合主动回忆、间隔练习、生成效应和交错练习提出建议，但不要擅自修改 D0～D60 调度规则。\n3. 明确区分“数据直接显示”“合理推断”“数据不足”；样本少时降低结论强度。\n4. 优先引用具体类别、具体卡片、评分序列、最大漏洞和一句话纠正。\n5. 建议必须少而可执行，说明下一次复习应重点提取什么、比较什么或输出什么。\n\n请按以下结构输出 Markdown：\n# ${data.range.reportType} · ${data.scopeLabel}\n## 一句话结论\n## 掌握情况（总体与分类）\n## 薄弱点与可能原因\n## 值得保持的学习行为\n## 下一周期建议（最多 5 条，按优先级）\n## 数据局限与需要继续观察的信号\n\n${buildEvidenceMarkdown(data)}`;
const copyText = async text => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.body.createEl('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};
const ensureFolder = async path => {
  let current = '';
  for (const part of path.split('/')) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
};
const safeFilePart = text => String(text).replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
const uniqueReportPath = (folder, dateText) => {
  const first = `${folder}/${dateText}.md`;
  if (!app.vault.getAbstractFileByPath(first)) return first;
  let number = 2;
  while (app.vault.getAbstractFileByPath(`${folder}/${dateText}-${number}.md`)) number++;
  return `${folder}/${dateText}-${number}.md`;
};
const createAnalysisNote = async (data, llmResult = '', providerLabel = '手动整理') => {
  const subcategoryFolder = data.selectedSubcategory === '全部内容'
    ? '全部内容'
    : data.selectedSubcategory;
  const folder = `复习/分析报告/${safeFilePart(data.selectedType)}/${safeFilePart(subcategoryFolder)}/${safeFilePart(data.range.reportType)}`;
  await ensureFolder(folder);
  const path = uniqueReportPath(folder, fmt(today));
  const title = `${data.range.reportType} · ${data.scopeLabel} · ${fmt(today)}`;
  const evidence = buildEvidenceMarkdown(data);
  const resultText = llmResult.trim() || '（粘贴分析结果）';
  const status = llmResult.trim() ? '已生成' : '待粘贴 LLM 结果';
  const yamlScalar = value => JSON.stringify(String(value));
  const content = `---\n报告类型: ${yamlScalar(data.range.reportType)}\n分析周期: ${yamlScalar(`${fmt(data.range.start)} 至 ${fmt(data.range.end)}`)}\n分析学科: ${yamlScalar(data.selectedType)}\n分析子分类: ${yamlScalar(data.selectedSubcategory)}\n生成日期: ${fmt(today)}\n分析方式: ${yamlScalar(providerLabel)}\n分析状态: ${yamlScalar(status)}\ntags:\n  - 复习/分析报告\n---\n# ${title}\n\n## LLM 分析结果\n\n${resultText}\n\n## 人工确认与行动\n\n- 我同意的判断：\n- 我需要修正的判断：\n- 下一周期最重要的行动：\n\n---\n\n${evidence}\n`;
  const file = await app.vault.create(path, content);
  await app.workspace.getLeaf(false).openFile(file);
  return path;
};
const createTextTable = (parent, headers, rows) => {
  const table = parent.createEl('table');
  const head = table.createEl('thead').createEl('tr');
  for (const header of headers) head.createEl('th', { text: header });
  const body = table.createEl('tbody');
  for (const row of rows) {
    const tr = body.createEl('tr');
    for (const value of row) tr.createEl('td', { text: String(value) });
  }
  return table;
};

dv.header(3, '🧠 周／月／累计 LLM 复习分析');
dv.paragraph('先选择学科类型与分析周期，复制材料并粘贴到你使用的网页端 LLM。收到分析后，可新建空白分析记录并粘贴结果。材料包含评分与复习反馈，不包含完整题目和答案正文。');
const analysisPanel = dv.container.createDiv({ cls: 'review-llm-analysis' });
let selectedPeriod = 'cumulative';
const analysisTypes = [...new Set(cards.map(card => card.explicitCategory).filter(Boolean))]
  .sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
let selectedAnalysisType = analysisTypes[0] ?? '未填写';
let selectedAnalysisSubcategory = '全部内容';
const renderAnalysisPanel = () => {
  analysisPanel.replaceChildren();
  const periodControls = analysisPanel.createDiv({ cls: 'review-analysis-period-controls' });
  for (const [kind, label] of [['cumulative', '累计至今'], ['week', '本周'], ['month', '本月']]) {
    const button = periodControls.createEl('button', { text: label });
    button.setAttr('aria-pressed', String(kind === selectedPeriod));
    if (kind === selectedPeriod) button.addClass('is-active');
    button.addEventListener('click', () => {
      selectedPeriod = kind;
      renderAnalysisPanel();
    });
  }
  analysisPanel.createEl('p', { text: '学科类型（读取 YAML 的“分类”）：' });
  const typeControls = analysisPanel.createDiv({ cls: 'review-analysis-type-controls' });
  for (const type of analysisTypes) {
    const button = typeControls.createEl('button', { text: type });
    button.setAttr('aria-pressed', String(type === selectedAnalysisType));
    if (type === selectedAnalysisType) button.addClass('is-active');
    button.addEventListener('click', () => {
      selectedAnalysisType = type;
      selectedAnalysisSubcategory = '全部内容';
      renderAnalysisPanel();
    });
  }
  const typeCards = cards.filter(card => card.explicitCategory === selectedAnalysisType);
  const analysisSubcategories = ['全部内容', ...new Set(typeCards
    .map(card => card.category))]
    .sort((a, b) => a === '全部内容' ? -1 : b === '全部内容' ? 1 : String(a).localeCompare(String(b), 'zh-CN'));
  analysisPanel.createEl('p', { text: '子分类：' });
  const categoryControls = analysisPanel.createDiv({ cls: 'review-analysis-category-controls' });
  for (const category of analysisSubcategories) {
    const button = categoryControls.createEl('button', { text: category });
    button.setAttr('aria-pressed', String(category === selectedAnalysisSubcategory));
    if (category === selectedAnalysisSubcategory) button.addClass('is-active');
    button.addEventListener('click', () => {
      selectedAnalysisSubcategory = category;
      renderAnalysisPanel();
    });
  }

  const data = buildAnalysisData(selectedPeriod, selectedAnalysisType, selectedAnalysisSubcategory);
  const low = data.counts[1] + data.counts[2];
  analysisPanel.createEl('p', {
    text: `范围：${data.range.label} · ${data.scopeLabel} · ${fmt(data.range.start)} 至 ${fmt(data.range.end)}（统计截至 ${fmt(today)}）`
  });
  createTextTable(
    analysisPanel,
    ['复习次数', '涉及卡片', '平均评分', '低分率', '熟练率', '当前逾期'],
    [[
      data.periodEvents.length,
      data.reviewedCards,
      data.mean == null ? '—' : data.mean.toFixed(2),
      pct(low, data.periodEvents.length),
      pct(data.counts[4], data.periodEvents.length),
      data.overdue
    ]]
  );
  createTextTable(
    analysisPanel,
    ['分类', '卡片', '本期涉及', '复习次数', '平均分', '低分率', '熟练率'],
    data.categoryRows.map(row => [
      row.category, row.cards, row.reviewedCards, row.reviews,
      row.mean == null ? '—' : row.mean.toFixed(2), row.lowRate, row.fluentRate
    ])
  );

  const actions = analysisPanel.createDiv({ cls: 'review-analysis-actions' });
  const copyButton = actions.createEl('button', { text: '复制 LLM 分析材料' });
  copyButton.addClass('mod-cta');
  const noteButton = actions.createEl('button', { text: '新建空白分析记录' });
  const status = actions.createSpan({ text: '' });
  status.setAttr('role', 'status');
  copyButton.addEventListener('click', async () => {
    try {
      await copyText(buildAnalysisPrompt(data));
      status.setText(' 已复制，请粘贴到你使用的网页端 LLM。');
    } catch (error) {
      status.setText(` 复制失败：${error.message ?? error}`);
    }
  });
  noteButton.addEventListener('click', async () => {
    try {
      const path = await createAnalysisNote(data, '', '手动整理');
      status.setText(` 已打开：${path}`);
    } catch (error) {
      status.setText(` 建立记录失败：${error.message ?? error}`);
    }
  });

  const details = analysisPanel.createEl('details');
  details.createEl('summary', { text: '预览将交给 LLM 的完整材料' });
  const preview = details.createEl('textarea');
  preview.value = buildAnalysisPrompt(data);
  preview.rows = 18;
  preview.style.width = '100%';
  preview.setAttr('readonly', 'readonly');
  preview.setAttr('aria-label', '将交给 LLM 的分析材料，只读');
};
renderAnalysisPanel();

const requiredFields = [
  '复习起始日', '调度类型', '当前阶段', '下次复习日',
  '连续熟练次数', '复习轮次', '复习模式', '最后评分', '状态'
];
const stages = new Set(['D0', 'D1', 'D3', 'D7', 'D14', 'D30', 'D60']);
const modes = new Set(['轻量复习', '完整复习']);
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const frontmatterBlock = content => content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
const hasFrontmatterField = (content, key) => new RegExp(`^${escapeRegExp(key)}:`, 'm').test(frontmatterBlock(content));
const questionAnswerState = (content, number) => {
  const lines = content.split(/\r?\n/);
  const questionPattern = number === 6
    ? new RegExp(`^(?:#{1,6}\\s+|\\*\\*)Q${number}[：:]`)
    : new RegExp(`^###\\s+Q${number}[：:]`);
  const questionIndex = lines.findIndex(line => questionPattern.test(line));
  if (questionIndex < 0) return { exists: false, answerArea: false, hasContent: false };

  let answerStart = questionIndex + 1;
  while (answerStart < lines.length && lines[answerStart].trim() === '') answerStart++;
  const isCallout = /^>\s*\[![^\]]+\]-/.test(lines[answerStart] ?? '');
  if (isCallout) {
    const body = [];
    for (let index = answerStart + 1; index < lines.length; index++) {
      const line = lines[index];
      if (!line.startsWith('>')) break;
      body.push(line.replace(/^>\s?/, ''));
    }
    const text = body.join('\n').replace(/[#*_`>|\-]/g, '').trim();
    return { exists: true, answerArea: true, hasContent: text.length > 0 };
  }

  const directBody = [];
  for (let index = answerStart; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+/.test(line) || /^###\s+Q[1-6][：:]/.test(line)) break;
    directBody.push(line);
  }
  const text = directBody.join('\n').replace(/[#*_`>|\-]/g, '').trim();
  return { exists: true, answerArea: text.length > 0, hasContent: text.length > 0 };
};

const normalizeFrontmatterTags = value => {
  if (Array.isArray(value)) return value.map(tag => String(tag).replace(/^#/, '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(',').map(tag => tag.replace(/^#/, '').trim()).filter(Boolean);
};
const repairGrammarMetadata = async card => {
  const file = app.vault.getAbstractFileByPath(card.path);
  if (!file) throw new Error('找不到卡片文件');
  await app.fileManager.processFrontMatter(file, frontmatter => {
    frontmatter['分类'] = '英语语法';
    const tags = normalizeFrontmatterTags(frontmatter.tags);
    if (!tags.some(tag => tag === '复习/待复习')) tags.push('复习/待复习');
    frontmatter.tags = tags;
  });
};
const integrityItems = [];
for (const card of cards) {
  const problems = [];
  let canRepairMetadata = false;
  if (!card.readable) {
    problems.push('文件内容无法读取');
  } else {
    const missingFields = requiredFields.filter(key => !hasFrontmatterField(card.content, key));
    if (missingFields.length > 0) problems.push(`缺少字段：${missingFields.join('、')}`);
    if (String(card.page.调度类型 ?? '') !== '自适应') problems.push('调度类型不是自适应');
    if (!/dv\.view\(["']复习\/系统\/自适应复习控件["']\)/.test(card.content)) {
      problems.push('缺少共享评分控件');
    }
    if (!hasFrontmatterField(card.content, '分类') || !card.explicitCategory) {
      problems.push('YAML 分类为空，请手动填写真实学科');
      if (card.isGrammarCard) canRepairMetadata = true;
    }
    if (card.isGrammarCard) {
      if (card.explicitCategory && card.explicitCategory !== '英语语法') {
        problems.push(`YAML 分类应为“英语语法”（当前：${card.explicitCategory || '空'}）`);
        canRepairMetadata = true;
      }
      if (!hasFrontmatterField(card.content, 'tags') || !card.hasReviewTag) {
        problems.push('YAML 缺少“复习/待复习”标签');
        canRepairMetadata = true;
      }
      if (card.category === '未分类') problems.push('未放入配置目录下的子分类文件夹');
    } else if (grammarPrefix && card.explicitCategory === '英语语法') {
      problems.push('标记为英语语法，但不在英语语法复习目录');
    }

    if (card.status !== '已完成') {
      if (!card.due) problems.push('下次复习日缺失或无效');
      if (!stages.has(card.stage)) problems.push('当前阶段无效');
      if (!modes.has(card.mode)) problems.push('复习模式无效');
      for (const number of [1, 2, 3, 6]) {
        const state = questionAnswerState(card.content, number);
        if (!state.exists) problems.push(`缺少 Q${number}`);
        else if (!state.answerArea) problems.push(`Q${number} 缺少答案区`);
        else if (!state.hasContent) problems.push(`Q${number} 答案为空`);
      }
    }
  }

  if (problems.length > 0) {
    integrityItems.push({ card, problems, canRepairMetadata });
  }
}

dv.header(3, '🔧 系统完整性检查');
dv.paragraph('按复习/待复习标签发现卡片，检查分类、日期、评分控件和答案结构。请手动填写真实学科；可选的旧英语目录修复默认关闭。调度和正文不会自动修改；旧复选框卡可由总表和归档读取，但本面板仍会提示其缺少自适应字段。');
if (integrityItems.length === 0) {
  dv.paragraph(`✅ ${cards.length} 张卡片检查正常。`);
} else {
  dv.paragraph(`⚠️ 发现 ${integrityItems.length} 张卡片需要确认。`);
  const repairButtonFor = item => {
    if (!item.canRepairMetadata) return '需人工确认';
    const button = document.createElement('button');
    button.textContent = '补齐英语语法分类与标签';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '修复中…';
      try {
        await repairGrammarMetadata(item.card);
        button.textContent = '已修复，等待刷新';
      } catch (error) {
        button.disabled = false;
        button.textContent = `失败：${error.message ?? error}`;
      }
    });
    return button;
  };
  dv.table(
    ['知识点', '目录分类', '发现的问题', '安全纠错'],
    integrityItems.map(item => [
      item.card.link,
      item.card.category,
      item.problems.join('；'),
      repairButtonFor(item)
    ])
  );
  const repairable = integrityItems.filter(item => item.canRepairMetadata);
  if (repairable.length > 1) {
    const bulkButton = dv.container.createEl('button', { text: `补齐全部 ${repairable.length} 张的分类与标签` });
    bulkButton.addEventListener('click', async () => {
      bulkButton.disabled = true;
      let success = 0;
      for (const item of repairable) {
        try {
          await repairGrammarMetadata(item.card);
          success++;
        } catch (error) {
          console.error('复习元数据修复失败', item.card.path, error);
        }
      }
      bulkButton.textContent = `已修复 ${success}/${repairable.length} 张，请等待 Dataview 刷新`;
    });
  }
}
