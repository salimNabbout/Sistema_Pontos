# Sistema de Pontos

Sistema web de ponto eletrônico desenvolvido com FastAPI, Supabase e HTML/JavaScript.

## Funcionalidades

- Cadastro de colaboradores
- Ativação e inativação de colaboradores
- Registro sequencial de ponto: entrada, saída almoço, retorno almoço e saída
- Bloqueio de colaborador inativo
- Bloqueio de duplicidade do mesmo tipo de batida no mesmo dia
- Ajuste manual de ponto pelo RH/Admin
- Auditoria com `manual`, `justificativa` e `criado_por`
- Dashboard do dia
- Histórico de batidas
- Relatório por período
- Exportação CSV pelo navegador

## Arquivos principais

- `main.py`: backend FastAPI
- `index.html`: interface web
- `requirements.txt`: dependências Python
- `.env.example`: modelo das variáveis de ambiente

## Como rodar localmente

```bash
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Abra no navegador:

```text
http://127.0.0.1:8000/app
```

## Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto com:

```env
SUPABASE_URL=sua_url_do_supabase
SUPABASE_KEY=sua_chave_do_supabase
ADMIN_PASSWORD=123456
```

Nunca envie o arquivo `.env` real para o GitHub.

## Tabelas esperadas no Supabase

### colaboradores

- id
- nome
- email
- matricula
- ativo
- created_at

### registros_ponto

- id
- colaborador_id
- tipo
- ip_origem
- created_at
- manual
- justificativa
- criado_por

## Status

MVP funcional para uso local e preparação para futura publicação em rede/intranet.
