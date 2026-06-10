// Cálculos financeiros conforme databook (seção 6).
const KPI = (() => {
  const BRL = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const PCT = v => (v == null || isNaN(v)) ? '—' : (v).toFixed(1) + '%';
  const today = () => new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

  function saldoRealizado(st, contaId = null) {
    const contas = (st.contas || []).filter(c => c.ativa !== false);
    const base = contaId
      ? Number((st.contas.find(c => c.id === contaId) || {}).saldoInicial || 0)
      : (contas.reduce((s, c) => s + (Number(c.saldoInicial) || 0), 0) + (Number(st.empresa.caixaInicial) || 0));
    return st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && (!contaId || (m.contaId || 'principal') === contaId))
      .reduce((s, m) => s + (m.tipo === 'entrada' ? +m.valor : -(+m.valor)), base);
  }

  function saldoPorConta(st) {
    return (st.contas || []).filter(c => c.ativa !== false).map(c => ({ ...c, saldo: saldoRealizado(st, c.id) }));
  }

  function abcClientes(st) {
    const map = {};
    st.titulosReceber.forEach(t => { map[t.clienteId] = (map[t.clienteId] || 0) + (+t.valor); });
    const cm = Object.fromEntries(st.clientes.map(c => [c.id, c.nome]));
    const list = Object.entries(map).map(([id, total]) => ({ id, nome: cm[id] || '—', total })).sort((a, b) => b.total - a.total);
    const soma = list.reduce((s, x) => s + x.total, 0);
    let acum = 0;
    return list.map(x => { acum += x.total; const pct = soma > 0 ? x.total / soma * 100 : 0; const acumPct = soma > 0 ? acum / soma * 100 : 0; return { ...x, pct, acumPct, classe: acumPct <= 80 ? 'A' : acumPct <= 95 ? 'B' : 'C' }; });
  }

  function abcProdutos(st) {
    const list = st.produtos.map(p => ({ id: p.id, nome: p.nome, total: (+p.preco) * (+p.volume || 0) })).sort((a, b) => b.total - a.total);
    const soma = list.reduce((s, x) => s + x.total, 0);
    let acum = 0;
    return list.map(x => { acum += x.total; const pct = soma > 0 ? x.total / soma * 100 : 0; const acumPct = soma > 0 ? acum / soma * 100 : 0; return { ...x, pct, acumPct, classe: acumPct <= 80 ? 'A' : acumPct <= 95 ? 'B' : 'C' }; });
  }

  // cenários: realista (1,1), pessimista (0.8 entradas, 1.1 saídas), agressivo (1.2, 0.95)
  const CENARIOS = {
    realista:   { e: 1.0,  s: 1.0 },
    pessimista: { e: 0.8,  s: 1.1 },
    agressivo:  { e: 1.2,  s: 0.95 }
  };
  function projecaoDiaria(st, dias = 60, cenario = 'realista', contaId = null) {
    const f = CENARIOS[cenario] || CENARIOS.realista;
    const inicio = today();
    // Saldo de partida: filtrado por conta se o usuario pediu.
    let saldo = saldoRealizado(st, contaId || null);
    const mapa = {};
    // Buckets separados para vencidos: somam-se em 'hoje' mas mantemos rastro
    // pra UI mostrar tag de atraso e pro alerta de risco.
    let vencidoEntradas = 0, vencidoSaidas = 0;

    // Helper: passa no filtro de conta? Item sem contaId trata como 'principal'
    // (compat com schema antigo). Quando contaId nao e passado, aceita tudo.
    const matchConta = (id) => !contaId || (id || 'principal') === contaId;

    // previstos de movimentos (futuros + atrasados)
    st.movimentos.filter(m => m.status === 'previsto' && !m.cancelado && matchConta(m.contaId))
      .forEach(m => {
        if (!m.data) return;
        if (m.data >= inicio) {
          mapa[m.data] = mapa[m.data] || { entradas: 0, saidas: 0 };
          if (m.tipo === 'entrada') mapa[m.data].entradas += +m.valor;
          else mapa[m.data].saidas += +m.valor;
        } else {
          // Movimento previsto no passado e nao realizado = atrasado
          if (m.tipo === 'entrada') vencidoEntradas += +m.valor;
          else vencidoSaidas += +m.valor;
        }
      });

    // títulos a receber abertos/parciais
    st.titulosReceber.filter(t => t.status !== 'pago' && t.status !== 'cancelado' && matchConta(t.contaId))
      .forEach(t => {
        if (!t.vencimento) return;
        const valor = (+t.valor) - (+t.valorRecebido || 0);
        if (valor <= 0) return;
        if (t.vencimento >= inicio) {
          mapa[t.vencimento] = mapa[t.vencimento] || { entradas: 0, saidas: 0 };
          mapa[t.vencimento].entradas += valor;
        } else {
          vencidoEntradas += valor;
        }
      });

    // títulos a pagar pendentes
    st.titulosPagar.filter(t => !t.pago && !t.cancelado && matchConta(t.contaId))
      .forEach(t => {
        if (!t.vencimento) return;
        if (t.vencimento >= inicio) {
          mapa[t.vencimento] = mapa[t.vencimento] || { entradas: 0, saidas: 0 };
          mapa[t.vencimento].saidas += +t.valor;
        } else {
          vencidoSaidas += +t.valor;
        }
      });

    // Adiciona vencidos no bucket de hoje (com flag separada).
    if (vencidoEntradas > 0 || vencidoSaidas > 0) {
      mapa[inicio] = mapa[inicio] || { entradas: 0, saidas: 0 };
      mapa[inicio].vencidoEntradas = (mapa[inicio].vencidoEntradas || 0) + vencidoEntradas;
      mapa[inicio].vencidoSaidas = (mapa[inicio].vencidoSaidas || 0) + vencidoSaidas;
    }

    const datas = Object.keys(mapa).filter(d => d >= inicio).sort().slice(0, dias);
    return datas.map(d => {
      const dia = mapa[d];
      const e = (dia.entradas || 0) * f.e;
      const s = (dia.saidas || 0) * f.s;
      const ve = (dia.vencidoEntradas || 0) * f.e;
      const vs = (dia.vencidoSaidas || 0) * f.s;
      saldo += (e + ve - s - vs);
      return { data: d, entradas: e, saidas: s, vencidoEntradas: ve, vencidoSaidas: vs, saldo };
    });
  }

  function saldoProjetadoSemana(st, contaId = null) {
    const proj = projecaoDiaria(st, 7, 'realista', contaId);
    return proj.length ? proj[proj.length - 1].saldo : saldoRealizado(st, contaId);
  }

  function custoFixoMensal(st) {
    const param = Number(st.parametros.custosFixosMensais) || 0;
    if (param > 0) return param;
    const hoje = new Date();
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1).toISOString().slice(0, 10);
    const fim = today();
    const fixos = st.titulosPagar.filter(t => t.categoria && ['Aluguel','Folha','Sistemas','Pró-labore'].includes(t.categoria)
      && t.vencimento >= ini && t.vencimento <= fim);
    if (!fixos.length) return 0;
    return fixos.reduce((s, t) => s + (+t.valor), 0) / 3;
  }

  function coberturaCaixaFixo(st) {
    const c = custoFixoMensal(st);
    return c > 0 ? saldoRealizado(st) / c : null;
  }

  function margemContribuicao(st) {
    const receita = st.produtos.reduce((s, p) => s + (+p.preco) * (+p.volume || 0), 0);
    const impostos = st.produtos.reduce((s, p) => s + ((+p.preco) * (+p.imposto || 0) / 100) * (+p.volume || 0), 0);
    const custos = st.produtos.reduce((s, p) => s + (+p.custoVariavel) * (+p.volume || 0), 0);
    const mc = receita - impostos - custos;
    const mcPct = receita > 0 ? (mc / receita) * 100 : 0;
    return { receita, impostos, custos, mc, mcPct };
  }

  function pontoEquilibrio(st) {
    const { mcPct } = margemContribuicao(st);
    const cf = custoFixoMensal(st);
    return mcPct > 0 ? (cf / (mcPct / 100)) : null;
  }

  function inadimplenciaPct(st) {
    const hoje = today();
    const total = st.titulosReceber.filter(t => t.status !== 'pago' && t.status !== 'cancelado')
      .reduce((s, t) => s + ((+t.valor) - (+t.valorRecebido || 0)), 0);
    const vencidos = st.titulosReceber.filter(t => t.status !== 'pago' && t.status !== 'cancelado' && t.vencimento < hoje)
      .reduce((s, t) => s + ((+t.valor) - (+t.valorRecebido || 0)), 0);
    return total > 0 ? (vencidos / total) * 100 : 0;
  }

  function pmr(st) {
    const cr = st.titulosReceber.filter(t => t.status !== 'pago' && t.status !== 'cancelado')
      .reduce((s, t) => s + ((+t.valor) - (+t.valorRecebido || 0)), 0);
    const vmd = Number(st.parametros.vendasMediaDiaria) || 0;
    return vmd > 0 ? cr / vmd : null;
  }

  function ncg(st) {
    const cr = st.titulosReceber.filter(t => t.status !== 'pago' && t.status !== 'cancelado')
      .reduce((s, t) => s + ((+t.valor) - (+t.valorRecebido || 0)), 0);
    const cp = st.titulosPagar.filter(t => !t.pago).reduce((s, t) => s + (+t.valor), 0);
    const est = Number(st.parametros.estoqueAtual) || 0;
    return cr + est - cp;
  }

  function resultadoOperacional(st) {
    const { mc } = margemContribuicao(st);
    return mc - custoFixoMensal(st);
  }

  function semSaldo(v, min) {
    if (v == null) return 'g';
    if (v < 0) return 'r';
    if (v < min) return 'a';
    return 'v';
  }
  function semCobertura(v) {
    if (v == null) return 'g';
    if (v < 1) return 'r';
    if (v < 1.5) return 'a';
    return 'v';
  }
  function semInad(v, limite) {
    if (v > limite) return 'r';
    if (v > limite * 0.6) return 'a';
    return 'v';
  }
  function semMargem(v, meta) {
    if (v <= 0) return 'r';
    if (v < meta) return 'a';
    return 'v';
  }

  function alertas(st) {
    const out = [];
    const saldoProj = saldoProjetadoSemana(st);
    if (saldoProj < 0) out.push({ sev: 'r', msg: 'Caixa projetado negativo na próxima semana.', acao: 'Suspender discricionários e replanejar pagamentos.' });
    else if (saldoProj < Number(st.parametros.caixaMinimo)) out.push({ sev: 'a', msg: 'Saldo projetado abaixo do caixa mínimo.', acao: 'Acelerar cobrança e adiar despesas não críticas.' });

    const inad = inadimplenciaPct(st);
    if (inad > Number(st.parametros.limiteInadimplenciaPct)) out.push({ sev: 'r', msg: `Inadimplência em ${inad.toFixed(1)}%.`, acao: 'Ativar régua de cobrança e revisar limites.' });

    const { mcPct } = margemContribuicao(st);
    if (st.produtos.length && mcPct < Number(st.parametros.metaMargemPct)) out.push({ sev: 'a', msg: `Margem de contribuição ${mcPct.toFixed(1)}% abaixo da meta.`, acao: 'Revisar preço, mix e custo variável.' });

    const pe = pontoEquilibrio(st);
    const { receita } = margemContribuicao(st);
    if (pe != null && receita > 0 && receita < pe) out.push({ sev: 'r', msg: 'Receita abaixo do ponto de equilíbrio.', acao: 'Cortar custo fixo ou elevar receita/margem.' });

    const hoje = new Date();
    const em7 = new Date(hoje.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const pressao = st.titulosPagar.filter(t => !t.pago && t.vencimento <= em7).reduce((s, t) => s + (+t.valor), 0);
    if (pressao > 0 && pressao > saldoProj * 0.5) out.push({ sev: 'a', msg: `Concentração de pagamentos nos próximos 7 dias: ${BRL(pressao)}.`, acao: 'Priorizar obrigatórios e negociar prazos.' });

    return out;
  }

  function dreGerencial(st, ano, mes) {
    // mes 1-12
    const pref = `${ano}-${String(mes).padStart(2, '0')}`;
    const movs = st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && m.data.startsWith(pref));
    const receitaBruta = movs.filter(m => m.tipo === 'entrada' && m.natureza === 'op').reduce((s, m) => s + (+m.valor), 0);
    const receitaNop   = movs.filter(m => m.tipo === 'entrada' && m.natureza !== 'op').reduce((s, m) => s + (+m.valor), 0);
    const saidasCat    = {};
    movs.filter(m => m.tipo === 'saida').forEach(m => {
      saidasCat[m.categoria] = (saidasCat[m.categoria] || 0) + (+m.valor);
    });
    const custosVar = ['Fornecedores', 'Tributos'].reduce((s, k) => s + (saidasCat[k] || 0), 0);
    const custosFix = ['Aluguel', 'Folha', 'Sistemas', 'Pró-labore'].reduce((s, k) => s + (saidasCat[k] || 0), 0);
    const outros    = Object.entries(saidasCat).filter(([k]) => !['Fornecedores', 'Tributos', 'Aluguel', 'Folha', 'Sistemas', 'Pró-labore'].includes(k)).reduce((s, [, v]) => s + v, 0);
    const mc = receitaBruta - custosVar;
    const mcPct = receitaBruta > 0 ? (mc / receitaBruta * 100) : 0;
    const resultadoOp = mc - custosFix - outros;
    const resultadoFinal = resultadoOp + receitaNop;
    return { receitaBruta, custosVar, mc, mcPct, custosFix, outros, resultadoOp, receitaNop, resultadoFinal, saidasCat };
  }

  function vencimentosPorDia(st, ano, mes) {
    const pref = `${ano}-${String(mes).padStart(2, '0')}`;
    const mapa = {};
    st.titulosReceber.filter(t => t.status !== 'pago' && t.status !== 'cancelado' && t.vencimento.startsWith(pref))
      .forEach(t => {
        mapa[t.vencimento] = mapa[t.vencimento] || { receber: 0, pagar: 0, itens: [] };
        mapa[t.vencimento].receber += (+t.valor) - (+t.valorRecebido || 0);
        mapa[t.vencimento].itens.push({ tipo: 'r', valor: (+t.valor) - (+t.valorRecebido || 0) });
      });
    st.titulosPagar.filter(t => !t.pago && t.vencimento.startsWith(pref))
      .forEach(t => {
        mapa[t.vencimento] = mapa[t.vencimento] || { receber: 0, pagar: 0, itens: [] };
        mapa[t.vencimento].pagar += (+t.valor);
        mapa[t.vencimento].itens.push({ tipo: 'p', valor: (+t.valor) });
      });
    return mapa;
  }

  return {
    CENARIOS,
    dreGerencial, vencimentosPorDia,
    BRL, PCT, today, daysBetween,
    saldoRealizado, saldoPorConta, saldoProjetadoSemana, projecaoDiaria,
    abcClientes, abcProdutos,
    // DFC método direto: separa entradas/saídas por atividade.
    dfcDireto: function (st, ano, mes) {
      const pref = `${ano}-${String(mes).padStart(2, '0')}`;
      const movs = st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && m.data.startsWith(pref));
      const blocos = { operacional: { entradas: {}, saidas: {} }, investimento: { entradas: {}, saidas: {} }, financiamento: { entradas: {}, saidas: {} } };
      movs.forEach(m => {
        const atv = m.natureza === 'op' ? 'operacional' : (m.natureza === 'ext' ? 'investimento' : 'financiamento');
        const lado = m.tipo === 'entrada' ? 'entradas' : 'saidas';
        const k = m.categoria || 'Outros';
        blocos[atv][lado][k] = (blocos[atv][lado][k] || 0) + (+m.valor);
      });
      const sumBloco = (b) => {
        const e = Object.values(b.entradas).reduce((s, v) => s + v, 0);
        const s = Object.values(b.saidas).reduce((a, v) => a + v, 0);
        return { e, s, liquido: e - s };
      };
      const op = sumBloco(blocos.operacional);
      const iv = sumBloco(blocos.investimento);
      const fi = sumBloco(blocos.financiamento);
      return { blocos, op, iv, fi, variacao: op.liquido + iv.liquido + fi.liquido };
    },
    // Série dos últimos N meses para sparklines de KPIs.
    seriesKpi: function (st, N = 6) {
      const hoje = new Date();
      const out = { receita: [], resultado: [], saldoFim: [], labels: [] };
      let saldoAcum = Number(st.empresa.caixaInicial) || 0;
      (st.contas || []).filter(c => c.ativa !== false).forEach(c => saldoAcum += (+c.saldoInicial || 0));
      // acumula todos os meses anteriores para pegar saldo cumulativo correto
      for (let i = N - 1; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const pref = d.toISOString().slice(0, 7);
        out.labels.push(pref);
        const movs = st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && m.data.startsWith(pref));
        const r = movs.filter(m => m.tipo === 'entrada').reduce((s, m) => s + (+m.valor), 0);
        const s = movs.filter(m => m.tipo === 'saida').reduce((a, m) => a + (+m.valor), 0);
        out.receita.push(r);
        out.resultado.push(r - s);
        saldoAcum += (r - s);
        out.saldoFim.push(saldoAcum);
      }
      return out;
    },
    // Burn rate: média mensal de (saídas - entradas) nos últimos 3 meses quando negativo.
    burnRate: function (st) {
      const hoje = new Date();
      let soma = 0, n = 0;
      for (let i = 1; i <= 3; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const pref = d.toISOString().slice(0, 7);
        const movs = st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && m.data.startsWith(pref));
        const e = movs.filter(m => m.tipo === 'entrada').reduce((s, m) => s + (+m.valor), 0);
        const s = movs.filter(m => m.tipo === 'saida').reduce((a, m) => a + (+m.valor), 0);
        const liquido = s - e;
        if (liquido > 0) { soma += liquido; n++; }
      }
      return n > 0 ? soma / n : 0;
    },
    runwayMeses: function (st) {
      const saldo = this.saldoRealizado(st);
      const burn = this.burnRate(st);
      if (burn <= 0) return null; // não queima caixa
      return saldo / burn;
    },
    // Classifica movimentos como "sócio" se a descrição ou categoria contiver termos como "pró-labore", "retirada", "sócio".
    // Forecast simples: regressão linear sobre N meses de receita realizada.
    // Índice sazonal: média da receita de cada mês civil dividida pela média geral (12 meses = 1,0).
    sazonalidade: function (st, meses = 24) {
      const hoje = new Date();
      const porMes = {}; // {1..12: [valores]}
      for (let m = 1; m <= 12; m++) porMes[m] = [];
      for (let i = meses - 1; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const pref = d.toISOString().slice(0, 7);
        const r = st.movimentos.filter(x => x.status === 'realizado' && !x.cancelado && x.tipo === 'entrada' && x.data.startsWith(pref)).reduce((s, x) => s + (+x.valor), 0);
        porMes[d.getMonth() + 1].push(r);
      }
      const medias = {};
      for (let m = 1; m <= 12; m++) medias[m] = porMes[m].length ? porMes[m].reduce((s, v) => s + v, 0) / porMes[m].length : 0;
      const geral = Object.values(medias).reduce((s, v) => s + v, 0) / 12;
      const indice = {};
      for (let m = 1; m <= 12; m++) indice[m] = geral > 0 ? medias[m] / geral : 0;
      return { medias, geral, indice };
    },
    forecastReceita: function (st, N = 6, horizonte = 3) {
      const hoje = new Date();
      const serie = [];
      for (let i = N - 1; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const pref = d.toISOString().slice(0, 7);
        const r = st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && m.tipo === 'entrada' && m.data.startsWith(pref)).reduce((s, m) => s + (+m.valor), 0);
        serie.push({ mes: pref, valor: r });
      }
      // ajuste y = a + b*x onde x = índice do mês
      const n = serie.length;
      const sumX = serie.reduce((s, _, i) => s + i, 0);
      const sumY = serie.reduce((s, p) => s + p.valor, 0);
      const sumXY = serie.reduce((s, p, i) => s + i * p.valor, 0);
      const sumXX = serie.reduce((s, _, i) => s + i * i, 0);
      const b = (n * sumXX - sumX * sumX) > 0 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;
      const a = (sumY - b * sumX) / n;
      const media = n > 0 ? sumY / n : 0;
      const forecast = [];
      for (let h = 1; h <= horizonte; h++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() + h, 1);
        forecast.push({ mes: d.toISOString().slice(0, 7), linear: Math.max(0, a + b * (n - 1 + h)), media });
      }
      return { historico: serie, forecast, tendencia: b, media };
    },
    // Comparativo YoY
    yoy: function (st, ano, mes) {
      const mk = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
      const sumEnt = (pref) => st.movimentos.filter(x => x.status === 'realizado' && !x.cancelado && x.data.startsWith(pref))
        .reduce((acc, x) => { if (x.tipo === 'entrada') acc.e += +x.valor; else acc.s += +x.valor; return acc; }, { e: 0, s: 0 });
      const cur = sumEnt(mk(ano, mes));
      const prev = sumEnt(mk(ano - 1, mes));
      const delta = (a, b) => b === 0 ? null : ((a - b) / b * 100);
      return { cur, prev, deltaE: delta(cur.e, prev.e), deltaS: delta(cur.s, prev.s), deltaR: delta(cur.e - cur.s, prev.e - prev.s) };
    },
    // Indicadores comerciais
    indicadoresComerciais: function (st) {
      const hoje = new Date();
      const pref = hoje.toISOString().slice(0, 7);
      const titMes = st.titulosReceber.filter(t => (t.emissao || '').startsWith(pref));
      const clientesComTit = new Set(st.titulosReceber.map(t => t.clienteId));
      const clientesMes = new Set(titMes.map(t => t.clienteId));
      const receitaMes = titMes.reduce((s, t) => s + (+t.valor), 0);
      const ticketMedio = titMes.length > 0 ? receitaMes / titMes.length : 0;
      const novosMes = [...clientesMes].filter(cid => {
        const ant = st.titulosReceber.filter(t => t.clienteId === cid && !t.emissao?.startsWith(pref));
        return !ant.length;
      }).length;
      return { ticketMedio, clientesAtivos: clientesComTit.size, clientesMes: clientesMes.size, novosMes, titulosMes: titMes.length };
    },
    movimentosSocios: function (st) {
      const rx = /pró[\s-]?labore|pro[\s-]?labore|retirada|sócio|socio|distribui[çc][ãa]o/i;
      return st.movimentos.filter(m => rx.test((m.descricao || '') + ' ' + (m.categoria || '')));
    },
    realizadoPorCategoria: function (st, ano, mes) {
      const pref = `${ano}-${String(mes).padStart(2, '0')}`;
      const out = {};
      st.movimentos.filter(m => m.status === 'realizado' && !m.cancelado && m.tipo === 'saida' && m.data.startsWith(pref))
        .forEach(m => { out[m.categoria || 'Outros'] = (out[m.categoria || 'Outros'] || 0) + (+m.valor); });
      return out;
    },
    custoFixoMensal, coberturaCaixaFixo,
    margemContribuicao, pontoEquilibrio,
    inadimplenciaPct, pmr, ncg, resultadoOperacional,
    semSaldo, semCobertura, semInad, semMargem,
    alertas
  };
})();
