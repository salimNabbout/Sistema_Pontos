/* ============================================================
   CETEM · Kanban — app.js
   Quadro, drag-and-drop, modais de tarefa / horas / colaboradores
   ============================================================ */

// Base da API. Usa PATH_INFO (funciona sem rewrite no HostGator).
// Com o .htaccess incluído você pode trocar para 'api'.
const API_BASE = 'api/index.php';

// Estado global (compartilhado com dashboard.js)
const State = { colunas: [], colaboradores: [], tarefas: [] };

// ---------- HTTP ----------
async function api(path, method = 'GET', payload = null) {
  const opts = { method, headers: {} };
  if (payload) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(payload); }
  const res = await fetch(`${API_BASE}/${path}`, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const e = await res.json(); msg = e.erro || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Util ----------
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iniciais = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', erro);
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function fmtData(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------- Carregamento ----------
async function carregarTudo() {
  [State.colunas, State.colaboradores, State.tarefas] = await Promise.all([
    api('colunas'), api('colaboradores'), api('tarefas'),
  ]);
  renderBoard();
}

// ---------- Render do quadro ----------
function renderBoard() {
  const board = $('#board');
  board.innerHTML = '';
  State.colunas.forEach(col => {
    const tarefas = State.tarefas.filter(t => +t.coluna_id === +col.id);
    const elCol = document.createElement('div');
    elCol.className = 'column';
    elCol.innerHTML = `
      <div class="column-head">
        <span class="dot"></span>
        <h2>${esc(col.nome)}</h2>
        <span class="count">${tarefas.length}</span>
      </div>
      <div class="cards" data-coluna="${col.id}"></div>`;
    const cont = elCol.querySelector('.cards');
    tarefas.forEach(t => cont.appendChild(cardEl(t)));
    board.appendChild(elCol);

    // drag-and-drop
    new Sortable(cont, {
      group: 'kanban',
      animation: 160,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: aoSoltar,
    });
  });
}

function cardEl(t) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = t.id;
  const resp = t.colaborador_nome
    ? `<span class="avatar" style="background:${esc(t.colaborador_cor || '#6366f1')}" title="${esc(t.colaborador_nome)}">${iniciais(t.colaborador_nome)}</span>`
    : '';
  const prazo = t.prazo ? `<span class="chip">📅 ${t.prazo.split('-').reverse().slice(0, 2).join('/')}</span>` : '';
  const horas = (+t.horas_total > 0) ? `<span class="chip horas">⏱ ${(+t.horas_total).toFixed(1)}h</span>` : '';
  el.innerHTML = `
    <span class="prio ${esc(t.prioridade)}"></span>
    <h4>${esc(t.titulo)}</h4>
    <div class="card-meta">${resp}${prazo}${horas}</div>`;
  el.addEventListener('click', () => abrirTarefa(t.id));
  return el;
}

// ---------- Drag and drop: persistência ----------
async function aoSoltar(evt) {
  const colDestino = +evt.to.dataset.coluna;
  const colOrigem  = +evt.from.dataset.coluna;
  try {
    // renumera a coluna de destino conforme a ordem do DOM
    await renumerar(evt.to);
    if (colOrigem !== colDestino) await renumerar(evt.from);
    // recarrega para refletir histórico/horas
    State.tarefas = await api('tarefas');
    // atualiza só os contadores sem re-render total seria ideal; re-render simples:
    renderBoard();
  } catch (e) {
    toast('Erro ao mover: ' + e.message, true);
    carregarTudo();
  }
}

async function renumerar(contEl) {
  const coluna = +contEl.dataset.coluna;
  const ids = $$('.card', contEl).map(c => +c.dataset.id);
  // PUT em sequência (boards pequenos). coluna_id igual = não loga "movida".
  for (let i = 0; i < ids.length; i++) {
    await api(`tarefas/${ids[i]}`, 'PUT', { coluna_id: coluna, ordem: i + 1 });
  }
}

// ============================================================
//  MODAL TAREFA
// ============================================================
function preencherSelectColunas(sel, valor) {
  sel.innerHTML = State.colunas.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  if (valor) sel.value = valor;
}
function preencherSelectColabs(sel, valor, comVazio = true) {
  const vazio = comVazio ? '<option value="">— sem responsável —</option>' : '';
  sel.innerHTML = vazio + State.colaboradores.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  sel.value = valor || '';
}

function abrirModal(id) { $('#' + id).classList.add('open'); }
function fecharModais() { $$('.modal-overlay').forEach(m => m.classList.remove('open')); }

async function abrirTarefa(id) {
  preencherSelectColunas($('#t-coluna'));
  preencherSelectColabs($('#t-colaborador'));
  trocarMtab('detalhes');

  if (id) {
    const t = State.tarefas.find(x => +x.id === +id);
    $('#tarefa-modal-titulo').textContent = 'Editar tarefa';
    $('#t-id').value = t.id;
    $('#t-titulo').value = t.titulo || '';
    $('#t-descricao').value = t.descricao || '';
    $('#t-coluna').value = t.coluna_id;
    $('#t-colaborador').value = t.colaborador_id || '';
    $('#t-prioridade').value = t.prioridade || 'media';
    $('#t-prazo').value = t.prazo || '';
    $('#t-excluir').style.display = '';
    $('#mtab-cronologia').style.display = '';
    $('#mtab-apontamentos').style.display = '';
    carregarHistoricoTarefa(id);
    carregarApontamentosTarefa(id);
  } else {
    $('#tarefa-modal-titulo').textContent = 'Nova tarefa';
    $('#t-id').value = '';
    $('#t-titulo').value = '';
    $('#t-descricao').value = '';
    $('#t-coluna').selectedIndex = 0;
    $('#t-colaborador').value = '';
    $('#t-prioridade').value = 'media';
    $('#t-prazo').value = '';
    $('#t-excluir').style.display = 'none';
    $('#mtab-cronologia').style.display = 'none';
    $('#mtab-apontamentos').style.display = 'none';
  }
  abrirModal('modal-tarefa');
}

function trocarMtab(nome) {
  $$('.mtab').forEach(b => b.classList.toggle('active', b.dataset.mtab === nome));
  $$('.mpane').forEach(p => p.classList.toggle('active', p.dataset.pane === nome));
}

async function salvarTarefa() {
  const id = $('#t-id').value;
  const payload = {
    titulo: $('#t-titulo').value.trim(),
    descricao: $('#t-descricao').value.trim(),
    coluna_id: +$('#t-coluna').value,
    colaborador_id: $('#t-colaborador').value || null,
    prioridade: $('#t-prioridade').value,
    prazo: $('#t-prazo').value || null,
  };
  if (!payload.titulo) { toast('Informe o título', true); return; }
  try {
    if (id) await api(`tarefas/${id}`, 'PUT', payload);
    else    await api('tarefas', 'POST', payload);
    fecharModais();
    await carregarTudo();
    toast(id ? 'Tarefa atualizada' : 'Tarefa criada');
  } catch (e) { toast('Erro: ' + e.message, true); }
}

async function excluirTarefa() {
  const id = $('#t-id').value;
  if (!id || !confirm('Excluir esta tarefa? Os apontamentos e o histórico dela também serão removidos.')) return;
  try {
    await api(`tarefas/${id}`, 'DELETE');
    fecharModais();
    await carregarTudo();
    toast('Tarefa excluída');
  } catch (e) { toast('Erro: ' + e.message, true); }
}

// ---------- cronologia da tarefa ----------
async function carregarHistoricoTarefa(id) {
  const ul = $('#t-historico');
  ul.innerHTML = '<li class="dim">Carregando…</li>';
  try {
    const hist = await api(`tarefas/${id}/historico`);
    ul.innerHTML = hist.length ? hist.map(itemTimeline).join('') : '<li class="dim">Sem eventos.</li>';
  } catch (e) { ul.innerHTML = `<li class="dim">Erro: ${esc(e.message)}</li>`; }
}

function itemTimeline(h) {
  const labels = { criada: 'Tarefa criada', movida: 'Movida', editada: 'Editada', responsavel_alterado: 'Responsável alterado' };
  let txt = labels[h.evento] || h.evento;
  if (h.evento === 'movida') txt = `Movida de <b>${esc(h.coluna_origem || '—')}</b> para <b>${esc(h.coluna_destino || '—')}</b>`;
  if (h.evento === 'responsavel_alterado') txt = `Responsável: <b>${esc(h.colaborador_nome || '—')}</b>`;
  return `<li>
    <span class="tl-dot ${esc(h.evento)}"></span>
    <div class="tl-body">${txt}${h.tarefa_titulo ? ` · <b>${esc(h.tarefa_titulo)}</b>` : ''}
      <div class="when">${fmtData(h.criado_em)}</div></div>
  </li>`;
}

// ---------- apontamentos da tarefa ----------
async function carregarApontamentosTarefa(id) {
  const box = $('#t-apontamentos');
  box.innerHTML = '<p class="dim">Carregando…</p>';
  try {
    const aps = await api(`apontamentos?tarefa_id=${id}`);
    if (!aps.length) { box.innerHTML = '<p class="dim">Nenhum apontamento.</p>'; $('#t-apont-total').textContent = ''; return; }
    box.innerHTML = aps.map(a => `
      <div class="apont-item">
        <span class="avatar" style="background:${esc(a.colaborador_cor || '#6366f1')}">${iniciais(a.colaborador_nome)}</span>
        <div style="flex:1">
          <div>${esc(a.colaborador_nome)} <span class="dim">· ${a.data.split('-').reverse().join('/')}</span></div>
          ${a.descricao ? `<div class="dim">${esc(a.descricao)}</div>` : ''}
        </div>
        <span class="h">${(+a.horas).toFixed(2)}h</span>
        <button class="x" title="Excluir" onclick="excluirApontamento(${a.id}, ${id})">×</button>
      </div>`).join('');
    const total = aps.reduce((s, a) => s + (+a.horas), 0);
    $('#t-apont-total').textContent = `Total: ${total.toFixed(2)}h em ${aps.length} lançamento(s).`;
  } catch (e) { box.innerHTML = `<p class="dim">Erro: ${esc(e.message)}</p>`; }
}

async function excluirApontamento(apId, tarefaId) {
  if (!confirm('Excluir este apontamento de horas?')) return;
  try {
    await api(`apontamentos/${apId}`, 'DELETE');
    carregarApontamentosTarefa(tarefaId);
    State.tarefas = await api('tarefas');
    renderBoard();
    toast('Apontamento excluído');
  } catch (e) { toast('Erro: ' + e.message, true); }
}

// ============================================================
//  MODAL HORAS
// ============================================================
function abrirHoras() {
  $('#h-tarefa').innerHTML = State.tarefas.map(t => `<option value="${t.id}">${esc(t.titulo)}</option>`).join('');
  preencherSelectColabs($('#h-colaborador'), '', false);
  $('#h-data').value = new Date().toISOString().slice(0, 10);
  $('#h-horas').value = '';
  $('#h-descricao').value = '';
  if (!State.tarefas.length) { toast('Crie uma tarefa antes de lançar horas.', true); return; }
  abrirModal('modal-horas');
}

async function salvarHoras() {
  const payload = {
    tarefa_id: +$('#h-tarefa').value,
    colaborador_id: +$('#h-colaborador').value,
    data: $('#h-data').value,
    horas: parseFloat($('#h-horas').value),
    descricao: $('#h-descricao').value.trim() || null,
  };
  if (!payload.colaborador_id) { toast('Selecione o colaborador', true); return; }
  if (!payload.data) { toast('Informe a data', true); return; }
  if (!(payload.horas > 0)) { toast('Horas deve ser maior que zero', true); return; }
  try {
    await api('apontamentos', 'POST', payload);
    fecharModais();
    State.tarefas = await api('tarefas');
    renderBoard();
    toast('Horas lançadas');
  } catch (e) { toast('Erro: ' + e.message, true); }
}

// ============================================================
//  MODAL COLABORADORES
// ============================================================
async function abrirColaboradores() {
  renderColabList();
  abrirModal('modal-colaboradores');
}
function renderColabList() {
  $('#colab-list').innerHTML = State.colaboradores.map(c => `
    <div class="colab-row">
      <span class="avatar" style="background:${esc(c.cor)}">${iniciais(c.nome)}</span>
      <span class="nm">${esc(c.nome)}</span>
      <button class="x" title="Remover" onclick="removerColab(${c.id})">×</button>
    </div>`).join('') || '<p class="dim">Nenhum colaborador.</p>';
}
async function addColab() {
  const nome = $('#c-nome').value.trim();
  const cor = $('#c-cor').value;
  if (!nome) { toast('Informe o nome', true); return; }
  try {
    await api('colaboradores', 'POST', { nome, cor });
    $('#c-nome').value = '';
    State.colaboradores = await api('colaboradores');
    renderColabList();
    toast('Colaborador adicionado');
  } catch (e) { toast('Erro: ' + e.message, true); }
}
async function removerColab(id) {
  if (!confirm('Remover este colaborador? O histórico de horas dele é preservado.')) return;
  try {
    await api(`colaboradores/${id}`, 'DELETE');
    State.colaboradores = await api('colaboradores');
    renderColabList();
    toast('Colaborador removido');
  } catch (e) { toast('Erro: ' + e.message, true); }
}

// ============================================================
//  Navegação / eventos
// ============================================================
function trocarView(nome) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === nome));
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + nome).classList.add('active');
  if (nome === 'dashboard' && typeof carregarDashboard === 'function') carregarDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
  // tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => trocarView(t.dataset.view)));
  // botões topo
  $('#btn-nova-tarefa').addEventListener('click', () => abrirTarefa(null));
  $('#btn-horas').addEventListener('click', abrirHoras);
  $('#btn-colaboradores').addEventListener('click', abrirColaboradores);
  // modal tarefa
  $('#t-salvar').addEventListener('click', salvarTarefa);
  $('#t-excluir').addEventListener('click', excluirTarefa);
  $$('.mtab').forEach(b => b.addEventListener('click', () => trocarMtab(b.dataset.mtab)));
  // modal horas / colab
  $('#h-salvar').addEventListener('click', salvarHoras);
  $('#c-add').addEventListener('click', addColab);
  // fechar modais
  $$('[data-close]').forEach(b => b.addEventListener('click', fecharModais));
  $$('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === m) fecharModais(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModais(); });

  carregarTudo().catch(e => toast('Falha ao carregar: ' + e.message, true));
});
