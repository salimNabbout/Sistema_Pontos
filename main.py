from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from supabase import create_client
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime
import os

load_dotenv(dotenv_path=Path(__file__).with_name('.env'))

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')

if not SUPABASE_URL:
    raise Exception('SUPABASE_URL não encontrado no .env')
if not SUPABASE_KEY:
    raise Exception('SUPABASE_KEY não encontrado no .env')
if not ADMIN_PASSWORD:
    raise Exception('ADMIN_PASSWORD não encontrado no .env')

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title='Sistema de Ponto Eletrônico', version='1.4.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

TIPOS_VALIDOS = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida']
PROXIMO_TIPO_PERMITIDO = {
    None: 'entrada',
    'entrada': 'saida_almoco',
    'saida_almoco': 'retorno_almoco',
    'retorno_almoco': 'saida',
    'saida': 'entrada',
}
IPS_AUTORIZADOS_PREFIXOS = [
    '127.0.0.1', '192.168.', '10.',
    '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.',
    '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'
]


def admin_autorizado(admin_password: str) -> bool:
    return admin_password == ADMIN_PASSWORD


def erro_admin():
    return {'erro': 'Acesso administrativo negado. Senha inválida.'}


def obter_ip_cliente(request: Request):
    forwarded_for = request.headers.get('x-forwarded-for')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.client.host


def ip_autorizado(ip: str):
    return any(ip.startswith(prefixo) for prefixo in IPS_AUTORIZADOS_PREFIXOS)


def buscar_colaborador(colaborador_id: str):
    resultado = supabase.table('colaboradores').select('*').eq('id', colaborador_id).limit(1).execute()
    return resultado.data[0] if resultado.data else None


def buscar_ultimo_ponto(colaborador_id: str):
    resultado = (
        supabase.table('registros_ponto')
        .select('*')
        .eq('colaborador_id', colaborador_id)
        .order('created_at', desc=True)
        .limit(1)
        .execute()
    )
    return resultado.data[0] if resultado.data else None


def buscar_ponto_mesmo_tipo_no_dia(colaborador_id: str, tipo: str, data_base: str):
    resultado = (
        supabase.table('registros_ponto')
        .select('*')
        .eq('colaborador_id', colaborador_id)
        .eq('tipo', tipo)
        .gte('created_at', f'{data_base}T00:00:00')
        .lte('created_at', f'{data_base}T23:59:59')
        .limit(1)
        .execute()
    )
    return resultado.data[0] if resultado.data else None


def validar_sequencia(colaborador_id: str, tipo_solicitado: str):
    ultimo_ponto = buscar_ultimo_ponto(colaborador_id)
    ultimo_tipo = ultimo_ponto.get('tipo') if ultimo_ponto else None
    tipo_esperado = PROXIMO_TIPO_PERMITIDO.get(ultimo_tipo)
    return {
        'valido': tipo_solicitado == tipo_esperado,
        'ultimo_tipo': ultimo_tipo,
        'tipo_esperado': tipo_esperado,
    }


@app.get('/')
def home():
    return {'mensagem': 'API do ponto funcionando', 'status': 'online'}


@app.get('/app')
def abrir_app():
    return FileResponse(Path(__file__).with_name('index.html'))


@app.get('/admin/validar')
def validar_admin(admin_password: str):
    if not admin_autorizado(admin_password):
        return {'autorizado': False, 'erro': 'Senha administrativa inválida.'}
    return {'autorizado': True, 'mensagem': 'Acesso administrativo liberado.'}


@app.get('/status-rede')
def status_rede(request: Request):
    ip = obter_ip_cliente(request)
    return {'ip_detectado': ip, 'rede_autorizada': ip_autorizado(ip)}


@app.get('/dashboard-dia')
def dashboard_dia(data: str, admin_password: str):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()

        colaboradores = supabase.table('colaboradores').select('*').eq('ativo', True).execute().data or []
        registros = (
            supabase.table('registros_ponto')
            .select('*')
            .gte('created_at', f'{data}T00:00:00')
            .lte('created_at', f'{data}T23:59:59')
            .order('created_at', desc=False)
            .execute()
            .data
            or []
        )
        ids_com_entrada = {r.get('colaborador_id') for r in registros if r.get('tipo') == 'entrada'}
        sem_entrada = [c for c in colaboradores if c.get('id') not in ids_com_entrada]
        ajustes = [r for r in registros if r.get('manual') is True]

        return {
            'data': data,
            'total_colaboradores_ativos': len(colaboradores),
            'total_registros_dia': len(registros),
            'total_ajustes_manuais': len(ajustes),
            'total_com_entrada': len(ids_com_entrada),
            'total_sem_entrada': len(sem_entrada),
            'colaboradores_sem_entrada': sem_entrada,
            'registros': registros,
        }
    except Exception as erro:
        return {'erro': str(erro)}


@app.get('/proximo-ponto')
def proximo_ponto(colaborador_id: str):
    try:
        ultimo = buscar_ultimo_ponto(colaborador_id)
        ultimo_tipo = ultimo.get('tipo') if ultimo else None
        return {
            'colaborador_id': colaborador_id,
            'ultimo_tipo': ultimo_tipo,
            'proximo_tipo_permitido': PROXIMO_TIPO_PERMITIDO.get(ultimo_tipo),
        }
    except Exception as erro:
        return {'erro': str(erro)}


@app.post('/bater-ponto')
async def bater_ponto(request: Request, colaborador_id: str, tipo: str):
    try:
        ip = obter_ip_cliente(request)
        if not ip_autorizado(ip):
            return {'erro': f'Ponto bloqueado. IP fora da rede autorizada: {ip}'}

        colaborador = buscar_colaborador(colaborador_id)
        if not colaborador:
            return {'erro': 'Colaborador não encontrado.'}
        if colaborador.get('ativo') is not True:
            return {'erro': 'Colaborador inativo. Registro de ponto bloqueado.'}

        tipo = tipo.lower()
        if tipo not in TIPOS_VALIDOS:
            return {'erro': 'Tipo de ponto inválido.'}

        data_hoje = datetime.now().strftime('%Y-%m-%d')
        ponto_duplicado = buscar_ponto_mesmo_tipo_no_dia(colaborador_id, tipo, data_hoje)
        if ponto_duplicado:
            return {
                'erro': 'Registro duplicado bloqueado.',
                'mensagem': 'Este colaborador já possui este tipo de ponto registrado hoje.',
                'tipo': tipo,
                'registro_existente': ponto_duplicado,
            }

        sequencia = validar_sequencia(colaborador_id, tipo)
        if not sequencia['valido']:
            return {
                'erro': 'Sequência inválida de ponto.',
                'ultimo_tipo_registrado': sequencia['ultimo_tipo'],
                'tipo_esperado_agora': sequencia['tipo_esperado'],
                'tipo_solicitado': tipo,
            }

        resultado = supabase.table('registros_ponto').insert({
            'colaborador_id': colaborador_id,
            'tipo': tipo,
            'ip_origem': ip,
            'manual': False,
            'justificativa': None,
            'criado_por': 'Sistema',
        }).execute()

        return {'mensagem': 'Ponto registrado com sucesso', 'ip': ip, 'registro': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.post('/ajuste-manual-ponto')
async def ajuste_manual_ponto(request: Request, colaborador_id: str, tipo: str, data_hora: str, justificativa: str, admin_password: str):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()
        colaborador = buscar_colaborador(colaborador_id)
        if not colaborador:
            return {'erro': 'Colaborador não encontrado.'}
        tipo = tipo.lower()
        if tipo not in TIPOS_VALIDOS:
            return {'erro': 'Tipo de ponto inválido.'}
        if not justificativa or len(justificativa.strip()) < 5:
            return {'erro': 'Informe uma justificativa com pelo menos 5 caracteres.'}

        resultado = supabase.table('registros_ponto').insert({
            'colaborador_id': colaborador_id,
            'tipo': tipo,
            'ip_origem': obter_ip_cliente(request),
            'created_at': data_hora,
            'manual': True,
            'justificativa': justificativa.strip(),
            'criado_por': 'Admin/RH',
        }).execute()
        return {'mensagem': 'Ajuste manual registrado com sucesso', 'registro': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.post('/colaboradores')
def criar_colaborador(nome: str, email: str = '', matricula: str = '', admin_password: str = ''):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()
        resultado = supabase.table('colaboradores').insert({
            'nome': nome,
            'email': email,
            'matricula': matricula,
            'ativo': True,
        }).execute()
        return {'mensagem': 'Colaborador cadastrado com sucesso', 'colaborador': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.get('/colaboradores')
def listar_colaboradores(apenas_ativos: bool = False, admin_password: str = ''):
    try:
        consulta = supabase.table('colaboradores').select('*')
        if apenas_ativos or not admin_autorizado(admin_password):
            consulta = consulta.eq('ativo', True)
        resultado = consulta.order('nome', desc=False).execute()
        return {'colaboradores': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.put('/colaboradores/inativar')
def inativar_colaborador(colaborador_id: str, admin_password: str):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()
        resultado = supabase.table('colaboradores').update({'ativo': False}).eq('id', colaborador_id).execute()
        return {'mensagem': 'Colaborador inativado com sucesso', 'colaborador': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.put('/colaboradores/ativar')
def ativar_colaborador(colaborador_id: str, admin_password: str):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()
        resultado = supabase.table('colaboradores').update({'ativo': True}).eq('id', colaborador_id).execute()
        return {'mensagem': 'Colaborador ativado com sucesso', 'colaborador': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.get('/registros-ponto')
def listar_registros_ponto():
    try:
        resultado = supabase.table('registros_ponto').select('*').order('created_at', desc=True).execute()
        return {'registros': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.get('/relatorio-ponto')
def relatorio_ponto(colaborador_id: str, data_inicio: str, data_fim: str, admin_password: str):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()
        consulta = supabase.table('registros_ponto').select('*')
        if colaborador_id and colaborador_id != 'todos':
            consulta = consulta.eq('colaborador_id', colaborador_id)
        resultado = (
            consulta.gte('created_at', f'{data_inicio}T00:00:00')
            .lte('created_at', f'{data_fim}T23:59:59')
            .order('created_at', desc=False)
            .execute()
        )
        return {'total_registros': len(resultado.data), 'registros': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}


@app.delete('/registros-ponto/limpar')
def limpar_registros_ponto(data_inicio: str, data_fim: str, confirmacao: str, admin_password: str):
    try:
        if not admin_autorizado(admin_password):
            return erro_admin()
        if confirmacao != 'LIMPAR':
            return {'erro': 'Confirmação inválida. Digite exatamente: LIMPAR'}
        resultado = (
            supabase.table('registros_ponto')
            .delete()
            .gte('created_at', f'{data_inicio}T00:00:00')
            .lte('created_at', f'{data_fim}T23:59:59')
            .execute()
        )
        return {'mensagem': 'Registros de ponto removidos com sucesso', 'registros_removidos': resultado.data}
    except Exception as erro:
        return {'erro': str(erro)}
