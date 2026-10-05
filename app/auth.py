"""Acesso do administrador (área central). O restante do sistema é público."""
import hashlib
import hmac
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import config


def admin_configurado() -> bool:
    return bool(config.ADMIN_EMAIL and config.ADMIN_PASSWORD)


def _hash(texto: str) -> bytes:
    return hashlib.sha256(texto.encode()).digest()


def conferir(email: str, senha: str) -> bool:
    if not admin_configurado():
        return False
    email_ok = hmac.compare_digest(_hash(email.strip().lower()), _hash(config.ADMIN_EMAIL))
    senha_ok = hmac.compare_digest(_hash(senha), _hash(config.ADMIN_PASSWORD))
    return email_ok and senha_ok


def impressao() -> str:
    """Guardada na sessão: trocar e-mail ou senha do admin no Railway invalida as sessões abertas."""
    return hashlib.sha256(f"{config.ADMIN_EMAIL}\n{config.ADMIN_PASSWORD}".encode()).hexdigest()[:24]


def eh_admin(request: Request) -> bool:
    return admin_configurado() and request.session.get("admin") == impressao()


async def exigir_admin(request: Request) -> dict:
    if not eh_admin(request):
        raise HTTPException(403, "Ação restrita ao administrador. Entre como administrador.")
    return identidade_admin()


def identidade_admin() -> dict:
    return {"nome": config.ADMIN_NOME, "unidade": config.ADMIN_UNIDADE, "email": config.ADMIN_EMAIL}


# --- limite de tentativas de login (por IP, em memória) ---
_JANELA, _MAX = 15 * 60, 8
_tentativas: dict[str, deque] = defaultdict(deque)


def _fila(ip: str) -> deque:
    fila, agora = _tentativas[ip], time.monotonic()
    while fila and agora - fila[0] > _JANELA:
        fila.popleft()
    return fila


def bloqueado(ip: str) -> bool:
    return len(_fila(ip)) >= _MAX


def registrar_falha(ip: str) -> None:
    _fila(ip).append(time.monotonic())


def limpar_falhas(ip: str) -> None:
    _tentativas.pop(ip, None)
