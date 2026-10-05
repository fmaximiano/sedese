"""Unidades da SEDESE extraídas da página "Quem é Quem" (social.mg.gov.br).

A lista é atualizada a partir da página (cache de 24 h). Se a página estiver fora do ar ou mudar de
formato, usa a cópia gravada em unidades_sedese.json.
"""
import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx

URL_QUEM_E_QUEM = "https://social.mg.gov.br/pagina_quem_e_quem.html"
ARQUIVO_RESERVA = Path(__file__).parent / "unidades_sedese.json"
VALIDADE = 24 * 3600

# Cargo -> unidade. A ordem importa: regras mais específicas primeiro.
_REGRAS = [
    (r"^Secret[áa]ri[oa] de Estado Adjunt[oa]$", "Gabinete do Secretário de Estado Adjunto"),
    (r"^Secret[áa]ri[oa] de Estado$", "Gabinete do Secretário de Estado"),
    (r"^Chefe de Gabinete$", "Chefia de Gabinete"),
    (r"^Assessor[a]? Jur[íi]dic[oa]\s*-?\s*Chefe$", "Assessoria Jurídica"),
    (r"^Assessor[a]?(?:-Chefe)? (de|da|do|dos|das) ", r"Assessoria \1 "),
    (r"^Auditor[a]?-Chefe d[ao] ", ""),
    (r"^Coordenador[a]? d[oa] ", ""),
    (r"^Subsecret[áa]ri[oa] ", "Subsecretaria "),
    (r"^Superintendente ", "Superintendência "),
    (r"^Diretor[a]? ", "Diretoria "),
]


def unidade_do_cargo(titulo: str) -> str:
    t = re.sub(r"\s+", " ", titulo).strip(" :-–")
    for padrao, troca in _REGRAS:
        novo = re.sub(padrao, troca, t, count=1, flags=re.IGNORECASE)
        if novo != t:
            t = novo
            break
    return t[:1].upper() + t[1:]


class _Leitor(HTMLParser):
    """Lê <details><summary>Grupo</summary> ... <p><strong>Cargo</strong><br/>Nome...</p></details>.

    O cargo é a primeira linha do parágrafo (até o primeiro <br>), desde que esteja em negrito —
    a página às vezes divide o título em vários <strong> seguidos ou aninhados.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.grupos: list[tuple[str, list[str]]] = []
        self._em_summary = self._coletando = self._viu_strong = False
        self._texto: list[str] = []

    def _fechar_linha(self):
        if self._coletando and self._viu_strong:
            cargo = re.sub(r"\s+", " ", "".join(self._texto)).strip()
            if cargo and self.grupos and ":" not in cargo:
                self.grupos[-1][1].append(cargo)
        self._coletando = False

    def handle_starttag(self, tag, attrs):
        if tag == "summary":
            self._em_summary, self._texto = True, []
        elif tag == "p" and not self._em_summary:
            self._coletando, self._viu_strong, self._texto = True, False, []
        elif tag == "strong" and self._coletando:
            self._viu_strong = True
        elif tag == "br":
            self._fechar_linha()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "summary" and self._em_summary:
            self._em_summary = False
            nome = re.sub(r"\s+", " ", "".join(self._texto)).strip()
            if nome:
                self.grupos.append((nome, []))
        elif tag == "p":
            self._fechar_linha()

    def handle_data(self, data):
        if self._em_summary or self._coletando:
            self._texto.append(data)


def extrair(pagina_html: str) -> list[dict]:
    leitor = _Leitor()
    leitor.feed(pagina_html)
    resultado, vistos = [], set()
    for grupo, cargos in leitor.grupos:
        nomes = []
        for nome in [grupo, *map(unidade_do_cargo, cargos)]:
            chave = nome.casefold()
            if chave not in vistos:
                vistos.add(chave)
                nomes.append(nome)
        if nomes:
            resultado.append({"grupo": grupo, "unidades": nomes})
    return resultado


_cache: dict = {"quando": 0.0, "dados": None}


def reserva() -> list[dict]:
    return json.loads(ARQUIVO_RESERVA.read_text(encoding="utf-8"))


async def listar() -> list[dict]:
    if _cache["dados"] and time.monotonic() - _cache["quando"] < VALIDADE:
        return _cache["dados"]
    dados = None
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as c:
            r = await c.get(URL_QUEM_E_QUEM)
        if r.status_code == 200:
            dados = extrair(r.content.decode("utf-8", errors="replace"))
            # Página mudou de formato? Mantém a reserva.
            if sum(len(g["unidades"]) for g in dados) < 30:
                dados = None
    except httpx.HTTPError:
        pass
    _cache.update(quando=time.monotonic(), dados=dados or _cache["dados"] or reserva())
    return _cache["dados"]


def todas(dados: list[dict]) -> set[str]:
    return {u for g in dados for u in g["unidades"]}


if __name__ == "__main__":
    # Regrava a reserva: python -m app.unidades_sedese
    r = httpx.get(URL_QUEM_E_QUEM, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    dados = extrair(r.content.decode("utf-8", errors="replace"))
    ARQUIVO_RESERVA.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    print(sum(len(g["unidades"]) for g in dados), "unidades em", len(dados), "grupos")
