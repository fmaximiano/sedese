"""Editor de serviços da SEDESE publicados no Portal MG."""
import asyncio
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from . import config, db, portalmg, unidades_sedese
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


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def agora() -> datetime:
    return datetime.now(timezone.utc)


# Sem login: limite simples de gravações por IP (evita abuso e cliques repetidos).
_JANELA_LIMITE, _MAX_POR_JANELA = 60, 60
_gravacoes: dict[str, deque] = defaultdict(deque)


def limite_excedido(ip: str) -> bool:
    fila, t = _gravacoes[ip], time.monotonic()
    while fila and t - fila[0] > _JANELA_LIMITE:
        fila.popleft()
    fila.append(t)
    return len(fila) > _MAX_POR_JANELA


# ---------------------------------------------------------------- identificação de quem edita
EMAIL_SEDESE = re.compile(r"^[A-Za-z0-9._%+-]+@social\.mg\.gov\.br$", re.IGNORECASE)


class Identificacao(BaseModel):
    responsavel: str = Field(max_length=200)
    unidade: str = Field(max_length=300)
    email: str = Field(max_length=200)


async def validar_identificacao(ident: Identificacao | None) -> dict:
    if ident is None:
        raise HTTPException(400, "Informe responsável, unidade e e-mail.")
    responsavel = re.sub(r"\s+", " ", ident.responsavel).strip()
    email = ident.email.strip().lower()
    if len(responsavel) < 3:
        raise HTTPException(400, "Informe o nome do responsável.")
    validas = unidades_sedese.todas(await unidades_sedese.listar()) | unidades_sedese.todas(unidades_sedese.reserva())
    if ident.unidade not in validas:
        raise HTTPException(400, "Selecione a unidade na lista.")
    if not EMAIL_SEDESE.match(email):
        raise HTTPException(400, "O e-mail deve terminar em @social.mg.gov.br.")
    return {"nome": responsavel, "unidade": ident.unidade, "email": email}


async def registrar(con, id_servico: int | None, quem: dict | None, acao: str, detalhe: Any = None) -> None:
    if quem:
        detalhe = {**(detalhe or {}), "unidade": quem["unidade"], "email": quem["email"]}
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
async def configuracao():
    return {"portal_configurado": portalmg.configurado()}


@app.get("/api/unidades-sedese")
async def unidades():
    return await unidades_sedese.listar()


# ---------------------------------------------------------------- serviços
CAMPOS_LISTA = """
    id_servico, nome, status, autorizado, autorizado_por, autorizado_unidade, autorizado_email, autorizado_em,
    atualizado_por, atualizado_unidade, atualizado_email, atualizado_em,
    sincronizado_em, erro_sincronizacao, portal_alterado, publicado_por, publicado_em, observacoes, versao,
    tem_alteracoes,
    CASE WHEN json_typeof(editado->'unidades') = 'array' THEN json_array_length(editado->'unidades') END AS qtd_unidades,
    CASE WHEN json_typeof(editado->'etapas') = 'array' THEN json_array_length(editado->'etapas') END AS qtd_etapas
"""


@app.get("/api/servicos")
async def listar():
    async with db.conexao() as con:
        cur = await con.execute(f"SELECT {CAMPOS_LISTA} FROM servicos WHERE ativo ORDER BY nome NULLS LAST, id_servico")
        return await cur.fetchall()


async def _carregar(con, id_servico: int) -> dict:
    cur = await con.execute(
        f"SELECT {CAMPOS_LISTA}, original, editado FROM servicos WHERE id_servico = %s AND ativo", (id_servico,)
    )
    s = await cur.fetchone()
    if not s:
        raise HTTPException(404, "Serviço não encontrado.")
    return s


@app.get("/api/servicos/{id_servico}")
async def obter(id_servico: int):
    async with db.conexao() as con:
        return await _carregar(con, id_servico)


class Edicao(BaseModel):
    editado: dict
    autorizado: bool = False
    identificacao: Identificacao
    observacoes: str | None = Field(default=None, max_length=5000)
    versao: int


@app.put("/api/servicos/{id_servico}")
async def salvar(id_servico: int, dados: Edicao):
    ed = dados.editado
    if not isinstance(ed.get("unidades"), list) or not isinstance(ed.get("etapas"), list) or "servico" not in ed:
        raise HTTPException(400, "Estrutura de dados inválida.")
    quem = await validar_identificacao(dados.identificacao)
    async with db.conexao() as con:
        atual = await _carregar(con, id_servico)
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
        cur = await con.execute(
            """UPDATE servicos SET editado = %s, tem_alteracoes = %s, status = %s, autorizado = %s,
                   autorizado_por = %s, autorizado_unidade = %s, autorizado_email = %s,
                   autorizado_em = CASE WHEN %s THEN now() END, observacoes = %s, versao = versao + 1,
                   atualizado_por = %s, atualizado_unidade = %s, atualizado_email = %s, atualizado_em = now()
               WHERE id_servico = %s AND versao = %s RETURNING id_servico""",
            (
                Json(ed), alterado, status, aut,
                quem["nome"] if aut else None, quem["unidade"] if aut else None, quem["email"] if aut else None,
                aut, (dados.observacoes or "").strip() or None,
                quem["nome"], quem["unidade"], quem["email"], id_servico, dados.versao,
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
        return await _carregar(con, id_servico)


class AcaoCentral(BaseModel):
    identificacao: Identificacao
    motivo: str | None = Field(default=None, max_length=5000)


@app.post("/api/servicos/{id_servico}/publicado")
async def marcar_publicado(id_servico: int, dados: AcaoCentral):
    quem = await validar_identificacao(dados.identificacao)
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


@app.post("/api/servicos/{id_servico}/devolver")
async def devolver(id_servico: int, dados: AcaoCentral):
    """Área central devolve à área fim (retira a autorização) com uma observação."""
    quem = await validar_identificacao(dados.identificacao)
    motivo = (dados.motivo or "").strip()
    if len(motivo) < 3:
        raise HTTPException(400, "Informe o motivo da devolução.")
    async with db.conexao() as con:
        await _carregar(con, id_servico)
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
async def descartar(id_servico: int, dados: AcaoCentral):
    """Descarta as edições e volta ao conteúdo atual do Portal MG (a versão descartada fica no histórico)."""
    quem = await validar_identificacao(dados.identificacao)
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
async def historico(id_servico: int):
    async with db.conexao() as con:
        cur = await con.execute(
            """SELECT id, usuario_nome, acao, criado_em, detalhe->>'unidade' AS unidade, detalhe->>'email' AS email,
                      coalesce(detalhe->>'motivo', detalhe->>'observacoes', detalhe->>'erro') AS nota
               FROM historico WHERE id_servico = %s ORDER BY criado_em DESC LIMIT 100""",
            (id_servico,),
        )
        return await cur.fetchall()


class NovoServico(BaseModel):
    id_servico: int = Field(gt=0)
    identificacao: Identificacao


@app.post("/api/servicos")
async def adicionar(dados: NovoServico):
    quem = await validar_identificacao(dados.identificacao)
    async with db.conexao() as con:
        await con.execute(
            """INSERT INTO servicos (id_servico, origem) VALUES (%s, 'manual')
               ON CONFLICT (id_servico) DO UPDATE SET ativo = TRUE,
                   origem = CASE WHEN servicos.ativo THEN servicos.origem ELSE 'manual' END""",
            (dados.id_servico,),
        )
        await registrar(con, dados.id_servico, quem, "adicionou_servico")
    if portalmg.configurado():
        async with portalmg.novo_cliente() as cliente:
            await sincronizar_um(cliente, dados.id_servico, None)
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
                   sincronizado_em = now(), erro_sincronizacao = NULL, versao = versao + 1
               WHERE id_servico = %s""",
            (
                Json(dados), Json(editado), editado != dados, status, portal_alterado,
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
async def sincronizar_todos():
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
async def status_sync():
    return estado_sync


@app.post("/api/servicos/{id_servico}/sincronizar")
async def sincronizar_servico(id_servico: int):
    if not portalmg.configurado():
        raise HTTPException(400, "Configure PORTALMG_API_KEY e as URLs do Portal MG nas variáveis do Railway.")
    async with portalmg.novo_cliente() as cliente:
        await sincronizar_um(cliente, id_servico)
    async with db.conexao() as con:
        return await _carregar(con, id_servico)


@app.get("/api/exportar")
async def exportar(status: str = "aguardando_publicacao"):
    """JSON com original x editado — apoio à alimentação manual do Portal MG."""
    async with db.conexao() as con:
        cur = await con.execute(
            """SELECT id_servico, nome, status, autorizado_por, autorizado_unidade, autorizado_email, autorizado_em,
                      observacoes, original, editado
               FROM servicos WHERE ativo AND (%s = 'todos' OR status = %s) ORDER BY nome""",
            (status, status),
        )
        linhas = await cur.fetchall()
    return JSONResponse(
        jsonable_encoder(linhas),
        headers={"Content-Disposition": f'attachment; filename="servicos_sedese_{status}.json"'},
    )
