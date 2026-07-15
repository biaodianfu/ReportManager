// ===== Tauri API =====
const { invoke } = window.__TAURI__.core;
const listen = window.__TAURI__?.event?.listen?.bind(window.__TAURI__.event) || null;

// ===== 配置 marked =====
if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}

// ===== 状态管理 =====
const state = {
  rootPath: null,
  treeData: [],
  currentFile: null,
  expandedDirs: new Set(),
  searchTerm: '',
  contextNode: null,
  draggedNode: null,
  osDragging: false,
  sidebarCollapsed: false,
  isLoadingFrame: false,
  currentBlobUrl: null,
  isInitializing: true,
  customOrders: {},  // { "文件夹路径": ["文件1", "文件2", ...] }
  dropTarget: null,  // { type: 'before'|'after'|'into', node }
};

// ===== DOM 元素 =====
const treeEl = document.getElementById('tree');
const viewerEl = document.getElementById('html-viewer');
const emptyStateEl = document.getElementById('empty-state');
const currentPathEl = document.getElementById('current-file-path');
const searchInputEl = document.getElementById('search-input');
const contextMenuEl = document.getElementById('context-menu');
const dropOverlayEl = document.getElementById('drop-overlay');
const dropHintEl = document.getElementById('drop-hint');
const sidebarEl = document.getElementById('sidebar');
const resizerEl = document.getElementById('resizer');
const sidebarExpandEl = document.getElementById('sidebar-expand');
const outlineSidebarEl = document.getElementById('outline-sidebar');
const outlineResizerEl = document.getElementById('outline-resizer');
const outlineListEl = document.getElementById('outline-list');
const btnOutlineEl = document.getElementById('btn-outline');

// ===== 工具函数 =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function isMarkdownFile(name) {
  return name.toLowerCase().endsWith('.md') || name.toLowerCase().endsWith('.markdown');
}

function isHtmlFile(name) {
  return name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.htm');
}

function showToast(msg, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ===== 配置持久化（写入 exe 同级目录的 config.json）=====
// 防抖保存：避免短时间内频繁写入
let saveConfigTimer = null;
function saveAppConfig() {
  if (state.isInitializing) return;
  if (saveConfigTimer) clearTimeout(saveConfigTimer);
  saveConfigTimer = setTimeout(async () => {
    try {
      await invoke('save_config', { key: 'rootPath', value: state.rootPath || '' });
      await invoke('save_config', { key: 'sidebarCollapsed', value: state.sidebarCollapsed ? '1' : '0' });
      await invoke('save_config', { key: 'expandedDirs', value: JSON.stringify([...state.expandedDirs]) });
      await invoke('save_config', { key: 'currentFile', value: state.currentFile || '' });
      await invoke('save_config', { key: 'customOrders', value: JSON.stringify(state.customOrders) });
      console.log('[ReportManager] 配置已保存');
    } catch (e) {
      console.error('[ReportManager] 保存配置失败:', e);
    }
  }, 500);
}

async function loadAppConfig() {
  const config = {};
  try {
    config.rootPath = await invoke('load_config', { key: 'rootPath' });
    config.sidebarCollapsed = await invoke('load_config', { key: 'sidebarCollapsed' });
    config.expandedDirs = await invoke('load_config', { key: 'expandedDirs' });
    config.currentFile = await invoke('load_config', { key: 'currentFile' });
    config.customOrders = await invoke('load_config', { key: 'customOrders' });
  } catch (e) {
    console.error('[ReportManager] 读取配置失败:', e);
  }
  return config;
}

// ===== 浅色主题对话框 =====
function showPrompt(title, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:10001;';
    overlay.innerHTML = `
      <div style="background:#ffffff;border:1px solid #d0d5dd;border-radius:10px;padding:20px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.15);">
        <div style="color:#1a1a2e;font-size:14px;margin-bottom:12px;font-weight:500;">${escapeHtml(title)}</div>
        <input type="text" style="width:100%;background:#f8f9fa;color:#1a1a2e;border:1px solid #d0d5dd;padding:8px 12px;border-radius:6px;font-size:14px;outline:none;box-sizing:border-box;" value="${escapeHtml(defaultValue)}" />
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button class="btn-cancel" style="background:#e9ecef;color:#495057;border:1px solid #d0d5dd;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px;">取消</button>
          <button class="btn-ok" style="background:#2563eb;color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus();
    input.select();
    input.addEventListener('focus', () => { input.style.borderColor = '#2563eb'; });
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.btn-ok').onclick = () => { if (input.value.trim()) close(input.value.trim()); };
    overlay.querySelector('.btn-cancel').onclick = () => close(null);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (input.value.trim()) close(input.value.trim()); }
      if (e.key === 'Escape') close(null);
    });
  });
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:10001;';
    overlay.innerHTML = `
      <div style="background:#ffffff;border:1px solid #d0d5dd;border-radius:10px;padding:20px;min-width:340px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.15);">
        <div style="color:#1a1a2e;font-size:14px;margin-bottom:8px;font-weight:500;">${escapeHtml(title)}</div>
        <div style="color:#495057;font-size:13px;margin-bottom:16px;white-space:pre-line;">${escapeHtml(message)}</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn-cancel" style="background:#e9ecef;color:#495057;border:1px solid #d0d5dd;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px;">取消</button>
          <button class="btn-ok" style="background:#e03131;color:#fff;border:none;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">删除</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.btn-ok').onclick = () => close(true);
    overlay.querySelector('.btn-cancel').onclick = () => close(false);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    const escHandler = (e) => { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
  });
}

// ===== 文件路径与 Asset URL 互转 =====
// 使用 Tauri 内置 convertFileSrc，回退到手动构建
const tauriConvertFileSrc = window.__TAURI__?.core?.convertFileSrc || window.__TAURI__?.core?.convertFileSrc;

function convertFileSrc(filePath) {
  // 优先使用 Tauri 内置函数
  if (tauriConvertFileSrc) {
    return tauriConvertFileSrc(filePath);
  }
  // 手动构建：不编码盘符冒号，只替换反斜杠
  const normalized = filePath.replace(/\\/g, '/');
  return `https://asset.localhost/${normalized}`;
}

function assetUrlToPath(url) {
  if (!url) return null;
  let path = url;
  if (path.startsWith('https://asset.localhost/')) {
    path = path.substring('https://asset.localhost/'.length);
  } else if (path.startsWith('http://asset.localhost/')) {
    path = path.substring('http://asset.localhost/'.length);
  } else if (path.startsWith('asset://localhost/')) {
    path = path.substring('asset://localhost/'.length);
  } else {
    return null;
  }
  // URL 解码后转 Windows 路径
  try {
    const decoded = decodeURIComponent(path);
    return decoded.replace(/\//g, '\\');
  } catch {
    return path.replace(/\//g, '\\');
  }
}

function getDirPath(filePath) {
  const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return lastSep >= 0 ? filePath.substring(0, lastSep) : '';
}

// ===== Markdown 渲染 =====
function renderMarkdown(mdContent, filePath) {
  const html = marked.parse(mdContent);
  const dirPath = getDirPath(filePath);
  const baseUrl = convertFileSrc(dirPath + '/');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${baseUrl}">
  <style>${getMarkdownCSS()}</style>
</head>
<body>
  <div class="md-body">${html}</div>
</body>
</html>`;
}

function getMarkdownCSS() {
  return `
    body { margin: 0; }
    .md-body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.7; color: #1a1a2e; max-width: 900px; margin: 0 auto; padding: 40px 48px; background: #fff; }
    .md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6 { margin-top: 28px; margin-bottom: 12px; font-weight: 600; line-height: 1.3; }
    .md-body h1 { font-size: 28px; border-bottom: 2px solid #e9ecef; padding-bottom: 8px; }
    .md-body h2 { font-size: 22px; border-bottom: 1px solid #e9ecef; padding-bottom: 6px; }
    .md-body h3 { font-size: 18px; }
    .md-body h4 { font-size: 16px; }
    .md-body p { margin: 12px 0; }
    .md-body ul, .md-body ol { margin: 12px 0; padding-left: 28px; }
    .md-body li { margin: 4px 0; }
    .md-body blockquote { border-left: 4px solid #2563eb; padding: 8px 16px; margin: 16px 0; background: #f8f9fa; color: #495057; border-radius: 0 6px 6px 0; }
    .md-body code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-family: "Cascadia Code", "Fira Code", Consolas, monospace; font-size: 13px; }
    .md-body pre { background: #1a1a2e; color: #e9ecef; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 16px 0; }
    .md-body pre code { background: none; padding: 0; color: inherit; font-size: 13px; }
    .md-body a { color: #2563eb; text-decoration: none; }
    .md-body a:hover { text-decoration: underline; }
    .md-body table { border-collapse: collapse; margin: 16px 0; width: 100%; }
    .md-body th, .md-body td { border: 1px solid #d0d5dd; padding: 8px 12px; text-align: left; }
    .md-body th { background: #f5f6f8; font-weight: 600; }
    .md-body tr:nth-child(even) { background: #f8f9fa; }
    .md-body img { max-width: 100%; border-radius: 8px; margin: 12px 0; }
    .md-body hr { border: none; border-top: 2px solid #e9ecef; margin: 24px 0; }
  `;
}

// ===== 树渲染 =====
function renderTree() {
  treeEl.innerHTML = '';
  if (!state.treeData || state.treeData.length === 0) {
    treeEl.innerHTML = '<div class="tree-empty">暂无文档<br>点击"打开目录"选择文件夹</div>';
    return;
  }
  const filtered = state.searchTerm ? filterTree(state.treeData, state.searchTerm) : state.treeData;
  if (filtered.length === 0) {
    treeEl.innerHTML = '<div class="tree-empty">未找到匹配的文件</div>';
    return;
  }
  // 应用自定义排序
  const sorted = applyCustomOrder(state.rootPath, filtered);
  for (const node of sorted) {
    treeEl.appendChild(createNodeEl(node, 0));
  }
}

// 应用自定义排序：如果文件夹有自定义顺序，按该顺序排列子节点
function applyCustomOrder(folderPath, nodes) {
  const order = state.customOrders[folderPath];
  if (!order || !Array.isArray(order) || order.length === 0) return nodes;

  const orderMap = new Map();
  order.forEach((name, idx) => orderMap.set(name, idx));

  // 有排序信息的排前面，没有的排后面（保持原有顺序）
  return [...nodes].sort((a, b) => {
    const idxA = orderMap.has(a.name) ? orderMap.get(a.name) : 999999;
    const idxB = orderMap.has(b.name) ? orderMap.get(b.name) : 999999;
    return idxA - idxB;
  });
}

function createNodeEl(node, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';

  const item = document.createElement('div');
  item.className = 'tree-item';
  item.style.paddingLeft = (depth * 16 + 8) + 'px';
  item.dataset.path = node.path;
  item.dataset.isDir = node.is_dir;

  if (state.currentFile === node.path) {
    item.classList.add('active');
  }

  const arrow = document.createElement('span');
  arrow.className = 'tree-arrow';
  if (node.is_dir) {
    arrow.textContent = '▶';
    if (state.expandedDirs.has(node.path)) {
      arrow.classList.add('expanded');
    }
  } else {
    arrow.classList.add('hidden');
  }

  const icon = document.createElement('span');
  if (node.is_dir) {
    icon.className = 'tree-icon folder';
    icon.textContent = state.expandedDirs.has(node.path) ? '📂' : '📁';
  } else if (node.file_type === 'md') {
    icon.className = 'tree-icon md';
    icon.textContent = '📝';
  } else {
    icon.className = 'tree-icon file';
    icon.textContent = '📄';
  }

  const label = document.createElement('span');
  label.className = 'tree-label';
  if (state.searchTerm) {
    const regex = new RegExp(`(${state.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    label.innerHTML = escapeHtml(node.name).replace(regex, '<mark>$1</mark>');
  } else {
    label.textContent = node.name;
  }

  item.appendChild(arrow);
  item.appendChild(icon);
  item.appendChild(label);
  wrapper.appendChild(item);

  if (node.is_dir && node.children.length > 0) {
    const childrenEl = document.createElement('div');
    childrenEl.className = 'tree-children';
    if (!state.expandedDirs.has(node.path)) {
      childrenEl.classList.add('collapsed');
    }
    const sortedChildren = applyCustomOrder(node.path, node.children);
    for (const child of sortedChildren) {
      childrenEl.appendChild(createNodeEl(child, depth + 1));
    }
    wrapper.appendChild(childrenEl);
  }

  item.addEventListener('click', (e) => {
    e.stopPropagation();
    if (node.is_dir) {
      toggleDir(node.path);
    } else {
      openFile(node);
    }
  });

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, node);
  });

  // 拖拽
  item.draggable = true;
  item.addEventListener('dragstart', (e) => {
    state.draggedNode = node;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.path);
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    state.draggedNode = null;
    clearDragIndicators();
  });

  // 所有节点都支持 dragover/drop（用于排序和移入文件夹）
  item.addEventListener('dragover', (e) => {
    if (!state.draggedNode) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearDragIndicators();

    const rect = item.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const isDir = node.is_dir;
    const isSameParent = getDirPath(state.draggedNode.path) === getDirPath(node.path);

    if (isDir && offsetY > rect.height * 0.25 && offsetY < rect.height * 0.75) {
      // 文件夹中间区域 → 移入文件夹
      item.classList.add('drag-over');
      state.dropTarget = { type: 'into', node };
    } else if (isSameParent && state.draggedNode.path !== node.path) {
      // 同级节点 → 排序（上方=插入前面，下方=插入后面）
      if (offsetY < rect.height * 0.5) {
        item.classList.add('drop-before');
        state.dropTarget = { type: 'before', node };
      } else {
        item.classList.add('drop-after');
        state.dropTarget = { type: 'after', node };
      }
    } else if (isDir) {
      // 不同级 + 文件夹 → 移入
      item.classList.add('drag-over');
      state.dropTarget = { type: 'into', node };
    }
  });
  item.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    // 只在真正离开时清除
    if (e.relatedTarget && item.contains(e.relatedTarget)) return;
    item.classList.remove('drag-over', 'drop-before', 'drop-after');
  });
  item.addEventListener('drop', (e) => {
    if (!state.draggedNode) return;
    e.preventDefault();
    e.stopPropagation();
    clearDragIndicators();
    handleTreeDrop(node, e);
  });

  return wrapper;
}

// 清除所有拖拽指示
function clearDragIndicators() {
  document.querySelectorAll('.tree-item.drag-over, .tree-item.drop-before, .tree-item.drop-after').forEach(el => {
    el.classList.remove('drag-over', 'drop-before', 'drop-after');
  });
}

function toggleDir(path) {
  if (state.expandedDirs.has(path)) {
    state.expandedDirs.delete(path);
  } else {
    state.expandedDirs.add(path);
  }
  renderTree();
  saveAppConfig();
}

async function handleTreeDrop(targetNode, e) {
  const draggedNode = state.draggedNode;
  if (!draggedNode) return;
  const dropTarget = state.dropTarget || { type: 'into', node: targetNode };
  state.dropTarget = null;

  // 同级排序
  if (dropTarget.type === 'before' || dropTarget.type === 'after') {
    const parentPath = getDirPath(draggedNode.path);
    if (!parentPath) return;
    if (draggedNode.path === targetNode.path) return;

    // 获取当前文件夹的子节点名称列表
    let order = state.customOrders[parentPath];
    if (!order) {
      // 没有自定义排序，从树数据中提取当前顺序
      const siblings = getSiblings(parentPath);
      order = siblings.map(n => n.name);
    }

    // 移除被拖拽的节点
    order = order.filter(name => name !== draggedNode.name);

    // 插入到目标位置
    const targetIdx = order.indexOf(targetNode.name);
    if (targetIdx === -1) {
      order.push(draggedNode.name);
    } else if (dropTarget.type === 'before') {
      order.splice(targetIdx, 0, draggedNode.name);
    } else {
      order.splice(targetIdx + 1, 0, draggedNode.name);
    }

    state.customOrders[parentPath] = order;
    saveAppConfig();
    renderTree();
    showToast('已调整顺序', 'success');
    return;
  }

  // 移入文件夹
  if (dropTarget.type === 'into') {
    if (draggedNode.path === targetNode.path) return;
    if (draggedNode.is_dir && targetNode.path.startsWith(draggedNode.path)) {
      showToast('不能将文件夹拖入自身的子目录', 'error');
      return;
    }
    try {
      await invoke('move_path', { src: draggedNode.path, destDir: targetNode.path });
      state.expandedDirs.add(targetNode.path);
      await loadTree();
      showToast(`已移动到 ${targetNode.name}`, 'success');
    } catch (err) {
      showToast('移动失败: ' + err, 'error');
    }
  }
}

// 获取指定文件夹下的同级节点
function getSiblings(folderPath) {
  if (folderPath === state.rootPath) {
    return state.treeData;
  }
  // 递归查找
  function findInTree(nodes) {
    for (const node of nodes) {
      if (node.path === folderPath) return node.children;
      if (node.is_dir && node.children.length > 0) {
        const found = findInTree(node.children);
        if (found) return found;
      }
    }
    return null;
  }
  return findInTree(state.treeData) || [];
}

function filterTree(nodes, term) {
  const lowerTerm = term.toLowerCase();
  const result = [];
  for (const node of nodes) {
    if (node.is_dir) {
      const filteredChildren = filterTree(node.children, term);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lowerTerm)) {
        state.expandedDirs.add(node.path);
        result.push({ ...node, children: filteredChildren });
      }
    } else {
      if (node.name.toLowerCase().includes(lowerTerm)) {
        result.push(node);
      }
    }
  }
  return result;
}

// ===== 文件操作 =====
async function loadTree() {
  if (!state.rootPath) return;
  treeEl.innerHTML = '<div class="loading">加载中...</div>';
  try {
    state.treeData = await invoke('list_directory', { path: state.rootPath });
    renderTree();
  } catch (e) {
    treeEl.innerHTML = `<div class="tree-empty">加载失败: ${escapeHtml(String(e))}</div>`;
    showToast('加载目录失败: ' + e, 'error');
  }
}

// ===== 核心：打开文件 =====
async function openFile(node) {
  state.currentFile = node.path;
  renderTree();
  currentPathEl.textContent = node.path + ' (加载中...)';
  emptyStateEl.classList.add('hidden');
  viewerEl.style.display = 'block';
  // 显示加载指示
  showViewerLoading();

  try {
    const content = await invoke('read_html_file', { path: node.path });
    const dirPath = getDirPath(node.path);

    if (node.file_type === 'md' || isMarkdownFile(node.name)) {
      const html = renderMarkdown(content, node.path);
      state.isLoadingFrame = true;
      viewerEl.src = '';
      viewerEl.srcdoc = html;
      state.isLoadingFrame = false;
    } else {
      // 快速检测是否有外部资源（单次正则，不提取）
      const hasExternal = hasExternalResources(content);

      let modifiedContent = content;
      if (hasExternal) {
        console.log('[ReportManager] 检测到外部资源，开始内联...');
        modifiedContent = await inlineExternalResources(content, dirPath);
      } else {
        console.log('[ReportManager] 无外部资源，直接加载');
      }
      // 移除 <base> 标签
      modifiedContent = modifiedContent.replace(/<base[^>]*>/gi, '');

      // 用 Blob URL 替代 srcdoc，大幅提升大文件加载性能
      const blob = new Blob([modifiedContent], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      // 释放上一个 blob URL
      if (state.currentBlobUrl) {
        URL.revokeObjectURL(state.currentBlobUrl);
      }
      state.currentBlobUrl = blobUrl;

      state.isLoadingFrame = true;
      viewerEl.removeAttribute('srcdoc');
      viewerEl.src = blobUrl;
      state.isLoadingFrame = false;
    }
    currentPathEl.textContent = node.path;
    saveAppConfig();
  } catch (e) {
    console.error('[ReportManager] 打开文件失败:', e);
    currentPathEl.textContent = node.path;
    hideViewerLoading();
    viewerEl.src = '';
    viewerEl.srcdoc = `<div style="padding:40px;text-align:center;color:#999;font-family:sans-serif;"><h2>加载失败</h2><p>${escapeHtml(String(e))}</p></div>`;
    showToast('打开文件失败: ' + e, 'error');
  }
}

// 显示加载指示器
function showViewerLoading() {
  let loader = document.getElementById('viewer-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'viewer-loader';
    loader.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#999;font-size:14px;font-family:sans-serif;text-align:center;z-index:10;';
    loader.innerHTML = '<div style="font-size:32px;animation:spin 1s linear infinite;display:inline-block;">⟳</div><p style="margin-top:8px;">加载中...</p><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.getElementById('viewer-container').appendChild(loader);
  }
  loader.style.display = 'block';
}

function hideViewerLoading() {
  const loader = document.getElementById('viewer-loader');
  if (loader) loader.style.display = 'none';
}

// 快速检测 HTML 是否包含外部资源（单次扫描，不提取内容）
function hasExternalResources(htmlContent) {
  // 只检查是否存在相对路径的 link/img/script，不做完整提取
  const quickCheck = /<(?:link[^>]+href|img[^>]+src|script[^>]+src)=["'](?!https?:|data:|\/\/|#|mailto:|tel:|asset:)/i;
  return quickCheck.test(htmlContent);
}

// ===== 内联外部资源（优化版：增量构建，避免反复 replace）=====
async function inlineExternalResources(htmlContent, dirPath) {
  // 收集所有需要替换的位置
  const replacements = [];

  // 1. <link rel="stylesheet" href="..."> 
  const linkRegex = /<link[^>]+href=["']([^"'>]+)["'][^>]*>/gi;
  let m;
  while ((m = linkRegex.exec(htmlContent)) !== null) {
    const href = m[1];
    if (/^(https?:|data:|\/\/|#|mailto:|tel:)/i.test(href)) continue;
    replacements.push({ index: m.index, fullMatch: m[0], type: 'css', path: href });
  }

  // 2. <img src="...">
  const imgRegex = /<img[^>]+src=["']([^"'>]+)["'][^>]*>/gi;
  while ((m = imgRegex.exec(htmlContent)) !== null) {
    const src = m[1];
    if (/^(https?:|data:|\/\/|#|mailto:|tel:)/i.test(src)) continue;
    replacements.push({ index: m.index, fullMatch: m[0], type: 'img', path: src });
  }

  // 3. <script src="...">
  const scriptRegex = /<script[^>]+src=["']([^"'>]+)["'][^>]*><\/script>/gi;
  while ((m = scriptRegex.exec(htmlContent)) !== null) {
    const src = m[1];
    if (/^(https?:|data:|\/\/|#|mailto:|tel:)/i.test(src)) continue;
    replacements.push({ index: m.index, fullMatch: m[0], type: 'js', path: src });
  }

  if (replacements.length === 0) return htmlContent;

  console.log(`[ReportManager] 发现 ${replacements.length} 个外部资源，开始内联`);

  // 并行读取所有资源
  const results = await Promise.allSettled(
    replacements.map(r => inlineResource(r.path, dirPath, r.type, r.fullMatch))
  );

  // 增量构建结果字符串（避免反复 replace 大字符串）
  let result = '';
  let lastIndex = 0;
  for (let i = 0; i < replacements.length; i++) {
    const r = replacements[i];
    const res = results[i];
    // 添加匹配前的原文
    result += htmlContent.substring(lastIndex, r.index);
    if (res.status === 'fulfilled' && res.value) {
      result += res.value.replacement;
    } else {
      // 内联失败，保留原标签
      result += r.fullMatch;
    }
    lastIndex = r.index + r.fullMatch.length;
  }
  // 添加最后一部分
  result += htmlContent.substring(lastIndex);

  return result;
}

async function inlineResource(relativePath, dirPath, type, originalTag) {
  try {
    // 解析相对路径为绝对路径
    const fullPath = resolvePath(dirPath, relativePath);
    if (!fullPath) return null;

    const dataUri = await invoke('read_file_data_uri', { path: fullPath });

    if (type === 'css') {
      // 将 <link> 替换为 <style>，读取实际 CSS 内容
      const cssContent = await invoke('read_html_file', { path: fullPath });
      return {
        original: originalTag,
        replacement: `<style>/* ${relativePath} */\n${cssContent}\n</style>`,
      };
    } else if (type === 'img') {
      // 替换 img src
      return {
        original: originalTag,
        replacement: originalTag.replace(relativePath, dataUri),
      };
    } else if (type === 'js') {
      // 将 <script src> 替换为内联 script
      const jsContent = await invoke('read_html_file', { path: fullPath });
      return {
        original: originalTag,
        replacement: `<script>\n${jsContent}\n</script>`,
      };
    }
  } catch (e) {
    console.warn('[ReportManager] 内联资源失败:', relativePath, e);
  }
  return null;
}

function resolvePath(baseDir, relativePath) {
  if (!relativePath || relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    // 绝对路径或盘符开头，直接使用
    if (/^[A-Za-z]:/.test(relativePath)) return relativePath;
    // Unix 绝对路径，在 Windows 上可能无效
    return null;
  }
  // 相对路径：拼接 baseDir 和 relativePath
  const separator = baseDir.includes('\\') ? '\\' : '/';
  const parts = relativePath.split(/[/\\]/);
  let result = baseDir;
  for (const part of parts) {
    if (part === '..') {
      const idx = Math.max(result.lastIndexOf('\\'), result.lastIndexOf('/'));
      if (idx > 0) result = result.substring(0, idx);
    } else if (part === '.' || part === '') {
      continue;
    } else {
      result = result + separator + part;
    }
  }
  return result;
}

// ===== iframe load 事件：从父窗口绑定链接拦截器 =====
// 不再向 iframe 内注入脚本，而是从父窗口直接监听 contentDocument 的点击事件
// 这比注入脚本更可靠，不受 CSP 限制，不会因 HTML 内容问题而失效
viewerEl.addEventListener('load', () => {
  if (state.isLoadingFrame) return;
  hideViewerLoading();
  attachLinkInterceptor();
  // 如果大纲栏打开，自动刷新大纲
  if (!outlineSidebarEl.classList.contains('hidden')) {
    setTimeout(() => buildOutline(), 100);
  }
});

function attachLinkInterceptor() {
  let iframeDoc;
  try {
    iframeDoc = viewerEl.contentDocument || viewerEl.contentWindow?.document;
  } catch (e) {
    console.error('[ReportManager] 无法访问 iframe document:', e);
    return;
  }
  if (!iframeDoc) return;

  console.log('[ReportManager] 链接拦截器已绑定到 iframe document');

  // 在 document 上绑定捕获阶段的点击事件，拦截所有 <a> 点击
  iframeDoc.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const rawHref = a.getAttribute('href');
    if (!rawHref) return;

    // 页内锚点（#xxx 或空 #）：阻止默认导航，手动滚动
    // 在 srcdoc 模式下，浏览器默认行为会导航顶层窗口，必须拦截
    if (rawHref === '#' || rawHref.charAt(0) === '#') {
      e.preventDefault();
      e.stopPropagation();
      if (rawHref.length > 1) {
        scrollIframeToAnchor(rawHref);
      }
      return;
    }

    // 外部链接
    if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(rawHref)) {
      if (a.target === '_blank') return; // 允许新窗口打开
      e.preventDefault();
      return;
    }

    // 跨文件锚点（page.html#section）
    const hashIdx = rawHref.indexOf('#');
    if (hashIdx > 0) {
      const filePart = rawHref.substring(0, hashIdx);
      const anchorPart = rawHref.substring(hashIdx);
      e.preventDefault();
      e.stopPropagation();
      handleLinkNavigation(filePart, anchorPart);
      return;
    }

    // 普通内部链接
    e.preventDefault();
    e.stopPropagation();
    handleLinkNavigation(rawHref, null);
  }, true); // 捕获阶段，确保最先处理
}

// 处理链接导航（从父窗口直接调用，不通过 postMessage）
async function handleLinkNavigation(rawHref, anchor) {
  console.log('[ReportManager] 链接导航:', rawHref, '锚点:', anchor);

  const currentDir = state.currentFile ? getDirPath(state.currentFile) : state.rootPath;
  let filePath = resolvePath(currentDir, rawHref);
  if (!filePath) {
    filePath = assetUrlToPath(rawHref);
  }

  console.log('[ReportManager] 解析为文件路径:', filePath);
  if (!filePath) return;

  // 当前文件且有锚点：直接滚动
  if (filePath === state.currentFile && anchor) {
    scrollIframeToAnchor(anchor);
    return;
  }

  try {
    const exists = await invoke('path_exists', { path: filePath });
    if (exists) {
      const fileName = filePath.split('\\').pop().split('/').pop();
      await openFile({
        path: filePath,
        name: fileName,
        is_dir: false,
        file_type: isMarkdownFile(fileName) ? 'md' : 'html',
      });
      if (anchor) {
        setTimeout(() => scrollIframeToAnchor(anchor), 400);
      }
    } else {
      showToast('链接目标不存在: ' + filePath, 'error');
    }
  } catch (err) {
    console.error('[ReportManager] 导航失败:', err);
    showToast('导航失败: ' + err, 'error');
  }
}

// 滚动 iframe 到指定锚点
function scrollIframeToAnchor(anchor) {
  try {
    const iframeDoc = viewerEl.contentDocument || viewerEl.contentWindow?.document;
    if (!iframeDoc) return;

    // anchor 格式为 "#id-name"
    const id = anchor.startsWith('#') ? anchor.substring(1) : anchor;
    
    // 优先用 getElementById（最可靠）
    let target = iframeDoc.getElementById(id);
    
    // 回退到 querySelector（处理 anchor 本身就是完整选择器的情况）
    if (!target) {
      try {
        target = iframeDoc.querySelector(anchor);
      } catch (e) {
        // querySelector 可能因特殊字符失败
      }
    }

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      console.log('[ReportManager] 已滚动到锚点:', anchor, '元素:', target.tagName);
    } else {
      console.warn('[ReportManager] 未找到锚点元素:', anchor, 'id:', id);
    }
  } catch (e) {
    console.error('[ReportManager] 滚动失败:', e);
  }
}

async function openRootFolder() {
  try {
    const folder = await invoke('pick_folder');
    if (folder) {
      state.rootPath = folder;
      state.currentFile = null;
      state.expandedDirs.clear();
      saveAppConfig();
      await loadTree();
      currentPathEl.textContent = '请从左侧选择一个文档';
      emptyStateEl.classList.remove('hidden');
      viewerEl.style.display = 'none';
      viewerEl.src = '';
      viewerEl.srcdoc = '';
      showToast('已打开: ' + folder, 'success');
    }
  } catch (e) {
    showToast('打开目录失败: ' + e, 'error');
  }
}

async function refreshTree() {
  if (state.rootPath) {
    await loadTree();
    showToast('已刷新', 'success');
  }
}

async function createFolder(parentPath) {
  const name = await showPrompt('输入文件夹名称', '新文件夹');
  if (!name) return;
  try {
    const newPath = await invoke('create_folder', { parent: parentPath, name });
    state.expandedDirs.add(parentPath);
    await loadTree();
    showToast(`已创建: ${newPath}`, 'success');
    console.log('[ReportManager] 文件夹已创建:', newPath);
  } catch (e) {
    showToast('创建失败: ' + e, 'error');
  }
}

async function createDocFile(parentPath) {
  const name = await showPrompt('输入文件名称（.html 或 .md）', '新文档.html');
  if (!name) return;
  try {
    const newPath = await invoke('create_html_file', { parent: parentPath, name });
    state.expandedDirs.add(parentPath);
    await loadTree();
    showToast(`已创建: ${newPath}`, 'success');
    console.log('[ReportManager] 文件已创建:', newPath);
    const finalName = name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.md') ? name : name + '.html';
    openFile({ path: newPath, name: finalName, is_dir: false, file_type: isMarkdownFile(finalName) ? 'md' : 'html' });
  } catch (e) {
    showToast('创建失败: ' + e, 'error');
  }
}

async function deleteItem(node) {
  const confirmed = await showConfirm(
    '确认删除',
    `确定要删除 ${node.is_dir ? '文件夹' : '文件'} "${node.name}" 吗？${node.is_dir ? '\n文件夹内的所有内容都将被删除。' : ''}`
  );
  if (!confirmed) return;
  try {
    await invoke('delete_path', { path: node.path });
    if (state.currentFile === node.path) {
      state.currentFile = null;
      currentPathEl.textContent = '请从左侧选择一个文档';
      emptyStateEl.classList.remove('hidden');
      viewerEl.style.display = 'none';
      viewerEl.src = '';
      viewerEl.srcdoc = '';
    }
    await loadTree();
    showToast('已删除', 'success');
  } catch (e) {
    showToast('删除失败: ' + e, 'error');
  }
}

async function renameItem(node) {
  const newName = await showPrompt('输入新名称', node.name);
  if (!newName || newName === node.name) return;
  try {
    const newPath = await invoke('rename_path', { path: node.path, newName });
    if (state.currentFile === node.path) {
      state.currentFile = newPath;
      currentPathEl.textContent = newPath;
    }
    await loadTree();
    showToast('已重命名', 'success');
  } catch (e) {
    showToast('重命名失败: ' + e, 'error');
  }
}

// 在资源管理器中打开
async function openInExplorer(node) {
  try {
    await invoke('open_in_explorer', { path: node.path });
  } catch (e) {
    showToast('打开资源管理器失败: ' + e, 'error');
  }
}

// ===== 右键菜单 =====
function showContextMenu(x, y, node) {
  state.contextNode = node;
  contextMenuEl.innerHTML = '';

  // 公共菜单项：在资源管理器中打开
  const explorerItem = document.createElement('div');
  explorerItem.className = 'menu-item';
  explorerItem.textContent = '📂 在资源管理器中打开';
  explorerItem.onclick = () => { hideContextMenu(); openInExplorer(node); };
  contextMenuEl.appendChild(explorerItem);

  const sep0 = document.createElement('div');
  sep0.className = 'menu-separator';
  contextMenuEl.appendChild(sep0);

  if (!node.is_dir) {
    // 文件菜单
    const openItem = document.createElement('div');
    openItem.className = 'menu-item';
    openItem.textContent = '打开';
    openItem.onclick = () => { hideContextMenu(); openFile(node); };
    contextMenuEl.appendChild(openItem);

    const renameItem = document.createElement('div');
    renameItem.className = 'menu-item';
    renameItem.textContent = '重命名';
    renameItem.onclick = () => { hideContextMenu(); renameItem_fn(node); };
    contextMenuEl.appendChild(renameItem);

    const sep1 = document.createElement('div');
    sep1.className = 'menu-separator';
    contextMenuEl.appendChild(sep1);

    const deleteItem = document.createElement('div');
    deleteItem.className = 'menu-item danger';
    deleteItem.textContent = '删除';
    deleteItem.onclick = () => { hideContextMenu(); deleteItem_fn(node); };
    contextMenuEl.appendChild(deleteItem);
  } else {
    // 文件夹菜单
    const newFolderItem = document.createElement('div');
    newFolderItem.className = 'menu-item';
    newFolderItem.textContent = '新建文件夹';
    newFolderItem.onclick = () => { hideContextMenu(); createFolder(node.path); };
    contextMenuEl.appendChild(newFolderItem);

    const newFileItem = document.createElement('div');
    newFileItem.className = 'menu-item';
    newFileItem.textContent = '新建文档 (HTML/MD)';
    newFileItem.onclick = () => { hideContextMenu(); createDocFile(node.path); };
    contextMenuEl.appendChild(newFileItem);

    const sep1 = document.createElement('div');
    sep1.className = 'menu-separator';
    contextMenuEl.appendChild(sep1);

    const renameItem = document.createElement('div');
    renameItem.className = 'menu-item';
    renameItem.textContent = '重命名';
    renameItem.onclick = () => { hideContextMenu(); renameItem_fn(node); };
    contextMenuEl.appendChild(renameItem);

    const deleteItem = document.createElement('div');
    deleteItem.className = 'menu-item danger';
    deleteItem.textContent = '删除';
    deleteItem.onclick = () => { hideContextMenu(); deleteItem_fn(node); };
    contextMenuEl.appendChild(deleteItem);
  }

  contextMenuEl.style.display = 'block';
  const rect = contextMenuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  contextMenuEl.style.left = Math.min(x, maxX) + 'px';
  contextMenuEl.style.top = Math.min(y, maxY) + 'px';
}

function renameItem_fn(node) { renameItem(node); }
function deleteItem_fn(node) { deleteItem(node); }

function hideContextMenu() {
  contextMenuEl.style.display = 'none';
  state.contextNode = null;
}

// ===== 侧边栏折叠/展开 =====
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  if (state.sidebarCollapsed) {
    sidebarEl.classList.add('collapsed');
    resizerEl.classList.add('hidden');
    sidebarExpandEl.classList.add('visible');
    invoke('save_config', { key: 'sidebarCollapsed', value: '1' }).catch(() => {});
  } else {
    sidebarEl.classList.remove('collapsed');
    resizerEl.classList.remove('hidden');
    sidebarExpandEl.classList.remove('visible');
  }
  saveAppConfig();
}

// ===== 右侧大纲导航栏 =====
function toggleOutline() {
  const isHidden = outlineSidebarEl.classList.contains('hidden');
  if (isHidden) {
    outlineSidebarEl.classList.remove('hidden');
    outlineResizerEl.classList.remove('hidden');
    btnOutlineEl.classList.add('active');
    buildOutline();
  } else {
    outlineSidebarEl.classList.add('hidden');
    outlineResizerEl.classList.add('hidden');
    btnOutlineEl.classList.remove('active');
  }
}

// 从 iframe 中提取 H1-H6 标题，构建大纲
function buildOutline() {
  outlineListEl.innerHTML = '';

  let iframeDoc;
  try {
    iframeDoc = viewerEl.contentDocument || viewerEl.contentWindow?.document;
  } catch (e) {
    outlineListEl.innerHTML = '<div class="outline-empty">无法访问文档内容</div>';
    return;
  }
  if (!iframeDoc) {
    outlineListEl.innerHTML = '<div class="outline-empty">请先打开一个文档</div>';
    return;
  }

  const headings = iframeDoc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) {
    outlineListEl.innerHTML = '<div class="outline-empty">未找到标题</div>';
    return;
  }

  headings.forEach((h, index) => {
    const level = parseInt(h.tagName.substring(1));
    const text = h.textContent.trim() || '(无标题)';

    // 如果没有 id，生成一个
    if (!h.id) {
      h.id = 'outline-heading-' + index;
    }

    const item = document.createElement('a');
    item.className = `outline-item level-${level}`;
    item.href = '#' + h.id;
    item.textContent = text;
    item.title = text;
    item.dataset.anchor = '#' + h.id;

    item.addEventListener('click', (e) => {
      e.preventDefault();
      scrollIframeToAnchor(item.dataset.anchor);
      // 高亮当前项
      outlineListEl.querySelectorAll('.outline-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });

    outlineListEl.appendChild(item);
  });

  console.log(`[ReportManager] 大纲已生成: ${headings.length} 个标题`);
}

// ===== 右侧大纲栏拖拽调整宽度 =====
function initOutlineResizer() {
  let isDragging = false;
  outlineResizerEl.addEventListener('mousedown', (e) => {
    isDragging = true;
    outlineResizerEl.style.background = 'var(--resizer-hover)';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newWidth = Math.max(180, Math.min(400, window.innerWidth - e.clientX));
    outlineSidebarEl.style.width = newWidth + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      outlineResizerEl.style.background = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ===== OS 文件拖拽（纯 HTML5 方案，与树内拖拽共存） =====
// dragDropEnabled=false 后，HTML5 drag-and-drop API 完全可用
// OS 文件拖入通过 dataTransfer.files 获取 File 对象，读取内容后写入磁盘
async function initOsDragDrop() {
  console.log('[ReportManager] 初始化 HTML5 拖放（树内拖拽 + OS 文件拖入）');

  // 在侧边栏注册全局 dragover/drop，处理 OS 文件拖入
  sidebarEl.addEventListener('dragover', (e) => {
    // 如果是树内拖拽（有 draggedNode），不干预，让树节点的 dragover 处理
    if (state.draggedNode) return;

    // OS 文件拖入
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      // 高亮鼠标下方的文件夹
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const treeItem = el?.closest('.tree-item');
      document.querySelectorAll('.tree-item.drag-over').forEach(el => el.classList.remove('drag-over'));

      if (treeItem && treeItem.dataset.isDir === 'true') {
        treeItem.classList.add('drag-over');
        dropHintEl.textContent = `📁 复制到: ${treeItem.querySelector('.tree-label').textContent}`;
      } else {
        dropHintEl.textContent = '📁 松开以复制到根目录';
      }
      dropHintEl.classList.add('active');
      dropOverlayEl.classList.add('active');
    }
  });

  sidebarEl.addEventListener('dragleave', (e) => {
    // 只在真正离开侧边栏时清除
    if (!sidebarEl.contains(e.relatedTarget)) {
      dropHintEl.classList.remove('active');
      dropOverlayEl.classList.remove('active');
      document.querySelectorAll('.tree-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    }
  });

  sidebarEl.addEventListener('drop', async (e) => {
    // 如果是树内拖拽（有 draggedNode），不干预
    if (state.draggedNode) return;

    // OS 文件拖入
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    e.preventDefault();
    e.stopPropagation();
    dropHintEl.classList.remove('active');
    dropOverlayEl.classList.remove('active');
    document.querySelectorAll('.tree-item.drag-over').forEach(el => el.classList.remove('drag-over'));

    // 确定目标文件夹
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const treeItem = el?.closest('.tree-item');
    let targetPath = state.rootPath;

    if (treeItem) {
      const isDir = treeItem.dataset.isDir === 'true';
      const itemPath = treeItem.dataset.path;
      if (isDir) {
        targetPath = itemPath;
      } else {
        targetPath = getDirPath(itemPath) || state.rootPath;
      }
    }

    if (!targetPath) {
      showToast('请先打开一个目录', 'error');
      return;
    }

    // 读取每个文件并写入磁盘
    const files = Array.from(e.dataTransfer.files);
    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      try {
        // 只处理 HTML 和 Markdown 文件（以及文件夹中的内容）
        const name = file.name.toLowerCase();
        const isSupported = name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.md') || name.endsWith('.markdown');

        // 读取文件内容为 ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // 调用 Rust 命令写入文件
        await invoke('write_file_bytes', {
          destDir: targetPath,
          filename: file.name,
          data: Array.from(bytes),
        });
        successCount++;
      } catch (err) {
        console.error('[ReportManager] 文件写入失败:', file.name, err);
        failCount++;
      }
    }

    await loadTree();
    if (successCount > 0) {
      showToast(`成功复制 ${successCount} 个文件${failCount > 0 ? `，${failCount} 个失败` : ''}`, 'success');
    } else if (failCount > 0) {
      showToast(`复制失败 ${failCount} 个文件`, 'error');
    }
  });

  // 阻止整个窗口的默认 drop（防止浏览器打开文件）
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  });
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  });
}

// ===== 侧边栏拖拽调整 =====
function initResizer() {
  let isDragging = false;
  resizerEl.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizerEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newWidth = Math.max(200, Math.min(600, e.clientX));
    sidebarEl.style.width = newWidth + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizerEl.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function getCurrentDir() {
  if (!state.currentFile) return state.rootPath;
  return getDirPath(state.currentFile) || state.rootPath;
}

// ===== 事件监听 =====
function setupEventListeners() {
  document.getElementById('btn-open-root').addEventListener('click', openRootFolder);
  document.getElementById('btn-new-folder').addEventListener('click', () => {
    if (!state.rootPath) { showToast('请先打开目录', 'error'); return; }
    createFolder(getCurrentDir());
  });
  document.getElementById('btn-refresh').addEventListener('click', refreshTree);
  document.getElementById('btn-collapse').addEventListener('click', toggleSidebar);
  sidebarExpandEl.addEventListener('click', toggleSidebar);

  // 大纲导航按钮
  btnOutlineEl.addEventListener('click', toggleOutline);
  document.getElementById('btn-outline-close').addEventListener('click', toggleOutline);

  let searchTimer;
  searchInputEl.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchTerm = e.target.value.trim();
      renderTree();
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (!contextMenuEl.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!treeEl.contains(e.target) && e.target.id !== 'tree-container') hideContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openRootFolder(); }
    if (e.ctrlKey && e.key === 'r') { e.preventDefault(); refreshTree(); }
    if (e.key === 'F5') { e.preventDefault(); refreshTree(); }
    // Ctrl+B 切换侧边栏
    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  });

  initResizer();
  initOutlineResizer();
}

// ===== 初始化 =====
async function init() {
  setupEventListeners();
  initOsDragDrop().catch(err => console.error('[ReportManager] 拖拽初始化异常:', err));

  // 从磁盘配置文件读取所有配置
  const config = await loadAppConfig();
  console.log('[ReportManager] 读取配置:', config);

  // 恢复侧边栏折叠状态
  if (config.sidebarCollapsed === '1') {
    toggleSidebar();
  }

  // 恢复上次打开的目录
  if (config.rootPath) {
    try {
      const exists = await invoke('path_exists', { path: config.rootPath });
      if (exists) {
        state.rootPath = config.rootPath;
        // 恢复展开的目录
        if (config.expandedDirs) {
          try {
            const dirs = JSON.parse(config.expandedDirs);
            state.expandedDirs = new Set(dirs);
          } catch { /* 忽略解析错误 */ }
        }
        // 恢复自定义排序
        if (config.customOrders) {
          try {
            state.customOrders = JSON.parse(config.customOrders);
          } catch { state.customOrders = {}; }
        }
        await loadTree();
        console.log('[ReportManager] 已恢复上次目录:', config.rootPath);

        // 恢复上次打开的文件
        if (config.currentFile) {
          try {
            const fileExists = await invoke('path_exists', { path: config.currentFile });
            if (fileExists) {
              const fileName = config.currentFile.split('\\').pop().split('/').pop();
              openFile({
                path: config.currentFile,
                name: fileName,
                is_dir: false,
                file_type: isMarkdownFile(fileName) ? 'md' : 'html',
              });
            }
          } catch { /* 忽略 */ }
        }
      } else {
        console.log('[ReportManager] 上次目录已不存在:', config.rootPath);
      }
    } catch (e) {
      console.error('[ReportManager] 恢复目录失败:', e);
    }
  }

  // 如果没有已保存的目录，使用默认文档目录
  if (!state.rootPath) {
    try {
      const defaultDir = await invoke('get_default_documents_dir');
      state.rootPath = defaultDir;
      await loadTree();
      console.log('[ReportManager] 使用默认文档目录:', defaultDir);
    } catch (e) {
      console.error('[ReportManager] 获取默认目录失败:', e);
    }
  }

  // 初始化完成，允许保存配置
  state.isInitializing = false;
  saveAppConfig();
}

init();
