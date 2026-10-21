"""Editor de serviços da SEDESE publicados no Portal MG."""
import asyncio
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Json
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from . import auth, config, db, portalmg, unidades_sedese
from .areas import AREA_DO_SERVICO, AREAS, unidades_da_area
from .servicos_ids import SERVICOS_PADRAO

STATIC = Path(__file__).parent / "static"
MAX_CORPO = 3 * 1024 * 1024  # 3 MB por requisição


def ids_iniciais() -> list[int]:
    if config.SERVICOS_IDS:
        return [int(x) for x in re.findall(r"\d+", config.SERVICOS_IDS)]
    return SERVICOS_PADRAO


@asynccontextmanager
async def ciclo_vida(app: FastAPI):
    await db.abrir()
    async with db.conexao() as con:
        # A lista padrão manda: entra o que está nela e sai o que foi retirado (os dados ficam no banco).
        # Serviços incluídos pela tela (origem 'manual') não são afetados.
        ids = ids_iniciais()
        await con.execute(
            """INSERT INTO servicos (id_servico, origem) SELECT unnest(%s::int[]), 'padrao'
               ON CONFLICT (id_servico) DO UPDATE SET ativo = TRUE, origem = 'padrao'""",
            (ids,),
        )
        await con.execute(
            "UPDATE servicos SET ativo = FALSE WHERE origem = 'padrao' AND ativo AND NOT (id_servico = ANY(%s))", (ids,)
        )
        # A divisão por área (app/areas.py) também manda sobre os IDs que ela lista.
        await con.execute(
            """UPDATE servicos s SET area = m.area FROM unnest(%s::int[], %s::text[]) AS m(id, area)
               WHERE s.id_servico = m.id AND s.area IS DISTINCT FROM m.area""",
            (list(AREA_DO_SERVICO), list(AREA_DO_SERVICO.values())),
        )
    yield
    await db.fechar()


app = FastAPI(title="Serviços SEDESE · Portal MG", lifespan=ciclo_vida, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def seguranca(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        # Proteção CSRF: navegadores não enviam este header em requisições de outros sites sem CORS.
        if request.headers.get("x-requested-with") != "sedese":
            return JSONResponse({"detail": "Requisição inválida."}, status_code=403)
        if int(request.headers.get("content-length") or 0) > MAX_CORPO:
            return JSONResponse({"detail": "Conteúdo grande demais."}, status_code=413)
        if limite_excedido(request.client.host if request.client else "?"):
            return JSONResponse({"detail": "Muitas requisições em pouco tempo. Aguarde um minuto."}, status_code=429)
    resposta = await call_next(request)
    resposta.headers["X-Content-Type-Options"] = "nosniff"
    resposta.headers["X-Frame-Options"] = "DENY"
    resposta.headers["Referrer-Policy"] = "same-origin"
    resposta.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        resposta.headers["Cache-Control"] = "no-store"
    return resposta


# Adicionado por último = executa primeiro: a sessão fica disponível para as rotas.
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET,
    session_cookie="sedese_sessao",
    max_age=12 * 3600,
    same_site="strict",
    https_only=config.COOKIE_SECURE,
)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def agora() -> datetime:
    return datetime.now(timezone.utc)


# Limite simples de gravações por IP (evita abuso e cliques repetidos).
_JANELA_LIMITE, _MAX_POR_JANELA = 60, 60
_gravacoes: dict[str, deque] = defaultdict(deque)


def limite_excedido(ip: str) -> bool:
    fila, t = _gravacoes[ip], time.monotonic()
    while fila and t - fila[0] > _JANELA_LIMITE:
        fila.popleft()
    fila.append(t)
    if len(_gravacoes) > 10_000:  # não deixa a memória crescer sem limite
        for chave in [k for k, f in _gravacoes.items() if t - f[-1] > _JANELA_LIMITE]:
            del _gravacoes[chave]
    return len(fila) > _MAX_POR_JANELA


# ---------------------------------------------------------------- identificação de quem edita
EMAIL_SEDESE = re.compile(r"^[A-Za-z0-9._%+-]+@social\.mg\.gov\.br$", re.IGNORECASE)


class Identificacao(BaseModel):
    responsavel: str = Field(max_length=200)
    unidade: str = Field(max_length=300)
    email: str = Field(max_length=200)


async def unidades_permitidas(area: str | None) -> list[dict]:
    """Unidades da página "Quem é Quem", agrupadas; para uma área, só as dela (todas, se a página mudou)."""
    dados = await unidades_sedese.listar()
    if not area:
        return dados
    for fonte in (dados, unidades_sedese.reserva()):
        if unidades := unidades_da_area(area, fonte):
            return [{"grupo": AREAS[area]["nome"], "unidades": unidades}]
    return dados


async def validar_identificacao(ident: Identificacao | None, area: str) -> dict:
    """O login da área é compartilhado: quem salva se identifica, e isso vai para o histórico."""
    if ident is None:
        raise HTTPException(400, "Informe responsável, unidade e e-mail.")
    responsavel = re.sub(r"\s+", " ", ident.responsavel).strip()
    email = ident.email.strip().lower()
    if len(responsavel) < 3:
        raise HTTPException(400, "Informe o nome do responsável.")
    if ident.unidade not in unidades_sedese.todas(await unidades_permitidas(area)):
        raise HTTPException(400, "Selecione a unidade na lista.")
    if not EMAIL_SEDESE.match(email):
        raise HTTPException(400, "O e-mail deve terminar em @social.mg.gov.br.")
    return {"nome": responsavel, "unidade": ident.unidade, "email": email, "area": area}


async def registrar(con, id_servico: int | None, quem: dict | None, acao: str, detalhe: Any = None) -> None:
    if quem:
        detalhe = {**(detalhe or {}), "unidade": quem["unidade"], "email": quem["email"], "area": quem.get("area")}
    await con.execute(
        "INSERT INTO historico (id_servico, usuario_nome, acao, detalhe) VALUES (%s, %s, %s, %s)",
        (id_servico, quem["nome"] if quem else "Sistema", acao, Json(detalhe) if detalhe is not None else None),
    )


# ---------------------------------------------------------------- páginas
@app.get("/", include_in_schema=False)
async def inicio():
    return FileResponse(STATIC / "index.html")


@app.get("/healthz", include_in_schema=False)
async def saude():
    async with db.conexao() as con:
        await con.execute("SELECT 1")
    return {"ok": True}


@app.get("/api/config")
async def configuracao(request: Request):
    u = auth.usuario(request)
    acessos = [{"valor": s, "nome": f"{a['nome']} ({s})"} for s, a in AREAS.items() if auth.senha_area(s)]
    if auth.admin_configurado():
        acessos.append({"valor": "admin", "nome": "Área central (administrador)"})
    return {
        "acessos": acessos,  # opções da tela de entrada
        "logado": bool(u),
        "admin": bool(u and u["admin"]),
        "area": u and u["area"] and {"sigla": u["area"], "nome": AREAS[u["area"]]["nome"]},
        "areas": {s: a["nome"] for s, a in AREAS.items()} if u and u["admin"] else None,
        "admin_nome": config.ADMIN_NOME if u and u["admin"] else None,
        "portal_configurado": portalmg.configurado() if u and u["admin"] else None,
    }


@app.get("/api/unidades-sedese")
async def unidades(u: dict = Depends(auth.exigir_login)):
    return await unidades_permitidas(u["area"])


# ---------------------------------------------------------------- login (administrador e áreas)
class Login(BaseModel):
    acesso: str = Field(max_length=20)  # "admin" ou a sigla da área
    email: str = Field(default="", max_length=200)  # só para o administrador
    senha: str = Field(max_length=200)


@app.post("/api/login")
async def login(dados: Login, request: Request):
    acesso = dados.acesso if dados.acesso == "admin" or dados.acesso in AREAS else "?"
    ip = request.client.host if request.client else "?"
    if auth.bloqueado(ip, acesso):
        raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.")
    ok = auth.conferir_admin(dados.email, dados.senha) if acesso == "admin" else auth.conferir_area(acesso, dados.senha)
    if not ok:
        auth.registrar_falha(ip, acesso)
        await asyncio.sleep(0.5)
        raise HTTPException(401, "E-mail ou senha incorretos." if acesso == "admin" else "Senha incorreta.")
    auth.limpar_falhas(ip)
    auth.iniciar_sessao(request, acesso)
    return {"ok": True}


@app.post("/api/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


# ---------------------------------------------------------------- serviços
CAMPOS_LISTA = """
    id_servico, nome, area, status, autorizado, autorizado_por, autorizado_unidade, autorizado_email, autorizado_em,
    atualizado_por, atualizado_unidade, atualizado_email, atualizado_em,
    sincronizado_em, erro_sincronizacao, portal_alterado, publicado_por, publicado_em, observacoes, versao,
    tem_alteracoes,
    CASE WHEN json_typeof(editado->'unidades') = 'array' THEN json_array_length(editado->'unidades') END AS qtd_unidades,
    CASE WHEN json_typeof(editado->'etapas') = 'array' THEN json_array_length(editado->'etapas') END AS qtd_etapas
"""
# A área só vê os seus serviços já sincronizados que não estejam com a área central para publicação.
VISIVEL_A_AREA = "area = %s AND original IS NOT NULL AND status <> 'aguardando_publicacao'"
CAMPOS_RESTRITOS = ("autorizado_email", "atualizado_email", "erro_sincronizacao")


def visiveis(u: dict) -> tuple[str, tuple]:
    """Filtro SQL (e parâmetros) dos serviços que o usuário pode ver e editar."""
    return ("ativo", ()) if u["admin"] else (f"ativo AND {VISIVEL_A_AREA}", (u["area"],))


def _para_area(linha: dict) -> dict:
    for campo in CAMPOS_RESTRITOS:
        linha.pop(campo, None)
    return linha


@app.get("/api/servicos")
async def listar(u: dict = Depends(auth.exigir_login)):
    filtro, params = visiveis(u)
    async with db.conexao() as con:
        cur = await con.execute(
            f"SELECT {CAMPOS_LISTA} FROM servicos WHERE {filtro} ORDER BY nome NULLS LAST, id_servico", params
        )
        linhas = await cur.fetchall()
    return linhas if u["admin"] else [_para_area(x) for x in linhas]


ADMIN = {"admin": True, "area": None}


async def _carregar(con, id_servico: int, u: dict = ADMIN) -> dict:
    filtro, params = visiveis(u)
    cur = await con.execute(
        f"SELECT {CAMPOS_LISTA}, original, editado FROM servicos WHERE id_servico = %s AND {filtro}",
        (id_servico, *params),
    )
    s = await cur.fetchone()
    if not s:
        raise HTTPException(
            404, "Serviço indisponível: não existe, não pertence à sua área, ainda não foi sincronizado "
            "ou já foi enviado para publicação."
        )
    return s if u["admin"] else _para_area(s)


@app.get("/api/servicos/{id_servico}")
async def obter(id_servico: int, u: dict = Depends(auth.exigir_login)):
    async with db.conexao() as con:
        return await _carregar(con, id_servico, u)


class Edicao(BaseModel):
    editado: dict
    autorizado: bool = False
    identificacao: Identificacao | None = None  # dispensada para o administrador
    observacoes: str | None = Field(default=None, max_length=5000)
    versao: int


@app.put("/api/servicos/{id_servico}")
async def salvar(id_servico: int, dados: Edicao, u: dict = Depends(auth.exigir_login)):
    ed = dados.editado
    if not isinstance(ed.get("unidades"), list) or not isinstance(ed.get("etapas"), list) or "servico" not in ed:
        raise HTTPException(400, "Estrutura de dados inválida.")
    admin = u["admin"]
    quem = auth.identidade_admin() if admin else await validar_identificacao(dados.identificacao, u["area"])
    filtro, params = visiveis(u)
    async with db.conexao() as con:
        atual = await _carregar(con, id_servico, u)
        if atual["original"] is None:
            raise HTTPException(409, "Serviço ainda não sincronizado com o Portal MG.")
        alterado = ed != atual["original"]
        if dados.autorizado:
            status = "aguardando_publicacao"
        elif alterado:
            status = "em_edicao"
        else:
            status = "sincronizado"
        aut = dados.autorizado
        # O filtro de visibilidade se repete aqui: a gravação só vale se o serviço continua sendo da área.
        cur = await con.execute(
            f"""UPDATE servicos SET editado = %s, tem_alteracoes = %s, status = %s, autorizado = %s,
                   autorizado_por = %s, autorizado_unidade = %s, autorizado_email = %s,
                   autorizado_em = CASE WHEN %s THEN now() END, observacoes = %s, versao = versao + 1,
                   atualizado_por = %s, atualizado_unidade = %s, atualizado_email = %s, atualizado_em = now()
               WHERE id_servico = %s AND versao = %s AND {filtro} RETURNING id_servico""",
            (
                Json(ed), alterado, status, aut,
                quem["nome"] if aut else None, quem["unidade"] if aut else None, quem["email"] if aut else None,
                aut, (dados.observacoes or "").strip() or None,
                quem["nome"], quem["unidade"], quem["email"], id_servico, dados.versao, *params,
            ),
        )
        if not await cur.fetchone():
            raise HTTPException(
                409, "Este serviço foi alterado por outra pessoa (ou sincronizado) enquanto você editava. "
                "Recarregue para ver a versão atual."
            )
        await registrar(
            con, id_servico, quem, "autorizou_publicacao" if aut else "salvou",
            {"observacoes": dados.observacoes, "editado": ed},
        )
        if aut and not admin:
            # Enviado para a área central: a partir daqui só o administrador vê o serviço.
            return {"enviado": True, "id_servico": id_servico}
        return await _carregar(con, id_servico, u)


@app.post("/api/servicos/{id_servico}/publicado")
async def marcar_publicado(id_servico: int, quem: dict = Depends(auth.exigir_admin)):
    async with db.conexao() as con:
        s = await _carregar(con, id_servico)
        if s["status"] != "aguardando_publicacao":
            raise HTTPException(409, "Só é possível marcar como publicado um serviço aguardando publicação.")
        await con.execute(
            """UPDATE servicos SET status = 'publicado', publicado_por = %s, publicado_em = now(),
                   versao = versao + 1 WHERE id_servico = %s""",
            (quem["nome"], id_servico),
        )
        await registrar(con, id_servico, quem, "marcou_publicado")
        return await _carregar(con, id_servico)


class Devolucao(BaseModel):
    motivo: str = Field(min_length=3, max_length=5000)


@app.post("/api/servicos/{id_servico}/devolver")
async def devolver(id_servico: int, dados: Devolucao, quem: dict = Depends(auth.exigir_admin)):
    """Administrador devolve o serviço à área demandante (retira a autorização) com uma orientação."""
    motivo = dados.motivo.strip()
    async with db.conexao() as con:
        s = await _carregar(con, id_servico)
        if s["status"] not in ("aguardando_publicacao", "em_edicao"):
            raise HTTPException(409, "Só é possível devolver um serviço em edição ou aguardando publicação.")
        await con.execute(
            """UPDATE servicos SET status = 'em_edicao', autorizado = FALSE, autorizado_em = NULL,
                   observacoes = %s, versao = versao + 1, atualizado_por = %s, atualizado_unidade = %s,
                   atualizado_email = %s, atualizado_em = now()
               WHERE id_servico = %s""",
            (f"[Devolvido pela área central] {motivo}", quem["nome"], quem["unidade"], quem["email"], id_servico),
        )
        await registrar(con, id_servico, quem, "devolveu", {"motivo": motivo})
        return await _carregar(con, id_servico)


@app.post("/api/servicos/{id_servico}/descartar")
async def descartar(id_servico: int, quem: dict = Depends(auth.exigir_admin)):
    """Descarta as edições e volta ao conteúdo atual do Portal MG (a versão descartada fica no histórico)."""
    async with db.conexao() as con:
        s = await _carregar(con, id_servico)
        await con.execute(
            """UPDATE servicos SET editado = original, tem_alteracoes = FALSE,
                   status = CASE WHEN original IS NULL THEN 'nao_sincronizado' ELSE 'sincronizado' END,
                   autorizado = FALSE, autorizado_por = NULL, autorizado_unidade = NULL, autorizado_email = NULL,
                   autorizado_em = NULL, portal_alterado = FALSE, versao = versao + 1, atualizado_por = %s,
                   atualizado_unidade = %s, atualizado_email = %s, atualizado_em = now()
               WHERE id_servico = %s""",
            (quem["nome"], quem["unidade"], quem["email"], id_servico),
        )
        await registrar(con, id_servico, quem, "descartou_edicoes", {"editado": s["editado"]})
        return await _carregar(con, id_servico)


@app.get("/api/servicos/{id_servico}/historico")
async def historico(id_servico: int, u: dict = Depends(auth.exigir_login)):
    admin = u["admin"]
    async with db.conexao() as con:
        await _carregar(con, id_servico, u)  # respeita a visibilidade da área
        cur = await con.execute(
            """SELECT id, usuario_nome, acao, criado_em, detalhe->>'unidade' AS unidade, detalhe->>'email' AS email,
                      coalesce(detalhe->>'motivo', detalhe->>'observacoes', detalhe->>'erro') AS nota
               FROM historico WHERE id_servico = %s ORDER BY criado_em DESC LIMIT 100""",
            (id_servico,),
        )
        linhas = await cur.fetchall()
    if not admin:
        for x in linhas:
            x.pop("email")
    return linhas


class NovoServico(BaseModel):
    id_servico: int = Field(gt=0, lt=2**31)
    area: str | None = None  # sigla; vazio = só o administrador vê


@app.post("/api/servicos")
async def adicionar(dados: NovoServico, quem: dict = Depends(auth.exigir_admin)):
    # IDs da divisão em app/areas.py ficam sempre com a área definida lá.
    area = AREA_DO_SERVICO.get(dados.id_servico) or dados.area or None
    if area and area not in AREAS:
        raise HTTPException(400, "Área inválida.")
    async with db.conexao() as con:
        await con.execute(
            """INSERT INTO servicos (id_servico, origem, area) VALUES (%s, 'manual', %s)
               ON CONFLICT (id_servico) DO UPDATE SET ativo = TRUE, area = EXCLUDED.area,
                   origem = CASE WHEN servicos.ativo THEN servicos.origem ELSE 'manual' END""",
            (dados.id_servico, area),
        )
        await registrar(con, dados.id_servico, quem, "adicionou_servico", {"area_servico": area})
    if portalmg.configurado():
        async with portalmg.novo_cliente() as cliente:
            await sincronizar_um(cliente, dados.id_servico, quem)
    return {"ok": True}


# ---------------------------------------------------------------- sincronização com o Portal MG
async def sincronizar_um(cliente, id_servico: int, quem: dict | None = None) -> bool:
    try:
        dados = await portalmg.buscar_servico(cliente, id_servico)
    except portalmg.ErroPortal as e:
        async with db.conexao() as con:
            await con.execute(
                "UPDATE servicos SET erro_sincronizacao = %s WHERE id_servico = %s", (str(e), id_servico)
            )
        return False

    async with db.conexao() as con:
        cur = await con.execute(
            "SELECT status, original, editado, portal_alterado, nome FROM servicos WHERE id_servico = %s FOR UPDATE",
            (id_servico,),
        )
        s = await cur.fetchone()
        if not s:
            return False
        mudou_no_portal = s["original"] is not None and s["original"] != dados
        status, editado, portal_alterado = s["status"], s["editado"], s["portal_alterado"]
        if status in ("nao_sincronizado", "sincronizado") or editado is None:
            status, editado, portal_alterado = "sincronizado", dados, False
        elif status == "publicado":
            portal_alterado = False
            if dados == editado:  # o Portal MG já reflete o que foi editado
                status = "sincronizado"
        else:  # em_edicao / aguardando_publicacao: preserva o trabalho das áreas
            portal_alterado = portal_alterado or mudou_no_portal
        await con.execute(
            """UPDATE servicos SET original = %s, editado = %s, tem_alteracoes = %s, status = %s, portal_alterado = %s, nome = %s,
                   autorizado = autorizado AND %s, sincronizado_em = now(), erro_sincronizacao = NULL, versao = versao + 1
               WHERE id_servico = %s""",
            (
                Json(dados), Json(editado), editado != dados, status, portal_alterado,
                status in ("aguardando_publicacao", "publicado"),
                portalmg.extrair_nome(dados["servico"]) or s["nome"], id_servico,
            ),
        )
        if mudou_no_portal or s["original"] is None:
            await registrar(con, id_servico, quem, "sincronizou", {"mudou_no_portal": mudou_no_portal})
    return True


estado_sync: dict[str, Any] = {"rodando": False, "total": 0, "feitos": 0, "erros": 0, "inicio": None, "fim": None}


async def _sincronizar_todos(ids: list[int]) -> None:
    sem = asyncio.Semaphore(max(1, config.PORTALMG_CONCORRENCIA))
    try:
        async with portalmg.novo_cliente() as cliente:
            async def tarefa(i: int):
                async with sem:
                    try:
                        ok = await sincronizar_um(cliente, i)
                    except Exception as e:  # nunca interrompe o lote por causa de um serviço
                        ok = False
                        async with db.conexao() as con:
                            await con.execute(
                                "UPDATE servicos SET erro_sincronizacao = %s WHERE id_servico = %s",
                                (f"Erro interno: {type(e).__name__}", i),
                            )
                    estado_sync["feitos"] += 1
                    estado_sync["erros"] += 0 if ok else 1

            await asyncio.gather(*(tarefa(i) for i in ids))
    finally:
        estado_sync.update(rodando=False, fim=agora().isoformat())


_tarefas: set = set()


@app.post("/api/sincronizar")
async def sincronizar_todos(quem: dict = Depends(auth.exigir_admin)):
    if not portalmg.configurado():
        raise HTTPException(400, "Configure PORTALMG_API_KEY e as URLs do Portal MG nas variáveis do Railway.")
    if estado_sync["rodando"]:
        return estado_sync
    async with db.conexao() as con:
        cur = await con.execute("SELECT id_servico FROM servicos WHERE ativo ORDER BY id_servico")
        ids = [r["id_servico"] for r in await cur.fetchall()]
    estado_sync.update(rodando=True, total=len(ids), feitos=0, erros=0, inicio=agora().isoformat(), fim=None)
    t = asyncio.create_task(_sincronizar_todos(ids))
    _tarefas.add(t)
    t.add_done_callback(_tarefas.discard)
    return estado_sync


@app.get("/api/sincronizar")
async def status_sync(quem: dict = Depends(auth.exigir_admin)):
    return estado_sync


@app.post("/api/servicos/{id_servico}/sincronizar")
async def sincronizar_servico(id_servico: int, quem: dict = Depends(auth.exigir_admin)):
    if not portalmg.configurado():
        raise HTTPException(400, "Configure PORTALMG_API_KEY e as URLs do Portal MG nas variáveis do Railway.")
    async with portalmg.novo_cliente() as cliente:
        await sincronizar_um(cliente, id_servico, quem)
    async with db.conexao() as con:
        return await _carregar(con, id_servico)


@app.get("/api/exportar")
async def exportar(status: str = "aguardando_publicacao", quem: dict = Depends(auth.exigir_admin)):
    """JSON com original x editado — apoio à alimentação manual do Portal MG."""
    if status not in ("todos", "nao_sincronizado", "sincronizado", "em_edicao", "aguardando_publicacao", "publicado"):
        raise HTTPException(400, "Status inválido.")
    async with db.conexao() as con:
        cur = await con.execute(
            """SELECT id_servico, nome, area, status, autorizado_por, autorizado_unidade, autorizado_email, autorizado_em,
                      observacoes, original, editado
               FROM servicos WHERE ativo AND (%s = 'todos' OR status = %s) ORDER BY nome""",
            (status, status),
        )
        linhas = await cur.fetchall()
    return JSONResponse(
        jsonable_encoder(linhas),
        headers={"Content-Disposition": f'attachment; filename="servicos_sedese_{status}.json"'},
    )
