# Serviços SEDESE · Portal MG

Sistema web para as **áreas fins da SEDESE** revisarem e editarem os serviços publicados no
[Portal MG](https://www.mg.gov.br) (dados do serviço, unidades vinculadas e etapas) e para a
**área central** receber essas edições, já autorizadas, e atualizar o Portal MG manualmente.

- **Backend:** Python 3.12 + FastAPI · **Banco:** Postgres no [Neon](https://neon.tech) · **Hospedagem:** [Railway](https://railway.com)
- **Frontend:** HTML/CSS/JS puro, sem etapa de build (`app/static`)

## Como funciona

Ninguém entra sem login. Há **um login por área fim** (senha compartilhada pela equipe da área) e **o login do
administrador** (área central), todos definidos por variáveis no Railway. Cada área **só vê e edita os seus
serviços** — a divisão fica em `app/areas.py`:

| Sigla | Área | Serviços |
|---|---|---|
| SUBAS | Subsecretaria de Assistência Social | 18 |
| SUBESP | Subsecretaria de Esportes | 13 |
| SUBDH | Subsecretaria de Direitos Humanos | 7 |
| SUBTE | Subsecretaria de Inclusão Produtiva, Trabalho, Emprego e Renda | 4 |
| SUBPDM | Subsecretaria de Política dos Direitos das Mulheres | 2 |
| SUBHAB | Subsecretaria de Política de Habitação | 2 |
| ASA | Assessoria de Segurança Alimentar | 2 |

Como o login da área é compartilhado, para salvar a pessoa informa **Responsável**, **Unidade** (só as unidades
da própria área, conforme a página [Quem é Quem](https://social.mg.gov.br/pagina_quem_e_quem.html)) e
**e-mail institucional** terminado em `@social.mg.gov.br`. Esses dados vão para o histórico e ficam lembrados
no navegador de quem preencheu.

1. O administrador entra (**Área central (administrador)** na tela de entrada) e clica em **Sincronizar com Portal MG**. O servidor consulta as
   3 APIs para cada serviço e grava o resultado no banco (`original` = como está no Portal; `editado` = versão de trabalho).
2. As áreas fins entram com a sua senha, abrem o serviço, editam qualquer campo (texto, HTML, listas, unidades,
   etapas: incluir, remover, reordenar) e clicam em **Salvar**. Sem marcar a autorização, fica como rascunho
   (*Em edição*) e continua na lista da área.
3. Ao salvar com **"Autorizo a publicação no Portal MG"**, o serviço vai para o administrador e **sai da lista
   da área**. (A caixa de autorização sempre começa desmarcada para a área, inclusive em serviços já publicados.)
4. O administrador usa o filtro **📥 Enviados para publicação** (é o filtro que abre ao entrar, e o botão
   **Enviados** no topo mostra quantos são). Em cada serviço ele vê as **Alterações** lado a lado, com botão *Copiar*
   para colar no Portal, atualiza o Portal MG manualmente e clica em **Marcar como publicado**. O serviço volta para a
   lista da área. Ele também pode **Devolver à área demandante** com orientações (o serviço volta para a área, em
   *Em edição*, com a orientação em destaque) ou **Descartar edições**. O administrador vê todos os serviços e pode
   filtrar por área.
5. Numa sincronização futura, se o Portal já refletir a versão editada, o serviço volta a "Sem alterações".

Só o administrador pode: sincronizar, exportar, devolver, marcar como publicado, descartar edições e incluir IDs de serviço.

| Status | Significado |
|---|---|
| Sem alterações | Igual ao Portal MG |
| Em edição | Alterações salvas como rascunho, sem autorização |
| Aguardando publicação | Área autorizou; só o administrador vê, até publicar ou devolver |
| Publicado | Área central informou que já atualizou o Portal MG |

Proteções: edições em andamento **nunca são sobrescritas** pela sincronização (o sistema avisa quando o Portal
mudou no meio da edição); bloqueio de conflito quando duas pessoas editam o mesmo serviço ao mesmo tempo;
histórico de todas as ações (com cópia do conteúdo salvo).

## Segurança

- A **chave da API e as URLs do Portal MG ficam só em variáveis de ambiente do Railway**: o navegador nunca as vê,
  porque quem consulta o Portal é o servidor.
- Logins: administrador em `ADMIN_EMAIL` / `ADMIN_PASSWORD`; cada área em `SENHA_<SIGLA>` (ex.: `SENHA_SUBAS`).
  Área sem senha definida não aparece na tela de entrada. Sessão em cookie assinado `HttpOnly` + `SameSite=Strict`
  (12 h). Trocar uma senha no Railway encerra na hora as sessões abertas daquele acesso.
- Limite de tentativas de login: 8 por IP e 20 por acesso (área/admin) a cada 15 min — o limite por acesso vale
  mesmo que alguém forje o IP.
- **Todas** as regras de visibilidade ficam no servidor: a área só consegue listar, abrir, salvar e ver o histórico
  dos seus serviços que não estão com a área central (inclusive se tentar chamar a API diretamente). Sincronizar,
  exportar, devolver, publicar, descartar e incluir IDs exigem o administrador.
- Rastreabilidade: identificação obrigatória (validada no navegador **e** no servidor, com a unidade restrita à
  área) e histórico. A identificação é declaratória (o sistema não confirma o dono do e-mail). E-mails e erros
  técnicos só aparecem para o administrador.
- Proteção CSRF, limite de 60 gravações por minuto por IP, cabeçalhos de segurança (CSP etc.) e
  sanitização do HTML editado (DOMPurify).

## Implantação

### 1. Banco no Neon
1. Crie um projeto em <https://console.neon.tech> (região **São Paulo / sa-east-1**).
2. Em **Connect**, copie a *connection string* (pode usar a **Pooled connection**). Ela termina com `?sslmode=require`.
3. Não precisa criar tabelas: o sistema cria tudo sozinho ao iniciar.

### 2. Aplicação no Railway
1. **New Project → Deploy from GitHub repo** → escolha este repositório e a branch desejada.
2. Em **Variables**, cadastre as variáveis de `.env.example` (mínimo: `DATABASE_URL`, `PORTALMG_API_KEY`,
   as 3 `PORTALMG_URL_*`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e as 7 `SENHA_<SIGLA>` das áreas).
   - As URLs vão **com o `=` no final**, porque o ID do serviço é colado depois dele.
   - Use senhas fortes (12+ caracteres) e diferentes para o administrador e para cada área; entregue a senha de
     cada área só à equipe dela.
3. Em **Settings → Networking**, clique em **Generate Domain** para ter a URL pública.
4. O `railway.json` já define o comando de início (`python -m app.servidor`) e o *health check* (`/healthz`).
5. Acesse a URL, escolha **Área central (administrador)**, entre com o e-mail e a senha e clique em
   **Sincronizar com Portal MG**.

### Rodar localmente (opcional)
```bash
pip install -r requirements.txt
cp .env.example .env   # preencha os valores e acrescente COOKIE_SECURE=false
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
  areas.py         áreas fins (siglas, nomes) e os serviços de cada uma
  auth.py          login do administrador e das áreas, e limite de tentativas
  config.py        leitura das variáveis de ambiente
  servicos_ids.py  lista padrão dos serviços = união das áreas (tirar um ID de areas.py o oculta na próxima inicialização)
  servidor.py      ponto de entrada (uvicorn)
  static/          interface (index.html, app.js, styles.css, vendor/purify.min.js)
```

A lista de serviços pode ser ampliada pela própria tela (campo **ID do serviço** + área, só administrador) ou pela
variável `SERVICOS_IDS`. Serviço sem área só é visto pelo administrador. Para mudar um serviço de área ou criar
uma área nova, edite `app/areas.py` (e, para área nova, cadastre a `SENHA_<SIGLA>` no Railway).

> O editor é **genérico**: monta o formulário a partir da estrutura JSON que o Portal MG devolver. Se a API
> incluir, remover ou renomear campos, a tela acompanha sem mudar o código. Campos de identificador
> (`id`, `nid`, `id_*`, `*_id`) aparecem como somente leitura.
