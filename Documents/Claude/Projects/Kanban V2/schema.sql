-- ============================================================
--  Kanban + Apontamento de Horas (CETEM)
--  Banco MySQL único. Importar no phpMyAdmin (Hostinger / hPanel).
--  Charset utf8mb4 para acentuação correta.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------
--  colaboradores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS colaboradores (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nome       VARCHAR(120) NOT NULL,
  email      VARCHAR(160) NULL,
  cor        VARCHAR(7)   NOT NULL DEFAULT '#6366f1',  -- cor do badge/avatar
  ativo      TINYINT(1)   NOT NULL DEFAULT 1,           -- soft delete
  criado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  colunas (board configurável)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS colunas (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nome   VARCHAR(80) NOT NULL,
  ordem  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  tarefas (cards)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tarefas (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  titulo          VARCHAR(200) NOT NULL,
  descricao       TEXT NULL,
  coluna_id       INT NOT NULL,
  colaborador_id  INT NULL,                              -- responsável
  prioridade      ENUM('baixa','media','alta') NOT NULL DEFAULT 'media',
  prazo           DATE NULL,
  ordem           INT NOT NULL DEFAULT 0,                -- posição na coluna
  criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tarefa_coluna FOREIGN KEY (coluna_id)      REFERENCES colunas(id),
  CONSTRAINT fk_tarefa_colab  FOREIGN KEY (colaborador_id) REFERENCES colaboradores(id) ON DELETE SET NULL,
  INDEX idx_tarefa_coluna (coluna_id),
  INDEX idx_tarefa_colab  (colaborador_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  tarefa_historico (CRONOLOGIA de cada tarefa)
--  Eventos: criada | movida | editada | responsavel_alterado
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tarefa_historico (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  tarefa_id         INT NOT NULL,
  evento            VARCHAR(40) NOT NULL,
  coluna_origem_id  INT NULL,
  coluna_destino_id INT NULL,
  colaborador_id    INT NULL,                            -- quem agiu / novo responsável
  detalhe           VARCHAR(255) NULL,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_tarefa FOREIGN KEY (tarefa_id) REFERENCES tarefas(id) ON DELETE CASCADE,
  INDEX idx_hist_tarefa (tarefa_id),
  INDEX idx_hist_data   (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  apontamentos (HORAS trabalhadas — lançamento manual)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS apontamentos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tarefa_id       INT NOT NULL,
  colaborador_id  INT NOT NULL,
  data            DATE NOT NULL,
  horas           DECIMAL(5,2) NOT NULL,                 -- ex.: 2.50
  descricao       VARCHAR(255) NULL,
  criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_apont_tarefa FOREIGN KEY (tarefa_id)      REFERENCES tarefas(id) ON DELETE CASCADE,
  CONSTRAINT fk_apont_colab  FOREIGN KEY (colaborador_id) REFERENCES colaboradores(id),
  INDEX idx_apont_tarefa (tarefa_id),
  INDEX idx_apont_colab  (colaborador_id),
  INDEX idx_apont_data   (data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Seeds
-- ------------------------------------------------------------
INSERT INTO colunas (nome, ordem) VALUES
  ('Backlog',      1),
  ('A Fazer',      2),
  ('Em Andamento', 3),
  ('Em Revisão',   4),
  ('Concluído',    5);

INSERT INTO colaboradores (nome, email, cor) VALUES
  ('Equipe CETEM', NULL, '#22d3ee');
