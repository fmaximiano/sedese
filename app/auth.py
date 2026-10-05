"""Senhas (scrypt), sessão e controle de tentativas de login."""
import base64
import hashlib
import hmac
import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import db

_N, _R, _P = 2**14, 8, 1


def gerar_hash(senha: str) -> str:
    sal = os.urandom(16)
    h = hashlib.scrypt(senha.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def conferir_senha(senha: str, armazenado: str) -> bool:
    try:
        _, sal_b64, h_b64 = armazenado.split("$")
        sal, esperado = base64.b64decode(sal_b64), base64.b64decode(h_b64)
    except ValueError:
        return False
    h = hashlib.scrypt(senha.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=len(esperado))
    return hmac.compare_digest(h, esperado)


# Usado quando o e-mail não existe, para o tempo de resposta não revelar quais e-mails estão cadastrados.
HASH_FICTICIO = gerar_hash(os.urandom(16).hex())


def impressao_senha(senha_hash: str) -> str:
    """Trecho do hash guardado na sessão: trocar a senha invalida sessões antigas."""
    return hashlib.sha256(senha_hash.encode()).hexdigest()[:16]


# --- limite de tentativas de login (por IP e por e-mail, em memória) ---
_JANELA, _MAX = 15 * 60, 8
_tentativas: dict[str, deque] = defaultdict(deque)


def _limpar(chave: str) -> deque:
    fila = _tentativas[chave]
    agora = time.monotonic()
    while fila and agora - fila[0] > _JANELA:
        fila.popleft()
    return fila


def bloqueado(*chaves: str) -> bool:
    return any(len(_limpar(c)) >= _MAX for c in chaves)


def registrar_falha(*chaves: str) -> None:
    for c in chaves:
        _limpar(c).append(time.monotonic())


def limpar_falhas(*chaves: str) -> None:
    for c in chaves:
        _tentativas.pop(c, None)


# --- dependências FastAPI ---
async def usuario_atual(request: Request) -> dict:
    uid = request.session.get("uid")
    if not uid:
        raise HTTPException(401, "Sessão expirada. Entre novamente.")
    async with db.conexao() as con:
        cur = await con.execute(
            "SELECT id, nome, email, perfil, servicos, ativo, senha_hash FROM usuarios WHERE id = %s", (uid,)
        )
        u = await cur.fetchone()
    if not u or not u["ativo"] or request.session.get("fp") != impressao_senha(u["senha_hash"]):
        request.session.clear()
        raise HTTPException(401, "Sessão expirada. Entre novamente.")
    u.pop("senha_hash")
    return u


async def admin_atual(request: Request) -> dict:
    u = await usuario_atual(request)
    if u["perfil"] != "admin":
        raise HTTPException(403, "Ação restrita à área central (administradores).")
    return u


def pode_ver(usuario: dict, id_servico: int) -> bool:
    return usuario["perfil"] == "admin" or usuario["servicos"] is None or id_servico in usuario["servicos"]
