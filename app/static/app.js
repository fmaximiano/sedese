"use strict";

/* =====================================================================
   Serviços SEDESE · Portal MG — front-end (JavaScript puro, sem build)
   ===================================================================== */

const STATUS = {
  nao_sincronizado: "Não sincronizado",
  sincronizado: "Sem alterações",
  em_edicao: "Em edição",
  aguardando_publicacao: "Aguardando publicação",
  publicado: "Publicado",
};
const FILTROS = [
  ["todos", "Todos"],
  ["em_edicao", "Em edição"],
  ["aguardando_publicacao", "Aguardando publicação"],
  ["publicado", "Publicado"],
  ["sincronizado", "Sem alterações"],
  ["problemas", "Com erro / não sincronizado"],
];
const SECOES = {
  servico: { titulo: "Dados do serviço", singular: "Item" },
  unidades: { titulo: "Unidades vinculadas", singular: "Unidade" },
  etapas: { titulo: "Etapas", singular: "Etapa" },
};
const ACOES = {
  salvou: "Salvou alterações",
  autorizou_publicacao: "Salvou e autorizou publicação",
  marcou_publicado: "Marcou como publicado no Portal MG",
  devolveu: "Devolveu para a área",
  descartou_edicoes: "Descartou edições",
  sincronizou: "Sincronizou com o Portal MG",
  adicionou_servico: "Incluiu o serviço",
  removeu_servico: "Removeu o serviço",
};

const estado = {
  usuario: null,
  servicos: [],
  filtro: "todos",
  busca: "",
  atual: null,       // registro completo vindo da API
  editado: null,     // cópia de trabalho
  base: null,        // snapshot do que está salvo (para detectar "não salvo")
  verificadores: [], // funções que atualizam marcações de "alterado"
};

/* ---------------------------------------------------------------- utilidades */
const $ = (sel, raiz = document) => raiz.querySelector(sel);

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "text") n.textContent = v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f.nodeType ? f : String(f));
  return n;
}

const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const ehObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function igual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => igual(x, b[i]));
  if (typeof a === "object") {
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && igual(a[k], b[k]));
  }
  return false;
}

function dataBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toast(msg, tipo = "") {
  const t = el("div", { class: `toast ${tipo}`, role: "status" }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), tipo === "erro" ? 7000 : 3500);
}

async function api(metodo, url, corpo) {
  const opts = { method: metodo, headers: { "X-Requested-With": "sedese" }, credentials: "same-origin" };
  if (corpo !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(corpo);
  }
  const r = await fetch(url, opts);
  let dados = null;
  try { dados = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 401 && url !== "/api/login") {
    mostrarLogin();
    throw new Error("Sessão expirada.");
  }
  if (!r.ok) {
    let msg = dados?.detail;
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join("; ");
    const e = new Error(msg || `Erro ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return dados;
}

/* ---------------------------------------------------------------- rótulos amigáveis */
const PALAVRAS = {
  descricao: "descrição", orgao: "órgão", orgaos: "órgãos", servico: "serviço", servicos: "serviços",
  informacao: "informação", informacoes: "informações", publico: "público", endereco: "endereço",
  enderecos: "endereços", horario: "horário", horarios: "horários", numero: "número", titulo: "título",
  codigo: "código", situacao: "situação", observacao: "observação", observacoes: "observações",
  municipio: "município", municipios: "municípios", atualizacao: "atualização", criacao: "criação",
  legislacao: "legislação", url: "URL", id: "ID", cep: "CEP", email: "e-mail", duracao: "duração",
  solicitacao: "solicitação", exigencias: "exigências", exigencia: "exigência", responsavel: "responsável",
  avaliacao: "avaliação", atencao: "atenção", previsao: "previsão", conclusao: "conclusão",
  documentacao: "documentação", tramitacao: "tramitação", publicacao: "publicação", alteracao: "alteração",
  modificacao: "modificação", ultima: "última", ultimo: "último", area: "área", areas: "áreas",
  orientacao: "orientação", orientacoes: "orientações", eletronico: "eletrônico", gratuito: "gratuito",
  tempo: "tempo", medio: "médio", maximo: "máximo", minimo: "mínimo", necessarios: "necessários",
  necessario: "necessário", obrigatorio: "obrigatório", condicoes: "condições", condicao: "condição",
  regiao: "região", estado: "estado", uf: "UF", sigla: "sigla", telefone: "telefone", telefones: "telefones",
  acessibilidade: "acessibilidade", atendimento: "atendimento", presencial: "presencial", inicio: "início",
  periodo: "período", vigencia: "vigência", palavras: "palavras", chave: "chave", tematica: "temática",
  categoria: "categoria", subcategoria: "subcategoria", opcao: "opção", opcoes: "opções", nid: "NID",
  html: "HTML", pdf: "PDF", cpf: "CPF", cnpj: "CNPJ", sei: "SEI", latitude: "latitude", longitude: "longitude",
};

function rotular(chave) {
  if (/^\d+$/.test(chave)) return `Item ${Number(chave) + 1}`;
  const partes = String(chave)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => PALAVRAS[p.toLowerCase()] ?? p.toLowerCase());
  const t = partes.join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const CHAVE_ID = /^(id|nid|uuid|tid|vid)$|^id_|_id$/i;
const ehChaveId = (k) => CHAVE_ID.test(String(k));
const ehHTML = (s) => typeof s === "string" && /<\/?(p|br|ul|ol|li|strong|b|em|i|u|a|div|span|h[1-6]|table|tr|td)\b[^>]*>/i.test(s);
const semTags = (s) => {
  if (typeof s !== "string") return s;
  const d = document.createElement("div");
  d.innerHTML = sanitizar(s)
    .replace(/<li[^>]*>/gi, "$&• ")
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr|\/blockquote)[^>]*>/gi, "$&\n");
  return d.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
};

function tituloItem(item, padrao) {
  if (!ehObjeto(item)) return typeof item === "string" ? semTags(item).slice(0, 90) : padrao;
  const preferidas = ["nome", "titulo", "title", "name", "nome_unidade", "nome_etapa", "descricao", "label"];
  for (const p of preferidas) {
    for (const [k, v] of Object.entries(item)) {
      if (k.toLowerCase() === p && typeof v === "string" && v.trim()) {
        const t = semTags(v);
        return t.length > 90 ? t.slice(0, 88) + "…" : t;
      }
    }
  }
  for (const v of Object.values(item)) if (ehObjeto(v)) { const t = tituloItem(v, null); if (t) return t; }
  return padrao;
}

function chaveIdentidade(item) {
  if (!ehObjeto(item)) return null;
  const k = Object.keys(item).find((c) => ehChaveId(c) && item[c] !== null && item[c] !== "" && typeof item[c] !== "object");
  return k ? [k, item[k]] : null;
}

/** Encontra o item original correspondente (por ID, se houver; senão pela posição). */
function acharOriginal(item, origArr, i) {
  if (!Array.isArray(origArr)) return undefined;
  const id = chaveIdentidade(item);
  if (id) return origArr.find((o) => ehObjeto(o) && o[id[0]] === id[1]);
  if (ehObjeto(item) && Object.keys(item).some(ehChaveId)) return undefined; // item novo (ID vazio)
  return origArr[i];
}

function modeloVazio(v) {
  if (Array.isArray(v)) return [];
  if (ehObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, modeloVazio(x)]));
  if (typeof v === "boolean") return false;
  if (typeof v === "number") return null;
  return "";
}

/* ---------------------------------------------------------------- HTML seguro */
const PURIFY_CFG = {
  ALLOWED_TAGS: ["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u", "a", "h2", "h3", "h4", "h5", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td", "span", "div", "sub", "sup", "hr"],
  ALLOWED_ATTR: ["href", "target", "rel", "title", "colspan", "rowspan"],
};
function sanitizar(html) {
  if (window.DOMPurify) return window.DOMPurify.sanitize(html ?? "", PURIFY_CFG);
  const d = document.createElement("div");
  d.textContent = html ?? "";
  return d.innerHTML;
}

/* ---------------------------------------------------------------- marcação de alterações */
let agendado = false;
function mudou() {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    estado.verificadores = estado.verificadores.filter((f) => f());
    atualizarPendente();
  });
}

/** Registra uma função que (re)calcula a marcação; retorna false quando o nó saiu da tela. */
function verificar(no, fn) {
  const f = () => {
    if (!no.isConnected) return false;
    fn();
    return true;
  };
  estado.verificadores.push(f);
  fn();
}

/* ---------------------------------------------------------------- editor genérico */
function controlePrimitivo(valor, origValor, chave, aoMudar) {
  const ref = valor ?? origValor;
  if (ehChaveId(chave)) {
    return el("input", { type: "text", value: valor ?? "", readonly: true, title: "Identificador — não editável" });
  }
  if (typeof ref === "boolean") {
    const cb = el("input", { type: "checkbox" });
    cb.checked = !!valor;
    const txt = el("span", {}, cb.checked ? "Sim" : "Não");
    cb.addEventListener("change", () => { txt.textContent = cb.checked ? "Sim" : "Não"; aoMudar(cb.checked); });
    return el("label", { class: "valor-bool" }, cb, txt);
  }
  if (typeof ref === "number") {
    const inp = el("input", { type: "number", step: "any", value: valor ?? "" });
    inp.addEventListener("input", () => aoMudar(inp.value === "" ? null : Number(inp.value)));
    return inp;
  }
  if (ehHTML(valor) || ehHTML(origValor)) return editorRico(valor ?? "", aoMudar);
  const texto = valor ?? "";
  const longo = String(texto).length > 90 || String(texto).includes("\n") || String(origValor ?? "").length > 90;
  const inp = longo ? el("textarea", { rows: Math.min(12, Math.max(3, Math.ceil(String(texto).length / 90))) }) : el("input", { type: "text" });
  inp.value = texto;
  inp.addEventListener("input", () => aoMudar(inp.value === "" && valor === null ? null : inp.value));
  return inp;
}

function editorRico(html, aoMudar) {
  if (!window.DOMPurify) {
    const ta = el("textarea", { rows: 6 });
    ta.value = html;
    ta.addEventListener("input", () => aoMudar(ta.value));
    return ta;
  }
  const area = el("div", { class: "rico-area", contenteditable: "true", role: "textbox", "aria-multiline": "true" });
  area.innerHTML = sanitizar(html);
  const fonte = el("textarea", { hidden: true, spellcheck: "false" });
  const emitir = () => aoMudar(sanitizar(area.innerHTML));
  area.addEventListener("input", emitir);
  area.addEventListener("paste", (e) => {
    const h = e.clipboardData.getData("text/html");
    const t = e.clipboardData.getData("text/plain");
    e.preventDefault();
    if (h) document.execCommand("insertHTML", false, sanitizar(h.replace(/<!--[\s\S]*?-->/g, "")).replace(/ (style|class)="[^"]*"/g, ""));
    else document.execCommand("insertText", false, t);
  });
  fonte.addEventListener("input", () => aoMudar(fonte.value));

  const cmd = (c, v) => () => { area.focus(); document.execCommand(c, false, v); emitir(); };
  const botao = (rot, titulo, fn) => el("button", { type: "button", title: titulo, onmousedown: (e) => e.preventDefault(), onclick: fn }, rot);
  const btnHTML = botao("</> HTML", "Ver/editar o código HTML", () => {
    const mostrandoFonte = !fonte.hidden;
    if (mostrandoFonte) { area.innerHTML = sanitizar(fonte.value); emitir(); }
    else fonte.value = sanitizar(area.innerHTML);
    fonte.hidden = mostrandoFonte;
    area.hidden = !mostrandoFonte;
    fonte.rows = 10;
  });
  const barra = el("div", { class: "rico-barra" },
    botao(el("b", {}, "N"), "Negrito", cmd("bold")),
    botao(el("i", {}, "I"), "Itálico", cmd("italic")),
    el("span", { class: "sep" }),
    botao("• Lista", "Lista com marcadores", cmd("insertUnorderedList")),
    botao("1. Lista", "Lista numerada", cmd("insertOrderedList")),
    botao("🔗 Link", "Inserir link", () => {
      const url = prompt("Endereço do link (https://…):", "https://");
      if (url && /^(https?:|mailto:|tel:)/i.test(url)) cmd("createLink", url)();
    }),
    botao("⌫ Formatação", "Limpar formatação", cmd("removeFormat")),
    el("span", { class: "sep" }),
    btnHTML,
  );
  return el("div", { class: "rico" }, barra, area, fonte);
}

/**
 * Desenha um campo (chave/valor) de um objeto, mantendo a referência ao objeto pai
 * para que a edição altere diretamente a cópia de trabalho.
 */
function campo(pai, chave, orig, temOrig) {
  const valor = pai[chave];
  const origValor = temOrig ? orig : undefined;
  const rotulo = el("div", { class: "rotulo" }, rotular(chave), el("small", {}, chave));

  if (ehObjeto(valor)) {
    const det = el("details", { class: "grupo", open: true },
      el("summary", {}, rotular(chave)),
      camposObjeto(valor, ehObjeto(origValor) ? origValor : undefined));
    return el("div", { class: "campo bloco" }, det);
  }

  if (Array.isArray(valor)) {
    const deObjetos = valor.some(ehObjeto) || (Array.isArray(origValor) && origValor.some(ehObjeto));
    const corpo = deObjetos
      ? listaObjetos(valor, Array.isArray(origValor) ? origValor : undefined, rotular(chave))
      : listaPrimitiva(valor, Array.isArray(origValor) ? origValor : undefined);
    const no = el("div", { class: "campo bloco" }, rotulo, corpo);
    if (!deObjetos && temOrig) verificar(no, () => no.classList.toggle("alterado", !igual(pai[chave], origValor)));
    return no;
  }

  const no = el("div", { class: "campo" });
  const desenhar = () => {
    const restaurar = el("button", {
      type: "button", class: "btn pequeno restaurar", title: "Voltar ao valor publicado no Portal MG",
      onclick: () => { pai[chave] = clonar(origValor); desenhar(); mudou(); },
    }, "↺ Restaurar");
    rotulo.querySelector(".restaurar")?.remove();
    rotulo.append(restaurar);
    no.replaceChildren(rotulo, controlePrimitivo(pai[chave], origValor, chave, (v) => { pai[chave] = v; mudou(); }));
  };
  desenhar();
  if (temOrig) verificar(no, () => no.classList.toggle("alterado", !igual(pai[chave], origValor)));
  return no;
}

function camposObjeto(obj, orig) {
  const box = el("div", { class: "campos" });
  for (const k of Object.keys(obj)) {
    const temOrig = ehObjeto(orig) && Object.prototype.hasOwnProperty.call(orig, k);
    box.append(campo(obj, k, temOrig ? orig[k] : undefined, temOrig));
  }
  if (!Object.keys(obj).length) box.append(el("p", { class: "muted" }, "Sem informações."));
  return box;
}

function listaPrimitiva(arr, origArr) {
  const box = el("div", { class: "lista-primitiva" });
  const desenhar = () => {
    box.replaceChildren(
      ...arr.map((v, i) => el("div", { class: "item" },
        controlePrimitivo(v, origArr?.[i], "", (nv) => { arr[i] = nv; mudou(); }),
        el("button", { type: "button", class: "btn icone perigo", title: "Remover", onclick: () => { arr.splice(i, 1); desenhar(); mudou(); } }, "✕"))),
      el("div", {}, el("button", {
        type: "button", class: "btn pequeno",
        onclick: () => { arr.push(typeof (arr[0] ?? origArr?.[0]) === "number" ? null : ""); desenhar(); mudou(); },
      }, "+ Adicionar")),
    );
  };
  desenhar();
  return box;
}

function listaObjetos(arr, origArr, rotuloLista, singular = "Item", abrirTodos = false) {
  const box = el("div");
  let abertos = new WeakSet();
  const desenhar = (focar) => {
    const itens = el("div", { class: "itens" });
    arr.forEach((item, i) => {
      const orig = acharOriginal(item, origArr, i);
      const novo = orig === undefined;
      const titulo = el("span", { class: "titulo" }, tituloItem(item, `${singular} ${i + 1}`));
      const parar = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
      const ferramentas = el("span", { class: "ferramentas" },
        novo ? el("span", { class: "selo aguardando_publicacao" }, "novo") : null,
        el("button", { type: "button", class: "btn icone", title: "Mover para cima", disabled: i === 0,
          onclick: parar(() => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; desenhar(); mudou(); }) }, "↑"),
        el("button", { type: "button", class: "btn icone", title: "Mover para baixo", disabled: i === arr.length - 1,
          onclick: parar(() => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; desenhar(); mudou(); }) }, "↓"),
        el("button", { type: "button", class: "btn icone perigo", title: `Remover ${singular.toLowerCase()}`,
          onclick: parar(() => {
            if (!confirm(`Remover “${titulo.textContent}”? A remoção só vale depois de salvar.`)) return;
            arr.splice(i, 1); desenhar(); mudou();
          }) }, "✕"),
      );
      const corpo = ehObjeto(item)
        ? camposObjeto(item, orig)
        : el("div", { class: "campos" }, controlePrimitivo(item, orig, "", (v) => { arr[i] = v; mudou(); }));
      const card = el("details", { class: `item-card${novo ? " novo" : ""}`, open: abrirTodos || (ehObjeto(item) && abertos.has(item)) || item === focar || arr.length <= 2 },
        el("summary", {}, el("span", { class: "ordem" }, i + 1), titulo, ferramentas), corpo);
      if (ehObjeto(item)) card.addEventListener("toggle", () => (card.open ? abertos.add(item) : abertos.delete(item)));
      verificar(card, () => {
        card.classList.toggle("alterado", !novo && !igual(item, orig));
        titulo.textContent = tituloItem(item, `${singular} ${i + 1}`);
      });
      itens.append(card);
      if (item === focar) requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
    if (!arr.length) itens.append(el("p", { class: "muted" }, `Nenhum registro em “${rotuloLista}”.`));
    const adicionar = el("button", {
      type: "button", class: "btn adicionar",
      onclick: () => {
        const modelo = arr.find(ehObjeto) ?? origArr?.find(ehObjeto);
        const novoItem = modelo ? modeloVazio(modelo) : "";
        arr.push(novoItem); desenhar(novoItem); mudou();
      },
    }, `+ Adicionar ${singular.toLowerCase()}`);
    box.replaceChildren(itens, adicionar);
  };
  box.expandir = (abrir) => box.querySelectorAll(":scope > .itens > .item-card").forEach((c) => (c.open = abrir));
  desenhar();
  return box;
}

/* ---------------------------------------------------------------- diferenças (original × editado) */
function diferencas(orig, novo, caminho = [], saida = []) {
  if (igual(orig, novo)) return saida;
  if (ehObjeto(orig) && ehObjeto(novo)) {
    for (const k of new Set([...Object.keys(orig), ...Object.keys(novo)])) diferencas(orig[k], novo[k], [...caminho, rotular(k)], saida);
    return saida;
  }
  if (Array.isArray(orig) && Array.isArray(novo) && (orig.some(ehObjeto) || novo.some(ehObjeto))) {
    const usados = new Set();
    novo.forEach((item, i) => {
      const o = acharOriginal(item, orig, i);
      const nome = tituloItem(item, `Item ${i + 1}`);
      if (o === undefined) saida.push({ caminho: [...caminho, nome], antes: undefined, depois: item, tipo: "adicionado" });
      else { usados.add(o); diferencas(o, item, [...caminho, nome], saida); }
    });
    const ordemAntes = orig.filter((o) => usados.has(o));
    const ordemDepois = novo.map((it, i) => acharOriginal(it, orig, i)).filter((o) => o !== undefined);
    if (!igual(ordemAntes.map((o) => tituloItem(o, "")), ordemDepois.map((o) => tituloItem(o, "")))) {
      saida.push({ caminho: [...caminho, "(ordem)"], antes: ordemAntes.map((o, i) => `${i + 1}. ${tituloItem(o, "")}`).join("\n"),
        depois: ordemDepois.map((o, i) => `${i + 1}. ${tituloItem(o, "")}`).join("\n"), tipo: "ordem" });
    }
    orig.forEach((o, i) => {
      if (!usados.has(o)) saida.push({ caminho: [...caminho, tituloItem(o, `Item ${i + 1}`)], antes: o, depois: undefined, tipo: "removido" });
    });
    return saida;
  }
  saida.push({ caminho, antes: orig, depois: novo, tipo: "alterado" });
  return saida;
}

function textoValor(v) {
  if (v === undefined) return "—";
  if (v === null || v === "") return "(vazio)";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "string") return ehHTML(v) ? semTags(v) : v;
  if (ehObjeto(v)) return Object.entries(v).filter(([, x]) => x !== null && x !== "" && !ehObjeto(x) && !Array.isArray(x))
    .map(([k, x]) => `${rotular(k)}: ${textoValor(x)}`).join("\n") || "(item sem conteúdo preenchido)";
  return JSON.stringify(v, null, 2);
}

async function copiar(v) {
  try {
    if (typeof v === "string" && ehHTML(v) && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([v], { type: "text/html" }),
        "text/plain": new Blob([semTags(v)], { type: "text/plain" }),
      })]);
    } else {
      await navigator.clipboard.writeText(typeof v === "string" ? v : textoValor(v));
    }
    toast("Copiado para a área de transferência.", "ok");
  } catch {
    toast("Não foi possível copiar automaticamente.", "erro");
  }
}

function contarAlteracoes() {
  if (!estado.atual?.original || !estado.editado) return 0;
  return diferencas(estado.atual.original, estado.editado).length;
}

function abrirDiferencas() {
  const difs = diferencas(estado.atual.original, estado.editado);
  const corpo = difs.length
    ? el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Campo"), el("th", {}, "Portal MG (atual)"), el("th", {}, "Nova versão"), el("th", {}, ""))),
      el("tbody", {}, ...difs.map((d) => el("tr", {},
        el("td", { class: "diff-caminho" }, d.caminho.join(" › "),
          d.tipo !== "alterado" ? el("div", {}, el("span", { class: `selo ${d.tipo === "removido" ? "erro" : "aguardando_publicacao"}` }, d.tipo)) : null),
        el("td", {}, d.antes === undefined ? "—" : el("div", { class: "diff-antes" }, textoValor(d.antes))),
        el("td", {}, d.depois === undefined ? "—" : el("div", { class: "diff-depois" }, textoValor(d.depois))),
        el("td", {}, d.depois !== undefined ? el("button", { class: "btn pequeno", title: "Copiar a nova versão", onclick: () => copiar(d.depois) }, "Copiar") : null),
      ))))
    : el("p", { class: "muted" }, "Nenhuma diferença em relação ao que está publicado no Portal MG.");
  dialogo(`Alterações — ${estado.atual.nome || estado.atual.id_servico}`, el("div", {},
    el("p", { class: "muted" }, "Compara o conteúdo atual do Portal MG com a versão em edição (inclui alterações ainda não salvas)."),
    corpo));
}

/* ---------------------------------------------------------------- diálogos */
function dialogo(titulo, conteudo) {
  const d = $("#dialogo");
  $("#dialogo-corpo").replaceChildren(
    el("div", { class: "dialogo-topo" }, el("h2", {}, titulo), el("button", { class: "btn icone", "aria-label": "Fechar", onclick: () => d.close() }, "✕")),
    el("div", { class: "dialogo-corpo" }, conteudo),
  );
  if (!d.open) d.showModal();
  return d;
}

/* ---------------------------------------------------------------- login / sessão */
function mostrarLogin() {
  $("#tela-app").hidden = true;
  $("#barra-pendente").hidden = true;
  $("#tela-login").hidden = false;
  $("#form-login [name=email]").focus();
}

async function iniciar() {
  try {
    estado.usuario = await api("GET", "/api/me");
  } catch {
    return mostrarLogin();
  }
  $("#tela-login").hidden = true;
  $("#tela-app").hidden = false;
  const admin = estado.usuario.perfil === "admin";
  document.querySelectorAll(".so-admin").forEach((n) => (n.hidden = !admin));
  $("#btn-usuario").textContent = `👤 ${estado.usuario.nome.split(" ")[0]}`;
  if (admin && !estado.usuario.portal_configurado) {
    toast("Variáveis do Portal MG não configuradas no Railway — a sincronização está desativada.", "erro");
  }
  await carregarLista();
  if (admin) acompanharSync(false);
  abrirPelaURL();
}

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  $("#login-erro").textContent = "";
  try {
    await api("POST", "/api/login", { email: f.email.value, senha: f.senha.value });
    f.senha.value = "";
    iniciar();
  } catch (err) {
    $("#login-erro").textContent = err.message;
  }
});

$("#btn-usuario").addEventListener("click", () => ($("#menu-usuario").hidden = !$("#menu-usuario").hidden));
document.addEventListener("click", (e) => { if (!e.target.closest(".usuario")) $("#menu-usuario").hidden = true; });
$("#btn-sair").addEventListener("click", async () => {
  if (temPendencias() && !confirm("Há alterações não salvas. Sair mesmo assim?")) return;
  await api("POST", "/api/logout");
  estado.atual = null;
  location.hash = "";
  mostrarLogin();
});
$("#btn-senha").addEventListener("click", () => {
  const form = el("form", {},
    el("label", {}, "Senha atual", el("input", { type: "password", name: "atual", required: true, autocomplete: "current-password" })),
    el("label", {}, "Nova senha (mínimo 10 caracteres)", el("input", { type: "password", name: "nova", required: true, minlength: 10, autocomplete: "new-password" })),
    el("label", {}, "Repita a nova senha", el("input", { type: "password", name: "nova2", required: true, minlength: 10, autocomplete: "new-password" })),
    el("div", {}, el("button", { class: "btn primario", type: "submit" }, "Alterar senha")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.nova.value !== form.nova2.value) return toast("As senhas não conferem.", "erro");
    try {
      await api("POST", "/api/me/senha", { atual: form.atual.value, nova: form.nova.value });
      $("#dialogo").close();
      toast("Senha alterada.", "ok");
    } catch (err) { toast(err.message, "erro"); }
  });
  dialogo("Trocar senha", form);
});

/* ---------------------------------------------------------------- lista lateral */
function grupoStatus(s) {
  if (s.erro_sincronizacao || s.status === "nao_sincronizado") return "problemas";
  return s.status;
}

async function carregarLista() {
  estado.servicos = await api("GET", "/api/servicos");
  desenharLista();
}

function desenharLista() {
  const contagem = { todos: estado.servicos.length };
  for (const s of estado.servicos) {
    contagem[s.status] = (contagem[s.status] || 0) + 1;
    if (grupoStatus(s) === "problemas") contagem.problemas = (contagem.problemas || 0) + 1;
  }
  $("#filtros").replaceChildren(...FILTROS.filter(([k]) => k === "todos" || contagem[k]).map(([k, rot]) =>
    el("button", { class: "filtro", "aria-pressed": String(estado.filtro === k), onclick: () => { estado.filtro = k; desenharLista(); } },
      rot, el("span", { class: "n" }, contagem[k] || 0))));

  const termo = estado.busca.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visiveis = estado.servicos.filter((s) => {
    if (estado.filtro !== "todos" && (estado.filtro === "problemas" ? grupoStatus(s) !== "problemas" : s.status !== estado.filtro)) return false;
    if (!termo) return true;
    const alvo = `${s.id_servico} ${s.nome || ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return alvo.includes(termo);
  });
  $("#lista").replaceChildren(...visiveis.map((s) => el("li", {},
    el("button", { "aria-current": String(estado.atual?.id_servico === s.id_servico), onclick: () => irPara(s.id_servico) },
      el("span", { class: "nome" }, s.nome || `Serviço ${s.id_servico}`),
      el("span", { class: "meta" },
        el("span", {}, `#${s.id_servico}`),
        el("span", { class: `selo ${s.erro_sincronizacao ? "erro" : s.status}` }, s.erro_sincronizacao ? "Erro na sincronização" : STATUS[s.status]),
        s.portal_alterado ? el("span", { class: "selo em_edicao", title: "O Portal MG mudou depois que a edição começou" }, "⚠ Portal mudou") : null,
        s.qtd_unidades != null ? el("span", { title: "Unidades" }, `🏢 ${s.qtd_unidades}`) : null,
        s.qtd_etapas != null ? el("span", { title: "Etapas" }, `🪜 ${s.qtd_etapas}`) : null,
      )))));
  if (!visiveis.length) $("#lista").append(el("li", { class: "muted", style: "padding:12px" }, "Nenhum serviço encontrado."));

  $("#resumo").replaceChildren(...[
    ["em_edicao", "Em edição"], ["aguardando_publicacao", "Aguardando publicação"], ["publicado", "Publicados"],
    ["sincronizado", "Sem alterações"], ["problemas", "Com pendência técnica"],
  ].map(([k, rot]) => el("div", { class: "card" }, el("div", { class: "num" }, contagem[k] || 0), el("div", { class: "muted" }, rot))));
}

$("#busca").addEventListener("input", (e) => { estado.busca = e.target.value; desenharLista(); });
$("#btn-menu").addEventListener("click", () => $("#lateral").classList.toggle("aberta"));

$("#form-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = Number(e.target.id.value);
  try {
    await api("POST", "/api/servicos", { id_servico: id });
    e.target.reset();
    await carregarLista();
    toast(`Serviço ${id} incluído.`, "ok");
    irPara(id);
  } catch (err) { toast(err.message, "erro"); }
});

/* ---------------------------------------------------------------- navegação */
function irPara(id) {
  $("#lateral").classList.remove("aberta");
  if (location.hash === `#s/${id}`) return abrirPelaURL();
  location.hash = `#s/${id}`;
}

let hashAnterior = location.hash;
function abrirPelaURL() {
  const m = location.hash.match(/^#s\/(\d+)$/);
  const id = m ? Number(m[1]) : null;
  if (id === estado.atual?.id_servico) return;
  if (temPendencias() && !confirm("Há alterações não salvas neste serviço. Descartá-las?")) {
    history.replaceState(null, "", hashAnterior);
    return;
  }
  hashAnterior = location.hash;
  if (id) abrirServico(id);
  else fecharServico();
}
window.addEventListener("hashchange", abrirPelaURL);
window.addEventListener("beforeunload", (e) => { if (temPendencias()) { e.preventDefault(); e.returnValue = ""; } });

function fecharServico() {
  estado.atual = estado.editado = estado.base = null;
  $("#servico").hidden = true;
  $("#vazio").hidden = false;
  atualizarPendente();
  desenharLista();
}

async function abrirServico(id) {
  try {
    const s = await api("GET", `/api/servicos/${id}`);
    carregarNoEditor(s);
    $("#conteudo").scrollTop = 0;
  } catch (err) {
    toast(err.message, "erro");
  }
}

function carregarNoEditor(s) {
  estado.atual = s;
  estado.editado = clonar(s.editado);
  estado.base = { editado: clonar(s.editado), observacoes: s.observacoes || "", autorizado: s.autorizado, autorizado_por: s.autorizado_por || "" };
  desenharServico();
  desenharLista();
  atualizarPendente();
}

/* ---------------------------------------------------------------- tela do serviço */
function formEnvio() {
  return {
    observacoes: $("#f-observacoes")?.value ?? "",
    autorizado: $("#f-autorizado")?.checked ?? false,
    autorizado_por: $("#f-autorizado-por")?.value ?? "",
  };
}

function temPendencias() {
  if (!estado.atual || !estado.base) return false;
  const f = formEnvio();
  return !igual(estado.editado, estado.base.editado) || f.observacoes !== estado.base.observacoes || f.autorizado !== estado.base.autorizado
    || (f.autorizado && f.autorizado_por !== estado.base.autorizado_por);
}

function atualizarPendente() {
  $("#barra-pendente").hidden = !temPendencias();
  const n = $("#n-alteracoes");
  if (n) n.textContent = contarAlteracoes();
}

function desenharServico() {
  const s = estado.atual;
  const admin = estado.usuario.perfil === "admin";
  estado.verificadores = [];
  $("#vazio").hidden = true;
  const art = $("#servico");
  art.hidden = false;

  const cab = el("header", { class: "cabecalho" },
    el("div", { class: "linha" },
      el("span", { class: `selo ${s.status}` }, STATUS[s.status]),
      el("span", {}, `Serviço nº ${s.id_servico}`),
      el("span", {}, `Sincronizado em ${dataBR(s.sincronizado_em)}`),
      s.atualizado_por ? el("span", {}, `Última edição: ${s.atualizado_por}, ${dataBR(s.atualizado_em)}`) : null),
    el("h1", {}, s.nome || `Serviço ${s.id_servico}`),
  );

  const avisos = [];
  if (s.erro_sincronizacao) avisos.push(el("div", { class: "aviso vermelho" }, `Erro na última sincronização: ${s.erro_sincronizacao}`));
  if (s.portal_alterado) avisos.push(el("div", { class: "aviso amarelo" },
    "⚠ O conteúdo deste serviço mudou no Portal MG depois que a edição começou. Revise em “Alterações” para não sobrescrever informações novas."));
  if (s.status === "publicado") avisos.push(el("div", { class: "aviso azul" },
    `Marcado como publicado no Portal MG por ${s.publicado_por} em ${dataBR(s.publicado_em)}. Na próxima sincronização, se o Portal refletir esta versão, o status volta a “Sem alterações”.`));
  if (s.observacoes?.startsWith("[Devolvido")) avisos.push(el("div", { class: "aviso amarelo" }, s.observacoes));

  if (!s.original) {
    art.replaceChildren(cab, ...avisos, el("div", { class: "aviso azul" },
      "Este serviço ainda não foi carregado do Portal MG. ",
      admin ? el("button", { class: "btn pequeno", onclick: () => ressincronizar() }, "Sincronizar agora") : "Aguarde a área central sincronizar."));
    return;
  }

  const blocos = {};
  const secoes = Object.keys(SECOES).map((k) => {
    const cfg = SECOES[k];
    const valor = estado.editado[k];
    const orig = s.original[k];
    let corpo;
    if (Array.isArray(valor)) corpo = blocos[k] = listaObjetos(valor, Array.isArray(orig) ? orig : undefined, cfg.titulo, cfg.singular);
    else if (ehObjeto(valor)) corpo = camposObjeto(valor, ehObjeto(orig) ? orig : undefined);
    else corpo = el("div", { class: "campos" }, campo(estado.editado, k, orig, true));
    const qtd = Array.isArray(valor) ? el("span", { class: "contagem" }, `(${valor.length})`) : null;
    const expandir = Array.isArray(valor) ? el("span", { style: "margin-left:auto;display:flex;gap:6px" },
      el("button", { type: "button", class: "btn pequeno", onclick: (e) => { e.preventDefault(); blocos[k].expandir(true); } }, "Expandir todos"),
      el("button", { type: "button", class: "btn pequeno", onclick: (e) => { e.preventDefault(); blocos[k].expandir(false); } }, "Recolher")) : null;
    return el("details", { class: "secao", id: `sec-${k}`, open: true }, el("summary", {}, cfg.titulo, qtd, expandir), el("div", { class: "secao-corpo" }, corpo));
  });

  const nav = el("nav", { class: "navegacao", "aria-label": "Seções" },
    ...Object.keys(SECOES).map((k) => el("a", { class: "btn pequeno", href: `#sec-${k}`, onclick: (e) => { e.preventDefault(); $(`#sec-${k}`).scrollIntoView({ behavior: "smooth" }); } },
      SECOES[k].titulo, Array.isArray(estado.editado[k]) ? ` (${estado.editado[k].length})` : "")),
    el("button", { class: "btn pequeno", onclick: abrirDiferencas }, "Alterações", el("span", { id: "n-alteracoes", class: "contador" }, "0")),
    el("button", { class: "btn pequeno", onclick: abrirHistorico }, "Histórico"),
    el("a", { class: "btn pequeno primario", href: "#envio", onclick: (e) => { e.preventDefault(); irParaSalvar(); } }, "Salvar ↓"),
  );

  art.replaceChildren(cab, ...avisos, nav, ...secoes, painelEnvio());
  atualizarPendente();
}

function painelEnvio() {
  const s = estado.atual;
  const admin = estado.usuario.perfil === "admin";
  const autorizado = el("input", { type: "checkbox", id: "f-autorizado" });
  autorizado.checked = !!s.autorizado;
  const responsavel = el("input", { type: "text", id: "f-autorizado-por", maxlength: 300, placeholder: "Nome e cargo/área do responsável" });
  responsavel.value = s.autorizado_por || estado.usuario.nome;
  responsavel.disabled = !autorizado.checked;
  autorizado.addEventListener("change", () => { responsavel.disabled = !autorizado.checked; if (autorizado.checked) responsavel.focus(); atualizarPendente(); });
  responsavel.addEventListener("input", atualizarPendente);
  const obs = el("textarea", { id: "f-observacoes", rows: 3, maxlength: 5000, placeholder: "Contexto das alterações, prazos, normas que fundamentam a mudança…" });
  obs.value = s.observacoes || "";
  obs.addEventListener("input", atualizarPendente);

  const btnSalvar = el("button", { class: "btn primario grande", id: "btn-salvar", onclick: salvar }, "💾 Salvar");
  const acoesAdmin = admin ? [
    el("span", { class: "espaco" }),
    s.status === "aguardando_publicacao" ? el("button", { class: "btn ok", onclick: marcarPublicado, title: "Use depois de atualizar manualmente o Portal MG" }, "✔ Marcar como publicado no Portal MG") : null,
    s.status === "aguardando_publicacao" || s.status === "em_edicao" ? el("button", { class: "btn", onclick: devolver }, "↩ Devolver à área") : null,
    el("button", { class: "btn", onclick: ressincronizar, title: "Busca a versão atual deste serviço no Portal MG" }, "⟳ Ressincronizar"),
    s.status !== "sincronizado" ? el("button", { class: "btn perigo", onclick: descartar }, "Descartar edições") : null,
  ] : [];

  return el("section", { class: "secao envio", id: "envio" },
    el("div", { class: "secao-titulo" }, "Envio para a área central da SEDESE"),
    el("div", { class: "secao-corpo" },
      el("div", { class: "envio-grade" }, el("label", {}, "Observações para a área central", obs)),
      el("div", { class: "autorizacao" },
        autorizado,
        el("div", { style: "flex:1;display:grid;gap:8px" },
          el("label", { for: "f-autorizado" }, "Autorizo a publicação destas informações no Portal MG"),
          el("span", { class: "muted", style: "font-size:13px" },
            "Ao marcar, a área declara que o conteúdo foi revisado e pode ser publicado. Sem a marcação, as alterações ficam salvas como rascunho (“Em edição”)."),
          el("label", { class: "envio-grade" }, "Responsável pela autorização", responsavel),
          s.autorizado && s.autorizado_em ? el("span", { class: "muted", style: "font-size:13px" }, `Autorizado por ${s.autorizado_por} em ${dataBR(s.autorizado_em)}.`) : null,
        )),
      el("div", { class: "envio-acoes" }, btnSalvar, ...acoesAdmin),
    ));
}

function irParaSalvar() {
  $("#envio")?.scrollIntoView({ behavior: "smooth", block: "end" });
}
$("#btn-ir-salvar").addEventListener("click", irParaSalvar);

async function salvar() {
  const s = estado.atual;
  const f = formEnvio();
  if (f.autorizado && !f.autorizado_por.trim()) return toast("Informe o responsável pela autorização.", "erro");
  if (!f.autorizado && !temPendencias()) return toast("Nada para salvar.");
  const btn = $("#btn-salvar");
  btn.disabled = true;
  try {
    const novo = await api("PUT", `/api/servicos/${s.id_servico}`, {
      editado: estado.editado, versao: s.versao, observacoes: f.observacoes, autorizado: f.autorizado, autorizado_por: f.autorizado_por,
    });
    carregarNoEditor(novo);
    await carregarLista();
    toast(f.autorizado ? "Salvo e enviado para publicação pela área central." : "Alterações salvas (rascunho).", "ok");
  } catch (err) {
    if (err.status === 409) {
      if (confirm(`${err.message}\n\nRecarregar agora? (suas alterações não salvas serão perdidas — use “Alterações” para copiá-las antes)`)) {
        estado.base = null;
        abrirServico(s.id_servico);
      }
    } else toast(err.message, "erro");
  } finally {
    btn.disabled = false;
  }
}

async function acaoAdmin(url, corpo, msg) {
  const base = estado.base;
  estado.base = null; // a ação recarrega o serviço; evita o aviso de "não salvo"
  try {
    const novo = await api("POST", url, corpo);
    carregarNoEditor(novo);
    await carregarLista();
    toast(msg, "ok");
  } catch (err) {
    estado.base = base;
    toast(err.message, "erro");
  }
}

function marcarPublicado() {
  if (temPendencias()) return toast("Salve ou descarte as alterações pendentes antes.", "erro");
  if (!confirm("Confirma que o conteúdo já foi atualizado manualmente no Portal MG?")) return;
  acaoAdmin(`/api/servicos/${estado.atual.id_servico}/publicado`, undefined, "Marcado como publicado.");
}

function descartar() {
  if (!confirm("Descartar TODAS as edições deste serviço e voltar ao conteúdo atual do Portal MG? (fica registrado no histórico)")) return;
  acaoAdmin(`/api/servicos/${estado.atual.id_servico}/descartar`, undefined, "Edições descartadas.");
}

function ressincronizar() {
  if (temPendencias() && !confirm("Há alterações não salvas que serão perdidas. Continuar?")) return;
  acaoAdmin(`/api/servicos/${estado.atual.id_servico}/sincronizar`, undefined, "Serviço sincronizado com o Portal MG.");
}

function devolver() {
  const form = el("form", {},
    el("label", {}, "Motivo / orientações para a área", el("textarea", { name: "motivo", rows: 5, required: true, minlength: 3 })),
    el("div", {}, el("button", { class: "btn primario", type: "submit" }, "Devolver")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    $("#dialogo").close();
      acaoAdmin(`/api/servicos/${estado.atual.id_servico}/devolver`, { motivo: form.motivo.value }, "Serviço devolvido à área.");
  });
  dialogo("Devolver à área responsável", form);
}

async function abrirHistorico() {
  try {
    const h = await api("GET", `/api/servicos/${estado.atual.id_servico}/historico`);
    dialogo("Histórico", h.length ? el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Data"), el("th", {}, "Usuário"), el("th", {}, "Ação"), el("th", {}, "Detalhe"))),
      el("tbody", {}, ...h.map((r) => el("tr", {},
        el("td", {}, dataBR(r.criado_em)), el("td", {}, r.usuario_nome || "—"), el("td", {}, ACOES[r.acao] || r.acao),
        el("td", {}, [r.autorizado_por ? `Responsável: ${r.autorizado_por}` : "", r.nota || ""].filter(Boolean).join(" — ")))))
    ) : el("p", { class: "muted" }, "Sem registros."));
  } catch (err) { toast(err.message, "erro"); }
}

/* ---------------------------------------------------------------- sincronização geral */
let timerSync = null;
async function acompanharSync(avisarFim = true) {
  clearTimeout(timerSync);
  try {
    const st = await api("GET", "/api/sincronizar");
    const box = $("#sync-status");
    box.hidden = !st.rodando;
    $("#btn-sync").disabled = st.rodando;
    if (st.rodando) {
      box.textContent = `Sincronizando ${st.feitos}/${st.total}${st.erros ? ` · ${st.erros} erro(s)` : ""}…`;
      timerSync = setTimeout(() => acompanharSync(true), 2000);
    } else if (avisarFim && st.fim) {
      await carregarLista();
      if (estado.atual && !temPendencias()) abrirServico(estado.atual.id_servico);
      toast(`Sincronização concluída: ${st.total - st.erros} ok${st.erros ? `, ${st.erros} com erro` : ""}.`, st.erros ? "erro" : "ok");
    }
  } catch { /* silencioso */ }
}

$("#btn-sync").addEventListener("click", async () => {
  if (!confirm("Buscar novamente todos os serviços na API do Portal MG?\n\nServiços com edições em andamento NÃO são sobrescritos — apenas a referência “Portal MG (atual)” é atualizada.")) return;
  try {
    await api("POST", "/api/sincronizar");
    acompanharSync(true);
  } catch (err) { toast(err.message, "erro"); }
});

/* ---------------------------------------------------------------- usuários (admin) */
$("#btn-usuarios").addEventListener("click", abrirUsuarios);

async function abrirUsuarios() {
  try {
    const lista = await api("GET", "/api/usuarios");
    const nomes = Object.fromEntries(estado.servicos.map((s) => [s.id_servico, s.nome || `Serviço ${s.id_servico}`]));
    dialogo("Usuários", el("div", {},
      el("div", { style: "margin-bottom:12px" }, el("button", { class: "btn primario", onclick: () => formUsuario() }, "+ Novo usuário")),
      el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Nome"), el("th", {}, "E-mail"), el("th", {}, "Perfil"), el("th", {}, "Acesso"), el("th", {}, "Último acesso"), el("th", {}, ""))),
        el("tbody", {}, ...lista.map((u) => el("tr", { style: u.ativo ? "" : "opacity:.55" },
          el("td", {}, u.nome, u.ativo ? "" : " (inativo)"), el("td", {}, u.email),
          el("td", {}, u.perfil === "admin" ? "Área central (admin)" : "Área fim (editor)"),
          el("td", { title: (u.servicos || []).map((i) => nomes[i] || i).join("\n") }, u.perfil === "admin" || u.servicos === null ? "Todos os serviços" : `${u.servicos.length} serviço(s)`),
          el("td", {}, dataBR(u.ultimo_login)),
          el("td", {}, el("button", { class: "btn pequeno", onclick: () => formUsuario(u) }, "Editar"))))))));
  } catch (err) { toast(err.message, "erro"); }
}

function formUsuario(u) {
  const novo = !u;
  u = u || { nome: "", email: "", perfil: "editor", servicos: [], ativo: true };
  const todos = el("input", { type: "checkbox", name: "todos" });
  todos.checked = u.servicos === null;
  const filtro = el("input", { type: "search", placeholder: "Filtrar serviços…" });
  const marcados = new Set(u.servicos || []);
  const caixas = estado.servicos.map((s) => {
    const cb = el("input", { type: "checkbox", value: s.id_servico });
    cb.checked = marcados.has(s.id_servico);
    return el("label", { "data-busca": `${s.id_servico} ${s.nome || ""}`.toLowerCase() }, cb, `${s.nome || "Serviço"} (#${s.id_servico})`);
  });
  const selecao = el("div", { class: "selecao-servicos" }, ...caixas);
  filtro.addEventListener("input", () => caixas.forEach((c) => (c.hidden = !c.dataset.busca.includes(filtro.value.toLowerCase()))));
  const perfil = el("select", { name: "perfil" },
    el("option", { value: "editor" }, "Área fim (editor) — edita e autoriza"),
    el("option", { value: "admin" }, "Área central (admin) — tudo + publicar, sincronizar, usuários"));
  perfil.value = u.perfil;
  const blocoServicos = el("div", { style: "display:grid;gap:6px" },
    el("label", { style: "display:flex;gap:8px;align-items:center" }, todos, "Acesso a todos os serviços"),
    filtro, selecao);
  const ajustar = () => {
    blocoServicos.hidden = perfil.value === "admin";
    selecao.hidden = filtro.hidden = todos.checked;
  };
  perfil.addEventListener("change", ajustar);
  todos.addEventListener("change", ajustar);
  const ativo = el("input", { type: "checkbox", name: "ativo" });
  ativo.checked = u.ativo;

  const form = el("form", {},
    el("label", {}, "Nome", el("input", { name: "nome", required: true, value: u.nome })),
    el("label", {}, "E-mail", el("input", { name: "email", type: "email", required: true, value: u.email })),
    el("label", {}, "Perfil", perfil),
    blocoServicos,
    el("label", {}, novo ? "Senha inicial (mínimo 10 caracteres)" : "Nova senha (deixe em branco para manter)",
      el("input", { name: "senha", type: "password", minlength: 10, required: novo, autocomplete: "new-password" })),
    el("label", { style: "display:flex;gap:8px;align-items:center" }, ativo, "Usuário ativo"),
    el("div", { style: "display:flex;gap:8px" },
      el("button", { class: "btn primario", type: "submit" }, "Salvar"),
      el("button", { class: "btn", type: "button", onclick: abrirUsuarios }, "Voltar")));
  ajustar();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const servicos = perfil.value === "admin" || todos.checked ? null
      : caixas.map((c) => c.querySelector("input")).filter((c) => c.checked).map((c) => Number(c.value));
    if (servicos && !servicos.length && !confirm("Nenhum serviço selecionado: o usuário não verá nenhum serviço. Continuar?")) return;
    const corpo = { nome: form.nome.value, email: form.email.value, perfil: perfil.value, servicos, ativo: ativo.checked, senha: form.senha.value || null };
    try {
      await api(novo ? "POST" : "PUT", novo ? "/api/usuarios" : `/api/usuarios/${u.id}`, corpo);
      toast("Usuário salvo.", "ok");
      abrirUsuarios();
    } catch (err) { toast(err.message, "erro"); }
  });
  dialogo(novo ? "Novo usuário" : `Editar usuário — ${u.nome}`, form);
}

/* ---------------------------------------------------------------- início */
iniciar();
