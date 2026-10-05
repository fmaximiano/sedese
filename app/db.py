"""Conexão com o Postgres (Neon) e criação do esquema."""
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from . import config

pool: AsyncConnectionPool | None = None

ESQUEMA = """
CREATE TABLE IF NOT EXISTS servicos (
    id_servico          INTEGER PRIMARY KEY,
    nome                TEXT,
    -- JSON (e nao JSONB) para preservar a ordem original dos campos do Portal MG
    original            JSON,             -- ultima versao lida do Portal MG
    editado             JSON,             -- versao de trabalho (editada pelas areas)
    tem_alteracoes      BOOLEAN NOT NULL DEFAULT FALSE,
    status              TEXT NOT NULL DEFAULT 'nao_sincronizado',
    autorizado          BOOLEAN NOT NULL DEFAULT FALSE,
    autorizado_por      TEXT,
    autorizado_em       TIMESTAMPTZ,
    observacoes         TEXT,
    versao              INTEGER NOT NULL DEFAULT 0,
    atualizado_por      TEXT,
    atualizado_em       TIMESTAMPTZ,
    sincronizado_em     TIMESTAMPTZ,
    erro_sincronizacao  TEXT,
    portal_alterado     BOOLEAN NOT NULL DEFAULT FALSE,
    publicado_por       TEXT,
    publicado_em        TIMESTAMPTZ,
    ativo               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS historico (
    id            BIGSERIAL PRIMARY KEY,
    id_servico    INTEGER REFERENCES servicos(id_servico) ON DELETE CASCADE,
    usuario_id    INTEGER,
    usuario_nome  TEXT,
    acao          TEXT NOT NULL,
    detalhe       JSON,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historico_servico_idx ON historico (id_servico, criado_em DESC);

-- Identificacao de quem edita/autoriza (o sistema nao tem login)
ALTER TABLE servicos
    ADD COLUMN IF NOT EXISTS autorizado_unidade TEXT,
    ADD COLUMN IF NOT EXISTS autorizado_email   TEXT,
    ADD COLUMN IF NOT EXISTS atualizado_unidade TEXT,
    ADD COLUMN IF NOT EXISTS atualizado_email   TEXT;
"""


async def abrir() -> None:
    global pool
    # prepare_threshold=None: compatível com o pooler do Neon (PgBouncer em modo transação).
    pool = AsyncConnectionPool(
        config.DATABASE_URL,
        min_size=1,
        max_size=10,
        max_idle=300,
        check=AsyncConnectionPool.check_connection,  # o Neon suspende o banco ocioso; descarta conexões mortas
        kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": False},
        open=False,
    )
    await pool.open(wait=True, timeout=30)
    async with pool.connection() as con:
        await con.execute(ESQUEMA)


async def fechar() -> None:
    if pool:
        await pool.close()


def conexao():
    assert pool is not None, "Pool não inicializado"
    return pool.connection()
