"""Lista padrão de serviços da SEDESE publicados no Portal MG: a união dos serviços das áreas (app/areas.py)."""
from .areas import AREAS

SERVICOS_PADRAO = [i for a in AREAS.values() for i in a["servicos"]]
