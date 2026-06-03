# CETEM · Kanban + Apontamento de Horas

Quadro kanban com lançamento manual de horas e dashboard, feito para rodar em
**hospedagem compartilhada da Hostinger** (PHP + MySQL, sem Node/Python).

- **Frontend:** HTML/CSS/JS puro (sem build) — `index.html`, `assets/`
- **Backend:** PHP puro (PDO) — `api/`
- **Banco:** MySQL único — `schema.sql`
- **Bibliotecas (via CDN):** SortableJS (drag-and-drop) e Chart.js (gráfico)

## Funcionalidades

- Quadro com colunas configuráveis e **arrastar-e-soltar** entre/dentro das colunas.
- Cada movimentação grava **histórico** (a cronologia da tarefa).
- Cards com responsável, prioridade, prazo e total de horas.
- **Lançamento manual de horas** por tarefa/colaborador/data.
- **Dashboard:** total de horas, horas por colaborador (gráfico), horas por tarefa,
  cronologia consolidada e **exportação CSV**, com filtro por período.
- Gestão de colaboradores (quadro único compartilhado — sem login).
- Layout responsivo (funciona em celular).

---

## Deploy na Hostinger (hPanel)

> O painel da Hostinger é o **hPanel** (não é cPanel). Os passos abaixo usam os
> nomes de menu do hPanel. Requer um plano com PHP + MySQL (qualquer plano de
> Hospedagem de Sites compartilhada serve).

### 1. Criar o banco MySQL
No hPanel → **Bancos de Dados → Gerenciamento de bancos MySQL**:

1. Em **Criar um novo banco de dados MySQL**, informe um nome (ex.: `kanban`).
   A Hostinger prefixa com seu usuário → algo como `u123456789_kanban`.
2. Crie também o **usuário** e uma **senha** (a tela cria banco + usuário juntos).
3. O usuário já vem vinculado ao banco com todos os privilégios.
4. Anote: **nome do banco**, **usuário** e **senha** (você vai precisar deles).

### 2. Importar o schema
No hPanel → **Bancos de Dados → phpMyAdmin** (botão ao lado do banco criado) →
aba **Importar** → escolha o arquivo `schema.sql` → **Executar/Importar**.
Isso cria as tabelas e o seed das colunas (Backlog → Concluído).

### 3. Configurar a conexão
Edite `api/config.php` com os dados do passo 1:

```php
return [
    'host'    => 'localhost',              // normalmente localhost na Hostinger
    'dbname'  => 'u123456789_kanban',      // nome completo do banco
    'user'    => 'u123456789_kanban',      // usuário MySQL
    'pass'    => 'SUA_SENHA',
    'charset' => 'utf8mb4',
];
```

> Se a Hostinger indicar um **host** diferente de `localhost` na tela do banco
> (alguns planos mostram um host/IP próprio), use o valor que ela informar.
>
> Dica: você pode partir de `api/config.example.php` (modelo) e salvar como
> `api/config.php`.

### 4. Subir os arquivos
No hPanel → **Arquivos → Gerenciador de Arquivos** (ou via FTP/SFTP), envie o
conteúdo do projeto para dentro de `public_html`. Você pode colocar tudo numa
subpasta `kanban/`. Estrutura final:

```
public_html/kanban/
├── index.html
├── assets/   (styles.css, app.js, dashboard.js)
├── api/      (config.php, config.example.php, db.php, index.php, .htaccess)
└── schema.sql
```

> Para subir tudo de uma vez pelo Gerenciador de Arquivos: compacte o projeto
> em um `.zip`, faça upload e use **Extrair** dentro de `public_html`.

### 5. Definir a versão do PHP
No hPanel → **Avançado → Configuração do PHP**, selecione **PHP 8.0 ou superior**
(o app usa arrow functions e tipos de retorno; PHP 7.4 também funciona).

### 6. Acessar
Abra `https://SEU-DOMINIO/kanban/`.

---

## Rodar localmente (opcional)

Para testar na sua máquina antes do deploy, basta ter o PHP instalado:

```bash
# importe schema.sql num MySQL local e ajuste api/config.php, depois:
php -S localhost:8000
# abra http://localhost:8000/
```

---

## Notas técnicas

- A API responde em JSON e roteia por **PATH_INFO** (`api/index.php/tarefas`),
  que funciona em qualquer Apache sem configuração extra.
- O `.htaccess` é opcional: habilita o atalho `api/tarefas` (sem `index.php`).
  Para usá-lo, troque `API_BASE` para `'api'` no topo de `assets/app.js`.
- Colaboradores são removidos por **soft delete** (`ativo=0`), preservando o
  histórico de horas. Excluir uma **tarefa** remove em cascata seus apontamentos
  e histórico.
- O drag-and-drop renumera a ordem dos cards na coluna afetada e só registra
  evento `movida` quando a tarefa muda de coluna (reordenar na mesma coluna não
  polui a cronologia).
- **Segurança:** não versione `api/config.php` com a senha real em repositórios
  públicos. O `.gitignore` traz uma linha pronta (comentada) para ignorá-lo, e
  `api/config.example.php` serve de modelo.

## Estrutura das tabelas

| Tabela | Papel |
|---|---|
| `colaboradores` | quem registra atividade (nome, cor, ativo) |
| `colunas` | colunas do quadro (Backlog → Concluído) |
| `tarefas` | cards: título, descrição, coluna, responsável, prioridade, prazo, ordem |
| `tarefa_historico` | cronologia: criada / movida / editada / responsável alterado |
| `apontamentos` | horas lançadas (tarefa, colaborador, data, horas, descrição) |
