"""Login do administrador (área central) e das áreas fins. Sem login, nada além da tela de entrada."""
import hashlib
import hmac
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import config
from .areas import AREAS


def admin_configurado() -> bool:
    return bool(config.ADMIN_EMAIL and config.ADMIN_PASSWORD)


def senha_area(sigla: str) -> str:
    return config.SENHAS_AREAS.get(sigla, "")


def _hash(texto: str) -> bytes:
    return hashlib.sha256(texto.encode()).digest()


def _confere(digitado: str, correto: str) -> bool:
    # Compara sempre (mesmo com senha vazia) para não revelar, pelo tempo, quais acessos existem.
    return hmac.compare_digest(_hash(digitado), _hash(correto)) and bool(correto)


def conferir_admin(email: str, senha: str) -> bool:
    email_ok = _confere(email.strip().lower(), config.ADMIN_EMAIL)
    senha_ok = _confere(senha, config.ADMIN_PASSWORD)
    return admin_configurado() and email_ok and senha_ok


def conferir_area(sigla: str, senha: str) -> bool:
    return sigla in AREAS and _confere(senha, senha_area(sigla))


def impressao(acesso: str) -> str:
    """Guardada na sessão: trocar a senha (ou o e-mail do admin) no Railway encerra as sessões abertas."""
    if acesso == "admin":
        segredo = f"admin\n{config.ADMIN_EMAIL}\n{config.ADMIN_PASSWORD}"
    else:
        segredo = f"area\n{acesso}\n{senha_area(acesso)}"
    return hashlib.sha256(segredo.encode()).hexdigest()[:24]


def iniciar_sessao(request: Request, acesso: str) -> None:
    request.session.clear()
    request.session.update(acesso=acesso, fp=impressao(acesso))


def usuario(request: Request) -> dict | None:
    """{"admin": bool, "area": sigla | None} do usuário logado, ou None."""
    acesso = request.session.get("acesso")
    if acesso == "admin":
        ok = admin_configurado()
    else:
        ok = acesso in AREAS and bool(senha_area(acesso))
    if not ok or not hmac.compare_digest(str(request.session.get("fp", "")), impressao(acesso)):
        return None
    return {"admin": acesso == "admin", "area": None if acesso == "admin" else acesso}


def eh_admin(request: Request) -> bool:
    u = usuario(request)
    return bool(u and u["admin"])


async def exigir_login(request: Request) -> dict:
    u = usuario(request)
    if not u:
        raise HTTPException(401, "Sessão encerrada. Entre novamente.")
    return u


async def exigir_admin(request: Request) -> dict:
    u = usuario(request)
    if not u:
        raise HTTPException(401, "Sessão encerrada. Entre novamente.")
    if not u["admin"]:
        raise HTTPException(403, "Ação restrita ao administrador da área central.")
    return identidade_admin()


def identidade_admin() -> dict:
    return {"nome": config.ADMIN_NOME, "unidade": config.ADMIN_UNIDADE, "email": config.ADMIN_EMAIL, "area": None}


# --- limite de tentativas de login (em memória) ---
# Por IP e também por acesso (área/admin): o IP vem do cabeçalho do proxy e pode ser forjado,
# então o limite por acesso é o que de fato impede adivinhar a senha.
_JANELA = 15 * 60
_MAX_IP, _MAX_ACESSO = 8, 20
_tentativas: dict[str, deque] = defaultdict(deque)


def _fila(chave: str) -> deque:
    fila, agora = _tentativas[chave], time.monotonic()
    while fila and agora - fila[0] > _JANELA:
        fila.popleft()
    if not fila:
        _tentativas.pop(chave, None)
        return deque()
    return fila


def bloqueado(ip: str, acesso: str) -> bool:
    return len(_fila(f"ip:{ip}")) >= _MAX_IP or len(_fila(f"acesso:{acesso}")) >= _MAX_ACESSO


def registrar_falha(ip: str, acesso: str) -> None:
    for chave in (f"ip:{ip}", f"acesso:{acesso}"):
        _fila(chave)
        _tentativas[chave].append(time.monotonic())


def limpar_falhas(ip: str) -> None:
    _tentativas.pop(f"ip:{ip}", None)
