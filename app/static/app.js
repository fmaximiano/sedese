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
  ["aguardando_publicacao", "📥 Enviados para publicação"],
  ["em_edicao", "Em edição"],
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
  admin: false,            // administrador logado (área central)
  loginHabilitado: false,
  ident: { responsavel: "", unidade: "", email: "" }, // quem está editando (lembrado neste navegador)
  unidades: [],            // unidades da SEDESE agrupadas (página "Quem é Quem")
  nomesUnidades: new Set(),
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

/* ---------------------------------------------------------------- identificação (o sistema não tem login) */
const EMAIL_SEDESE = /^[A-Za-z0-9._%+-]+@social\.mg\.gov\.br$/i;
const CHAVE_IDENT = "sedese.identificacao";

function carregarIdent() {
  const vazio = { responsavel: "", unidade: "", email: "" };
  try { return { ...vazio, ...JSON.parse(localStorage.getItem(CHAVE_IDENT) || "{}") }; } catch { return vazio; }
}
function guardarIdent() {
  try { localStorage.setItem(CHAVE_IDENT, JSON.stringify(estado.ident)); } catch { /* navegador sem armazenamento */ }
}
function errosIdent(i = estado.ident) {
  const e = {};
  if ((i.responsavel || "").trim().length < 3) e.responsavel = "Informe o nome do responsável.";
  if (!estado.nomesUnidades.has(i.unidade)) e.unidade = "Selecione a unidade na lista.";
  if (!EMAIL_SEDESE.test((i.email || "").trim())) e.email = "Use o e-mail institucional (terminado em @social.mg.gov.br).";
  return e;
}
const identValida = () => Object.keys(errosIdent()).length === 0;
const identPayload = () => ({
  responsavel: estado.ident.responsavel.trim(), unidade: estado.ident.unidade, email: estado.ident.email.trim().toLowerCase(),
});

/** Campos Responsável / Unidade / E-mail, ligados a estado.ident e lembrados neste navegador. */
function camposIdentificacao() {
  const erro = (k) => el("span", { class: "erro-campo", "data-erro": k });
  const resp = el("input", { type: "text", name: "responsavel", maxlength: 200, required: true, autocomplete: "name", placeholder: "Nome completo" });
  resp.value = estado.ident.responsavel;
  const unid = el("select", { name: "unidade", required: true },
    el("option", { value: "" }, "Selecione a unidade…"),
    ...estado.unidades.map((g) => el("optgroup", { label: g.grupo }, ...g.unidades.map((u) => el("option", { value: u }, u)))));
  unid.value = estado.nomesUnidades.has(estado.ident.unidade) ? estado.ident.unidade : "";
  const email = el("input", { type: "email", name: "email", maxlength: 200, required: true, autocomplete: "email", placeholder: "nome@social.mg.gov.br" });
  email.value = estado.ident.email;
  const box = el("div", { class: "ident-grade" },
    el("label", {}, el("span", {}, "Responsável ", el("b", { class: "obrigatorio" }, "*")), resp, erro("responsavel")),
    el("label", {}, el("span", {}, "Unidade ", el("b", { class: "obrigatorio" }, "*")), unid, erro("unidade")),
    el("label", {}, el("span", {}, "E-mail institucional ", el("b", { class: "obrigatorio" }, "*")), email, erro("email")));
  const atualizar = () => {
    estado.ident = { responsavel: resp.value, unidade: unid.value, email: email.value };
    guardarIdent();
    if (box.dataset.validado) mostrarErrosIdent(box);
  };
  resp.addEventListener("input", atualizar);
  email.addEventListener("input", atualizar);
  email.addEventListener("blur", () => mostrarErrosIdent(box, ["email"]));
  unid.addEventListener("change", atualizar);
  return box;
}

function mostrarErrosIdent(box, apenas) {
  if (!apenas) box.dataset.validado = "1";
  const erros = errosIdent();
  box.querySelectorAll("[data-erro]").forEach((sp) => {
    const k = sp.dataset.erro;
    if (apenas && !apenas.includes(k)) return;
    sp.textContent = erros[k] || "";
    box.querySelector(`[name=${k}]`).setAttribute("aria-invalid", String(!!erros[k]));
  });
  return Object.keys(erros).length === 0;
}

/** Garante a identificação antes de gravar: valida o bloco da tela ou pede num diálogo. */
function exigirIdentificacao() {
  return new Promise((resolve) => {
    if (identValida()) return resolve(identPayload());
    const box = $("#envio .ident-grade");
    if (box) {
      mostrarErrosIdent(box);
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Preencha responsável, unidade e e-mail institucional.", "erro");
      return resolve(null);
    }
    const campos = camposIdentificacao();
    const form = el("form", { novalidate: true },
      el("p", { class: "muted" }, "Identifique-se para que a ação fique registrada no histórico."), campos,
      el("div", {}, el("button", { class: "btn primario", type: "submit" }, "Continuar")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mostrarErrosIdent(campos)) return;
      resolve(identPayload());
      $("#dialogo").close();
    });
    dialogo("Identificação", form).addEventListener("close", () => resolve(null), { once: true });
  });
}

async function iniciar() {
  estado.ident = carregarIdent();
  const [cfg, unidades] = await Promise.all([
    api("GET", "/api/config").catch(() => ({})),
    api("GET", "/api/unidades-sedese").catch(() => []),
  ]);
  estado.unidades = unidades;
  estado.nomesUnidades = new Set(unidades.flatMap((g) => g.unidades));
  aplicarPerfil(cfg);
  await carregarLista();
  if (estado.admin) {
    focarEnviados();
    acompanharSync(false);
  }
  abrirPelaURL();
}

/* ---------------------------------------------------------------- administrador */
function aplicarPerfil(cfg) {
  estado.admin = !!cfg.admin;
  estado.loginHabilitado = !!cfg.login_habilitado;
  document.body.classList.toggle("modo-admin", estado.admin);
  document.querySelectorAll(".so-admin").forEach((n) => (n.hidden = !estado.admin));
  $("#btn-entrar").hidden = estado.admin || !estado.loginHabilitado;
  $("#btn-sair").title = estado.admin ? `Sair (${cfg.admin_nome})` : "";
  if (estado.admin && cfg.portal_configurado === false) {
    toast("Variáveis do Portal MG não configuradas no Railway — a sincronização está desativada.", "erro");
  }
}

/** Mostra os serviços enviados para publicação (se houver). */
function focarEnviados() {
  if (estado.servicos.some((x) => x.status === "aguardando_publicacao")) {
    estado.filtro = "aguardando_publicacao";
    desenharLista();
  }
}

async function trocarPerfil() {
  const f = formEnvio();
  aplicarPerfil(await api("GET", "/api/config"));
  await carregarLista();
  if (!estado.admin && estado.filtro === "aguardando_publicacao") estado.filtro = "todos";
  if (estado.admin) {
    focarEnviados();
    acompanharSync(false);
  }
  if (!estado.atual) return desenharLista();
  if (!estado.admin && !estado.servicos.some((x) => x.id_servico === estado.atual.id_servico)) {
    estado.base = null; // o serviço deixou de ser visível sem o login
    location.hash = "";
    return;
  }
  desenharServico(); // mantém a edição em andamento
  $("#f-observacoes").value = f.observacoes;
  $("#f-autorizado").checked = f.autorizado;
  atualizarPendente();
}

$("#btn-entrar").addEventListener("click", () => {
  const form = el("form", {},
    el("p", { class: "muted", style: "margin:0" }, "Acesso exclusivo do administrador da área central."),
    el("label", {}, "E-mail", el("input", { type: "email", name: "email", required: true, autocomplete: "username" })),
    el("label", {}, "Senha", el("input", { type: "password", name: "senha", required: true, autocomplete: "current-password" })),
    el("p", { class: "erro", role: "alert" }),
    el("div", {}, el("button", { class: "btn primario", type: "submit" }, "Entrar")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("POST", "/api/login", { email: form.email.value, senha: form.senha.value });
      $("#dialogo").close();
      await trocarPerfil();
      toast("Você entrou como administrador.", "ok");
    } catch (err) {
      form.querySelector(".erro").textContent = err.message;
    }
  });
  dialogo("Entrar — administrador", form);
  form.email.focus();
});

$("#btn-sair").addEventListener("click", async () => {
  await api("POST", "/api/logout");
  clearTimeout(timerSync);
  $("#sync-status").hidden = true;
  await trocarPerfil();
  toast("Você saiu da área do administrador.");
});

$("#btn-enviados").addEventListener("click", () => {
  estado.filtro = "aguardando_publicacao";
  desenharLista();
  $("#lateral").classList.add("aberta");
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

  const n = contagem.aguardando_publicacao || 0;
  $("#n-enviados").textContent = n;
  $("#btn-enviados").classList.toggle("destaque", n > 0);
  $("#resumo").replaceChildren(...[
    ["em_edicao", "Em edição"], ["aguardando_publicacao", "Enviados para publicação"], ["publicado", "Publicados"],
    ["sincronizado", "Sem alterações"], ["problemas", "Com pendência técnica"],
  ].filter(([k]) => estado.admin || !["aguardando_publicacao", "problemas"].includes(k)).map(([k, rot]) => el("div", { class: "card" }, el("div", { class: "num" }, contagem[k] || 0), el("div", { class: "muted" }, rot))));
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
    if (err.status === 404) {
      history.replaceState(null, "", estado.atual ? `#s/${estado.atual.id_servico}` : location.pathname);
      hashAnterior = location.hash;
      await carregarLista();
    }
  }
}

function carregarNoEditor(s) {
  estado.atual = s;
  estado.editado = clonar(s.editado);
  estado.base = { editado: clonar(s.editado), observacoes: s.observacoes || "", autorizado: s.autorizado };
  desenharServico();
  desenharLista();
  atualizarPendente();
}

/* ---------------------------------------------------------------- tela do serviço */
function formEnvio() {
  return {
    observacoes: $("#f-observacoes")?.value ?? "",
    autorizado: $("#f-autorizado")?.checked ?? false,
  };
}

function temPendencias() {
  if (!estado.atual || !estado.base) return false;
  const f = formEnvio();
  return !igual(estado.editado, estado.base.editado) || f.observacoes !== estado.base.observacoes || f.autorizado !== estado.base.autorizado;
}

function atualizarPendente() {
  $("#barra-pendente").hidden = !temPendencias();
  const n = $("#n-alteracoes");
  if (n) n.textContent = contarAlteracoes();
}

function desenharServico() {
  const s = estado.atual;
  estado.verificadores = [];
  $("#vazio").hidden = true;
  const art = $("#servico");
  art.hidden = false;

  const cab = el("header", { class: "cabecalho" },
    el("div", { class: "linha" },
      el("span", { class: `selo ${s.status}` }, STATUS[s.status]),
      el("span", {}, `Serviço nº ${s.id_servico}`),
      el("span", {}, `Sincronizado em ${dataBR(s.sincronizado_em)}`),
      s.atualizado_por ? el("span", {}, `Última edição: ${quem(s.atualizado_por, s.atualizado_unidade)}, ${dataBR(s.atualizado_em)}`) : null),
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
      estado.admin ? el("button", { class: "btn pequeno", onclick: () => ressincronizar() }, "Sincronizar agora") : null));
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

const quem = (nome, unidade) => (unidade ? `${nome} (${unidade})` : nome);

function painelEnvio() {
  const s = estado.atual;
  const autorizado = el("input", { type: "checkbox", id: "f-autorizado" });
  autorizado.checked = !!s.autorizado;
  autorizado.addEventListener("change", atualizarPendente);
  const obs = el("textarea", { id: "f-observacoes", rows: 3, maxlength: 5000, placeholder: "Contexto das alterações, prazos, normas que fundamentam a mudança…" });
  obs.value = s.observacoes || "";
  obs.addEventListener("input", atualizarPendente);

  const btnSalvar = el("button", { class: "btn primario grande", id: "btn-salvar", onclick: salvar }, "💾 Salvar");
  const acoesCentral = !estado.admin ? [] : [
    s.status === "aguardando_publicacao" ? el("button", { class: "btn ok", onclick: marcarPublicado, title: "Use depois de atualizar manualmente o Portal MG" }, "✔ Marcar como publicado no Portal MG") : null,
    s.status === "aguardando_publicacao" || s.status === "em_edicao" ? el("button", { class: "btn", onclick: devolver }, "↩ Devolver à área demandante") : null,
    el("button", { class: "btn", onclick: ressincronizar, title: "Busca a versão atual deste serviço no Portal MG" }, "⟳ Ressincronizar"),
    s.status !== "sincronizado" ? el("button", { class: "btn perigo", onclick: descartar }, "Descartar edições") : null,
  ];

  return el("section", { class: "secao envio", id: "envio" },
    el("div", { class: "secao-titulo" }, "Envio para a área central da SEDESE"),
    el("div", { class: "secao-corpo" },
      el("div", { class: "envio-grade" }, el("label", {}, "Observações para a área central", obs)),
      el("div", { class: "autorizacao" },
        autorizado,
        el("div", { style: "flex:1;display:grid;gap:4px" },
          el("label", { for: "f-autorizado" }, "Autorizo a publicação destas informações no Portal MG"),
          el("span", { class: "muted", style: "font-size:13px" },
            "Ao marcar, a área declara que o conteúdo foi revisado e pode ser publicado. Sem a marcação, as alterações ficam salvas como rascunho (“Em edição”)."),
          s.autorizado && s.autorizado_em
            ? el("span", { class: "muted", style: "font-size:13px" },
              `Autorizado por ${quem(s.autorizado_por, s.autorizado_unidade)}${s.autorizado_email ? ` · ${s.autorizado_email}` : ""} em ${dataBR(s.autorizado_em)}.`)
            : null,
        )),
      ...(estado.admin
        ? [el("p", { class: "muted", style: "margin:14px 0 0;font-size:13px" },
          "Você está logado como administrador: as gravações ficam registradas em seu nome.")]
        : [el("h3", { class: "ident-titulo" }, "Responsável pelas informações"),
          el("p", { class: "muted", style: "margin:0 0 8px;font-size:13px" },
            "Obrigatório para salvar. Fica registrado no histórico e é lembrado neste navegador. ",
            "Ao salvar com a autorização marcada, o serviço vai para a área central e sai desta lista até ser publicado ou devolvido."),
          camposIdentificacao()]),
      el("div", { class: "envio-acoes" }, btnSalvar),
      estado.admin ? el("div", { class: "central" },
        el("span", { class: "central-rotulo" }, "Administrador:"), ...acoesCentral) : null,
    ));
}

function irParaSalvar() {
  $("#envio")?.scrollIntoView({ behavior: "smooth", block: "end" });
}
$("#btn-ir-salvar").addEventListener("click", irParaSalvar);

async function salvar() {
  const s = estado.atual;
  const f = formEnvio();
  if (!f.autorizado && !temPendencias()) return toast("Nada para salvar.");
  const identificacao = estado.admin ? undefined : await exigirIdentificacao();
  if (!estado.admin && !identificacao) return;
  if (f.autorizado && !estado.admin
    && !confirm("Enviar para publicação?\n\nO serviço vai para a área central e deixa de aparecer nesta lista até ser publicado ou devolvido.")) return;
  const btn = $("#btn-salvar");
  btn.disabled = true;
  try {
    const novo = await api("PUT", `/api/servicos/${s.id_servico}`, {
      editado: estado.editado, versao: s.versao, observacoes: f.observacoes, autorizado: f.autorizado, identificacao,
    });
    if (novo.enviado) {
      estado.base = null;
      location.hash = "";
      await carregarLista();
      toast("Enviado para a área central. Obrigado! O serviço volta a aparecer depois de publicado ou devolvido.", "ok");
      return;
    }
    carregarNoEditor(novo);
    await carregarLista();
    toast(f.autorizado ? "Salvo e mantido em “Enviados para publicação”." : "Alterações salvas (rascunho).", "ok");
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

async function marcarPublicado() {
  if (temPendencias()) return toast("Salve ou descarte as alterações pendentes antes.", "erro");
  if (!confirm("Confirma que o conteúdo já foi atualizado manualmente no Portal MG?")) return;
  acaoAdmin(`/api/servicos/${estado.atual.id_servico}/publicado`, undefined, "Marcado como publicado.");
}

function descartar() {
  if (!confirm("Descartar TODAS as edições deste serviço e voltar ao conteúdo atual do Portal MG? (a versão descartada fica no histórico)")) return;
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
    acaoAdmin(`/api/servicos/${estado.atual.id_servico}/devolver`, { motivo: form.motivo.value }, "Serviço devolvido à área demandante.");
  });
  dialogo("Devolver à área demandante", form);
}

async function abrirHistorico() {
  try {
    const h = await api("GET", `/api/servicos/${estado.atual.id_servico}/historico`);
    dialogo("Histórico", h.length ? el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Data"), el("th", {}, "Responsável"), el("th", {}, "Ação"), el("th", {}, "Detalhe"))),
      el("tbody", {}, ...h.map((r) => el("tr", {},
        el("td", {}, dataBR(r.criado_em)),
        el("td", {}, r.usuario_nome || "—",
          r.unidade ? el("div", { class: "muted", style: "font-size:12.5px" }, r.unidade) : null,
          r.email ? el("div", { class: "muted", style: "font-size:12.5px" }, r.email) : null),
        el("td", {}, ACOES[r.acao] || r.acao),
        el("td", {}, r.nota || ""))))
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

/* ---------------------------------------------------------------- início */
iniciar();
