import { el, button, field, option } from './dom.js';
import { graphNodeOf, upgradeProject, saveProjectEdge, removeProjectEdge } from './projects.js';
import { recordPreview } from './record-preview.js';
import { icon } from './icons.js';
import { upgradeRecord } from './model.js';

export async function projectGraph(
  db,
  initialId,
  { onChanged = () => {}, onEdit = () => {} } = {},
) {
  const root = el('section', { class: 'project-graph' });
  const summarySaves = new Set();
  let projectId = initialId,
    editing = null,
    connecting = false,
    from = null,
    preview,
    previewGeneration = 0,
    selectedId = null;
  let view = { x: 0, y: 0, width: 940, height: 600 };
  const svgNode = (tag, attrs = {}, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function render() {
    await Promise.all([...summarySaves].map((save) => save()));
    summarySaves.clear();
    preview?.dispose?.();
    previewGeneration++;
    const rows = await db.allRows();
    const project = rows.find((r) => r.id === projectId)?.record;
    if (!project || project.deleted_at) {
      root.replaceChildren(el('p', {}, '项目已不存在。'));
      return;
    }
    const nodes = rows.map((r) => r.record).filter((r) => graphNodeOf(r, projectId));
    const edges = project.graph?.edges || [];
    const names = new Map(
      nodes.map((r) => [r.id, r.type === 'list' ? 'Todo / Idea' : r.title || '未命名记录']),
    );
    const source = el(
      'select',
      { 'aria-label': '关系起点' },
      option('', '选择节点'),
      ...nodes.map((r) => option(r.id, names.get(r.id))),
    );
    const target = el(
      'select',
      { 'aria-label': '关系终点' },
      option('', '选择节点'),
      ...nodes.map((r) => option(r.id, names.get(r.id))),
    );
    const label = el('input', {
      type: 'text',
      maxlength: 200,
      'aria-label': '关系说明',
      placeholder: '例如：参考、补充、相关',
    });
    const error = el('p', { class: 'error-text', role: 'alert' });
    const status = el('span', { class: 'muted graph-status', role: 'status' });
    const run =
      (fn) =>
      async (...args) => {
        try {
          error.textContent = '';
          await fn(...args);
        } catch (e) {
          error.textContent = e.message;
        }
      };
    const points = new Map(
      nodes.map((r, i) => [
        r.id,
        Object.hasOwn(project.graph?.positions || {}, r.id)
          ? project.graph.positions[r.id]
          : {
              x: 150 + (i % 3) * 290,
              y: 105 + Math.floor(i / 3) * 185,
            },
      ]),
    );
    async function persistPositions() {
      const positions = Object.fromEntries(points);
      await db.mutate(projectId, (r) => {
        const p = upgradeProject(r);
        return { ...p, graph: { ...p.graph, positions }, updated_at: new Date().toISOString() };
      });
      status.textContent = '布局已保存';
      onChanged();
    }
    const add = run(async () => {
      if (!source.value || !target.value) throw new Error('请选择两个节点。');
      await saveProjectEdge(db, projectId, {
        id: editing || crypto.randomUUID(),
        source: source.value,
        target: target.value,
        label: label.value.trim(),
      });
      editing = null;
      from = null;
      onChanged();
      await render();
    });
    const save = button('添加关系', add, 'button primary');
    const svg = svgNode('svg', {
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': '项目内记录关系图',
    });
    const setView = () =>
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    setView();
    const lineNodes = [],
      groups = new Map();
    const updateLines = () => {
      for (const { edge, line, text } of lineNodes) {
        const a = points.get(edge.source),
          b = points.get(edge.target);
        for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }))
          line.setAttribute(key, value);
        text.setAttribute('x', (a.x + b.x) / 2);
        text.setAttribute('y', (a.y + b.y) / 2 - 10);
      }
    };
    function editEdge(edge) {
      editing = edge.id;
      source.value = edge.source;
      target.value = edge.target;
      label.value = edge.label;
      save.textContent = '保存关系';
      controls.open = true;
    }
    for (const edge of edges) {
      if (!points.has(edge.source) || !points.has(edge.target)) continue;
      const line = svgNode('line', {
        class: 'graph-edge',
        tabindex: 0,
        role: 'button',
        'aria-label': `编辑关系 ${edge.label || '相关'}`,
      });
      const text = svgNode(
        'text',
        { class: 'graph-edge-label', 'text-anchor': 'middle' },
        edge.label || '相关',
      );
      line.addEventListener('click', () => editEdge(edge));
      line.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') editEdge(edge);
      });
      lineNodes.push({ edge, line, text });
      svg.append(line, text);
    }
    updateLines();
    const detail = el(
      'aside',
      { class: 'graph-detail' },
      el(
        'p',
        { class: 'description' },
        '点击记录预览；拖动节点整理布局；点击“连线”后依次选择两个节点，或从连接点拖到另一个节点。',
      ),
    );
    const showPreview = run(async (record) => {
      selectedId = record.id;
      const generation = ++previewGeneration;
      preview?.dispose?.();
      const next =
        record.type === 'project'
          ? el(
              'article',
              { class: 'record-preview' },
              el('h2', {}, `${record.appearance?.icon || '📁'} ${record.title}`),
              el('p', {}, record.summary || '尚未填写项目描述。'),
              button(
                '进入子项目',
                run(async () => {
                  projectId = record.id;
                  selectedId = null;
                  from = null;
                  view = { x: 0, y: 0, width: 940, height: 600 };
                  await render();
                }),
              ),
            )
          : await recordPreview(db, record, { onChanged });
      if (generation !== previewGeneration) {
        next.dispose?.();
        return;
      }
      preview = next;
      detail.replaceChildren(
        button(
          record.type === 'project' ? '编辑子项目' : '编辑记录',
          run(async () => {
            await Promise.all([...summarySaves].map((save) => save()));
            await onEdit(record);
          }),
          'button primary graph-preview-edit',
        ),
        next,
      );
    });
    function graphPoint(event) {
      const p = svg.createSVGPoint();
      p.x = event.clientX;
      p.y = event.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }
    let suppressedClick = false;
    async function choose(record) {
      if (suppressedClick) {
        suppressedClick = false;
        return;
      }
      if (!connecting) return showPreview(record);
      if (!from) {
        from = record.id;
        source.value = record.id;
        status.textContent = '请选择终点';
        groups.get(record.id)?.classList.add('connecting');
      } else {
        source.value = from;
        target.value = record.id;
        await add();
      }
    }
    for (const record of nodes) {
      const position = points.get(record.id),
        child = record.type === 'project';
      const group = svgNode('g', {
        class: `graph-node${child ? ' graph-project' : ''}`,
        transform: `translate(${position.x} ${position.y})`,
        tabindex: '0',
        role: 'button',
        'aria-label': `预览 ${names.get(record.id)}`,
        'data-node-id': record.id,
      });
      const rect = svgNode('rect', { x: -125, y: -55, width: 250, height: 125, rx: 8 });
      if (child && record.appearance?.color) rect.style.stroke = record.appearance.color;
      group.append(
        rect,
        svgNode(
          'text',
          { x: 0, y: -29, 'text-anchor': 'middle' },
          `${child ? (record.appearance?.icon || '📁') + ' ' : ''}${names.get(record.id).slice(0, 13)}`,
        ),
        svgNode('circle', {
          cx: 125,
          cy: 0,
          r: 9,
          class: 'graph-port',
          'aria-label': '拖动此处连线',
        }),
      );
      const summaryBox = svgNode('foreignObject', { x: -112, y: -16, width: 224, height: 74 });
      const summary = el('textarea', {
        class: 'graph-summary',
        rows: 3,
        maxlength: 2000,
        'aria-label': `${child ? '子项目描述' : '人工总结'} ${names.get(record.id)}`,
        placeholder: child ? '添加子项目描述…' : '添加人工总结…',
      });
      summary.value = record.summary || '';
      let summaryTimer,
        savedSummary = summary.value,
        writing = Promise.resolve();
      const persistSummary = () => {
        clearTimeout(summaryTimer);
        const value = summary.value;
        writing = writing
          .then(async () => {
            if (value === savedSummary) return;
            await db.mutate(record.id, (r) => ({
              ...(child ? upgradeProject(r) : upgradeRecord(r)),
              summary: value,
              updated_at: new Date().toISOString(),
            }));
            savedSummary = value;
            record.summary = value;
            status.textContent = child ? '描述已保存' : '总结已保存';
            if (selectedId === record.id && root.isConnected) await showPreview(record);
            onChanged();
          })
          .catch((e) => {
            error.textContent = e.message;
          });
        return writing;
      };
      summarySaves.add(persistSummary);
      summary.addEventListener('input', () => {
        clearTimeout(summaryTimer);
        status.textContent = '正在保存…';
        summaryTimer = setTimeout(persistSummary, 500);
      });
      summary.addEventListener('blur', persistSummary);
      for (const type of ['pointerdown', 'click', 'dblclick', 'keydown'])
        summary.addEventListener(type, (event) => event.stopPropagation());
      summaryBox.append(summary);
      group.append(summaryBox);
      group.append(svgNode('title', {}, `${names.get(record.id)} · ${record.id}`));
      group.addEventListener(
        'click',
        run(() => choose(record)),
      );
      group.addEventListener(
        'dblclick',
        run(async () => {
          if (child) {
            projectId = record.id;
            selectedId = null;
            from = null;
            await render();
          }
        }),
      );
      group.addEventListener(
        'keydown',
        run(async (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            await choose(record);
          }
        }),
      );
      group.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const start = graphPoint(e),
          old = { ...points.get(record.id) },
          isPort = e.target.classList.contains('graph-port');
        let moved = false;
        const ghost = isPort
          ? svgNode('line', {
              x1: old.x,
              y1: old.y,
              x2: old.x,
              y2: old.y,
              class: 'graph-edge graph-ghost',
            })
          : null;
        if (ghost) svg.append(ghost);
        group.setPointerCapture(e.pointerId);
        const move = (event) => {
          const p = graphPoint(event);
          moved ||= Math.hypot(p.x - start.x, p.y - start.y) > 5;
          if (ghost) {
            ghost.setAttribute('x2', p.x);
            ghost.setAttribute('y2', p.y);
          } else if (moved) {
            const point = { x: old.x + p.x - start.x, y: old.y + p.y - start.y };
            points.set(record.id, point);
            group.setAttribute('transform', `translate(${point.x} ${point.y})`);
            updateLines();
          }
        };
        const end = run(async (event) => {
          group.removeEventListener('pointermove', move);
          group.removeEventListener('pointerup', end);
          group.removeEventListener('pointercancel', cancel);
          if (group.hasPointerCapture(event.pointerId))
            group.releasePointerCapture(event.pointerId);
          ghost?.remove();
          suppressedClick = moved || isPort;
          if (isPort) {
            const id = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest('[data-node-id]')?.dataset.nodeId;
            if (id && id !== record.id) {
              source.value = record.id;
              target.value = id;
              await add();
            }
          } else if (moved) await persistPositions();
        });
        const cancel = () => {
          group.removeEventListener('pointermove', move);
          group.removeEventListener('pointerup', end);
          group.removeEventListener('pointercancel', cancel);
          ghost?.remove();
          points.set(record.id, old);
          group.setAttribute('transform', `translate(${old.x} ${old.y})`);
          updateLines();
        };
        group.addEventListener('pointermove', move);
        group.addEventListener('pointerup', end);
        group.addEventListener('pointercancel', cancel);
      });
      groups.set(record.id, group);
      svg.append(group);
    }
    svg.addEventListener('pointerdown', (e) => {
      if (e.target !== svg) return;
      const start = { x: e.clientX, y: e.clientY },
        old = { ...view };
      svg.setPointerCapture(e.pointerId);
      const move = (event) => {
        const box = svg.getBoundingClientRect();
        view.x = old.x - ((event.clientX - start.x) * old.width) / box.width;
        view.y = old.y - ((event.clientY - start.y) * old.height) / box.height;
        setView();
      };
      const end = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', end);
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', end, { once: true });
    });
    const zoom = (factor) => {
      const width = Math.max(300, Math.min(5000, view.width * factor));
      const height = (width * 600) / 940;
      view = {
        x: view.x + (view.width - width) / 2,
        y: view.y + (view.height - height) / 2,
        width,
        height,
      };
      setView();
    };
    svg.addEventListener(
      'wheel',
      (event) => {
        if (event.target.closest('textarea') && document.activeElement === event.target) return;
        event.preventDefault();
        event.stopPropagation();
        const anchor = graphPoint(event),
          old = { ...view };
        const factor = Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.002);
        const width = Math.max(300, Math.min(5000, old.width * factor));
        const ratio = width / old.width;
        view = {
          x: anchor.x - (anchor.x - old.x) * ratio,
          y: anchor.y - (anchor.y - old.y) * ratio,
          width,
          height: old.height * ratio,
        };
        setView();
      },
      { passive: false },
    );
    const connect = button(connecting ? '结束连线' : '连线', () => {
      connecting = !connecting;
      from = null;
      connect.textContent = connecting ? '结束连线' : '连线';
      status.textContent = connecting ? '依次选择两个节点' : '';
      groups.forEach((g) => g.classList.remove('connecting'));
    });
    const relationList = el(
      'div',
      { class: 'graph-relations' },
      ...edges.map((edge) =>
        el(
          'div',
          { class: 'graph-relation', 'data-edge-id': edge.id },
          el(
            'span',
            {},
            `${names.get(edge.source) || edge.source} ↔ ${names.get(edge.target) || edge.target} · ${edge.label || '相关'}`,
          ),
          button('编辑关系', () => editEdge(edge)),
          el(
            'button',
            {
              type: 'button',
              class: 'icon-button',
              'aria-label': '删除关系',
              onclick: run(async () => {
                await removeProjectEdge(db, projectId, edge.id);
                onChanged();
                editing = null;
                await render();
              }),
            },
            icon('trash'),
          ),
        ),
      ),
    );
    const controls = el(
      'details',
      { class: 'graph-controls' },
      el('summary', {}, '关系说明与列表'),
      el(
        'div',
        { class: 'graph-form' },
        field('节点 A', source),
        field('节点 B', target),
        field('关系说明', label),
      ),
      el(
        'div',
        { class: 'row' },
        save,
        button('取消编辑', () => {
          editing = null;
          from = null;
          source.value = '';
          target.value = '';
          label.value = '';
          save.textContent = '添加关系';
        }),
      ),
      relationList,
    );
    root.replaceChildren(
      el(
        'div',
        { class: 'graph-toolbar row' },
        ...(project.parent_project_id
          ? [
              button(
                '← 返回父项目',
                run(async () => {
                  projectId = project.parent_project_id;
                  selectedId = null;
                  from = null;
                  await render();
                }),
              ),
            ]
          : []),
        el('strong', {}, project.title),
        connect,
        button('放大', () => zoom(0.8)),
        button('缩小', () => zoom(1.25)),
        button(
          '重新排列',
          run(async () => {
            nodes.forEach((r, i) =>
              points.set(r.id, { x: 150 + (i % 3) * 290, y: 105 + Math.floor(i / 3) * 185 }),
            );
            await persistPositions();
            await render();
          }),
        ),
        status,
      ),
      el('p', { class: 'description' }, project.summary || '为项目填写描述，说明目标和资料范围。'),
      el('div', { class: 'graph-workspace' }, el('div', { class: 'graph-canvas' }, svg), detail),
      error,
      controls,
    );
    root.closest('.dialog-body')?.scrollTo({ top: 0 });
    if (selectedId && nodes.some((n) => n.id === selectedId))
      await showPreview(nodes.find((n) => n.id === selectedId));
  }
  await render();
  root.refresh = async () => {
    const controls = root.querySelector('.graph-controls');
    const draft = {
      open: controls?.open,
      source: root.querySelector('[aria-label="关系起点"]')?.value,
      target: root.querySelector('[aria-label="关系终点"]')?.value,
      label: root.querySelector('[aria-label="关系说明"]')?.value,
    };
    await render();
    if (!root.querySelector('.graph-controls')) return;
    root.querySelector('.graph-controls').open = draft.open;
    const source = root.querySelector('[aria-label="关系起点"]'),
      target = root.querySelector('[aria-label="关系终点"]');
    source.value = draft.source || '';
    target.value = draft.target || '';
    root.querySelector('[aria-label="关系说明"]').value = draft.label || '';
    if (editing) root.querySelector('.graph-controls .primary').textContent = '保存关系';
    if (from)
      root.querySelector(`[data-node-id="${CSS.escape(from)}"]`)?.classList.add('connecting');
  };
  root.dispose = () => {
    for (const save of summarySaves) save();
    summarySaves.clear();
    previewGeneration++;
    preview?.dispose?.();
  };
  return root;
}
