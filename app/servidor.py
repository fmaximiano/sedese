"""Ponto de entrada (Railway): python -m app.servidor"""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        proxy_headers=True,
        forwarded_allow_ips="*",  # atrás do proxy do Railway: usa o IP real do cliente
        workers=1,  # a sincronização em lote roda em memória; mantenha 1 worker
    )
