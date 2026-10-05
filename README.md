# Serviços SEDESE · Portal MG

Sistema web para as **áreas fins da SEDESE** revisarem e editarem os serviços publicados no
[Portal MG](https://www.mg.gov.br) (dados do serviço, unidades vinculadas e etapas) e para a
**área central** receber essas edições, já autorizadas, e atualizar o Portal MG manualmente.

- **Backend:** Python 3.12 + FastAPI · **Banco:** Postgres no [Neon](https://neon.tech) · **Hospedagem:** [Railway](https://railway.com)
- **Frontend:** HTML/CSS/JS puro, sem etapa de build (`app/static`)

## Como funciona

Há **um único login: o do administrador** (área central), definido por variáveis no Railway.
Todo o resto é público: qualquer pessoa com o endereço vê e edita os serviços já sincronizados.
Para salvar, a área informa **Responsável**, **Unidade** (lista da página
[Quem é Quem](https://social.mg.gov.br/pagina_quem_e_quem.html)) e **e-mail institucional** terminado em
`@social.mg.gov.br`. Esses dados vão para o histórico e ficam lembrados no navegador de quem preencheu.

1. O administrador entra (🔒 **Área central**) e clica em **Sincronizar com Portal MG**. O servidor consulta as
   3 APIs para cada serviço e grava o resultado no banco (`original` = como está no Portal; `editado` = versão de trabalho).
2. As áreas fins abrem o serviço, editam qualquer campo (texto, HTML, listas, unidades, etapas: incluir,
   remover, reordenar) e clicam em **Salvar**. Sem marcar a autorização, fica como rascunho (*Em edição*) e continua público.
3. Ao salvar com **"Autorizo a publicação no Portal MG"**, o serviço vai para o administrador e **deixa de aparecer
   para o público**.
4. O administrador usa o filtro **📥 Enviados para publicação** (é o filtro que abre ao entrar, e o botão
   **Enviados** no topo mostra quantos são). Em cada serviço ele vê as **Alterações** lado a lado, com botão *Copiar*
   para colar no Portal, atualiza o Portal MG manualmente e clica em **Marcar como publicado**. O serviço volta a ficar público.
   Ele também pode **Devolver à área demandante** com orientações (o serviço volta a ficar público, em *Em edição*)
   ou **Descartar edições**.
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
- Administrador: e-mail e senha em `ADMIN_EMAIL` / `ADMIN_PASSWORD`; sessão em cookie assinado `HttpOnly` +
  `SameSite=Strict` (12 h); limite de 8 tentativas de login a cada 15 min. Trocar a senha no Railway encerra as sessões abertas.
- Público: a rastreabilidade vem da identificação obrigatória (validada no navegador **e** no servidor) e do
  histórico. A identificação é declaratória (o sistema não confirma o dono do e-mail). E-mails e erros técnicos
  só aparecem para o administrador.
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
   as 3 `PORTALMG_URL_*`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`).
   - As URLs vão **com o `=` no final**, porque o ID do serviço é colado depois dele.
   - Use uma senha forte para o administrador (12+ caracteres).
3. Em **Settings → Networking**, clique em **Generate Domain** para ter a URL pública.
4. O `railway.json` já define o comando de início (`python -m app.servidor`) e o *health check* (`/healthz`).
5. Acesse a URL, clique em 🔒 **Área central**, entre com o e-mail e a senha do administrador e clique em
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
  auth.py          login do administrador (único) e limite de tentativas
  config.py        leitura das variáveis de ambiente
  servicos_ids.py  lista padrão dos serviços (tirar um ID daqui o oculta na próxima inicialização)
  servidor.py      ponto de entrada (uvicorn)
  static/          interface (index.html, app.js, styles.css, vendor/purify.min.js)
```

A lista de serviços pode ser ampliada pela própria tela (campo **Incluir ID de serviço**, só administrador) ou pela
variável `SERVICOS_IDS`.

> O editor é **genérico**: monta o formulário a partir da estrutura JSON que o Portal MG devolver. Se a API
> incluir, remover ou renomear campos, a tela acompanha sem mudar o código. Campos de identificador
> (`id`, `nid`, `id_*`, `*_id`) aparecem como somente leitura.
