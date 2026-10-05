# Serviços SEDESE · Portal MG

Sistema web para as **áreas fins da SEDESE** revisarem e editarem os serviços publicados no
[Portal MG](https://www.mg.gov.br) (dados do serviço, unidades vinculadas e etapas) e para a
**área central** receber essas edições, já autorizadas, e atualizar o Portal MG manualmente.

- **Backend:** Python 3.12 + FastAPI · **Banco:** Postgres no [Neon](https://neon.tech) · **Hospedagem:** [Railway](https://railway.com)
- **Frontend:** HTML/CSS/JS puro, sem etapa de build (`app/static`)

## Como funciona

O sistema **não tem login**: qualquer pessoa com o endereço acessa. Para salvar (ou executar ações da área
central), é obrigatório informar **Responsável**, **Unidade** (lista das unidades da página
[Quem é Quem](https://social.mg.gov.br/pagina_quem_e_quem.html)) e **e-mail institucional** terminado em
`@social.mg.gov.br`. Esses dados ficam gravados no histórico e são lembrados no navegador de quem preencheu.

1. A área central clica em **Sincronizar com Portal MG**. O servidor consulta as 3 APIs para cada serviço
   e grava o resultado no banco (`original` = como está no Portal; `editado` = versão de trabalho).
2. As áreas fins abrem o serviço, editam qualquer campo (texto, HTML, listas, unidades, etapas: incluir,
   remover, reordenar), marcam **"Autorizo a publicação no Portal MG"**, preenchem a identificação e clicam em **Salvar**.
3. A área central filtra **Aguardando publicação**, abre **Alterações** (comparação lado a lado, com botão *Copiar*
   para colar no Portal), atualiza o Portal MG manualmente e clica em **Marcar como publicado**.
   Também pode **Devolver à área** com orientações ou **Descartar edições**.
4. Numa sincronização futura, se o Portal já refletir a versão editada, o serviço volta a "Sem alterações".

| Status | Significado |
|---|---|
| Sem alterações | Igual ao Portal MG |
| Em edição | Alterações salvas como rascunho, sem autorização |
| Aguardando publicação | Área autorizou; a área central precisa atualizar o Portal MG |
| Publicado | Área central informou que já atualizou o Portal MG |

Proteções: edições em andamento **nunca são sobrescritas** pela sincronização (o sistema avisa quando o Portal
mudou no meio da edição); bloqueio de conflito quando duas pessoas editam o mesmo serviço ao mesmo tempo;
histórico de todas as ações (com cópia do conteúdo salvo).

## Segurança

- A **chave da API e as URLs do Portal MG ficam só em variáveis de ambiente do Railway**: o navegador nunca as vê,
  porque quem consulta o Portal é o servidor.
- Sem login, a rastreabilidade vem da identificação obrigatória (nome, unidade e e-mail `@social.mg.gov.br`),
  validada no navegador **e** no servidor, e do histórico de cada serviço (com cópia do conteúdo salvo ou descartado).
  A identificação é declaratória: o sistema não confirma que a pessoa é dona do e-mail.
- Proteção CSRF, limite de 60 gravações por minuto por IP, cabeçalhos de segurança (CSP etc.) e
  sanitização do HTML editado (DOMPurify).

## Implantação

### 1. Banco no Neon
1. Crie um projeto em <https://console.neon.tech> (região **São Paulo / sa-east-1**).
2. Em **Connect**, copie a *connection string* (pode usar a **Pooled connection**). Ela termina com `?sslmode=require`.
3. Não precisa criar tabelas: o sistema cria tudo sozinho ao iniciar.

### 2. Aplicação no Railway
1. **New Project → Deploy from GitHub repo** → escolha este repositório e a branch desejada.
2. Em **Variables**, cadastre as variáveis de `.env.example` (mínimo: `DATABASE_URL`, `SESSION_SECRET`,
   `PORTALMG_API_KEY` e as 3 `PORTALMG_URL_*`).
   - As URLs vão **com o `=` no final**, porque o ID do serviço é colado depois dele.
   - Se o projeto já existia com login, as variáveis `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e
     `ADMIN_NOME` podem ser apagadas.
3. Em **Settings → Networking**, clique em **Generate Domain** para ter a URL pública.
4. O `railway.json` já define o comando de início (`python -m app.servidor`) e o *health check* (`/healthz`).
5. Acesse a URL e clique em **Sincronizar com Portal MG**.

### Rodar localmente (opcional)
```bash
pip install -r requirements.txt
cp .env.example .env   # preencha os valores
set -a; . ./.env; set +a
python -m app.servidor  # http://localhost:8000
```

## Estrutura
```
app/
  main.py          rotas da API e regras de status/sincronização
  portalmg.py      cliente da API do Portal MG (header "key")
  db.py            conexão com o Neon e criação das tabelas
  unidades_sedese.py  unidades da página "Quem é Quem" (atualiza a cada 24 h; reserva em unidades_sedese.json)
  config.py        leitura das variáveis de ambiente
  servicos_ids.py  lista padrão dos serviços (tirar um ID daqui o oculta na próxima inicialização)
  servidor.py      ponto de entrada (uvicorn)
  static/          interface (index.html, app.js, styles.css, vendor/purify.min.js)
```

A lista de serviços pode ser ampliada pela própria tela (campo **Incluir ID de serviço**) ou pela
variável `SERVICOS_IDS`.

> O editor é **genérico**: monta o formulário a partir da estrutura JSON que o Portal MG devolver. Se a API
> incluir, remover ou renomear campos, a tela acompanha sem mudar o código. Campos de identificador
> (`id`, `nid`, `id_*`, `*_id`) aparecem como somente leitura.
