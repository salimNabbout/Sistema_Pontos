const UI = (() => {
  // Escape defensivo para HTML quando for inevitável usar innerHTML.
  // Prefira textContent sempre que possível.
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v; // reservado para HTML confiável do próprio código
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  };

  function modal(title, bodyNode, onSave) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const close = () => root.innerHTML = '';
    // Modal NAO fecha ao clicar fora (decisao operacional 2026-05-05): evita perda
    // de digitacao em formularios longos. So fecha via Cancelar, Salvar ou X.
    const bg = el('div', { class: 'modal-bg' });
    const box = el('div', { class: 'modal' });
    box.appendChild(el('div', { class: 'flex justify-between items-center mb-4' }, [
      el('h2', { class: 'text-lg font-semibold' }, title),
      el('button', { class: 'text-slate-500 hover:text-slate-900 text-xl', onclick: close }, '×')
    ]));
    box.appendChild(bodyNode);
    const footer = el('div', { class: 'flex justify-end gap-2 mt-6' }, [
      el('button', { class: 'btn btn-s', onclick: close }, 'Cancelar'),
      el('button', { class: 'btn btn-p', onclick: () => { if (onSave() !== false) close(); } }, 'Salvar')
    ]);
    box.appendChild(footer);
    bg.appendChild(box);
    root.appendChild(bg);
  }

  function confirmar(msg, onOk) {
    if (window.confirm(msg)) onOk();
  }

  // Confirmação em 2 etapas: exige o usuário digitar literalmente o texto esperado.
  // Útil para ações destrutivas (zerar empresa, remover empresa, cancelar título).
  function confirmarCritico({ titulo, mensagem, confirmacao, labelBotao = 'Confirmar' }, onOk) {
    const body = el('div');
    body.appendChild(el('p', { class: 'text-sm mb-3' }, mensagem));
    body.appendChild(el('p', { class: 'text-xs mb-2 text-slate-600' }, 'Para confirmar, digite exatamente: '));
    const code = el('code', { class: 'block bg-slate-100 dark:bg-slate-800 rounded p-2 mb-3 text-sm' }, confirmacao);
    body.appendChild(code);
    const inp = el('input', { class: 'input', placeholder: confirmacao });
    body.appendChild(inp);
    const erroEl = el('div', { class: 'text-xs text-red-600 mt-2' }, '');
    body.appendChild(erroEl);

    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const close = () => root.innerHTML = '';
    // Modal NAO fecha ao clicar fora (decisao operacional 2026-05-05): evita perda
    // de digitacao em formularios longos. So fecha via Cancelar, Salvar ou X.
    const bg = el('div', { class: 'modal-bg' });
    const box = el('div', { class: 'modal' });
    box.appendChild(el('div', { class: 'flex justify-between items-center mb-4' }, [
      el('h2', { class: 'text-lg font-semibold text-red-700' }, titulo || 'Confirmação crítica'),
      el('button', { class: 'text-slate-500 hover:text-slate-900 text-xl', onclick: close }, '×')
    ]));
    box.appendChild(body);
    const footer = el('div', { class: 'flex justify-end gap-2 mt-6' }, [
      el('button', { class: 'btn btn-s', onclick: close }, 'Cancelar'),
      el('button', { class: 'btn btn-d', onclick: () => {
        if (inp.value !== confirmacao) { erroEl.textContent = 'Texto não confere exatamente. Digite de novo.'; return; }
        close(); onOk();
      } }, labelBotao)
    ]);
    box.appendChild(footer);
    bg.appendChild(box); root.appendChild(bg);
    setTimeout(() => inp.focus(), 30);
  }

  // Toast não bloqueante — substitui alert() para confirmações positivas.
  function toast(msg, tipo = 'v') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const t = el('div', { class: `toast toast-${tipo}` }, msg);
    host.appendChild(t);
    setTimeout(() => { t.classList.add('toast-out'); }, 2500);
    setTimeout(() => { try { host.removeChild(t); } catch {} }, 3000);
  }

  // Modal de motivo obrigatório (usado no cancelamento lógico).
  function pedirMotivo({ titulo = 'Motivo', placeholder = 'Motivo obrigatório' }, onOk) {
    const body = el('div');
    const inp = el('textarea', { class: 'input', rows: 3, placeholder });
    body.appendChild(el('p', { class: 'text-xs text-slate-600 mb-2' }, 'Este motivo ficará registrado na trilha de auditoria.'));
    body.appendChild(inp);
    modal(titulo, body, () => {
      const v = String(inp.value || '').trim();
      if (!v) { toast('Motivo é obrigatório.', 'r'); return false; }
      onOk(v);
    });
    setTimeout(() => inp.focus(), 30);
  }

  function field(label, input, errorNode) {
    return el('label', { class: 'block mb-3' }, [
      el('span', { class: 'block text-xs font-medium text-slate-600 mb-1' }, label),
      input,
      errorNode || null
    ].filter(Boolean));
  }

  function sparkline(values, color = '#2563eb') {
    if (!values || values.length < 2) return null;
    const w = 120, h = 24, max = Math.max(...values), min = Math.min(...values);
    const rng = max - min || 1;
    const points = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - ((v - min) / rng) * h).toFixed(1)}`).join(' ');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
    const p = document.createElementNS(svgNS, 'polyline');
    p.setAttribute('points', points); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '1.5');
    svg.appendChild(p);
    return svg;
  }

  function kpi(label, value, sem = 'g', hint = '', onClick = null, spark = null) {
    const n = el('div', { class: `card kpi sem-${sem}` + (onClick ? ' cursor-pointer hover:shadow-md' : '') }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value),
      hint ? el('div', { class: 'hint' }, hint) : null,
      spark ? (() => { const s = sparkline(spark.values, spark.color); return s ? el('div', { class: 'mt-1' }, s) : null; })() : null
    ]);
    if (onClick) n.onclick = onClick;
    return n;
  }

  function badge(text, sev) {
    return el('span', { class: `badge badge-${sev}` }, text);
  }

  // Faixa de aviso inline (ex: "Esta tela é estimativa; valores oficiais requerem contador").
  function banner(msg, tipo = 'a') {
    return el('div', { class: `alert alert-${tipo} mb-3` }, [el('div', {}, msg)]);
  }

  // ============================================================
  // Autocomplete: input com dropdown filtrado por nome/documento.
  // Substitui <select> gigante (lento com 1000+ opcoes).
  //
  // Uso:
  //   const ac = UI.autocomplete({
  //     items: st.clientes,
  //     getLabel: c => c.nome,
  //     getMeta: c => c.documento,
  //     getSearch: c => `${c.nome} ${c.documento}`,
  //     initialId: data.clienteId,
  //     placeholder: 'Buscar cliente...',
  //     onSelect: (item) => { ... },
  //     allowClear: true
  //   });
  //   field('Cliente', ac.element)
  //   ac.value         // -> id do selecionado, ou ''
  //   ac.setValue(id)
  //   ac.selectedItem
  // ============================================================
  function autocomplete(opts) {
    const items = opts.items || [];
    const getLabel = opts.getLabel || (i => i.nome);
    const getMeta = opts.getMeta || (() => '');
    const getSearch = opts.getSearch || (i => `${getLabel(i)} ${getMeta(i)}`);
    const placeholder = opts.placeholder || 'Buscar...';
    const onSelect = opts.onSelect || (() => {});
    const onCreate = opts.onCreate; // (queryText) => void — opcional
    const createLabel = opts.createLabel || 'Cadastrar novo';
    const maxResults = opts.maxResults || 50;
    const allowClear = opts.allowClear !== false;

    let selectedId = '';
    let selectedItem = null;
    let highlight = 0;
    let resultsCache = [];

    const wrap = el('div', { class: 'autocomplete-wrap' });
    const input = el('input', { class: 'input autocomplete-input', placeholder, autocomplete: 'off', spellcheck: 'false' });
    const dropdown = el('div', { class: 'autocomplete-dropdown hidden' });
    const clearBtn = el('button', { type: 'button', class: 'autocomplete-clear', title: 'Limpar' }, '\u00d7');

    wrap.appendChild(input);
    if (allowClear) wrap.appendChild(clearBtn);
    wrap.appendChild(dropdown);

    function norm(s) {
      return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function search(q) {
      q = norm(q).trim();
      if (!q) return items.slice(0, maxResults);
      const tokens = q.split(/\s+/).filter(Boolean);
      const out = [];
      for (let i = 0; i < items.length && out.length < maxResults * 3; i++) {
        const haystack = norm(getSearch(items[i]));
        if (tokens.every(t => haystack.includes(t))) out.push(items[i]);
      }
      out.sort((a, b) => {
        const la = norm(getLabel(a)), lb = norm(getLabel(b));
        const aStart = la.startsWith(q) ? 0 : 1;
        const bStart = lb.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return la.localeCompare(lb);
      });
      return out.slice(0, maxResults);
    }

    function renderDropdown() {
      dropdown.innerHTML = '';
      if (!resultsCache.length) {
        const empty = el('div', { class: 'autocomplete-empty' }, 'Nenhum resultado.');
        dropdown.appendChild(empty);
      } else {
        resultsCache.forEach((it, i) => {
          const meta = getMeta(it);
          const item = el('div', {
            class: 'autocomplete-item' + (i === highlight ? ' active' : ''),
            onmousedown: (e) => { e.preventDefault(); pickIndex(i); }
          }, [
            el('div', { class: 'autocomplete-label' }, getLabel(it)),
            meta ? el('div', { class: 'autocomplete-meta' }, meta) : null
          ].filter(Boolean));
          dropdown.appendChild(item);
        });
      }
      // Linha de "Cadastrar novo" no rodape, se onCreate foi passado.
      if (typeof onCreate === 'function') {
        const q = input.value.trim();
        const createRow = el('div', {
          class: 'autocomplete-create',
          onmousedown: (e) => {
            e.preventDefault();
            close();
            try { onCreate(q); } catch (err) { console.error(err); }
          }
        }, '+ ' + createLabel + (q ? ' "' + q + '"' : ''));
        dropdown.appendChild(createRow);
      }
    }

    function open() {
      resultsCache = search(input.value);
      highlight = 0;
      renderDropdown();
      dropdown.classList.remove('hidden');
    }
    function close() { dropdown.classList.add('hidden'); }

    function pickIndex(i) {
      const it = resultsCache[i]; if (!it) return;
      selectedId = it.id != null ? String(it.id) : '';
      selectedItem = it;
      input.value = getLabel(it);
      close();
      try { onSelect(it); } catch (e) { console.error(e); }
    }

    function setValue(id) {
      if (!id) {
        selectedId = ''; selectedItem = null; input.value = '';
        return;
      }
      // Busca dinamica em items[] (suporta itens adicionados depois da criacao)
      const it = items.find(x => x && String(x.id) === String(id));
      if (!it) {
        selectedId = String(id); selectedItem = null; input.value = '';
        return;
      }
      selectedId = String(id); selectedItem = it; input.value = getLabel(it);
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', () => {
      selectedId = ''; selectedItem = null;
      open();
    });
    input.addEventListener('blur', () => { setTimeout(close, 150); });
    input.addEventListener('keydown', (e) => {
      if (dropdown.classList.contains('hidden') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        open(); e.preventDefault(); return;
      }
      if (e.key === 'ArrowDown') { highlight = Math.min(resultsCache.length - 1, highlight + 1); renderDropdown(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { highlight = Math.max(0, highlight - 1); renderDropdown(); e.preventDefault(); }
      else if (e.key === 'Enter') { pickIndex(highlight); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); }
    });
    if (allowClear) {
      clearBtn.onclick = (e) => { e.preventDefault(); setValue(''); input.focus(); };
    }

    if (opts.initialId != null && opts.initialId !== '') setValue(opts.initialId);

    return {
      element: wrap,
      get value() { return selectedId; },
      get selectedItem() { return selectedItem; },
      setValue,
      focus: () => input.focus()
    };
  }


  // ============================================================
  // Formato de datas em pt-BR (dd/mm/aaaa)
  // ============================================================
  function fmtDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    try {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
    } catch (e) {}
    return iso;
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d.toLocaleString('pt-BR');
    } catch (e) {}
    return iso;
  }
  // Expoe global para fora do UI tambem (views.js usa direto)
  window.fmtDate = fmtDate;
  window.fmtDateTime = fmtDateTime;

  // Banner sticky no topo: usado para 'Nova versao disponivel'. Persistente
  // ate o usuario clicar em 'Atualizar agora' ou 'X' (descartar).
  let _updateBannerEl = null;
  function updateBanner(msg, opts = {}) {
    // Se ja existe um banner, atualiza apenas a mensagem.
    if (_updateBannerEl) { try { _updateBannerEl.remove(); } catch {} _updateBannerEl = null; }
    const onConfirm = opts.onConfirm || (() => location.reload());
    const onDismiss = opts.onDismiss || (() => {});
    const labelBtn = opts.labelBtn || 'Atualizar agora';
    const bar = el('div', {
      role: 'alert',
      style: 'position:fixed; top:0; left:0; right:0; z-index:9999; background:#1d4ed8; color:#fff; padding:10px 16px; display:flex; align-items:center; justify-content:center; gap:12px; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,0.15);'
    }, [
      el('span', { style: 'flex:0 1 auto;' }, '🔄  ' + msg),
      el('button', {
        style: 'background:#fff; color:#1d4ed8; padding:4px 12px; border-radius:6px; font-weight:600; border:none; cursor:pointer;',
        onclick: () => { onConfirm(); }
      }, labelBtn),
      el('button', {
        style: 'background:transparent; color:#fff; border:none; cursor:pointer; font-size:18px; padding:0 4px;',
        title: 'Descartar',
        onclick: () => { try { bar.remove(); } catch {} _updateBannerEl = null; onDismiss(); }
      }, '×')
    ]);
    document.body.appendChild(bar);
    _updateBannerEl = bar;
    return bar;
  }
  window.updateBanner = updateBanner;

  return { el, esc, modal, confirmar, confirmarCritico, pedirMotivo, toast, field, kpi, badge, banner, autocomplete, updateBanner, fmtDate, fmtDateTime };
})();
