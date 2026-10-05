"""Cliente da API do Portal MG (somente leitura). A chave vai no header "key"."""
import asyncio
from typing import Any

import httpx

from . import config


class ErroPortal(Exception):
    pass


def configurado() -> bool:
    return all(
        [config.PORTALMG_API_KEY, config.PORTALMG_URL_SERVICO, config.PORTALMG_URL_UNIDADES, config.PORTALMG_URL_ETAPAS]
    )


def novo_cliente() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=config.PORTALMG_TIMEOUT,
        follow_redirects=True,
        headers={
            "key": config.PORTALMG_API_KEY,
            "Accept": "application/json",
            "User-Agent": config.PORTALMG_USER_AGENT,
        },
    )


async def _get(cliente: httpx.AsyncClient, url_base: str, id_servico: int) -> Any:
    url = f"{url_base}{id_servico}"
    ultimo_erro = ""
    for tentativa in range(3):
        try:
            r = await cliente.get(url)
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    raise ErroPortal(f"Resposta não é JSON (HTTP 200, {r.headers.get('content-type', '?')})")
            if r.status_code in (401, 403):
                raise ErroPortal(f"Acesso negado pelo Portal MG (HTTP {r.status_code}) — verifique PORTALMG_API_KEY")
            if r.status_code == 404:
                return None
            ultimo_erro = f"HTTP {r.status_code}"
        except httpx.HTTPError as e:
            ultimo_erro = f"{type(e).__name__}: {e}"
        await asyncio.sleep(1.5 * (tentativa + 1))
    raise ErroPortal(f"Falha ao consultar o Portal MG ({ultimo_erro})")


def _como_lista(dados: Any) -> list:
    """Unidades/etapas: normaliza para lista, preservando o conteúdo original."""
    if dados is None:
        return []
    if isinstance(dados, list):
        return dados
    if isinstance(dados, dict):
        # Ex.: {"unidades": [...]} ou {"data": [...]} — se houver uma única lista, usa-a.
        listas = [v for v in dados.values() if isinstance(v, list)]
        if len(listas) == 1 and len(dados) <= 3:
            return listas[0]
        return [dados]
    return [dados]


def _como_objeto(dados: Any) -> Any:
    """Serviço: se vier como lista de um único item, usa o item."""
    if isinstance(dados, list) and len(dados) == 1:
        return dados[0]
    return dados


async def buscar_servico(cliente: httpx.AsyncClient, id_servico: int) -> dict:
    servico, unidades, etapas = await asyncio.gather(
        _get(cliente, config.PORTALMG_URL_SERVICO, id_servico),
        _get(cliente, config.PORTALMG_URL_UNIDADES, id_servico),
        _get(cliente, config.PORTALMG_URL_ETAPAS, id_servico),
    )
    if servico is None:
        raise ErroPortal("Serviço não encontrado no Portal MG (HTTP 404)")
    return {"servico": _como_objeto(servico), "unidades": _como_lista(unidades), "etapas": _como_lista(etapas)}


CHAVES_NOME = ("nome", "titulo", "title", "name", "nome_servico", "nome_do_servico", "label")


def extrair_nome(servico: Any, profundidade: int = 0) -> str | None:
    if isinstance(servico, list) and servico:
        return extrair_nome(servico[0], profundidade)
    if not isinstance(servico, dict) or profundidade > 2:
        return None
    for chave in CHAVES_NOME:
        for k, v in servico.items():
            if k.lower() == chave and isinstance(v, str) and v.strip():
                return v.strip()
    for v in servico.values():
        if isinstance(v, (dict, list)):
            nome = extrair_nome(v, profundidade + 1)
            if nome:
                return nome
    return None
