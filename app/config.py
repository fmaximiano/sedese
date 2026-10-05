"""Configuração lida exclusivamente de variáveis de ambiente (Railway)."""
import os


def _env(nome: str, padrao: str | None = None, obrigatorio: bool = False) -> str | None:
    valor = os.environ.get(nome, padrao)
    if valor is not None:
        valor = valor.strip()
    if obrigatorio and not valor:
        raise RuntimeError(f"Variável de ambiente obrigatória não definida: {nome}")
    return valor


DATABASE_URL = _env("DATABASE_URL", obrigatorio=True)

# Portal MG — URLs e chave nunca vão para o navegador; só o servidor as usa.
PORTALMG_API_KEY = _env("PORTALMG_API_KEY", "")
PORTALMG_URL_SERVICO = _env("PORTALMG_URL_SERVICO", "")
PORTALMG_URL_UNIDADES = _env("PORTALMG_URL_UNIDADES", "")
PORTALMG_URL_ETAPAS = _env("PORTALMG_URL_ETAPAS", "")
PORTALMG_USER_AGENT = _env(
    "PORTALMG_USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
)
PORTALMG_CONCORRENCIA = int(_env("PORTALMG_CONCORRENCIA", "4"))
PORTALMG_TIMEOUT = float(_env("PORTALMG_TIMEOUT", "30"))

# Lista opcional de IDs (separados por vírgula/espaço) que substitui a lista padrão do código.
SERVICOS_IDS = _env("SERVICOS_IDS", "")
