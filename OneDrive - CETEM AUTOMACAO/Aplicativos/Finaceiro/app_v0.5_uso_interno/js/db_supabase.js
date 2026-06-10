// ============================================================
// db_supabase.js - drop-in replacement for db.js
// Backend: Supabase (state em JSONB) + localStorage (audit/snap/usage)
// ============================================================
// API publica IDENTICA a db.js, com adicao de DB.ready (Promise).
// Estrategia de leitura: cache em memoria, sincrono.
// Estrategia de escrita: debounced upsert em Supabase.
// ============================================================

const SNAP_PREFIX  = 'cockpit-fin-snap-v2:';
const AUDIT_PREFIX = 'cockpit-fin-audit-v1:';
const USAGE_PREFIX = 'cockpit-fin-usage-v1:';
const META_LOCAL_KEY = 'cetem-fin-meta-prefs';
const ACTIVE_EMPRESA_KEY = 'cetem-fin-active-empresa';
const AUDIT_MAX = 5000;
const SNAP_MAX = 10;
const SCHEMA_VERSION = 2;
const SAVE_DEBOUNCE_MS = 600;

const _BC = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('cockpit-fin') : null;

const DB = (() => {
  // ----- Schema base do state (igual ao db.js) -----
  const empty = () => ({
    _schemaVersion: SCHEMA_VERSION,
    empresa: { nome: 'CETEM Engenharia', caixaInicial: 0, pixChave: '', pixCidade: 'SAO PAULO', cnpj: '', setor: '' },
    parametros: {
      caixaMinimo: 5000, metaMargemPct: 35, limiteInadimplenciaPct: 5,
      custosFixosMensais: 0, vendasMediaDiaria: 0, estoqueAtual: 0, diasAtrasoRisco: 15
    },
    clientes: [], fornecedores: [], produtos: [],
    contas: [{ id: 'principal', nome: 'Caixa principal', tipo: 'caixa', saldoInicial: 0, ativa: true }],
    movimentos: [], titulosReceber: [], titulosPagar: [],
    categorias: {
      entrada: ['Vendas', 'Servicos', 'Aporte', 'Outros'],
      saida: ['Fornecedores', 'Folha', 'Tributos', 'Aluguel', 'Sistemas', 'Pro-labore', 'Outros']
    },
    reguaCobranca: [
      { dias: -2, acao: 'Aviso previo de vencimento', canal: 'e-mail/whatsapp' },
      { dias: 1,  acao: 'Primeiro contato de cobranca', canal: 'telefone' },
      { dias: 5,  acao: 'Segundo contato + negociacao', canal: 'telefone/e-mail' },
      { dias: 15, acao: 'Renegociacao formal',          canal: 'reuniao' },
      { dias: 30, acao: 'Suspensao comercial',          canal: 'formal' }
    ],
    auditoria: [],
    metas: { receitaMensal: 0, resultadoMensal: 0, inadimplenciaMaxPct: 5, margemMinPct: 35 },
    onboardingConcluido: false,
    interacoes: [],
    anexos: {},
    orcamento: {},
    recorrencias: []
  });

  const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // ----- Cliente Supabase (singleton compartilhado com auth.js) -----
  if (!window.SB) {
    console.error('[DB Supabase] window.SB nao existe. Carregue js/supabase_client.js antes deste arquivo.');
  }
  const sb = window.SB;

  // ----- Validacao de schema (mesmo do db.js) -----
  function validarSchema(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { ok: false, erro: 'Raiz precisa ser um objeto JSON.' };
    if (data.empresa && typeof data.empresa !== 'object') return { ok: false, erro: '"empresa" precisa ser objeto.' };
    const listas = ['clientes','fornecedores','produtos','contas','movimentos','titulosReceber','titulosPagar','recorrencias','interacoes'];
    for (const k of listas) {
      if (data[k] !== undefined && !Array.isArray(data[k]))
        return { ok: false, erro: `"${k}" precisa ser array.` };
    }
    if (data.anexos && typeof data.anexos !== 'object') return { ok: false, erro: '"anexos" precisa ser objeto.' };
    if (data.orcamento && typeof data.orcamento !== 'object') return { ok: false, erro: '"orcamento" precisa ser objeto.' };
    if (data.categorias) {
      if (typeof data.categorias !== 'object') return { ok: false, erro: '"categorias" precisa ser objeto.' };
      if (data.categorias.entrada && !Array.isArray(data.categorias.entrada)) return { ok: false, erro: '"categorias.entrada" precisa ser array.' };
      if (data.categorias.saida && !Array.isArray(data.categorias.saida)) return { ok: false, erro: '"categorias.saida" precisa ser array.' };
    }
    const checkTitulo = (t, nome) => {
      if (!t || typeof t !== 'object') return `${nome}: item nao e objeto`;
      if (t.valor !== undefined && !isFinite(Number(t.valor))) return `${nome}: valor nao numerico`;
      return null;
    };
    for (const t of (data.movimentos || []).slice(0, 50)) { const e = checkTitulo(t, 'movimento'); if (e) return { ok: false, erro: e }; }
    for (const t of (data.titulosReceber || []).slice(0, 50)) { const e = checkTitulo(t, 'titulo a receber'); if (e) return { ok: false, erro: e }; }
    for (const t of (data.titulosPagar || []).slice(0, 50)) { const e = checkTitulo(t, 'titulo a pagar'); if (e) return { ok: false, erro: e }; }
    return { ok: true };
  }

  // ----- Estado em memoria -----
  let state = empty();
  let meta = {
    empresas: [],
    empresaAtivaId: null,
    perfilAtivo: 'socio',
    userEmail: null,           // email do usuario logado (Supabase Auth)
    userId: null,              // user_id da sessao
    modoAvancado: false
  };
  const listeners = new Set();
  function emit() { listeners.forEach(fn => { try { fn(state); } catch(e) { console.error(e); } }); }

  // ----- Preferencias locais (perfil, modoAvancado, ultima empresa) -----
  function loadLocalPrefs() {
    try {
      const raw = localStorage.getItem(META_LOCAL_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.perfilAtivo) meta.perfilAtivo = p.perfilAtivo;
        if (typeof p.modoAvancado === 'boolean') meta.modoAvancado = p.modoAvancado;
      }
    } catch {}
  }
  function saveLocalPrefs() {
    try {
      localStorage.setItem(META_LOCAL_KEY, JSON.stringify({
        perfilAtivo: meta.perfilAtivo,
        modoAvancado: meta.modoAvancado
      }));
    } catch {}
  }

  // ----- Bootstrap async -----
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  // Flag de seguranca: bloqueia save() ate o bootstrap carregar o state real
  // do Supabase. Se save() rodar com state ainda em empty(), gravava state
  // vazio sobre os dados do banco (bug observado em 2026-05-05).
  let _dbReady = false;
  let _allowEmptySave = false; // permite save de state vazio (uso intencional via reset())

  // Detecta state suspeitamente vazio (todos os arrays principais zerados).
  // Em uso real, o app raramente fica com tudo vazio simultaneamente.
  // Se isso acontecer, abortamos o save por seguranca.
  function _stateSuspeitamenteVazio(st) {
    if (!st) return true;
    const arrays = ['clientes','fornecedores','movimentos','titulosReceber','titulosPagar','contas','produtos'];
    const totalItems = arrays.reduce((acc, k) => acc + (Array.isArray(st[k]) ? st[k].length : 0), 0);
    // 'contas' tem default de 1 (Caixa principal). Se total <= 1, eh suspeito.
    return totalItems <= 1;
  }

  async function bootstrap() {
    try {
      loadLocalPrefs();

      // Garante que ha uma sessao autenticada antes de tocar no banco
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const err = new Error('NAO_AUTENTICADO');
        err.code = 'NAO_AUTENTICADO';
        throw err;
      }
      // Captura email/userId da sessao para registro de responsavel em auditoria
      try {
        meta.userEmail = (session.user && session.user.email) || null;
        meta.userId = (session.user && session.user.id) || null;
      } catch {}
      // Listener: atualiza email quando login/logout ocorre durante a sessao
      try {
        sb.auth.onAuthStateChange((_event, sess) => {
          meta.userEmail = (sess && sess.user && sess.user.email) || null;
          meta.userId = (sess && sess.user && sess.user.id) || null;
        });
      } catch {}

      // Carrega lista de empresas
      const { data: empresas, error: eEmp } = await sb
        .from('empresas')
        .select('id, nome')
        .order('nome', { ascending: true });
      if (eEmp) throw eEmp;

      if (!empresas || empresas.length === 0) {
        // Primeira execucao: cria empresa default
        const eid = id();
        const novoState = empty();
        novoState.empresa.nome = 'CETEM Engenharia';
        const { error: eIns } = await sb
          .from('empresas')
          .insert({ id: eid, nome: 'CETEM Engenharia', state: novoState });
        if (eIns) throw eIns;
        meta.empresas = [{ id: eid, nome: 'CETEM Engenharia' }];
        meta.empresaAtivaId = eid;
        state = novoState;
      } else {
        meta.empresas = empresas;
        const last = localStorage.getItem(ACTIVE_EMPRESA_KEY);
        meta.empresaAtivaId = (last && empresas.find(e => e.id === last))
          ? last
          : empresas[0].id;
        const { data: row, error: eSel } = await sb
          .from('empresas')
          .select('state')
          .eq('id', meta.empresaAtivaId)
          .single();
        if (eSel) throw eSel;
        state = mergeState(empty(), row.state || {});
      }

      _dbReady = true;
      console.log('[DB Supabase] Pronto. Empresa ativa:', meta.empresaAtivaId, '| Save habilitado.');
      resolveReady(state);
      emit();
      // Realtime: sincroniza com outros usuarios (Diego, Jamille, etc.)
      subscribeRealtime();
    } catch (e) {
      console.error('[DB Supabase] Falha no bootstrap:', e);
      window.dispatchEvent(new CustomEvent('cockpit-fin-supabase-error', { detail: { fase: 'bootstrap', error: e } }));
      rejectReady(e);
    }
  }

  function mergeState(base, incoming) {
    return { ...base, ...incoming, _schemaVersion: SCHEMA_VERSION };
  }

  // ----- Save debounced -----
  let saveTimer = null;
  let savePending = false;
  let saveInflight = false;

  function scheduleSave() {
    savePending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }

  async function saveNow() {
    if (!savePending || saveInflight) return;
    if (!meta.empresaAtivaId) return;
    // Trava 1: bloqueia save antes do bootstrap completar.
    if (!_dbReady) {
      console.warn('[DB Supabase] save abortado: bootstrap ainda nao completou. Estado em memoria nao foi gravado para evitar sobrescrita do banco.');
      return;
    }
    // Trava 2: bloqueia save de state suspeitamente vazio (todos os arrays
    // principais zerados). Se isso acontecer apos bootstrap OK, eh quase
    // certamente bug ou corrompimento. Salvar sobrescreveria dados reais.
    // Bypass: reset() seta _allowEmptySave temporariamente.
    if (_stateSuspeitamenteVazio(state) && !_allowEmptySave) {
      console.warn('[DB Supabase] save abortado: state esta suspeitamente vazio (todos os arrays principais zerados). Para zerar de verdade, use o botao Zerar com confirmacao em duas etapas.');
      window.dispatchEvent(new CustomEvent('cockpit-fin-save-abortado', { detail: { motivo: 'state-vazio-suspeito' } }));
      savePending = false; // descarta tentativa
      return;
    }
    saveInflight = true;
    savePending = false;
    const snapshotState = JSON.parse(JSON.stringify(state));
    const nome = (snapshotState.empresa && snapshotState.empresa.nome) || 'Empresa';
    try {
      const { error } = await sb
        .from('empresas')
        .update({ state: snapshotState, nome })
        .eq('id', meta.empresaAtivaId);
      if (error) throw error;
      // Mantem o nome local na lista de empresas em sincronia
      const e = meta.empresas.find(x => x.id === meta.empresaAtivaId);
      if (e && e.nome !== nome) e.nome = nome;
    } catch (err) {
      console.error('[DB Supabase] Falha ao salvar:', err);
      // Re-marca pendente para tentar de novo
      savePending = true;
      window.dispatchEvent(new CustomEvent('cockpit-fin-supabase-error', { detail: { fase: 'save', error: err } }));
    } finally {
      saveInflight = false;
      // Se algo entrou na fila enquanto salvavamos, reagenda
      if (savePending) scheduleSave();
    }
  }

  function save() { scheduleSave(); emit(); broadcastChange(); }

  // Flush pendente ao fechar / esconder a aba
  window.addEventListener('beforeunload', () => { if (savePending) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && savePending) saveNow(); });

  // ----- BroadcastChannel multi-aba -----
  const _tabId = id();
  if (_BC) {
    _BC.onmessage = async (msg) => {
      if (!msg || !msg.data) return;
      if (msg.data.type === 'hello' && msg.data.empresaId === meta.empresaAtivaId && msg.data.tabId !== _tabId) {
        window.dispatchEvent(new CustomEvent('cockpit-fin-concurrent-tab', { detail: { tabId: msg.data.tabId } }));
      }
      if (msg.data.type === 'data-changed' && msg.data.empresaId === meta.empresaAtivaId && msg.data.tabId !== _tabId) {
        // Outra aba salvou — recarrega do Supabase
        try {
          const { data: row } = await sb.from('empresas').select('state').eq('id', meta.empresaAtivaId).single();
          if (row) { state = mergeState(empty(), row.state || {}); emit(); }
        } catch {}
      }
    };
    try { _BC.postMessage({ type: 'hello', empresaId: meta.empresaAtivaId, tabId: _tabId }); } catch {}
  }
  function broadcastChange() {
    if (!_BC) return;
    try { _BC.postMessage({ type: 'data-changed', empresaId: meta.empresaAtivaId, tabId: _tabId }); } catch {}
  }

  // ----- Auditoria (mantida em localStorage, espelho leve no state) -----
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        window.dispatchEvent(new CustomEvent('cockpit-fin-quota-exceeded', { detail: { key } }));
      }
      return false;
    }
  }
  function auditAppend(ev) {
    // ----- Local (cache rapido + backup offline) -----
    const key = AUDIT_PREFIX + (meta.empresaAtivaId || 'default');
    let lista = [];
    try { lista = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
    lista.push(ev);
    if (lista.length > AUDIT_MAX) lista = lista.slice(-AUDIT_MAX);
    safeSet(key, JSON.stringify(lista));
    state.auditoria = (state.auditoria || []);
    state.auditoria.unshift(ev);
    state.auditoria = state.auditoria.slice(0, 500);
    // ----- Remoto (fonte oficial, multi-usuario) -----
    auditAppendRemote(ev);
  }

  // ============================================================
  // INSERT na tabela auditoria_eventos (fonte oficial multi-user).
  // Fire-and-forget: nao trava a UI se Supabase estiver lento.
  // Resolve o bug onde acoes de outros usuarios eram sobrescritas
  // pelo 'last write wins' do state.auditoria JSONB.
  // ============================================================
  async function auditAppendRemote(ev) {
    if (!sb || !meta.empresaAtivaId) return;
    try {
      const email = (ev.email || meta.userEmail || (typeof window !== 'undefined' && window.CURRENT_USER_EMAIL) || '').toLowerCase();
      if (!email) return;
      const { error } = await sb.from('auditoria_eventos').insert({
        empresa_id: meta.empresaAtivaId,
        usuario_email: email,
        perfil: ev.perfil || meta.perfilAtivo || null,
        acao: ev.acao || 'evento',
        detalhe: ev.detalhe || null,
        metadata: ev.metadata || null
      });
      if (error) throw error;
    } catch (e) {
      console.warn('[Auditoria remota] falha (fica so local):', e && e.message || e);
    }
  }

  function auditLoad(empresaId) {
    const key = AUDIT_PREFIX + (empresaId || meta.empresaAtivaId || 'default');
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }

  // ============================================================
  // Leitura remota: busca eventos da tabela auditoria_eventos
  // (fonte oficial). Cai no cache local se Supabase falhar.
  // ============================================================
  async function auditLoadRemote(empresaId, limite) {
    const eid = empresaId || meta.empresaAtivaId || 'default';
    const lim = limite || 500;
    try {
      const { data, error } = await sb
        .from('auditoria_eventos')
        .select('id, usuario_email, perfil, acao, detalhe, metadata, created_at')
        .eq('empresa_id', eid)
        .order('created_at', { ascending: false })
        .limit(lim);
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id,
        ts: r.created_at,
        usuario: r.usuario_email,
        email: r.usuario_email,
        perfil: r.perfil,
        acao: r.acao,
        detalhe: r.detalhe,
        metadata: r.metadata
      }));
    } catch (e) {
      console.warn('[Auditoria remota] falha ao ler, usando cache local:', e && e.message || e);
      return auditLoad(eid);
    }
  }

  // ============================================================
  // Realtime: ouve UPDATE na linha da empresa ativa + INSERT em
  // auditoria_eventos, propagando para a UI via custom events.
  // ============================================================
  let realtimeChannel = null;
  function subscribeRealtime() {
    if (!sb || !meta.empresaAtivaId) return;
    if (realtimeChannel) {
      try { sb.removeChannel(realtimeChannel); } catch (_) {}
      realtimeChannel = null;
    }
    try {
      realtimeChannel = sb
        .channel('empresa-' + meta.empresaAtivaId)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'empresas', filter: 'id=eq.' + meta.empresaAtivaId },
          (payload) => {
            if (saveInflight) return;
            const novoState = payload && payload.new && payload.new.state;
            if (!novoState) return;
            const stamp = new Date().toLocaleTimeString('pt-BR');
            console.log('[Realtime] Update de outro usuario em', stamp);
            state = mergeState(empty(), novoState);
            emit();
            window.dispatchEvent(new CustomEvent('cockpit-fin-remote-sync', {
              detail: { ts: new Date().toISOString() }
            }));
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'auditoria_eventos', filter: 'empresa_id=eq.' + meta.empresaAtivaId },
          (payload) => {
            window.dispatchEvent(new CustomEvent('cockpit-fin-audit-new', {
              detail: { evento: payload && payload.new }
            }));
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[Realtime] Assinatura ativa para empresa', meta.empresaAtivaId);
          }
        });
    } catch (e) {
      console.warn('[Realtime] Falha ao assinar:', e);
    }
  }

  // ----- Helper interno -----
  function DB_internalSet(updater) { updater(state); save(); }

  // Bootstrap ja!
  bootstrap();

  return {
    id,
    SCHEMA_VERSION,
    ready,
    backend: 'supabase',
    validarSchema,
    checarQuota: async () => null, // Nao se aplica em modo Supabase
    get: () => state,
    meta: () => meta,
    set: (updater) => { updater(state); save(); },
    reset: () => {
      // reset eh acao intencional do usuario - bypassa o guard de state vazio.
      // IMPORTANTE: a auditoria NAO eh apagada — preservamos o historico completo
      // de cancelamentos, reversoes e encerramentos (decisao operacional 2026-05-06).
      const auditoriaPreservada = (state && Array.isArray(state.auditoria)) ? state.auditoria.slice() : [];
      state = empty();
      state.auditoria = auditoriaPreservada;
      // Registra o proprio reset na auditoria preservada
      auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'reset-empresa', detalhe: `motivo=Reset de dados via UI; auditoria preservada com ${auditoriaPreservada.length} eventos` });
      _allowEmptySave = true;
      try { save(); } finally { setTimeout(() => { _allowEmptySave = false; }, 5000); }
    },
    replace: (data) => {
      const v = validarSchema(data);
      if (!v.ok) throw new Error('Import invalido: ' + v.erro);
      state = mergeState(empty(), data);
      save();
    },
    importar: (data, origem = 'arquivo') => {
      const v = validarSchema(data);
      if (!v.ok) return { ok: false, erro: v.erro };
      state = mergeState(empty(), data);
      save();
      auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'import', detalhe: `origem=${origem}; chaves=${Object.keys(data).join(',')}` });
      return { ok: true };
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    log: (acao, detalhe) => {
      // Email do responsavel: prioriza window.CURRENT_USER_EMAIL (setado em signIn antes do onAuthStateChange propagar);
      // cai para meta.userEmail (preenchido pelo listener de auth) quando o global nao estiver disponivel.
      const ev = { ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: (typeof window !== 'undefined' && window.CURRENT_USER_EMAIL) || meta.userEmail, acao, detalhe };
      auditAppend(ev);
      save();
    },
    auditList: (empresaId) => auditLoad(empresaId),                              // sync, cache local
    auditListRemote: (empresaId, limite) => auditLoadRemote(empresaId, limite),  // async, fonte oficial multi-user
    auditExport: (empresaId) => {
      const lista = auditLoad(empresaId);
      return lista.map(e => JSON.stringify(e)).join('\n');
    },

    // ----- Cancelamento logico -----
    cancelarTituloReceber: (tituloId, motivo) => {
      const m = String(motivo || '').trim();
      if (!m) return { ok: false, erro: 'Motivo do cancelamento e obrigatorio.' };
      let achou = false;
      DB_internalSet(s => {
        const t = s.titulosReceber.find(x => x.id === tituloId);
        if (!t) return;
        t.status = 'cancelado';
        t.cancelamento = { ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: m };
        achou = true;
      });
      if (achou) auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'cancelar-receber', detalhe: `tituloId=${tituloId}; motivo=${m}` });
      return achou ? { ok: true } : { ok: false, erro: 'Titulo nao encontrado.' };
    },
    cancelarTituloPagar: (tituloId, motivo) => {
      const m = String(motivo || '').trim();
      if (!m) return { ok: false, erro: 'Motivo do cancelamento e obrigatorio.' };
      let achou = false;
      DB_internalSet(s => {
        const t = s.titulosPagar.find(x => x.id === tituloId);
        if (!t) return;
        if (t.pago) return;
        t.cancelado = true;
        t.cancelamento = { ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: m };
        achou = true;
      });
      if (achou) auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'cancelar-pagar', detalhe: `tituloId=${tituloId}; motivo=${m}` });
      return achou ? { ok: true } : { ok: false, erro: 'Titulo nao encontrado ou ja pago.' };
    },
    cancelarMovimento: (movId, motivo) => {
      const m = String(motivo || '').trim();
      if (!m) return { ok: false, erro: 'Motivo do cancelamento e obrigatorio.' };
      let achou = false;
      DB_internalSet(s => {
        const mv = s.movimentos.find(x => x.id === movId);
        if (!mv) return;
        if (mv.origem === 'baixa-receber' || mv.origem === 'baixa-pagar') return;
        mv.cancelado = true;
        mv.cancelamento = { ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: m };
        achou = true;
      });
      if (achou) auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'cancelar-movimento', detalhe: `movId=${movId}; motivo=${m}` });
      return achou ? { ok: true } : { ok: false, erro: 'Movimento nao encontrado ou e fruto de baixa (requer estorno).' };
    },
    // Reverte um pagamento: marca titulo como pendente (pago=false) e cancela
    // logicamente o movimento gerado pela baixa. Append-only audit.
    reverterPagamento: (tituloId, motivo) => {
      const m = String(motivo || '').trim();
      if (!m) return { ok: false, erro: 'Motivo da reversao e obrigatorio.' };
      let achou = false, movsRevertidos = 0;
      DB_internalSet(s => {
        const t = s.titulosPagar.find(x => x.id === tituloId);
        if (!t || !t.pago || t.cancelado) return;
        t.pago = false;
        t.dataPagamento = null;
        t.reversoes = (t.reversoes || []).concat([{ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: m }]);
        // Cancela movimentos vinculados (origem=baixa-pagar e tituloId)
        (s.movimentos || []).forEach(mv => {
          if (mv.origem === 'baixa-pagar' && mv.tituloId === tituloId && !mv.cancelado) {
            mv.cancelado = true;
            mv.cancelamento = { ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: 'Reversao de pagamento: ' + m };
            movsRevertidos++;
          }
        });
        achou = true;
      });
      if (achou) auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'reverter-pagamento', detalhe: `tituloId=${tituloId}; movsRevertidos=${movsRevertidos}; motivo=${m}` });
      return achou ? { ok: true, movsRevertidos } : { ok: false, erro: 'Titulo nao encontrado, ja pendente ou cancelado.' };
    },
    // Reverte um recebimento (pago/parcial -> aberto) e cancela movimentos vinculados.
    reverterRecebimento: (tituloId, motivo) => {
      const m = String(motivo || '').trim();
      if (!m) return { ok: false, erro: 'Motivo da reversao e obrigatorio.' };
      let achou = false, movsRevertidos = 0;
      DB_internalSet(s => {
        const t = s.titulosReceber.find(x => x.id === tituloId);
        if (!t || t.status === 'cancelado' || t.status === 'aberto') return;
        t.valorRecebido = 0;
        t.status = 'aberto';
        t.reversoes = (t.reversoes || []).concat([{ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: m }]);
        (s.movimentos || []).forEach(mv => {
          if (mv.origem === 'baixa-receber' && mv.tituloId === tituloId && !mv.cancelado) {
            mv.cancelado = true;
            mv.cancelamento = { ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, motivo: 'Reversao de recebimento: ' + m };
            movsRevertidos++;
          }
        });
        achou = true;
      });
      if (achou) auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'reverter-recebimento', detalhe: `tituloId=${tituloId}; movsRevertidos=${movsRevertidos}; motivo=${m}` });
      return achou ? { ok: true, movsRevertidos } : { ok: false, erro: 'Titulo nao encontrado, ja aberto ou cancelado.' };
    },

    // ----- Multi-empresa -----
    listEmpresas: () => meta.empresas.slice(),
    empresaAtivaId: () => meta.empresaAtivaId,
    createEmpresa: (nome) => {
      const eid = id();
      const novo = empty();
      novo.empresa.nome = nome;
      // Insercao otimista local + async no Supabase
      meta.empresas.push({ id: eid, nome });
      meta.empresaAtivaId = eid;
      localStorage.setItem(ACTIVE_EMPRESA_KEY, eid);
      state = novo;
      sb.from('empresas').insert({ id: eid, nome, state: novo }).then(({ error }) => {
        if (error) {
          console.error('[DB Supabase] Falha ao criar empresa:', error);
          window.dispatchEvent(new CustomEvent('cockpit-fin-supabase-error', { detail: { fase: 'createEmpresa', error } }));
        }
      });
      emit();
      return eid;
    },
    readEmpresa: (eid) => {
      // Sincrono (compat). Retorna empty() se nao for a ativa.
      // Para leitura real, usar getEmpresaAsync.
      if (eid === meta.empresaAtivaId) return state;
      return empty();
    },
    getEmpresaAsync: async (eid) => {
      const { data, error } = await sb.from('empresas').select('state').eq('id', eid).single();
      if (error) throw error;
      return mergeState(empty(), data.state || {});
    },
    switchEmpresa: (eid) => {
      if (!meta.empresas.find(e => e.id === eid)) return;
      // Flush pending antes de trocar
      const doSwitch = async () => {
        if (savePending) await saveNow();
        meta.empresaAtivaId = eid;
        localStorage.setItem(ACTIVE_EMPRESA_KEY, eid);
        try {
          const { data: row, error } = await sb.from('empresas').select('state').eq('id', eid).single();
          if (error) throw error;
          state = mergeState(empty(), row.state || {});
          emit();
          // Re-assina Realtime para a nova empresa
          subscribeRealtime();
        } catch (err) {
          console.error('[DB Supabase] Falha ao trocar empresa:', err);
          window.dispatchEvent(new CustomEvent('cockpit-fin-supabase-error', { detail: { fase: 'switchEmpresa', error: err } }));
        }
      };
      doSwitch();
    },
    renameEmpresa: (eid, nome) => {
      const e = meta.empresas.find(x => x.id === eid); if (!e) return;
      e.nome = nome;
      if (eid === meta.empresaAtivaId) { state.empresa.nome = nome; save(); }
      else {
        sb.from('empresas').update({ nome }).eq('id', eid).then(({ error }) => {
          if (error) console.error('[DB Supabase] Rename:', error);
        });
      }
    },
    removeEmpresa: (eid) => {
      if (meta.empresas.length <= 1) return false;
      meta.empresas = meta.empresas.filter(e => e.id !== eid);
      if (meta.empresaAtivaId === eid) {
        meta.empresaAtivaId = meta.empresas[0].id;
        localStorage.setItem(ACTIVE_EMPRESA_KEY, meta.empresaAtivaId);
      }
      sb.from('empresas').delete().eq('id', eid).then(async ({ error }) => {
        if (error) console.error('[DB Supabase] Remove:', error);
      });
      // Recarrega a empresa ativa
      sb.from('empresas').select('state').eq('id', meta.empresaAtivaId).single().then(({ data, error }) => {
        if (!error && data) { state = mergeState(empty(), data.state || {}); emit(); }
      });
      auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'remover-empresa', detalhe: `eid=${eid}` });
      return true;
    },

    // ----- Perfis -----
    perfis: ['socio', 'financeiro', 'comercial', 'contabilidade'],
    getPerfil: () => meta.perfilAtivo || 'socio',
    setPerfil: (p) => { meta.perfilAtivo = p; saveLocalPrefs(); emit(); },
    modoAvancado: () => !!meta.modoAvancado,
    setModoAvancado: (v) => { meta.modoAvancado = !!v; saveLocalPrefs(); emit(); },

    // ----- Snapshots (mantidos em localStorage por enquanto) -----
    snapshot: (label) => {
      const key = SNAP_PREFIX + meta.empresaAtivaId;
      let list = [];
      try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
      list.unshift({ ts: new Date().toISOString(), label: label || 'manual', data: JSON.parse(JSON.stringify(state)) });
      list = list.slice(0, SNAP_MAX);
      safeSet(key, JSON.stringify(list));
    },
    listSnapshots: () => {
      const key = SNAP_PREFIX + meta.empresaAtivaId;
      try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
    },
    restoreSnapshot: (ts) => {
      const list = (function () { try { return JSON.parse(localStorage.getItem(SNAP_PREFIX + meta.empresaAtivaId) || '[]'); } catch { return []; } })();
      const snap = list.find(s => s.ts === ts);
      if (!snap) return false;
      state = mergeState(empty(), snap.data);
      save();
      auditAppend({ ts: new Date().toISOString(), perfil: meta.perfilAtivo, email: meta.userEmail, acao: 'restore-snapshot', detalhe: `ts=${ts}; label=${snap.label || ''}` });
      return true;
    },
    deleteSnapshot: (ts) => {
      const key = SNAP_PREFIX + meta.empresaAtivaId;
      let list = []; try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
      list = list.filter(s => s.ts !== ts);
      safeSet(key, JSON.stringify(list));
    },

    // ----- Telemetria de uso (localStorage) -----
    registrarUso: (rotaId) => {
      if (!rotaId) return;
      const key = USAGE_PREFIX + meta.empresaAtivaId;
      let u = {};
      try { u = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
      const agora = new Date().toISOString();
      if (!u[rotaId]) u[rotaId] = { count: 0, firstSeen: agora, lastSeen: agora };
      u[rotaId].count += 1;
      u[rotaId].lastSeen = agora;
      safeSet(key, JSON.stringify(u));
    },
    listarUso: (empresaId) => {
      const key = USAGE_PREFIX + (empresaId || meta.empresaAtivaId);
      try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
    },
    exportarUso: (empresaId) => {
      const u = (function() {
        const key = USAGE_PREFIX + (empresaId || meta.empresaAtivaId);
        try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
      })();
      const rows = Object.entries(u).map(([r, v]) => `${r};${v.count};${v.firstSeen};${v.lastSeen}`);
      return '\uFEFFrota;visitas;primeira_visita;ultima_visita\n' + rows.join('\n');
    }
  };
})();

// Matriz de permissoes por perfil (mesmo do db.js)
const PERMS = {
  socio:         { verTudo: true, pagar: true, baixar: true, editar: true, configurar: true, relatorios: true, cancelar: true },
  financeiro:    { verTudo: true, pagar: true, baixar: true, editar: true, configurar: false, relatorios: true, cancelar: true },
  comercial:     { verTudo: false, pagar: false, baixar: false, editar: false, configurar: false, relatorios: false, verClientes: true, verReceber: true, cancelar: false },
  contabilidade: { verTudo: true, pagar: false, baixar: false, editar: false, configurar: false, relatorios: true, cancelar: false }
};
function can(acao) {
  const p = PERMS[DB.getPerfil()] || PERMS.socio;
  return !!p[acao] || (p.verTudo && ['ver', 'verRelatorios'].includes(acao));
}
