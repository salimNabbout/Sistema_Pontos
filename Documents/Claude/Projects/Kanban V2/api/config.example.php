<?php
// ============================================================
//  MODELO de configuração do banco MySQL (Hostinger / hPanel).
//  Copie este arquivo para "config.php" e preencha com as
//  credenciais criadas em:
//    hPanel > Bancos de Dados > Gerenciamento de bancos MySQL.
//  Na Hostinger o host é normalmente 'localhost'.
// ============================================================

return [
    'host'    => 'localhost',
    'dbname'  => 'SEUUSER_kanban',   // nome do banco criado no hPanel
    'user'    => 'SEUUSER_kanban',   // usuário MySQL
    'pass'    => 'SUA_SENHA_AQUI',   // senha do usuário MySQL
    'charset' => 'utf8mb4',
];
