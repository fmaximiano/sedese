"""Áreas fins da SEDESE: cada uma tem um login próprio e só vê os seus serviços.

A senha de cada área fica na variável de ambiente SENHA_<SIGLA> (ex.: SENHA_SUBAS) no Railway.
Área sem senha definida não consegue entrar. Mover um ID de uma área para outra aqui vale na próxima
inicialização do sistema.
"""

AREAS: dict[str, dict] = {
    "SUBAS": {
        "nome": "Subsecretaria de Assistência Social",
        "servicos": [111336, 20770, 20765, 20750, 20763, 20785, 20764, 20781, 20753, 20754, 20755, 121181,
                     20749, 20751, 20786, 20787, 20777, 20784],
    },
    "SUBESP": {
        "nome": "Subsecretaria de Esportes",
        "servicos": [121320, 18844, 20747, 18846, 13468, 120449, 13463, 18849, 18663, 19276, 18664, 21342, 20748],
    },
    "SUBDH": {
        "nome": "Subsecretaria de Direitos Humanos",
        "servicos": [20740, 121429, 21884, 120454, 20741, 20743, 20746],
    },
    "SUBTE": {
        "nome": "Subsecretaria de Inclusão Produtiva, Trabalho, Emprego e Renda",
        "servicos": [104656, 19842, 12965, 12966],
    },
    "SUBPDM": {
        "nome": "Subsecretaria de Política dos Direitos das Mulheres",
        "servicos": [121317, 21197],
    },
    "SUBHAB": {
        "nome": "Subsecretaria de Política de Habitação",
        "servicos": [120434, 120436],
    },
    "ASA": {
        "nome": "Assessoria de Segurança Alimentar",
        "servicos": [120647, 120639],
    },
}

# ID do serviço -> sigla da área
AREA_DO_SERVICO: dict[int, str] = {i: sigla for sigla, a in AREAS.items() for i in a["servicos"]}


def unidades_da_area(sigla: str, dados: list[dict]) -> list[str]:
    """Unidades da página "Quem é Quem" que pertencem à área: o grupo com o mesmo nome (subsecretarias)
    ou, se não houver grupo, a própria unidade (assessorias)."""
    nome = AREAS[sigla]["nome"].casefold()
    for g in dados:
        if g["grupo"].casefold() == nome:
            return g["unidades"]
    return [u for g in dados for u in g["unidades"] if u.casefold() == nome]
