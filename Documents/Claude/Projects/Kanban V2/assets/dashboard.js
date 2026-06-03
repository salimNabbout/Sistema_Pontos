/* ============================================================
   CETEM · Kanban — dashboard.js
   KPIs, gráfico de horas por colaborador, horas por tarefa,
   cronologia consolidada, com filtro por período.
   Depende de app.js (api, $, esc, fmtData, itemTimeline).
   ============================================================ */

let chartColab = null;

async function carregarDashboard() {
  const de  = $('#dash-de').value;
  const ate = $('#dash-ate').value;
  const qs = [];
  if (de)  qs.push('de='  + de);
  if (ate) qs.push('ate=' + ate);
  const url = 'dashboard' + (qs.length ? '?' + qs.join('&') : '');

  try {
    const d = await api(url);
    renderKpis(d.totais);
    renderChart(d.por_colaborador);
    renderTabelaTarefas(d.por_tarefa);
    renderTimeline(d.cronologia);
  } catch (e) {
    toast('Erro no dashboard: ' + e.message, true);
  }
}

function renderKpis(t) {
  $('#kpis').innerHTML = `
    <div class="kpi accent"><div class="v">${(+t.total_horas).toFixed(1)}h</div><div class="l">Total de horas</div></div>
    <div class="kpi"><div class="v">${t.total_lancamentos}</div><div class="l">Lançamentos</div></div>
    <div class="kpi"><div class="v">${t.total_tarefas}</div><div class="l">Tarefas no quadro</div></div>`;
}

function renderChart(dados) {
  const ctx = $('#chart-colab').getContext('2d');
  const labels = dados.map(d => d.nome);
  const valores = dados.map(d => +d.horas);
  const cores = dados.map(d => d.cor || '#6366f1');
  if (chartColab) chartColab.destroy();
  chartColab = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Horas',
        data: valores,
        backgroundColor: cores,
        borderRadius: 8,
        maxBarThickness: 46,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y.toFixed(2) + 'h' } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8a97aa' } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#8a97aa' } },
      },
    },
  });
}

function renderTabelaTarefas(dados) {
  const tb = $('#tab-tarefas tbody');
  if (!dados.length) { tb.innerHTML = '<tr><td class="dim">Sem horas no período.</td><td></td></tr>'; return; }
  tb.innerHTML = '<tr><th>Tarefa</th><th>Horas</th></tr>' + dados.map(t => `
    <tr><td>${esc(t.titulo)} <span class="dim">· ${esc(t.coluna)}</span></td><td>${(+t.horas).toFixed(2)}h</td></tr>`).join('');
}

function renderTimeline(dados) {
  const ul = $('#timeline');
  ul.innerHTML = dados.length ? dados.map(itemTimeline).join('') : '<li class="dim">Sem eventos.</li>';
}

// ---------- Exportação CSV ----------
// Formato pt-BR: separador ';', decimal com vírgula, BOM UTF-8 (acentos no Excel).
function csvCampo(v) {
  const s = (v ?? '').toString();
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportarCSV() {
  const de  = $('#dash-de').value;
  const ate = $('#dash-ate').value;
  const qs = [];
  if (de)  qs.push('de='  + de);
  if (ate) qs.push('ate=' + ate);
  const url = 'apontamentos' + (qs.length ? '?' + qs.join('&') : '');

  try {
    const aps = await api(url);
    if (!aps.length) { toast('Nenhum apontamento no período.', true); return; }

    // mapeia a coluna de cada tarefa (dados já carregados pelo app.js)
    const colNome = Object.fromEntries(State.colunas.map(c => [c.id, c.nome]));
    const tarefa  = Object.fromEntries(State.tarefas.map(t => [t.id, t]));

    const SEP = ';';
    const cabecalho = ['Data', 'Colaborador', 'Tarefa', 'Coluna', 'Horas', 'Descrição'];

    const linhas = aps.map(a => {
      const t = tarefa[a.tarefa_id];
      const coluna = t ? (colNome[t.coluna_id] || '') : '';
      const data   = a.data.split('-').reverse().join('/');
      const horas  = (+a.horas).toFixed(2).replace('.', ',');
      return [data, a.colaborador_nome, a.tarefa_titulo, coluna, horas, a.descricao || '']
        .map(csvCampo).join(SEP);
    });

    const total = aps.reduce((s, a) => s + (+a.horas), 0).toFixed(2).replace('.', ',');
    linhas.push('');
    linhas.push(['', '', 'Total geral', '', total, ''].map(csvCampo).join(SEP));

    const csv = '\uFEFF' + [cabecalho.join(SEP), ...linhas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const hoje = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `apontamentos_cetem_${de || 'inicio'}_a_${ate || hoje}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    toast(`CSV exportado (${aps.length} lançamentos).`);
  } catch (e) {
    toast('Erro ao exportar: ' + e.message, true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#dash-filtrar').addEventListener('click', carregarDashboard);
  $('#dash-export').addEventListener('click', exportarCSV);
  $('#dash-limpar').addEventListener('click', () => {
    $('#dash-de').value = '';
    $('#dash-ate').value = '';
    carregarDashboard();
  });
});
