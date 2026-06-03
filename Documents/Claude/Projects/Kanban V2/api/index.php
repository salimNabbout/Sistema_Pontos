<?php
// ============================================================
//  API REST — Kanban + Apontamento de Horas (CETEM)
//  Roteador único. Respostas em JSON.
//  Rotas (via PATH_INFO, ex.: api/index.php/tarefas):
//    GET|POST|PUT|DELETE  /colaboradores[/{id}]
//    GET                  /colunas
//    GET|POST|PUT|DELETE  /tarefas[/{id}]
//    GET                  /tarefas/{id}/historico
//    GET|POST|DELETE      /apontamentos[/{id}]
//    GET                  /dashboard
// ============================================================

require __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');

// ---------- Helpers ----------
function body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
function json($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function erro(string $msg, int $code = 400): void {
    json(['erro' => $msg], $code);
}
function historico(PDO $pdo, int $tarefaId, string $evento,
                   ?int $origem = null, ?int $destino = null,
                   ?int $colaboradorId = null, ?string $detalhe = null): void {
    $stmt = $pdo->prepare(
        'INSERT INTO tarefa_historico
           (tarefa_id, evento, coluna_origem_id, coluna_destino_id, colaborador_id, detalhe)
         VALUES (?,?,?,?,?,?)'
    );
    $stmt->execute([$tarefaId, $evento, $origem, $destino, $colaboradorId, $detalhe]);
}

// ---------- Roteamento ----------
$metodo   = $_SERVER['REQUEST_METHOD'];
$pathInfo = $_SERVER['PATH_INFO'] ?? '';
if ($pathInfo === '' && isset($_GET['route'])) {        // fallback ?route=
    $pathInfo = '/' . ltrim($_GET['route'], '/');
}
$segs    = array_values(array_filter(explode('/', $pathInfo), fn($s) => $s !== ''));
$recurso = $segs[0] ?? '';
$id      = isset($segs[1]) && is_numeric($segs[1]) ? (int) $segs[1] : null;
$sub     = $segs[2] ?? null;

$pdo = db();

try {
    switch ($recurso) {

        // ====================================================
        //  COLABORADORES
        // ====================================================
        case 'colaboradores':
            if ($metodo === 'GET') {
                json($pdo->query('SELECT * FROM colaboradores WHERE ativo = 1 ORDER BY nome')->fetchAll());
            }
            if ($metodo === 'POST') {
                $b = body();
                if (empty($b['nome'])) erro('Nome é obrigatório');
                $stmt = $pdo->prepare('INSERT INTO colaboradores (nome, email, cor) VALUES (?,?,?)');
                $stmt->execute([$b['nome'], $b['email'] ?? null, $b['cor'] ?? '#6366f1']);
                json(['id' => (int) $pdo->lastInsertId()], 201);
            }
            if ($metodo === 'PUT' && $id) {
                $b = body();
                if (empty($b['nome'])) erro('Nome é obrigatório');
                $stmt = $pdo->prepare('UPDATE colaboradores SET nome=?, email=?, cor=? WHERE id=?');
                $stmt->execute([$b['nome'], $b['email'] ?? null, $b['cor'] ?? '#6366f1', $id]);
                json(['ok' => true]);
            }
            if ($metodo === 'DELETE' && $id) {
                // soft delete: preserva histórico e apontamentos
                $pdo->prepare('UPDATE colaboradores SET ativo=0 WHERE id=?')->execute([$id]);
                json(['ok' => true]);
            }
            erro('Método não suportado', 405);
            break;

        // ====================================================
        //  COLUNAS
        // ====================================================
        case 'colunas':
            if ($metodo === 'GET') {
                json($pdo->query('SELECT * FROM colunas ORDER BY ordem, id')->fetchAll());
            }
            erro('Método não suportado', 405);
            break;

        // ====================================================
        //  TAREFAS
        // ====================================================
        case 'tarefas':
            // ---- GET /tarefas/{id}/historico ----
            if ($metodo === 'GET' && $id && $sub === 'historico') {
                $stmt = $pdo->prepare(
                    'SELECT h.*, c.nome AS colaborador_nome,
                            co.nome AS coluna_origem, cd.nome AS coluna_destino
                     FROM tarefa_historico h
                     LEFT JOIN colaboradores c ON c.id = h.colaborador_id
                     LEFT JOIN colunas co ON co.id = h.coluna_origem_id
                     LEFT JOIN colunas cd ON cd.id = h.coluna_destino_id
                     WHERE h.tarefa_id = ?
                     ORDER BY h.criado_em DESC, h.id DESC'
                );
                $stmt->execute([$id]);
                json($stmt->fetchAll());
            }

            // ---- GET /tarefas (lista) ----
            if ($metodo === 'GET') {
                $rows = $pdo->query(
                    'SELECT t.*, c.nome AS colaborador_nome, c.cor AS colaborador_cor,
                            (SELECT COALESCE(SUM(a.horas),0) FROM apontamentos a WHERE a.tarefa_id = t.id) AS horas_total
                     FROM tarefas t
                     LEFT JOIN colaboradores c ON c.id = t.colaborador_id
                     ORDER BY t.coluna_id, t.ordem, t.id'
                )->fetchAll();
                json($rows);
            }

            // ---- POST /tarefas ----
            if ($metodo === 'POST') {
                $b = body();
                if (empty($b['titulo']))    erro('Título é obrigatório');
                if (empty($b['coluna_id'])) erro('Coluna é obrigatória');
                $ord = $pdo->prepare('SELECT COALESCE(MAX(ordem),0)+1 FROM tarefas WHERE coluna_id=?');
                $ord->execute([(int) $b['coluna_id']]);
                $novaOrdem = (int) $ord->fetchColumn();
                $colab = !empty($b['colaborador_id']) ? (int) $b['colaborador_id'] : null;

                $stmt = $pdo->prepare(
                    'INSERT INTO tarefas (titulo, descricao, coluna_id, colaborador_id, prioridade, prazo, ordem)
                     VALUES (?,?,?,?,?,?,?)'
                );
                $stmt->execute([
                    $b['titulo'],
                    $b['descricao'] ?? null,
                    (int) $b['coluna_id'],
                    $colab,
                    $b['prioridade'] ?? 'media',
                    !empty($b['prazo']) ? $b['prazo'] : null,
                    $novaOrdem,
                ]);
                $novoId = (int) $pdo->lastInsertId();
                historico($pdo, $novoId, 'criada', null, (int) $b['coluna_id'], $colab, 'Tarefa criada');
                json(['id' => $novoId], 201);
            }

            // ---- PUT /tarefas/{id}  (editar / mover / reordenar) ----
            if ($metodo === 'PUT' && $id) {
                $b = body();
                $atual = $pdo->prepare('SELECT * FROM tarefas WHERE id=?');
                $atual->execute([$id]);
                $t = $atual->fetch();
                if (!$t) erro('Tarefa não encontrada', 404);

                $colAtual   = (int) $t['coluna_id'];
                $colabAtual = $t['colaborador_id'] !== null ? (int) $t['colaborador_id'] : null;

                $novaColuna = isset($b['coluna_id']) ? (int) $b['coluna_id'] : $colAtual;
                $novaOrdem  = isset($b['ordem'])     ? (int) $b['ordem']     : (int) $t['ordem'];
                $novoColab  = array_key_exists('colaborador_id', $b)
                    ? (!empty($b['colaborador_id']) ? (int) $b['colaborador_id'] : null)
                    : $colabAtual;

                $stmt = $pdo->prepare(
                    'UPDATE tarefas
                        SET titulo=?, descricao=?, coluna_id=?, colaborador_id=?, prioridade=?, prazo=?, ordem=?
                      WHERE id=?'
                );
                $stmt->execute([
                    array_key_exists('titulo', $b)    ? $b['titulo']    : $t['titulo'],
                    array_key_exists('descricao', $b) ? $b['descricao'] : $t['descricao'],
                    $novaColuna,
                    $novoColab,
                    array_key_exists('prioridade', $b) ? $b['prioridade'] : $t['prioridade'],
                    array_key_exists('prazo', $b) ? ($b['prazo'] ?: null) : $t['prazo'],
                    $novaOrdem,
                    $id,
                ]);

                // --- Histórico ---
                // 1) movimentação entre colunas
                if ($novaColuna !== $colAtual) {
                    historico($pdo, $id, 'movida', $colAtual, $novaColuna, $novoColab, null);
                }
                // 2) edição de conteúdo (compara valores)
                $mudouConteudo = false;
                foreach (['titulo', 'descricao', 'prioridade'] as $f) {
                    if (array_key_exists($f, $b) && (string) $b[$f] !== (string) $t[$f]) $mudouConteudo = true;
                }
                if (array_key_exists('prazo', $b) && ($b['prazo'] ?: null) !== $t['prazo']) $mudouConteudo = true;
                if ($mudouConteudo) {
                    historico($pdo, $id, 'editada', null, null, $novoColab, null);
                }
                // 3) troca de responsável
                if ($novoColab !== $colabAtual) {
                    historico($pdo, $id, 'responsavel_alterado', null, null, $novoColab, null);
                }
                json(['ok' => true]);
            }

            // ---- DELETE /tarefas/{id} ----
            if ($metodo === 'DELETE' && $id) {
                $pdo->prepare('DELETE FROM tarefas WHERE id=?')->execute([$id]);
                json(['ok' => true]);
            }
            erro('Método não suportado', 405);
            break;

        // ====================================================
        //  APONTAMENTOS (horas)
        // ====================================================
        case 'apontamentos':
            if ($metodo === 'GET') {
                $cond = [];
                $params = [];
                if (!empty($_GET['colaborador_id'])) { $cond[] = 'a.colaborador_id = ?'; $params[] = (int) $_GET['colaborador_id']; }
                if (!empty($_GET['tarefa_id']))      { $cond[] = 'a.tarefa_id = ?';      $params[] = (int) $_GET['tarefa_id']; }
                if (!empty($_GET['de']))             { $cond[] = 'a.data >= ?';          $params[] = $_GET['de']; }
                if (!empty($_GET['ate']))            { $cond[] = 'a.data <= ?';          $params[] = $_GET['ate']; }
                $where = $cond ? ('WHERE ' . implode(' AND ', $cond)) : '';
                $stmt = $pdo->prepare(
                    "SELECT a.*, c.nome AS colaborador_nome, c.cor AS colaborador_cor, t.titulo AS tarefa_titulo
                     FROM apontamentos a
                     JOIN colaboradores c ON c.id = a.colaborador_id
                     JOIN tarefas t       ON t.id = a.tarefa_id
                     $where
                     ORDER BY a.data DESC, a.id DESC"
                );
                $stmt->execute($params);
                json($stmt->fetchAll());
            }
            if ($metodo === 'POST') {
                $b = body();
                if (empty($b['tarefa_id']))      erro('Tarefa é obrigatória');
                if (empty($b['colaborador_id'])) erro('Colaborador é obrigatório');
                if (empty($b['data']))           erro('Data é obrigatória');
                if (!isset($b['horas']) || (float) $b['horas'] <= 0) erro('Horas deve ser maior que zero');
                $stmt = $pdo->prepare(
                    'INSERT INTO apontamentos (tarefa_id, colaborador_id, data, horas, descricao)
                     VALUES (?,?,?,?,?)'
                );
                $stmt->execute([
                    (int) $b['tarefa_id'],
                    (int) $b['colaborador_id'],
                    $b['data'],
                    (float) $b['horas'],
                    $b['descricao'] ?? null,
                ]);
                json(['id' => (int) $pdo->lastInsertId()], 201);
            }
            if ($metodo === 'DELETE' && $id) {
                $pdo->prepare('DELETE FROM apontamentos WHERE id=?')->execute([$id]);
                json(['ok' => true]);
            }
            erro('Método não suportado', 405);
            break;

        // ====================================================
        //  DASHBOARD
        // ====================================================
        case 'dashboard':
            if ($metodo !== 'GET') erro('Método não suportado', 405);

            $de  = $_GET['de']  ?? null;
            $ate = $_GET['ate'] ?? null;

            // condição de período aplicada à coluna a.data
            $joinPeriodo = '';   $pp = [];   // para LEFT JOIN (por colaborador)
            $wherePeriodo = '';  $pw = [];   // para WHERE (por tarefa / total)
            if ($de)  { $joinPeriodo .= ' AND a.data >= ?'; $pp[] = $de;  $wherePeriodo .= ' AND a.data >= ?'; $pw[] = $de; }
            if ($ate) { $joinPeriodo .= ' AND a.data <= ?'; $pp[] = $ate; $wherePeriodo .= ' AND a.data <= ?'; $pw[] = $ate; }

            // 1) horas por colaborador (inclui quem tem 0)
            $stmt = $pdo->prepare(
                "SELECT c.id, c.nome, c.cor,
                        COALESCE(SUM(a.horas),0) AS horas,
                        COUNT(a.id) AS lancamentos
                 FROM colaboradores c
                 LEFT JOIN apontamentos a ON a.colaborador_id = c.id $joinPeriodo
                 WHERE c.ativo = 1
                 GROUP BY c.id, c.nome, c.cor
                 ORDER BY horas DESC, c.nome"
            );
            $stmt->execute($pp);
            $porColaborador = $stmt->fetchAll();

            // 2) horas por tarefa
            $stmt = $pdo->prepare(
                "SELECT t.id, t.titulo, col.nome AS coluna,
                        SUM(a.horas) AS horas
                 FROM apontamentos a
                 JOIN tarefas t   ON t.id = a.tarefa_id
                 JOIN colunas col ON col.id = t.coluna_id
                 WHERE 1=1 $wherePeriodo
                 GROUP BY t.id, t.titulo, col.nome
                 ORDER BY horas DESC"
            );
            $stmt->execute($pw);
            $porTarefa = $stmt->fetchAll();

            // 3) totais
            $stmt = $pdo->prepare(
                "SELECT COALESCE(SUM(a.horas),0) AS total_horas, COUNT(*) AS total_lancamentos
                 FROM apontamentos a WHERE 1=1 $wherePeriodo"
            );
            $stmt->execute($pw);
            $totais = $stmt->fetch();
            $totais['total_tarefas'] = (int) $pdo->query('SELECT COUNT(*) FROM tarefas')->fetchColumn();

            // 4) cronologia consolidada (últimos eventos)
            $cronologia = $pdo->query(
                "SELECT h.id, h.evento, h.criado_em, h.detalhe,
                        t.titulo AS tarefa_titulo,
                        co.nome AS coluna_origem, cd.nome AS coluna_destino,
                        c.nome AS colaborador_nome, c.cor AS colaborador_cor
                 FROM tarefa_historico h
                 JOIN tarefas t ON t.id = h.tarefa_id
                 LEFT JOIN colunas co ON co.id = h.coluna_origem_id
                 LEFT JOIN colunas cd ON cd.id = h.coluna_destino_id
                 LEFT JOIN colaboradores c ON c.id = h.colaborador_id
                 ORDER BY h.criado_em DESC, h.id DESC
                 LIMIT 50"
            )->fetchAll();

            json([
                'totais'          => $totais,
                'por_colaborador' => $porColaborador,
                'por_tarefa'      => $porTarefa,
                'cronologia'      => $cronologia,
            ]);
            break;

        default:
            erro('Recurso não encontrado: ' . $recurso, 404);
    }
} catch (Throwable $e) {
    erro('Erro interno: ' . $e->getMessage(), 500);
}
