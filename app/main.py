"""Editor de serviços da SEDESE publicados no Portal MG."""
import asyncio
import re
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

from . import auth, config, db, portalmg
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
        await con.execute(
            "INSERT INTO servicos (id_servico) SELECT unnest(%s::int[]) ON CONFLICT DO NOTHING", (ids_iniciais(),)
        )
        if config.ADMIN_EMAIL and config.ADMIN_PASSWORD:
            cur = await con.execute("SELECT id, senha_hash FROM usuarios WHERE email = %s", (config.ADMIN_EMAIL,))
            existente = await cur.fetchone()
            if not existente:
                await con.execute(
                    "INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (%s, %s, %s, 'admin')",
                    (config.ADMIN_NOME, config.ADMIN_EMAIL, auth.gerar_hash(config.ADMIN_PASSWORD)),
                )
            elif not auth.conferir_senha(config.ADMIN_PASSWORD, existente["senha_hash"]):
                # Permite redefinir a senha do admin pelas variáveis do Railway.
                await con.execute(
                    "UPDATE usuarios SET senha_hash = %s, perfil = 'admin', ativo = TRUE WHERE id = %s",
                    (auth.gerar_hash(config.ADMIN_PASSWORD), existente["id"]),
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


# Adicionado por último = executa primeiro: a sessão fica disponível para o middleware acima.
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


async def registrar(con, id_servico: int | None, usuario: dict | None, acao: str, detalhe: Any = None) -> None:
    await con.execute(
        "INSERT INTO historico (id_servico, usuario_id, usuario_nome, acao, detalhe) VALUES (%s, %s, %s, %s, %s)",
        (
            id_servico,
            usuario["id"] if usuario else None,
            usuario["nome"] if usuario else "Sistema",
            acao,
            Json(detalhe) if detalhe is not None else None,
        ),
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


# ---------------------------------------------------------------- autenticação
class Login(BaseModel):
    email: str = Field(max_length=200)
    senha: str = Field(max_length=200)


@app.post("/api/login")
async def login(dados: Login, request: Request):
    email = dados.email.strip().lower()
    ip = request.client.host if request.client else "?"
    chaves = (f"ip:{ip}", f"email:{email}")
    if auth.bloqueado(*chaves):
        raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.")
    async with db.conexao() as con:
        cur = await con.execute("SELECT id, senha_hash, ativo FROM usuarios WHERE email = %s", (email,))
        u = await cur.fetchone()
        senha_ok = auth.conferir_senha(dados.senha, u["senha_hash"] if u else auth.HASH_FICTICIO)
        if not u or not u["ativo"] or not senha_ok:
            auth.registrar_falha(*chaves)
            await asyncio.sleep(0.5)
            raise HTTPException(401, "E-mail ou senha incorretos.")
        await con.execute("UPDATE usuarios SET ultimo_login = now() WHERE id = %s", (u["id"],))
    auth.limpar_falhas(*chaves)
    request.session.clear()
    request.session.update({"uid": u["id"], "fp": auth.impressao_senha(u["senha_hash"])})
    return {"ok": True}


@app.post("/api/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
async def me(usuario: dict = Depends(auth.usuario_atual)):
    return {**usuario, "portal_configurado": portalmg.configurado()}


class TrocaSenha(BaseModel):
    atual: str = Field(max_length=200)
    nova: str = Field(min_length=10, max_length=200)


@app.post("/api/me/senha")
async def trocar_senha(dados: TrocaSenha, request: Request, usuario: dict = Depends(auth.usuario_atual)):
    async with db.conexao() as con:
        cur = await con.execute("SELECT senha_hash FROM usuarios WHERE id = %s", (usuario["id"],))
        if not auth.conferir_senha(dados.atual, (await cur.fetchone())["senha_hash"]):
            raise HTTPException(400, "Senha atual incorreta.")
        novo = auth.gerar_hash(dados.nova)
        await con.execute("UPDATE usuarios SET senha_hash = %s WHERE id = %s", (novo, usuario["id"]))
    request.session["fp"] = auth.impressao_senha(novo)
    return {"ok": True}


# ---------------------------------------------------------------- serviços
CAMPOS_LISTA = """
    id_servico, nome, status, autorizado, autorizado_por, autorizado_em, atualizado_por, atualizado_em,
    sincronizado_em, erro_sincronizacao, portal_alterado, publicado_por, publicado_em, observacoes, versao,
    tem_alteracoes,
    CASE WHEN json_typeof(editado->'unidades') = 'array' THEN json_array_length(editado->'unidades') END AS qtd_unidades,
    CASE WHEN json_typeof(editado->'etapas') = 'array' THEN json_array_length(editado->'etapas') END AS qtd_etapas
"""


@app.get("/api/servicos")
async def listar(usuario: dict = Depends(auth.usuario_atual)):
    filtro, params = "WHERE ativo", []
    if usuario["perfil"] != "admin" and usuario["servicos"] is not None:
        filtro += " AND id_servico = ANY(%s)"
        params.append(usuario["servicos"])
    async with db.conexao() as con:
        cur = await con.execute(f"SELECT {CAMPOS_LISTA} FROM servicos {filtro} ORDER BY nome NULLS LAST, id_servico", params)
        return await cur.fetchall()


async def _carregar(con, id_servico: int, usuario: dict) -> dict:
    if not auth.pode_ver(usuario, id_servico):
        raise HTTPException(403, "Você não tem acesso a este serviço.")
    cur = await con.execute(
        f"SELECT {CAMPOS_LISTA}, original, editado FROM servicos WHERE id_servico = %s AND ativo", (id_servico,)
    )
    s = await cur.fetchone()
    if not s:
        raise HTTPException(404, "Serviço não encontrado.")
    return s


@app.get("/api/servicos/{id_servico}")
async def obter(id_servico: int, usuario: dict = Depends(auth.usuario_atual)):
    async with db.conexao() as con:
        return await _carregar(con, id_servico, usuario)


class Edicao(BaseModel):
    editado: dict
    autorizado: bool = False
    autorizado_por: str | None = Field(default=None, max_length=300)
    observacoes: str | None = Field(default=None, max_length=5000)
    versao: int


@app.put("/api/servicos/{id_servico}")
async def salvar(id_servico: int, dados: Edicao, usuario: dict = Depends(auth.usuario_atual)):
    ed = dados.editado
    if not isinstance(ed.get("unidades"), list) or not isinstance(ed.get("etapas"), list) or "servico" not in ed:
        raise HTTPException(400, "Estrutura de dados inválida.")
    autorizado_por = (dados.autorizado_por or "").strip() or None
    if dados.autorizado and not autorizado_por:
        raise HTTPException(400, "Informe o nome do responsável pela autorização de publicação.")
    async with db.conexao() as con:
        atual = await _carregar(con, id_servico, usuario)
        if atual["original"] is None:
            raise HTTPException(409, "Serviço ainda não sincronizado com o Portal MG.")
        alterado = ed != atual["original"]
        if dados.autorizado:
            status = "aguardando_publicacao"
        elif alterado:
            status = "em_edicao"
        else:
            status = "sincronizado"
        cur = await con.execute(
            """UPDATE servicos SET editado = %s, tem_alteracoes = %s, status = %s, autorizado = %s, autorizado_por = %s,
                   autorizado_em = CASE WHEN %s THEN now() END, observacoes = %s,
                   versao = versao + 1, atualizado_por = %s, atualizado_em = now()
               WHERE id_servico = %s AND versao = %s RETURNING id_servico""",
            (
                Json(ed), alterado, status, dados.autorizado, autorizado_por if dados.autorizado else None,
                dados.autorizado, (dados.observacoes or "").strip() or None,
                usuario["nome"], id_servico, dados.versao,
            ),
        )
        if not await cur.fetchone():
            raise HTTPException(
                409, "Este serviço foi alterado por outra pessoa (ou sincronizado) enquanto você editava. "
                "Recarregue para ver a versão atual."
            )
        await registrar(
            con, id_servico, usuario, "autorizou_publicacao" if dados.autorizado else "salvou",
            {"autorizado_por": autorizado_por, "observacoes": dados.observacoes, "editado": ed},
        )
        return await _carregar(con, id_servico, usuario)


@app.post("/api/servicos/{id_servico}/publicado")
async def marcar_publicado(id_servico: int, usuario: dict = Depends(auth.admin_atual)):
    async with db.conexao() as con:
        s = await _carregar(con, id_servico, usuario)
        if s["status"] != "aguardando_publicacao":
            raise HTTPException(409, "Só é possível marcar como publicado um serviço aguardando publicação.")
        await con.execute(
            """UPDATE servicos SET status = 'publicado', publicado_por = %s, publicado_em = now(),
                   versao = versao + 1 WHERE id_servico = %s""",
            (usuario["nome"], id_servico),
        )
        await registrar(con, id_servico, usuario, "marcou_publicado")
        return await _carregar(con, id_servico, usuario)


class Devolucao(BaseModel):
    motivo: str = Field(min_length=3, max_length=5000)


@app.post("/api/servicos/{id_servico}/devolver")
async def devolver(id_servico: int, dados: Devolucao, usuario: dict = Depends(auth.admin_atual)):
    """Área central devolve à área fim (retira a autorização) com uma observação."""
    async with db.conexao() as con:
        await _carregar(con, id_servico, usuario)
        await con.execute(
            """UPDATE servicos SET status = 'em_edicao', autorizado = FALSE, autorizado_em = NULL,
                   observacoes = %s, versao = versao + 1, atualizado_por = %s, atualizado_em = now()
               WHERE id_servico = %s""",
            (f"[Devolvido pela área central] {dados.motivo.strip()}", usuario["nome"], id_servico),
        )
        await registrar(con, id_servico, usuario, "devolveu", {"motivo": dados.motivo})
        return await _carregar(con, id_servico, usuario)


@app.post("/api/servicos/{id_servico}/descartar")
async def descartar(id_servico: int, usuario: dict = Depends(auth.admin_atual)):
    """Descarta as edições e volta ao conteúdo atual do Portal MG."""
    async with db.conexao() as con:
        s = await _carregar(con, id_servico, usuario)
        await con.execute(
            """UPDATE servicos SET editado = original, tem_alteracoes = FALSE,
                   status = CASE WHEN original IS NULL THEN 'nao_sincronizado' ELSE 'sincronizado' END,
                   autorizado = FALSE, autorizado_por = NULL, autorizado_em = NULL, portal_alterado = FALSE,
                   versao = versao + 1, atualizado_por = %s, atualizado_em = now()
               WHERE id_servico = %s""",
            (usuario["nome"], id_servico),
        )
        await registrar(con, id_servico, usuario, "descartou_edicoes", {"editado": s["editado"]})
        return await _carregar(con, id_servico, usuario)


@app.get("/api/servicos/{id_servico}/historico")
async def historico(id_servico: int, usuario: dict = Depends(auth.usuario_atual)):
    if not auth.pode_ver(usuario, id_servico):
        raise HTTPException(403, "Você não tem acesso a este serviço.")
    async with db.conexao() as con:
        cur = await con.execute(
            """SELECT id, usuario_nome, acao, criado_em, detalhe->>'autorizado_por' AS autorizado_por,
                      coalesce(detalhe->>'motivo', detalhe->>'observacoes', detalhe->>'erro') AS nota
               FROM historico WHERE id_servico = %s ORDER BY criado_em DESC LIMIT 100""",
            (id_servico,),
        )
        return await cur.fetchall()


class NovoServico(BaseModel):
    id_servico: int = Field(gt=0)


@app.post("/api/servicos")
async def adicionar(dados: NovoServico, usuario: dict = Depends(auth.admin_atual)):
    async with db.conexao() as con:
        await con.execute(
            """INSERT INTO servicos (id_servico) VALUES (%s)
               ON CONFLICT (id_servico) DO UPDATE SET ativo = TRUE""",
            (dados.id_servico,),
        )
        await registrar(con, dados.id_servico, usuario, "adicionou_servico")
    if portalmg.configurado():
        async with portalmg.novo_cliente() as cliente:
            await sincronizar_um(cliente, dados.id_servico, usuario)
    return {"ok": True}


@app.delete("/api/servicos/{id_servico}")
async def remover(id_servico: int, usuario: dict = Depends(auth.admin_atual)):
    async with db.conexao() as con:
        await con.execute("UPDATE servicos SET ativo = FALSE WHERE id_servico = %s", (id_servico,))
        await registrar(con, id_servico, usuario, "removeu_servico")
    return {"ok": True}


# ---------------------------------------------------------------- sincronização com o Portal MG
async def sincronizar_um(cliente, id_servico: int, usuario: dict | None) -> bool:
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
            await registrar(con, id_servico, usuario, "sincronizou", {"mudou_no_portal": mudou_no_portal})
    return True


estado_sync: dict[str, Any] = {"rodando": False, "total": 0, "feitos": 0, "erros": 0, "inicio": None, "fim": None}


async def _sincronizar_todos(ids: list[int], usuario: dict) -> None:
    sem = asyncio.Semaphore(max(1, config.PORTALMG_CONCORRENCIA))
    try:
        async with portalmg.novo_cliente() as cliente:
            async def tarefa(i: int):
                async with sem:
                    try:
                        ok = await sincronizar_um(cliente, i, usuario)
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
async def sincronizar_todos(usuario: dict = Depends(auth.admin_atual)):
    if not portalmg.configurado():
        raise HTTPException(400, "Configure PORTALMG_API_KEY e as URLs do Portal MG nas variáveis do Railway.")
    if estado_sync["rodando"]:
        return estado_sync
    async with db.conexao() as con:
        cur = await con.execute("SELECT id_servico FROM servicos WHERE ativo ORDER BY id_servico")
        ids = [r["id_servico"] for r in await cur.fetchall()]
    estado_sync.update(rodando=True, total=len(ids), feitos=0, erros=0, inicio=agora().isoformat(), fim=None)
    t = asyncio.create_task(_sincronizar_todos(ids, usuario))
    _tarefas.add(t)
    t.add_done_callback(_tarefas.discard)
    return estado_sync


@app.get("/api/sincronizar")
async def status_sync(usuario: dict = Depends(auth.admin_atual)):
    return estado_sync


@app.post("/api/servicos/{id_servico}/sincronizar")
async def sincronizar_servico(id_servico: int, usuario: dict = Depends(auth.admin_atual)):
    if not portalmg.configurado():
        raise HTTPException(400, "Configure PORTALMG_API_KEY e as URLs do Portal MG nas variáveis do Railway.")
    async with portalmg.novo_cliente() as cliente:
        await sincronizar_um(cliente, id_servico, usuario)
    async with db.conexao() as con:
        return await _carregar(con, id_servico, usuario)


@app.get("/api/exportar")
async def exportar(status: str = "aguardando_publicacao", usuario: dict = Depends(auth.admin_atual)):
    """JSON com original x editado — apoio à alimentação manual do Portal MG."""
    async with db.conexao() as con:
        cur = await con.execute(
            """SELECT id_servico, nome, status, autorizado_por, autorizado_em, observacoes, original, editado
               FROM servicos WHERE ativo AND (%s = 'todos' OR status = %s) ORDER BY nome""",
            (status, status),
        )
        linhas = await cur.fetchall()
    return JSONResponse(
        jsonable_encoder(linhas),
        headers={"Content-Disposition": f'attachment; filename="servicos_sedese_{status}.json"'},
    )


# ---------------------------------------------------------------- usuários (admin)
class UsuarioIn(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    email: str = Field(min_length=5, max_length=200)
    perfil: str = Field(pattern="^(admin|editor)$")
    servicos: list[int] | None = None
    ativo: bool = True
    senha: str | None = Field(default=None, max_length=200)


@app.get("/api/usuarios")
async def listar_usuarios(usuario: dict = Depends(auth.admin_atual)):
    async with db.conexao() as con:
        cur = await con.execute(
            "SELECT id, nome, email, perfil, servicos, ativo, criado_em, ultimo_login FROM usuarios ORDER BY nome"
        )
        return await cur.fetchall()


@app.post("/api/usuarios")
async def criar_usuario(dados: UsuarioIn, usuario: dict = Depends(auth.admin_atual)):
    if not dados.senha or len(dados.senha) < 10:
        raise HTTPException(400, "A senha inicial precisa ter ao menos 10 caracteres.")
    async with db.conexao() as con:
        cur = await con.execute("SELECT 1 FROM usuarios WHERE email = %s", (dados.email.strip().lower(),))
        if await cur.fetchone():
            raise HTTPException(409, "Já existe um usuário com este e-mail.")
        await con.execute(
            "INSERT INTO usuarios (nome, email, senha_hash, perfil, servicos, ativo) VALUES (%s, %s, %s, %s, %s, %s)",
            (
                dados.nome.strip(), dados.email.strip().lower(), auth.gerar_hash(dados.senha),
                dados.perfil, dados.servicos, dados.ativo,
            ),
        )
        await registrar(con, None, usuario, "criou_usuario", {"email": dados.email})
    return {"ok": True}


@app.put("/api/usuarios/{uid}")
async def editar_usuario(uid: int, dados: UsuarioIn, usuario: dict = Depends(auth.admin_atual)):
    if uid == usuario["id"] and (dados.perfil != "admin" or not dados.ativo):
        raise HTTPException(400, "Você não pode remover seu próprio acesso de administrador.")
    if dados.senha and len(dados.senha) < 10:
        raise HTTPException(400, "A nova senha precisa ter ao menos 10 caracteres.")
    async with db.conexao() as con:
        await con.execute(
            """UPDATE usuarios SET nome = %s, email = %s, perfil = %s, servicos = %s, ativo = %s,
                   senha_hash = COALESCE(%s, senha_hash) WHERE id = %s""",
            (
                dados.nome.strip(), dados.email.strip().lower(), dados.perfil, dados.servicos,
                dados.ativo, auth.gerar_hash(dados.senha) if dados.senha else None, uid,
            ),
        )
        await registrar(con, None, usuario, "editou_usuario", {"id": uid, "email": dados.email})
    return {"ok": True}
