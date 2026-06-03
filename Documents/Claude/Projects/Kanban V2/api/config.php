<?php
// ============================================================
//  Configuração do banco MySQL (Hostinger / hPanel)
//  Edite os valores abaixo com as credenciais criadas em
//  hPanel > Bancos de Dados > Gerenciamento de bancos MySQL.
//  Na Hostinger o host é normalmente 'localhost'.
//  (Se a hospedagem indicar um host diferente, ex.: algo como
//   'mysql.hostinger.com' ou um IP, use o valor informado lá.)
//
//  ⚠️  NÃO suba este arquivo com a senha real para repositórios
//      públicos. Veja o .gitignore na raiz do projeto.
// ============================================================

return [
    'host'    => 'localhost',
    'dbname'  => 'SEUUSER_kanban',   // nome do banco criado no hPanel
    'user'    => 'SEUUSER_kanban',   // usuário MySQL
    'pass'    => 'SUA_SENHA_AQUI',   // senha do usuário MySQL
    'charset' => 'utf8mb4',
];
