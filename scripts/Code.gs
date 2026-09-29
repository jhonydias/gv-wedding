/**
 * Gisele & Victor — backend em Google Apps Script.
 * Task 10. Substitui o backend parcial da task 06.
 *
 * Três frentes num serviço só:
 *   1. catálogo de presentes e disponibilidade   (doGet)
 *   2. confirmação de presença e reserva de presente (doPost)
 *   3. campanha de e-mail para quem confirmou     (gatilho diário)
 *
 * ---------------------------------------------------------------------------
 * DEPLOY: ver README-backend.md. Resumo:
 *   1. rode `configurarPlanilha()` uma vez  (cria as abas)
 *   2. preencha a aba `Config`
 *   3. Implantar → App da Web → Executar como: eu · Acesso: QUALQUER PESSOA
 *   4. rode `instalarGatilhos()` uma vez
 *
 * CORS: o Apps Script NÃO responde ao preflight OPTIONS. Por isso o front envia
 * `Content-Type: text/plain` com JSON no corpo. NÃO troque para application/json.
 * ---------------------------------------------------------------------------
 */

// ============================================================ configuração

const ABAS = {
    PRESENTES: 'Presentes',
    PAGAMENTOS: 'Pagamentos',
    CONVIDADOS: 'Convidados',
    CONFIG: 'Config',
    LOG: 'Log',
};

/**
 * Categorias dos presentes, gravadas na coluna `faixa` (o nome ficou da task 17, quando a
 * faixa era derivada do valor). Desde 29/09/2026 os noivos escolhem a categoria no painel.
 * Espelha `FAIXAS` de src/data/presentes.ts e o `tools/catalogo.mjs`: mudou lá, muda aqui.
 */
const CATEGORIAS = ['salvador', 'gisele', 'victor', 'ruth', 'resenha'];

/** Categoria como pode ter sido digitada à mão na planilha: sem espaço, minúscula. */
function categoriaDe_(v) {
    return String(v || '').trim().toLowerCase();
}

const COLUNAS = {
    // Colunas novas entram SEMPRE no fim: a planilha em uso já tem as antigas, e
    // `garantirEsquema_()` só acrescenta o que falta à direita (task 22 §5.1).
    Presentes: ['id', 'nome', 'valor', 'faixa', 'imagem', 'descricao', 'ativo', 'cotas', 'ordem', 'valor_livre'],
    Pagamentos: [
        'id', 'presente_id', 'nome', 'contato', 'valor', 'status', 'criado_em', 'confirmado_em',
        // task 22: Mercado Pago
        'canal', 'expira_em', 'mp_payment_id', 'mp_status', 'mp_status_detail', 'metodo',
        'parcelas', 'valor_pago', 'recado', 'atualizado_em', 'conciliado_em', 'alerta',
    ],
    // `acompanhantes`, `restricao` e `descadastrado` não são mais usados (o site não pede
    // acompanhantes nem restrição, e não há descadastro), mas FICAM: as linhas são gravadas
    // por posição, e tirar uma coluna daqui desalinharia tudo numa planilha que já as tem.
    // `protocolo` é o código que o convidado vê como "Sua confirmação: GV-0001".
    Convidados: [
        'protocolo', 'nome', 'contato', 'comparece', 'acompanhantes', 'total_pessoas',
        'restricao', 'recado', 'criado_em', 'atualizado_em', 'mesa',
        'emails_enviados', 'descadastrado',
    ],
    Config: ['chave', 'valor'],
    Log: ['carimbo', 'nivel', 'acao', 'detalhe'],
};

/**
 * URL /exec da implantação em uso. Não é segredo: está no HTML do site (PUBLIC_BACKEND_URL).
 * Vai no `notification_url` do Mercado Pago. `ScriptApp.getService().getUrl()` não serve:
 * pode devolver a URL /dev ou a de outra implantação. Declarada ANTES do CONFIG_PADRAO,
 * que a usa na carga do script.
 */
const BACKEND_URL_PADRAO =
    'https://script.google.com/macros/s/AKfycbxZBcsoztmV7OZeVOwaMcevRAmbSidh6IPXlugjLwpubqRoH14e3zoT3KNXQZNK2QnCxg/exec';

/** Padrões da aba Config. `configurarPlanilha()` grava estes valores. */
const CONFIG_PADRAO = [
    // Data, hora e prazo: texto com offset, igual ao `event.ts`. Na planilha, a célula tem
    // de ficar como TEXTO; se o Sheets converter para data, o `new Date()` perde o offset.
    ['evento_quando', '2027-01-16T20:00:00-03:00'],
    ['evento_local', 'Espaço FRA'],
    ['evento_endereco', 'R. Cônego Jerônimo Pimentel, 124 - Umarizal, Belém - PA, 66055-000'],
    // ⚠️ Só vale para planilha com a Config VAZIA: `configurarPlanilha()` não sobrescreve
    // ajuste existente. Numa planilha já semeada, editar a célula `site_url` à mão (task 23).
    ['site_url', 'https://giseleevictor.com.br'],
    // A conta dona do script: é ela que envia os e-mails e recebe o aviso de cada RSVP.
    ['email_noivos', 'giseleevictorcasamento@gmail.com'],
    ['rsvp_ate', '2026-11-16T23:59:59-03:00'],
    // Referência: o BR Code é gerado no build com PUBLIC_PIX_CHAVE, que tem de ser esta.
    ['pix_chave', '312c7e14-437d-44fe-a588-9f4b26d32792'],
    // ⚠️ TRUE = nada é enviado de verdade. Só vire para FALSE com autorização dos noivos.
    ['modo_simulacao', 'TRUE'],
    ['lote_email_max', '80'],
    // Task 22. `pix` = Mercado Pago desligado (o site usa o Pix estático); `teste` = só
    // quem abre o site com ?teste=<mp_chave_teste> chega ao checkout; `mercadopago` = todos.
    ['pagamento_modo', 'pix'],
    ['backend_url', BACKEND_URL_PADRAO],
    ['reserva_minutos', '30'],
    ['parcelas_max', '12'],
    ['valor_livre_max', '5000'],
];

const LIMITES = {
    LOCK_MS: 10000,
    RATE_MAX: 3,
    RATE_JANELA_MS: 5 * 60 * 1000,
    IDEMPOTENCIA_MS: 24 * 60 * 60 * 1000,
    CACHE_CATALOGO_S: 300,
    CACHE_STATUS_S: 60,
    /** Folga na cota do Gmail: nunca gastar os últimos N envios do dia. */
    RESERVA_QUOTA: 5,
};

/** Campanhas, em dias relativos ao evento. Negativo = antes. */
const CAMPANHAS = [
    { chave: 'd30', dias: -30, assunto: 'Faltam 30 dias! Tudo que você precisa saber' },
    { chave: 'd7', dias: -7, assunto: 'É na próxima semana!' },
    { chave: 'd1', dias: -1, assunto: 'É amanhã! Te esperamos lá' },
    { chave: 'pos', dias: 3, assunto: 'Obrigado por estar com a gente' },
];

// ============================================================ acesso à planilha

function planilha_() {
    return SpreadsheetApp.getActiveSpreadsheet();
}

function aba_(nome) {
    const s = planilha_().getSheetByName(nome);
    if (!s) throw new Error(`Aba "${nome}" não existe. Rode configurarPlanilha().`);
    return s;
}

/**
 * Lê uma aba inteira como array de objetos, usando a primeira linha como cabeçalho.
 *
 * `_linha` é o número REAL da linha na planilha. Antes era contado depois de descartar as
 * linhas vazias: com uma confirmação apagada à mão no meio de `Convidados`, o reenvio de
 * outro convidado sobrescrevia o vizinho e a campanha marcava o e-mail na pessoa errada.
 */
function lerAba_(nome) {
    return lerTabela_(nome).linhas;
}

function config_() {
    const cache = CacheService.getScriptCache();
    const bruto = cache.get('config');
    if (bruto) return JSON.parse(bruto);

    const o = {};
    lerAba_(ABAS.CONFIG).forEach(function (l) { o[String(l.chave)] = String(l.valor); });
    cache.put('config', JSON.stringify(o), 120);
    return o;
}

const ehVerdadeiro_ = function (v) {
    return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1';
};

// ============================================================ log

function log_(nivel, acao, detalhe) {
    try {
        aba_(ABAS.LOG).appendRow([
            new Date(),
            nivel,
            acao,
            typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe),
        ]);
    } catch (e) {
        console.error('falha ao logar', e);
    }
}

// ============================================================ bootstrap

/**
 * Cria as 5 abas com cabeçalho. Rode UMA VEZ, no editor.
 * Não apaga aba existente — se já houver uma com o nome, só confere o cabeçalho.
 */
function configurarPlanilha() {
    const ss = planilha_();
    Object.keys(COLUNAS).forEach(function (nome) {
        let s = ss.getSheetByName(nome);
        if (!s) {
            s = ss.insertSheet(nome);
            s.appendRow(COLUNAS[nome]);
            s.setFrozenRows(1);
            s.getRange(1, 1, 1, COLUNAS[nome].length).setFontWeight('bold');
        }
    });

    // Preenche a Config só se estiver vazia, para não sobrescrever ajustes.
    const cfg = ss.getSheetByName(ABAS.CONFIG);
    if (cfg.getLastRow() <= 1) {
        CONFIG_PADRAO.forEach(function (par) { cfg.appendRow(par); });
    }

    log_('info', 'configurarPlanilha', 'abas verificadas');
    return 'ok. Confira a aba Config antes de publicar';
}

/** Instala o gatilho diário da campanha. Rode UMA VEZ. */
function instalarGatilhos() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'rodarCampanhas') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('rodarCampanhas').timeBased().atHour(9).everyDays(1).create();

    // Task 22 §6.4: varredura dos pagamentos do Mercado Pago. É o caminho que não depende
    // de webhook nem de o convidado ficar na página.
    ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'varrerPagamentos') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('varrerPagamentos').timeBased().everyMinutes(10).create();

    log_('info', 'instalarGatilhos', 'campanha diária às 9h; varredura de pagamentos a cada 10 min');
    return 'gatilhos instalados';
}

// ============================================================ leitura (doGet)

function doGet(e) {
    const acao = (e && e.parameter && e.parameter.acao) || 'ping';
    try {
        switch (acao) {
            case 'ping':
                return json_({
                    ok: true,
                    versao: '22.2',
                    hora: new Date().toISOString(),
                    pagamento: modoPagamento_(config_()),
                    mp: mpToken_() ? (PropertiesService.getScriptProperties().getProperty('mp_ambiente') || '?') : 'sem_token',
                });
            case 'catalogo':
                return json_({ ok: true, presentes: catalogo_() });
            case 'status':
                // `pagamento` diz ao site se o botão abre o checkout (mercadopago/teste) ou
                // o Pix estático (pix). Vem aqui porque a página já faz esta chamada (task 22).
                return json_({ ok: true, status: statusPresentes_(), pagamento: modoPagamento_(config_()) });
            case 'pagamento':
                return json_(pagamentoPublico_(e.parameter.ref));
            default:
                return json_({ ok: false, msg: 'Ação desconhecida.' });
        }
    } catch (err) {
        console.error(err);
        log_('erro', 'doGet:' + acao, String(err));
        return json_({ ok: false, msg: 'Erro ao processar.' });
    }
}

/**
 * Catálogo público. NUNCA inclui nada de Convidados, Pagamentos ou Config —
 * este endpoint é público por natureza.
 */
function catalogo_() {
    const cache = CacheService.getScriptCache();
    const bruto = cache.get('catalogo');
    if (bruto) return JSON.parse(bruto);

    const itens = lerAba_(ABAS.PRESENTES)
        .filter(function (p) { return ehVerdadeiro_(p.ativo) && String(p.id).trim() !== ''; })
        .map(function (p) {
            return {
                id: String(p.id).trim(),
                nome: String(p.nome),
                valor: Number(p.valor) || 0,
                faixa: categoriaDe_(p.faixa),
                imagem: String(p.imagem || ''),
                descricao: String(p.descricao || ''),
                cotas: p.cotas === '' || p.cotas === null ? null : Number(p.cotas),
                ordem: Number(p.ordem) || 0,
                valor_livre: ehVerdadeiro_(p.valor_livre),
            };
        })
        .sort(function (a, b) { return a.ordem - b.ordem; });

    cache.put('catalogo', JSON.stringify(itens), LIMITES.CACHE_CATALOGO_S);
    return itens;
}

/**
 * Disponibilidade DERIVADA dos pagamentos confirmados.
 *
 * Não existe coluna "comprado" na aba Presentes, e isso é deliberado: no modelo herdado
 * um campo escrito à mão tirou do ar dois presentes cujo único pagamento tinha sido
 * recusado. Só `confirmado` consome cota.
 */
function statusPresentes_() {
    const cache = CacheService.getScriptCache();
    const bruto = cache.get('status');
    if (bruto) return JSON.parse(bruto);

    const conta = contarUso_(lerAba_(ABAS.PAGAMENTOS), Date.now());

    const saida = {};
    catalogo_().forEach(function (p) {
        const d = disponibilidade_(p.cotas, conta[p.id]);
        saida[p.id] = {
            disponivel: d.disponivel,
            cotasRestantes: d.restantes,
            reservado: d.reservado,
        };
    });

    cache.put('status', JSON.stringify(saida), LIMITES.CACHE_STATUS_S);
    return saida;
}

/**
 * Conta, por presente, os pagamentos confirmados e as reservas ATIVAS (task 22 §5.3).
 * Reserva = checkout do Mercado Pago `pendente` com `expira_em` no futuro. O Pix manual
 * (task 10) nunca reservou, e continua não reservando.
 */
function contarUso_(linhas, agoraMs) {
    const c = {};
    linhas.forEach(function (p) {
        const id = String(p.presente_id).trim();
        if (!id) return;
        if (!c[id]) c[id] = { confirmados: 0, reservas: 0 };
        const st = String(p.status).toLowerCase();
        if (st === 'confirmado') c[id].confirmados++;
        else if (st === 'pendente' && String(p.canal) === 'mercadopago') {
            const exp = p.expira_em ? new Date(p.expira_em).getTime() : 0;
            if (exp > agoraMs) c[id].reservas++;
        }
    });
    return c;
}

/** `cotas` null ou <= 0 = ilimitado: nunca esgota e nunca reserva. */
function disponibilidade_(cotas, uso) {
    const u = uso || { confirmados: 0, reservas: 0 };
    const ilimitado = cotas === null || cotas === '' || !(Number(cotas) > 0);
    if (ilimitado) return { disponivel: true, restantes: null, reservado: false, ilimitado: true };
    const restantes = Math.max(0, Number(cotas) - u.confirmados);
    const livres = restantes - u.reservas;
    return {
        disponivel: livres > 0,
        restantes: restantes,
        reservado: livres <= 0 && restantes > 0,
        ilimitado: false,
    };
}

// ============================================================ escrita (doPost)

function doPost(e) {
    // Webhook do Mercado Pago (task 22 §6.5): antes de tudo, inclusive do parse, porque o
    // IPN antigo pode vir sem corpo. Responde 200 SEMPRE; quem reenvia é o Mercado Pago, e a
    // varredura cobre o que se perder.
    if (e && e.parameter && e.parameter.acao === 'mp_webhook') {
        try {
            mpWebhook_(e);
        } catch (err) {
            console.error(err);
            log_('erro', 'mp_webhook', String(err));
        }
        return json_({ ok: true });
    }

    // Ações dos noivos (task 17) pegam o lock só em volta da gravação: elas fazem rede
    // (pré-voo da imagem, disparo do deploy) e não podem prender o RSVP dos convidados.
    let dadosAdmin = null;
    try {
        dadosAdmin = JSON.parse(e.postData.contents);
    } catch (err) {
        dadosAdmin = null;
    }
    // Checkout (task 22): fora do lock global, que prenderia o RSVP durante a chamada ao
    // Mercado Pago. Ele pega o lock só para gravar a reserva.
    if (dadosAdmin && dadosAdmin.acao === 'checkout') {
        if (dadosAdmin._gotcha) return json_({ ok: true });
        try {
            return json_(checkout_(dadosAdmin));
        } catch (err) {
            console.error(err);
            log_('erro', 'checkout', String(err));
            return json_({ ok: false, motivo: 'indisponivel', msg: 'Não conseguimos abrir o pagamento agora.' });
        }
    }

    if (dadosAdmin && ACOES_ADMIN.indexOf(dadosAdmin.acao) !== -1) {
        try {
            return json_(admin_(dadosAdmin));
        } catch (err) {
            console.error(err);
            log_('erro', 'admin:' + dadosAdmin.acao, String(err));
            return json_({ ok: false, msg: 'Não conseguimos salvar agora. Tente de novo em instantes.' });
        }
    }

    const lock = LockService.getScriptLock();
    try {
        // Serializa a escrita. Sem lock, dois envios simultâneos podem escrever na mesma
        // linha e um some — o bug mais caro possível aqui.
        lock.waitLock(LIMITES.LOCK_MS);

        const dados = JSON.parse(e.postData.contents);

        // Bot: finge sucesso e descarta em silêncio.
        if (dados._gotcha) return json_({ ok: true });

        switch (dados.acao || 'rsvp') {
            case 'rsvp':
                return rsvp_(dados);
            case 'reservar':
                return reservar_(dados);
            default:
                return json_({ ok: false, msg: 'Ação desconhecida.' });
        }
    } catch (err) {
        console.error(err);
        log_('erro', 'doPost', String(err));
        return json_({ ok: false, msg: 'Não conseguimos registrar agora. Tente novamente.' });
    } finally {
        lock.releaseLock();
    }
}

// ---------------------------------------------------------------- RSVP

function limpar_(v, max) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function contatoValido_(v) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return true;
    const so = v.replace(/\D/g, '');
    return so.length === 10 || so.length === 11;
}

function rateLimitado_(chaveBruta) {
    const props = PropertiesService.getScriptProperties();
    const chave = 'rl_' + Utilities.base64EncodeWebSafe(String(chaveBruta).toLowerCase()).slice(0, 40);
    const agora = Date.now();
    const regs = JSON.parse(props.getProperty(chave) || '[]')
        .filter(function (t) { return agora - t < LIMITES.RATE_JANELA_MS; });
    if (regs.length >= LIMITES.RATE_MAX) return true;
    regs.push(agora);
    props.setProperty(chave, JSON.stringify(regs));
    return false;
}

function rsvp_(bruto) {
    const d = {
        nome: limpar_(bruto.nome, 80),
        contato: limpar_(bruto.contato, 120),
        comparece: limpar_(bruto.comparece, 5).toLowerCase(),
        restricao: limpar_(bruto.restricao, 300),
        recado: limpar_(bruto.recado, 500),
    };

    // Revalida TUDO no servidor: o cliente não é fonte de verdade.
    if (d.nome.length < 3) return json_({ ok: false, msg: 'Informe o nome completo.' });
    if (!contatoValido_(d.contato)) return json_({ ok: false, msg: 'Informe um e-mail ou celular válido.' });
    if (d.comparece !== 'sim' && d.comparece !== 'nao') {
        return json_({ ok: false, msg: 'Escolha se você vai ou não.' });
    }

    // Prazo (task 16 §3). É a camada que manda: o site estático pode ficar sem build depois
    // do prazo, e um POST direto nem passa pelo site.
    const cfg = config_();
    if (prazoEncerrado_(cfg)) {
        return json_({
            ok: false,
            msg: 'O prazo de confirmação encerrou em ' + prazoRsvp_(cfg) + '.',
        });
    }

    if (rateLimitado_(d.contato)) {
        return json_({ ok: false, msg: 'Muitas tentativas seguidas. Tente de novo em alguns minutos.' });
    }

    // Sem acompanhantes: cada confirmação é uma pessoa. Calculado aqui, nunca vindo do
    // cliente, e um `acompanhantes` num payload forjado é simplesmente ignorado.
    const total = d.comparece === 'sim' ? 1 : 0;

    const aba = aba_(ABAS.CONVIDADOS);
    const linhas = lerAba_(ABAS.CONVIDADOS);
    const agora = new Date();

    // Idempotência: mesmo contato + nome dentro de 24h ATUALIZA em vez de duplicar.
    for (let i = linhas.length - 1; i >= 0; i--) {
        const l = linhas[i];
        if (String(l.contato).toLowerCase() !== d.contato.toLowerCase()) continue;
        if (String(l.nome).toLowerCase() !== d.nome.toLowerCase()) continue;
        const quando = new Date(l.criado_em).getTime();
        if (isNaN(quando) || Date.now() - quando > LIMITES.IDEMPOTENCIA_MS) break;

        aba.getRange(l._linha, 1, 1, COLUNAS.Convidados.length).setValues([[
            l.protocolo, d.nome, d.contato, d.comparece, '', total,
            d.restricao, d.recado, l.criado_em, agora, l.mesa || '',
            l.emails_enviados || '', false,
        ]]);
        log_('info', 'rsvp:atualizado', l.protocolo);
        return json_({ ok: true, protocolo: String(l.protocolo), msg: 'Confirmação atualizada!' });
    }

    const protocolo = 'GV-' + String(aba.getLastRow()).padStart(4, '0');
    aba.appendRow([
        protocolo, d.nome, d.contato, d.comparece, '', total,
        d.restricao, d.recado, agora, agora, '', '', false,
    ]);

    enviarConfirmacao_(protocolo, d);
    notificarNoivos_(d, protocolo);
    log_('info', 'rsvp:novo', protocolo);

    return json_({ ok: true, protocolo: protocolo, msg: 'Presença confirmada!' });
}

function notificarNoivos_(d, protocolo) {
    const cfg = config_();
    const para = cfg.email_noivos;
    if (!para || para.indexOf('TODO') === 0) return;
    const vai = d.comparece === 'sim';
    const corpo = [
        'Confirmação: ' + protocolo,
        'Nome: ' + d.nome,
        'Contato: ' + d.contato,
        'Vai? ' + (vai ? 'SIM' : 'NÃO'),
        d.restricao ? 'Restrição: ' + d.restricao : '',
        d.recado ? 'Recado:\n' + d.recado : '',
    ].filter(Boolean).join('\n');

    enviarEmail_(para, (vai ? '[RSVP] ' : '[RSVP - não vai] ') + d.nome, corpo, null);
}

// ---------------------------------------------------------------- reserva de presente

function reservar_(bruto) {
    const presenteId = limpar_(bruto.presente_id, 60);
    const nome = limpar_(bruto.nome, 80);

    // Rejeita id inexistente: o modelo herdado aceitava linhas órfãs, e a planilha
    // acabou com 14 pagamentos sem produto nenhum.
    const presente = catalogo_().filter(function (p) { return p.id === presenteId; })[0];
    if (!presente) return json_({ ok: false, msg: 'Presente não encontrado.' });

    const st = statusPresentes_()[presenteId];
    if (st && !st.disponivel) {
        return json_({ ok: false, msg: 'Alguém acabou de presentear este item.' });
    }

    const agora = new Date();
    const t = lerTabela_(ABAS.PAGAMENTOS);
    t.aba.appendRow(linhaPara_(t.cab, {
        id: Utilities.getUuid(),
        presente_id: presenteId,
        nome: textoSeguro_(nome),
        contato: textoSeguro_(limpar_(bruto.contato, 120)),
        valor: presente.valor,
        status: 'pendente',
        criado_em: agora,
        // Task 22: o Pix manual não reserva cota (sem expira_em) e é confirmado à mão.
        canal: 'pix_manual',
        atualizado_em: agora,
    }));

    // O status muda; invalida o cache para o próximo visitante já ver.
    CacheService.getScriptCache().remove('status');
    log_('info', 'reservar', presenteId + ' por ' + (nome || '(anônimo)'));

    return json_({ ok: true, msg: 'Reserva registrada. Obrigado!' });
}

// ============================================================ presentes pelos noivos (task 17)

/**
 * Os noivos criam, editam e apagam presentes pela tela `/noivos/presentes` do site.
 * Tudo aqui exige a senha dos noivos. Ver tasks/17/task_text.md.
 */
const ACOES_ADMIN = [
    'entrar', 'listarPresentes', 'criarPresente', 'editarPresente', 'apagarPresente',
    'listarRecebidos', // task 22 §8
];

/**
 * Senha dos noivos: só o hash fica no código, porque o repositório é público.
 * Para trocar, rode no editor `definirSenhaNoivos('nova-senha')` (a partir de uma função
 * sua, ver o comentário dela). O valor gravado em PropertiesService passa a valer no lugar
 * deste.
 */
const SENHA_PADRAO = {
    sal: '1a489fed25c4f31e',
    hash: 'ac2259cb610f43e61e85ee8ae53a453e15ee97c797e346d3372dd615bac17cc5',
};

const ADMIN = {
    /** Senhas erradas toleradas na janela. O Apps Script não vê IP: o limite é global. */
    FALHAS_MAX: 5,
    JANELA_MS: 15 * 60 * 1000,
    IDEMPOTENCIA_S: 600,
    REPO: 'jhonydias/gv-wedding',
    WORKFLOW: 'deploy.yml',
};

function sha256Hex_(texto) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)
        .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
        .join('');
}

/** Comparação em tempo constante. */
function iguais_(a, b) {
    if (a.length !== b.length) return false;
    let dif = 0;
    for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return dif === 0;
}

function senhaConfere_(senha) {
    const props = PropertiesService.getScriptProperties();
    const sal = props.getProperty('admin_sal') || SENHA_PADRAO.sal;
    const hash = props.getProperty('admin_hash') || SENHA_PADRAO.hash;
    return iguais_(sha256Hex_(sal + String(senha || '')), hash);
}

/**
 * Troca a senha dos noivos. No editor não dá para passar argumento pelo botão Executar:
 * crie uma função `function trocar() { definirSenhaNoivos('nova-senha'); }`, rode, e
 * apague a função depois (para a senha não ficar escrita no projeto).
 */
function definirSenhaNoivos(senha) {
    if (!senha || String(senha).length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
    const sal = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    const props = PropertiesService.getScriptProperties();
    props.setProperty('admin_sal', sal);
    props.setProperty('admin_hash', sha256Hex_(sal + String(senha)));
    props.deleteProperty('admin_falhas');
    return 'senha trocada';
}

/**
 * Opcional: token fino do GitHub (só este repositório, só "Actions: Read and write").
 * Com ele, o presente aparece no site em ~3 min. Sem ele, a verificação agendada do
 * deploy.yml publica em até ~30 min. Mesmo esquema do definirSenhaNoivos para rodar.
 */
function definirTokenGithub(token) {
    PropertiesService.getScriptProperties().setProperty('github_token', String(token || '').trim());
    return 'token gravado';
}

/**
 * Rode UMA VEZ no editor depois de colar este arquivo: a task 17 usa UrlFetchApp (conferir
 * o link da foto e disparar o deploy), e o Google só pede essa autorização no editor.
 * Sem isso, o App da Web falha ao salvar presente.
 */
function autorizarNoivos() {
    const r = UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
    log_('info', 'autorizarNoivos', 'UrlFetchApp ok: ' + r.getResponseCode());
    return 'autorizado (' + r.getResponseCode() + ')';
}

function falhasRecentes_() {
    const agora = Date.now();
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('admin_falhas') || '[]')
        .filter(function (t) { return agora - t < ADMIN.JANELA_MS; });
}

function registrarFalha_() {
    const f = falhasRecentes_();
    f.push(Date.now());
    PropertiesService.getScriptProperties().setProperty('admin_falhas', JSON.stringify(f));
}

/** Ponto de entrada das ações dos noivos. Devolve objeto; o doPost serializa. */
function admin_(d) {
    if (falhasRecentes_().length >= ADMIN.FALHAS_MAX) {
        return { ok: false, motivo: 'bloqueado', msg: 'Muitas tentativas com a senha errada. Espere 15 minutos e tente de novo.' };
    }
    if (!senhaConfere_(d.senha)) {
        registrarFalha_();
        log_('aviso', 'admin:senha', 'senha errada em ' + d.acao); // nunca a senha tentada
        return { ok: false, motivo: 'senha', msg: 'Senha incorreta.' };
    }

    switch (d.acao) {
        case 'entrar':
            return { ok: true };
        case 'listarPresentes':
            return { ok: true, presentes: listarPresentes_() };
        case 'listarRecebidos':
            return { ok: true, recebidos: listarRecebidos_() };
    }

    let r;
    if (d.acao === 'criarPresente') r = criarPresente_(d);
    else if (d.acao === 'editarPresente') r = editarPresente_(d);
    else r = apagarPresente_(d);

    if (r.ok && !r._repetido) {
        CacheService.getScriptCache().removeAll(['catalogo', 'status']);
        r.publicacao = dispararDeploy_();
        lembrarPedido_(d.pedido_id, r);
    }
    delete r._repetido;
    return r;
}

// ---------------------------------------------------------------- leitura

/** Lê `Presentes` guardando o número REAL da linha, para editar e apagar o presente certo. */
function lerPresentes_() {
    return lerTabela_(ABAS.PRESENTES);
}

/** Mesma leitura, para qualquer aba: número REAL da linha, para escrever com segurança. */
function lerTabela_(nome) {
    const aba = aba_(nome);
    const valores = aba.getDataRange().getValues();
    const cab = valores[0].map(String);
    const linhas = [];
    for (let i = 1; i < valores.length; i++) {
        const l = valores[i];
        if (!l.some(function (c) { return c !== '' && c !== null; })) continue;
        const o = { _linha: i + 1 };
        cab.forEach(function (c, j) { o[c] = l[j]; });
        linhas.push(o);
    }
    return { aba: aba, cab: cab, linhas: linhas };
}

/** Hash curto do conteúdo da linha: controle de edição concorrente. */
function versaoDe_(p) {
    return sha256Hex_(JSON.stringify(COLUNAS.Presentes.map(function (c) { return String(p[c]); }))).slice(0, 12);
}

function contagemPagamentos_() {
    const c = {};
    lerAba_(ABAS.PAGAMENTOS).forEach(function (p) {
        const id = String(p.presente_id).trim();
        if (!id) return;
        if (!c[id]) c[id] = { pendente: 0, confirmado: 0, cancelado: 0, recusado: 0, expirado: 0, estornado: 0, total: 0 };
        const st = String(p.status).toLowerCase();
        if (c[id][st] !== undefined) c[id][st]++;
        c[id].total++;
    });
    return c;
}

function presenteDaLinha_(p, pagamentos) {
    const id = String(p.id).trim();
    return {
        id: id,
        nome: String(p.nome),
        valor: Number(p.valor) || 0,
        faixa: categoriaDe_(p.faixa),
        imagem: String(p.imagem || ''),
        descricao: String(p.descricao || ''),
        cotas: p.cotas === '' || p.cotas === null ? null : Number(p.cotas),
        ativo: ehVerdadeiro_(p.ativo),
        ordem: Number(p.ordem) || 0,
        pagamentos: pagamentos[id] || { pendente: 0, confirmado: 0, cancelado: 0, recusado: 0, expirado: 0, estornado: 0, total: 0 },
        valor_livre: ehVerdadeiro_(p.valor_livre),
        versao: versaoDe_(p),
    };
}

/** Todos os presentes, inclusive os fora do site. Contagem de pagamentos, nunca nomes. */
function listarPresentes_() {
    const pg = contagemPagamentos_();
    return lerPresentes_().linhas
        .filter(function (p) { return String(p.id).trim() !== ''; })
        .map(function (p) { return presenteDaLinha_(p, pg); })
        .sort(function (a, b) { return a.ordem - b.ordem; });
}

// ---------------------------------------------------------------- regras

/** Espelha `txidDe()` de src/lib/pix.ts. Mudou lá, muda aqui. */
function txidDe_(slug) {
    return ('GV' + String(slug).replace(/[^A-Za-z0-9]/g, '')).slice(0, 25);
}

function slugDe_(nome) {
    const s = String(nome)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '');
    return s || 'presente';
}

/**
 * Id livre: não colide com nenhum id da aba (inclusive os fora do site) NEM com o txid de
 * nenhum deles. O txid corta em 25 caracteres, então dois nomes longos que começam igual
 * dariam o mesmo txid e pagamentos indistinguíveis no extrato. Para o sufixo não cair
 * depois do corte, a base encurta até caber.
 */
function idLivre_(base, linhas) {
    const ids = {};
    const txids = {};
    linhas.forEach(function (p) {
        const id = String(p.id).trim();
        if (!id) return;
        ids[id] = true;
        txids[txidDe_(id)] = true;
    });
    const livre = function (c) { return !ids[c] && !txids[txidDe_(c)]; };
    if (livre(base)) return base;
    for (let n = 2; n < 1000; n++) {
        const suf = String(n);
        let b = base;
        while (b.replace(/[^a-z0-9]/g, '').length + suf.length > 23) b = b.slice(0, -1).replace(/-+$/, '');
        const cand = (b ? b + '-' : '') + suf;
        if (livre(cand)) return cand;
    }
    throw new Error('Sem id livre para ' + base);
}

/** Travessão vira dois-pontos, como no tools/catalogo.mjs (task 11). */
function semTravessao_(s) {
    return s.indexOf('—') === -1 ? s : s.replace(/\s*—\s*/g, ': ').replace(/[\s:]+$/, '').trim();
}

/** Célula que começa com = + - @ viraria fórmula na planilha. */
function textoSeguro_(s) {
    return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** Valida os campos do formulário. Igual para criar e editar. */
function validarPresente_(d) {
    const avisos = [];
    const erro = function (campo, msg) { return { ok: false, campo: campo, msg: msg }; };

    let nome = limpar_(d.nome, 200);
    let descricao = limpar_(d.descricao, 400);
    const nomeT = semTravessao_(nome);
    const descT = semTravessao_(descricao);
    if (nomeT !== nome || descT !== descricao) {
        avisos.push('Trocamos o travessão (—) por dois-pontos: o site não usa travessão.');
    }
    nome = nomeT;
    descricao = descT;

    if (nome.length < 2 || nome.length > 100) return erro('nome', 'Dê um nome ao presente, com até 100 letras.');
    if (descricao.length > 140) return erro('descricao', 'Use no máximo 140 caracteres na descrição.');

    const valor = Number(d.valor);
    if (!Number.isInteger(valor) || valor < 10 || valor > 20000) {
        return erro('valor', 'Use um valor em reais, sem centavos, entre R$ 10 e R$ 20.000.');
    }

    const imagemBruta = String(d.imagem || '').trim();
    if (imagemBruta.length > 2048) return erro('imagem', 'Esse link é longo demais.');
    if (imagemBruta && !/^https:\/\/\S+$/i.test(imagemBruta)) {
        return erro('imagem', 'O link da foto precisa começar com https://');
    }

    let cotas = '';
    if (d.cotas !== null && d.cotas !== undefined && d.cotas !== '') {
        cotas = Number(d.cotas);
        if (!Number.isInteger(cotas) || cotas < 1 || cotas > 50) {
            return erro('cotas', 'Escolha de 1 a 50 pessoas, ou "sem limite".');
        }
    }

    // Sem `categoria` só vem do painel antigo, ainda aberto num celular: no editar, a
    // categoria atual fica; no criar, pede para atualizar a página.
    const categoria = categoriaDe_(d.categoria);
    if (categoria && CATEGORIAS.indexOf(categoria) === -1) {
        return erro('categoria', 'Escolha uma categoria da lista.');
    }
    // Task 22 §5.4: o convidado escolhe o valor; `valor` vira o mínimo. Só faz sentido sem
    // limite de pessoas (uma "cota única" de valor livre não tem significado).
    const valorLivre = d.valor_livre === true;
    if (valorLivre && cotas !== '') {
        return erro('cotas', 'Com valor livre, escolha "Sem limite": cada pessoa dá quanto quiser.');
    }
    return {
        ok: true,
        avisos: avisos,
        campos: {
            nome: nome,
            valor: valor,
            faixa: categoria || null,
            imagem: imagemBruta,
            descricao: descricao,
            ativo: d.publicar !== false,
            cotas: cotas,
            valor_livre: valorLivre,
        },
    };
}

/**
 * Confere se o link da foto abre uma FOTO. O erro mais provável de quem copia do celular é
 * copiar o link da página do produto. Erro de rede não bloqueia: loja que recusa o Google
 * pode aceitar o runner do GitHub, que é quem baixa de verdade.
 */
function preVooImagem_(url) {
    try {
        const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
        const cab = r.getHeaders();
        const tipo = String(cab['Content-Type'] || cab['content-type'] || '');
        const cod = r.getResponseCode();
        if (cod >= 200 && cod < 300) {
            if (/^image\//i.test(tipo)) return { ok: true };
            if (/html/i.test(tipo)) {
                return {
                    ok: false,
                    msg: 'Esse link abre uma página, não uma foto. Na loja, toque e segure a foto do produto e escolha "Copiar endereço da imagem".',
                };
            }
        }
        return { ok: true, aviso: 'Não conseguimos conferir a foto agora (a loja respondeu ' + cod + '). Se ela não baixar, o presente aparece com o símbolo do casamento no lugar.' };
    } catch (e) {
        return { ok: true, aviso: 'Não conseguimos abrir o link da foto agora. Se ela não baixar, o presente aparece com o símbolo do casamento no lugar.' };
    }
}

// ---------------------------------------------------------------- escrita

function pedidoGuardado_(pedido) {
    if (!pedido) return null;
    const bruto = CacheService.getScriptCache().get('pedido_' + pedido);
    if (!bruto) return null;
    const r = JSON.parse(bruto);
    r._repetido = true;
    return r;
}

function lembrarPedido_(pedido, r) {
    if (!pedido) return;
    CacheService.getScriptCache().put('pedido_' + limpar_(pedido, 64), JSON.stringify(r), ADMIN.IDEMPOTENCIA_S);
}

/**
 * Grava com lock, uma vez por `pedido_id`. A conferência do pedido é DENTRO do lock: fora,
 * dois envios simultâneos do mesmo toque duplo passariam os dois.
 */
function gravarUmaVez_(pedidoBruto, fn) {
    const pedido = limpar_(pedidoBruto, 64);
    const lock = LockService.getScriptLock();
    lock.waitLock(LIMITES.LOCK_MS);
    try {
        const ja = pedidoGuardado_(pedido);
        if (ja) return ja;
        const r = fn();
        if (r.ok) lembrarPedido_(pedido, r);
        return r;
    } finally {
        lock.releaseLock();
    }
}

function linhaPara_(cab, o) {
    return cab.map(function (c) { return o[c] === undefined ? '' : o[c]; });
}

function avisoImagemRepetida_(imagem, linhas, idProprio) {
    if (!imagem) return null;
    const outro = linhas.filter(function (p) {
        return String(p.imagem).trim() === imagem && String(p.id).trim() !== idProprio;
    })[0];
    return outro ? 'Esta foto já é usada em "' + outro.nome + '". Confira se é a foto certa.' : null;
}

function criarPresente_(d) {
    const v = validarPresente_(d);
    if (!v.ok) return v;
    const c = v.campos;
    if (!c.faixa) return { ok: false, msg: 'Atualize a página: agora cada presente tem uma categoria.' };

    // Rede fora do lock.
    if (c.imagem) {
        const img = preVooImagem_(c.imagem);
        if (!img.ok) return { ok: false, campo: 'imagem', msg: img.msg };
        if (img.aviso) v.avisos.push(img.aviso);
    }

    return gravarUmaVez_(d.pedido_id, function () {
        const t = lerPresentes_();
        const rep = avisoImagemRepetida_(c.imagem, t.linhas, null);
        if (rep) v.avisos.push(rep);

        const id = idLivre_(slugDe_(c.nome), t.linhas);
        const ordem = t.linhas.reduce(function (m, p) { return Math.max(m, Number(p.ordem) || 0); }, 0) + 10;

        t.aba.appendRow(linhaPara_(t.cab, {
            id: id,
            nome: textoSeguro_(c.nome),
            valor: c.valor,
            faixa: c.faixa,
            imagem: c.imagem,
            descricao: textoSeguro_(c.descricao),
            ativo: c.ativo,
            cotas: c.cotas,
            ordem: ordem,
            valor_livre: c.valor_livre,
        }));
        log_('info', 'criarPresente', id + ' · ' + c.nome + ' · R$ ' + c.valor);
        return { ok: true, id: id, nome: c.nome, faixa: c.faixa, avisos: v.avisos };
    });
}

function editarPresente_(d) {
    const id = limpar_(d.id, 60);
    if (!id) return { ok: false, msg: 'Presente não informado.' };
    const v = validarPresente_(d);
    if (!v.ok) return v;
    const c = v.campos;

    // Pré-voo só se a foto mudou (e fora do lock).
    const antes = lerPresentes_().linhas.filter(function (p) { return String(p.id).trim() === id; })[0];
    if (c.imagem && (!antes || String(antes.imagem).trim() !== c.imagem)) {
        const img = preVooImagem_(c.imagem);
        if (!img.ok) return { ok: false, campo: 'imagem', msg: img.msg };
        if (img.aviso) v.avisos.push(img.aviso);
    }

    return gravarUmaVez_(d.pedido_id, function () {
        // Relê DENTRO do lock e acha pelo id, nunca pela posição: a planilha pode ter
        // mudado desde a listagem.
        const t = lerPresentes_();
        const p = t.linhas.filter(function (l) { return String(l.id).trim() === id; })[0];
        if (!p) return { ok: false, motivo: 'nao_existe', msg: 'Este presente não existe mais. Ele pode ter sido apagado.' };

        const pgs = contagemPagamentos_();
        if (versaoDe_(p) !== String(d.versao || '')) {
            return {
                ok: false,
                motivo: 'conflito',
                msg: 'Este presente foi alterado enquanto você editava. Carregamos a versão atual.',
                presente: presenteDaLinha_(p, pgs),
            };
        }

        const pg = pgs[id] || { pendente: 0, confirmado: 0, cancelado: 0, total: 0 };
        if (c.cotas !== '' && c.cotas < pg.confirmado) {
            return {
                ok: false,
                campo: 'cotas',
                msg: 'Já tem ' + pg.confirmado + ' pessoas que deram este presente. O mínimo é ' + pg.confirmado + '.',
            };
        }
        if (pg.pendente > 0 && Number(p.valor) !== c.valor) {
            v.avisos.push('Tem ' + pg.pendente + ' reserva(s) aguardando Pix com o valor antigo (R$ ' + p.valor + '). Quem reservou pode pagar esse valor.');
        }
        if (pg.pendente > 0 && c.cotas !== '' && c.cotas <= pg.confirmado) {
            v.avisos.push('Tem reserva aguardando Pix: se ela for paga, o presente passa do limite de pessoas.');
        }
        const rep = avisoImagemRepetida_(c.imagem, t.linhas, id);
        if (rep) v.avisos.push(rep);

        if (!c.faixa) c.faixa = categoriaDe_(p.faixa);
        const mudouFaixa = categoriaDe_(p.faixa) !== c.faixa;
        const ordem = mudouFaixa
            ? t.linhas.reduce(function (m, l) { return Math.max(m, Number(l.ordem) || 0); }, 0) + 10
            : p.ordem;

        t.aba.getRange(p._linha, 1, 1, t.cab.length).setValues([linhaPara_(t.cab, {
            id: id, // o id NUNCA muda: é o txid no extrato e a chave dos pagamentos
            nome: textoSeguro_(c.nome),
            valor: c.valor,
            faixa: c.faixa,
            imagem: c.imagem,
            descricao: textoSeguro_(c.descricao),
            ativo: c.ativo,
            cotas: c.cotas,
            ordem: ordem,
            // linhaPara_ grava a linha INTEIRA: coluna esquecida aqui seria apagada.
            valor_livre: c.valor_livre,
        })]);
        log_('info', 'editarPresente', id + ' · ' + JSON.stringify(c));
        return { ok: true, id: id, nome: c.nome, faixa: c.faixa, avisos: v.avisos };
    });
}

function apagarPresente_(d) {
    const id = limpar_(d.id, 60);
    if (!id) return { ok: false, msg: 'Presente não informado.' };

    return gravarUmaVez_(d.pedido_id, function () {
        const t = lerPresentes_();
        const p = t.linhas.filter(function (l) { return String(l.id).trim() === id; })[0];
        if (!p) return { ok: true, id: id, msg: 'Este presente já tinha sido apagado.' };

        // Qualquer pagamento, até cancelado, bloqueia: apagar deixaria linha órfã em
        // Pagamentos (task 10 §0.2.1). Conferido DENTRO do lock, senão um `reservar`
        // pode gravar entre a conferência e o deleteRow.
        const pg = contagemPagamentos_()[id];
        if (pg && pg.total > 0) {
            return {
                ok: false,
                motivo: 'tem_pagamento',
                pagamentos: pg,
                msg: 'Este presente tem pagamentos registrados e não pode ser apagado. Você pode tirá-lo do site.',
            };
        }

        // O desfazer: a linha inteira fica no Log.
        const copia = {};
        COLUNAS.Presentes.forEach(function (col) { copia[col] = p[col]; });
        log_('info', 'apagarPresente', JSON.stringify(copia));
        t.aba.deleteRow(p._linha);
        return { ok: true, id: id, nome: String(p.nome) };
    });
}

/**
 * Pede ao GitHub um deploy novo. Sem token, a verificação agendada do deploy.yml publica
 * sozinha em até ~30 min; o token só encurta a espera.
 */
function dispararDeploy_() {
    const token = PropertiesService.getScriptProperties().getProperty('github_token');
    if (!token) return 'agendada';
    try {
        const r = UrlFetchApp.fetch(
            'https://api.github.com/repos/' + ADMIN.REPO + '/actions/workflows/' + ADMIN.WORKFLOW + '/dispatches',
            {
                method: 'post',
                contentType: 'application/json',
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
                payload: JSON.stringify({ ref: 'main' }),
                muteHttpExceptions: true,
            },
        );
        if (r.getResponseCode() === 204) return 'disparada';
        log_('erro', 'dispararDeploy', r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
    } catch (e) {
        log_('erro', 'dispararDeploy', String(e));
    }
    return 'agendada';
}

// ============================================================ Mercado Pago (task 22)

/**
 * Pagamento pelo Checkout Pro, com confirmação automática. Ver tasks/22/task_text.md.
 *
 * Regra que sustenta tudo: o ÚNICO que muda o status de um pagamento é `conciliar_()`, e
 * ele só decide depois de perguntar à API do Mercado Pago. Webhook, página de retorno e
 * varredura só dizem "confira este". O navegador nunca marca nada como pago (foi o defeito
 * do wedding-web: `retorno.html?id=X` tirava qualquer presente do ar).
 */
const MP = {
    API: 'https://api.mercadopago.com',
    RESERVA_MIN_PADRAO: 30,
    /** Pix pago no último minuto: só expira a reserva depois desta folga. */
    FOLGA_EXPIRAR_MS: 15 * 60 * 1000,
    /** Freio do polling da página de retorno: no máximo uma consulta à API por ref nesta janela. */
    POLL_MIN_S: 5,
    /** Folga antes do limite de 6 min de execução do Apps Script. */
    VARREDURA_TEMPO_MS: 4.5 * 60 * 1000,
    /** Estornos e contestações são vigiados nos confirmados desta janela. */
    ESTORNO_DIAS: 180,
    VALOR_LIVRE_MAX_PADRAO: 5000,
    DESCRITOR_FATURA: 'GISELEVICTOR',
};

/** status do Mercado Pago → status da linha. O que não está aqui fica `pendente`. */
const STATUS_MP_ = {
    approved: 'confirmado',
    in_mediation: 'confirmado', // disputa aberta: o dinheiro entrou; vai com alerta
    rejected: 'recusado',
    cancelled: 'cancelado',
    refunded: 'estornado',
    charged_back: 'estornado',
};

function propsMp_() {
    return PropertiesService.getScriptProperties();
}

function mpToken_() {
    return propsMp_().getProperty('mp_access_token') || '';
}

/** `pix` (desligado), `teste` ou `mercadopago`. Qualquer outro valor conta como `pix`. */
function modoPagamento_(cfg) {
    const m = String((cfg && cfg.pagamento_modo) || '').trim().toLowerCase();
    return m === 'mercadopago' || m === 'teste' ? m : 'pix';
}

/** Segredo do `notification_url`. Gerado na primeira vez que alguém precisa dele. */
function segredoWebhook_() {
    const props = propsMp_();
    let s = props.getProperty('segredo_webhook');
    if (!s) {
        s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
        props.setProperty('segredo_webhook', s);
    }
    return s;
}

/** Chave do modo `teste`: quem abre o site com ?teste=<chave> chega ao checkout. */
function chaveTeste_() {
    const props = propsMp_();
    let s = props.getProperty('mp_chave_teste');
    if (!s) {
        s = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
        props.setProperty('mp_chave_teste', s);
    }
    return s;
}

/** ISO 8601 com offset de Belém, o formato que a API aceita nas datas da preferência. */
function isoBelem_(d) {
    return Utilities.formatDate(d, FUSO_, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
}

/** Chamada à API. Lança em qualquer resposta fora de 2xx; nunca registra o token. */
function mpFetch_(metodo, caminho, corpo, chaveIdempotencia) {
    const opcoes = {
        method: metodo,
        muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + mpToken_() },
    };
    if (corpo) {
        opcoes.contentType = 'application/json';
        opcoes.payload = JSON.stringify(corpo);
    }
    if (chaveIdempotencia) opcoes.headers['X-Idempotency-Key'] = chaveIdempotencia;
    const r = UrlFetchApp.fetch(MP.API + caminho, opcoes);
    const cod = r.getResponseCode();
    const texto = r.getContentText();
    if (cod < 200 || cod >= 300) {
        throw new Error('MP ' + metodo.toUpperCase() + ' ' + caminho.split('?')[0] + ' -> ' + cod + ' ' + String(texto).slice(0, 300));
    }
    return texto ? JSON.parse(texto) : {};
}

/**
 * Acrescenta à direita as colunas que faltam em `Pagamentos` e `Presentes`, sem tocar em
 * nenhuma linha. Roda sozinha antes da primeira escrita (cacheada por 6 h), para que o
 * deploy desta task não dependa de alguém lembrar de rodar uma função no editor.
 */
function garantirEsquema_() {
    const cache = CacheService.getScriptCache();
    if (cache.get('esquema_22')) return;
    [ABAS.PAGAMENTOS, ABAS.PRESENTES].forEach(function (nome) {
        const aba = aba_(nome);
        const ultima = Math.max(aba.getLastColumn(), 1);
        const cab = aba.getRange(1, 1, 1, ultima).getValues()[0].map(String);
        const faltam = COLUNAS[nome].filter(function (c) { return cab.indexOf(c) === -1; });
        if (!faltam.length) return;
        const inicio = cab.filter(function (c) { return c !== ''; }).length + 1;
        aba.getRange(1, inicio, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
        if (nome === ABAS.PAGAMENTOS) {
            // Id do Mercado Pago passa de 2^53: como número, o Sheets arredonda (§5.1).
            const col = inicio + faltam.indexOf('mp_payment_id');
            if (faltam.indexOf('mp_payment_id') !== -1) aba.getRange(1, col, aba.getMaxRows(), 1).setNumberFormat('@');
        }
        log_('info', 'garantirEsquema', nome + ': +' + faltam.join(', '));
    });
    cache.put('esquema_22', '1', 21600);
}

// ---------------------------------------------------------------- checkout

function checkout_(bruto) {
    const cfg = config_();
    const modo = modoPagamento_(cfg);
    const indisponivel = { ok: false, motivo: 'indisponivel' };
    if (modo === 'pix' || !mpToken_()) return indisponivel;
    if (modo === 'teste' && !iguais_(String(bruto.chave_teste || ''), chaveTeste_())) return indisponivel;

    const presenteId = limpar_(bruto.presente_id, 60);
    const nome = semTravessao_(limpar_(bruto.nome, 80));
    const contato = limpar_(bruto.contato, 120);
    const recado = semTravessao_(limpar_(bruto.recado, 280));
    if (nome.length < 2) return { ok: false, campo: 'nome', msg: 'Escreva seu nome, para os noivos saberem quem deu.' };
    if (contato && !contatoValido_(contato)) {
        return { ok: false, campo: 'contato', msg: 'Informe um e-mail ou celular válido, ou deixe em branco.' };
    }

    garantirEsquema_();
    const minutos = Number(cfg.reserva_minutos) > 0 ? Number(cfg.reserva_minutos) : MP.RESERVA_MIN_PADRAO;

    // Reserva COM lock, uma vez por pedido_id (toque duplo não reserva duas vezes).
    const r = gravarUmaVez_(bruto.pedido_id, function () {
        const p = lerPresentes_().linhas.filter(function (l) {
            return String(l.id).trim() === presenteId && ehVerdadeiro_(l.ativo);
        })[0];
        if (!p) return { ok: false, motivo: 'nao_existe', msg: 'Este presente não está mais na lista.' };

        // O VALOR VEM DAQUI, nunca do cliente. Exceção: valor livre, validado no intervalo.
        let valor = Number(p.valor);
        if (ehVerdadeiro_(p.valor_livre)) {
            const v = Number(bruto.valor);
            const max = Number(cfg.valor_livre_max) > 0 ? Number(cfg.valor_livre_max) : MP.VALOR_LIVRE_MAX_PADRAO;
            if (!Number.isInteger(v) || v < valor || v > max) {
                return { ok: false, campo: 'valor', msg: 'Escolha um valor em reais, sem centavos, entre R$ ' + valor + ' e R$ ' + max + '.' };
            }
            valor = v;
        }

        const tp = lerTabela_(ABAS.PAGAMENTOS);
        const cotas = p.cotas === '' || p.cotas === null ? null : Number(p.cotas);
        const d = disponibilidade_(cotas, contarUso_(tp.linhas, Date.now())[presenteId]);
        if (!d.disponivel) {
            return {
                ok: false,
                motivo: 'indisponivel_presente',
                reservado: d.reservado,
                msg: d.reservado
                    ? 'Alguém está finalizando este presente agora. Escolha outro ou tente de novo em meia hora.'
                    : 'Este presente acabou de ser dado. Obrigado mesmo assim!',
            };
        }

        const ref = Utilities.getUuid();
        const agora = new Date();
        const expira = new Date(agora.getTime() + minutos * 60000);
        tp.aba.appendRow(linhaPara_(tp.cab, {
            id: ref,
            presente_id: presenteId,
            nome: textoSeguro_(nome),
            contato: textoSeguro_(contato),
            valor: valor,
            status: 'pendente',
            criado_em: agora,
            canal: 'mercadopago',
            expira_em: expira,
            recado: textoSeguro_(recado),
            atualizado_em: agora,
        }));
        CacheService.getScriptCache().remove('status');
        return {
            ok: true,
            ref: ref,
            _p: { id: presenteId, nome: String(p.nome), imagem: String(p.imagem || ''), valor: valor, nomeConvidado: nome },
            _expira: expira.getTime(),
        };
    });

    if (!r.ok) return r;
    if (r.init_point) return { ok: true, ref: r.ref, init_point: r.init_point }; // reenvio do mesmo pedido

    // Preferência SEM lock: é rede.
    let initPoint;
    try {
        initPoint = criarPreferencia_(r.ref, r._p, new Date(r._expira), cfg);
    } catch (err) {
        log_('erro', 'checkout:preferencia', String(err));
        liberarReserva_(r.ref, 'falha_preferencia');
        return indisponivel;
    }
    const final = { ok: true, ref: r.ref, init_point: initPoint };
    lembrarPedido_(bruto.pedido_id, final);
    log_('info', 'checkout', r._p.id + ' · R$ ' + r._p.valor + ' · ' + r.ref);
    return final;
}

/** Corpo da preferência: task 22 §6.2, campo a campo. */
function corpoPreferencia_(ref, p, expira, cfg) {
    const site = String(cfg.site_url || '').replace(/\/+$/, '');
    const volta = site + '/presentes/obrigado/?ref=' + encodeURIComponent(ref);
    const backend = String(cfg.backend_url || BACKEND_URL_PADRAO).trim();
    const item = {
        id: p.id,
        title: String(p.nome).slice(0, 250),
        description: 'Presente de casamento para Gisele e Victor',
        category_id: 'others',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: p.valor,
    };
    if (/^https:\/\//i.test(p.imagem)) item.picture_url = p.imagem;
    return {
        items: [item],
        payer: { name: p.nomeConvidado },
        external_reference: ref,
        notification_url: backend + '?acao=mp_webhook&chave=' + segredoWebhook_(),
        back_urls: { success: volta, pending: volta, failure: volta },
        auto_return: 'approved',
        // Cartão aprova ou recusa na hora: nada de `in_process` segurando a reserva.
        binary_mode: true,
        statement_descriptor: MP.DESCRITOR_FATURA,
        // O link e o Pix morrem junto com a reserva: ninguém paga por algo já solto.
        expires: true,
        expiration_date_from: isoBelem_(new Date(Date.now() - 60000)),
        expiration_date_to: isoBelem_(expira),
        date_of_expiration: isoBelem_(expira),
        payment_methods: {
            // Boleto e lotérica compensam em até 3 dias úteis; a reserva é de 30 min.
            excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
            installments: Number(cfg.parcelas_max) > 0 ? Number(cfg.parcelas_max) : 12,
        },
        metadata: { presente_id: p.id, origem: 'gv-wedding' },
    };
}

function criarPreferencia_(ref, p, expira, cfg) {
    // Idempotência pela ref: uma retentativa nossa não cria duas preferências.
    const j = mpFetch_('post', '/checkout/preferences', corpoPreferencia_(ref, p, expira, cfg), ref);
    if (!j.init_point) throw new Error('preferência sem init_point: ' + JSON.stringify(j).slice(0, 200));
    return j.init_point;
}

/** Falhou depois de reservar: solta a cota na hora, em vez de esperar 30 min. */
function liberarReserva_(ref, alerta) {
    const lock = LockService.getScriptLock();
    lock.waitLock(LIMITES.LOCK_MS);
    try {
        const t = lerTabela_(ABAS.PAGAMENTOS);
        const l = t.linhas.filter(function (x) { return String(x.id) === ref; })[0];
        if (!l || String(l.status) !== 'pendente') return;
        gravarLinha_(t, l, { status: 'cancelado', alerta: alerta, atualizado_em: new Date() });
        CacheService.getScriptCache().remove('status');
    } finally {
        lock.releaseLock();
    }
}

/**
 * Regrava a linha inteira com as mudanças. `mp_payment_id` sempre com apóstrofo: sem ele,
 * o Sheets converte o texto numérico em número e arredonda (task 22 §5.1).
 */
function gravarLinha_(t, linha, mudancas) {
    const o = {};
    t.cab.forEach(function (c) { o[c] = linha[c]; });
    Object.keys(mudancas).forEach(function (k) { o[k] = mudancas[k]; });
    if (o.mp_payment_id !== undefined && o.mp_payment_id !== '' && o.mp_payment_id !== null) {
        o.mp_payment_id = "'" + String(o.mp_payment_id).replace(/^'/, '');
    }
    ['nome', 'contato', 'recado'].forEach(function (c) {
        if (typeof o[c] === 'string') o[c] = textoSeguro_(o[c]);
    });
    t.aba.getRange(linha._linha, 1, 1, t.cab.length).setValues([linhaPara_(t.cab, o)]);
    Object.keys(mudancas).forEach(function (k) { linha[k] = mudancas[k]; });
}

// ---------------------------------------------------------------- conciliação

/**
 * O coração (task 22 §6.4). Pergunta ao Mercado Pago tudo que existe com esta
 * external_reference e leva a linha ao estado certo. Idempotente: chamar dez vezes dá o
 * mesmo resultado que chamar uma. Devolve { mudou, status, alerta } ou null.
 */
function conciliar_(ref) {
    if (!ref || !mpToken_()) return null;
    garantirEsquema_();

    // 1. Rede, SEM lock.
    const busca = mpFetch_('get', '/v1/payments/search?external_reference=' + encodeURIComponent(ref) +
        '&sort=date_created&criteria=desc&limit=50');
    const pagamentos = (busca.results || []).filter(function (p) { return String(p.external_reference) === ref; });
    const aprovados = pagamentos
        .filter(function (p) { return p.status === 'approved' || p.status === 'in_mediation'; })
        .sort(function (a, b) { return String(a.date_created).localeCompare(String(b.date_created)); });
    // Algum aprovado vale mais que tudo; senão, o mais recente.
    const vale = aprovados[0] || pagamentos[0] || null;
    const estornado = !aprovados.length && pagamentos.some(function (p) {
        return p.status === 'refunded' || p.status === 'charged_back';
    });

    // 2. Escrita, COM lock, relendo a linha pela ref.
    const lock = LockService.getScriptLock();
    lock.waitLock(LIMITES.LOCK_MS);
    let resultado;
    const avisos = [];
    try {
        const t = lerTabela_(ABAS.PAGAMENTOS);
        const l = t.linhas.filter(function (x) { return String(x.id) === ref; })[0];
        if (!l) {
            log_('aviso', 'conciliar', 'ref sem linha: ' + ref);
            return null;
        }
        const antes = String(l.status);
        const agora = new Date();

        if (!vale) {
            // Nada no Mercado Pago ainda (convidado não pagou). Só registra a consulta.
            gravarLinha_(t, l, { conciliado_em: agora });
            return { mudou: false, status: antes, alerta: String(l.alerta || '') };
        }

        let alvo = STATUS_MP_[vale.status] || 'pendente';
        if (estornado) alvo = 'estornado';
        // Um confirmado só sai de confirmado por estorno.
        if (antes === 'confirmado' && alvo !== 'confirmado' && alvo !== 'estornado') alvo = 'confirmado';
        // Pendente no Mercado Pago não "desexpira" nem "desrecusa" uma linha já encerrada.
        if (alvo === 'pendente' && antes !== 'pendente') alvo = antes;

        const mud = {
            mp_payment_id: String(vale.id),
            mp_status: String(vale.status),
            mp_status_detail: String(vale.status_detail || ''),
            // No Pix o tipo vem como `bank_transfer`; quem diz "pix" é o payment_method_id.
            metodo: vale.payment_method_id === 'pix' ? 'pix' : String(vale.payment_type_id || ''),
            parcelas: Number(vale.installments) || '',
            valor_pago: Number(vale.transaction_amount) || '',
            conciliado_em: agora,
        };
        let alerta = String(l.alerta || '');

        if (alvo === 'confirmado' && antes !== 'confirmado') {
            const valorOk = Math.abs(Number(vale.transaction_amount) - Number(l.valor)) < 0.011;
            const moedaOk = String(vale.currency_id) === 'BRL';
            if (!valorOk || !moedaOk) {
                // Não confirma presente de R$ 900 pago com R$ 9 (§6.6).
                alvo = antes === 'pendente' ? 'pendente' : antes;
                alerta = 'divergente';
                avisos.push('[ATENÇÃO] Pagamento com valor diferente do presente: esperado R$ ' + l.valor +
                    ', pago ' + vale.currency_id + ' ' + vale.transaction_amount + ' (ref ' + ref + ')');
            } else {
                // Cota já tomada por outro pagamento? Confirma mesmo assim (o dinheiro entrou).
                const p = lerPresentes_().linhas.filter(function (x) { return String(x.id).trim() === String(l.presente_id); })[0];
                const cotas = p && p.cotas !== '' && p.cotas !== null ? Number(p.cotas) : null;
                const outros = t.linhas.filter(function (x) {
                    return String(x.presente_id) === String(l.presente_id) && String(x.status) === 'confirmado' && String(x.id) !== ref;
                }).length;
                if (cotas && outros >= cotas) {
                    alerta = 'excedente';
                    avisos.push('[ATENÇÃO] Presente dado além do limite de pessoas (ref ' + ref + '). Decidam entre devolver pelo painel do Mercado Pago ou aceitar.');
                }
                if (vale.status === 'in_mediation') {
                    alerta = alerta || 'disputa';
                    avisos.push('[ATENÇÃO] Pagamento em disputa no Mercado Pago (ref ' + ref + ').');
                }
                mud.confirmado_em = agora;
            }
        }
        if (alvo === 'estornado' && antes !== 'estornado') {
            avisos.push('[ATENÇÃO] Pagamento devolvido ou contestado (ref ' + ref + '). O presente voltou para a lista.');
        }

        mud.status = alvo;
        mud.alerta = alerta;
        const mudou = alvo !== antes || alerta !== String(l.alerta || '') ||
            String(l.mp_payment_id || '').replace(/^'/, '') !== String(vale.id) || String(l.mp_status) !== String(vale.status);
        if (mudou) mud.atualizado_em = agora;
        gravarLinha_(t, l, mud);

        // Segundo pagamento aprovado na mesma ref: alguém pagou duas vezes (§6.6).
        aprovados.slice(1).forEach(function (dup) {
            const idDup = ref + '-dup-' + dup.id;
            if (t.linhas.some(function (x) { return String(x.id) === idDup; })) return;
            t.aba.appendRow(linhaPara_(t.cab, {
                id: idDup, presente_id: l.presente_id, nome: textoSeguro_(String(l.nome)), contato: textoSeguro_(String(l.contato || '')),
                valor: l.valor, status: 'confirmado', criado_em: agora, confirmado_em: agora, canal: 'mercadopago',
                mp_payment_id: "'" + dup.id, mp_status: dup.status, metodo: dup.payment_type_id || '',
                parcelas: dup.installments || '', valor_pago: dup.transaction_amount || '',
                atualizado_em: agora, conciliado_em: agora, alerta: 'duplicado',
            }));
            avisos.push('[ATENÇÃO] ' + l.nome + ' pagou duas vezes o mesmo presente (ref ' + ref + '). Devolvam um pelo painel.');
        });

        if (mudou) CacheService.getScriptCache().remove('status');
        resultado = { mudou: mudou, status: alvo, alerta: alerta, confirmouAgora: alvo === 'confirmado' && antes !== 'confirmado', linha: l };
    } finally {
        lock.releaseLock();
    }

    // 3. E-mail, SEM lock.
    if (resultado && resultado.confirmouAgora) avisarPresente_(resultado.linha);
    avisos.forEach(function (a) { avisarNoivos_(prefixoTeste_() + a.slice(0, 120), a); });
    return { mudou: resultado.mudou, status: resultado.status, alerta: resultado.alerta };
}

// ---------------------------------------------------------------- webhook

/**
 * Aceita os formatos que o Mercado Pago usa (v2 no corpo, query, IPN antigo) e extrai só o
 * id do pagamento. O webhook não traz status para dentro do sistema: ele só dispara uma
 * consulta autenticada à API. Por isso não é preciso validar a assinatura (que o Apps Script
 * nem conseguiria: não expõe cabeçalhos).
 */
function mpWebhook_(e) {
    const q = e.parameter || {};
    const segredo = propsMp_().getProperty('segredo_webhook') || '';
    if (!segredo || !iguais_(String(q.chave || ''), segredo)) {
        const cache = CacheService.getScriptCache();
        if (!cache.get('webhook_chave_errada')) {
            cache.put('webhook_chave_errada', '1', 3600);
            log_('aviso', 'mp_webhook', 'chave ausente ou errada');
        }
        return;
    }
    let corpo = {};
    try {
        corpo = JSON.parse((e.postData && e.postData.contents) || '{}') || {};
    } catch (err) {
        corpo = {};
    }
    const tipo = String(corpo.type || q.type || q.topic || '').toLowerCase();
    const acao = String(corpo.action || '');
    if (tipo && tipo !== 'payment' && acao.indexOf('payment') !== 0) return; // merchant_order etc.
    const id = String((corpo.data && corpo.data.id) || q['data.id'] || q.id || '').replace(/\D/g, '');
    if (!id) return;
    // Rastro de que o Mercado Pago chegou até aqui (a página de retorno também confirma).
    log_('info', 'mp_webhook', 'pagamento ' + id);

    const pg = mpFetch_('get', '/v1/payments/' + id);
    const ref = String(pg.external_reference || '');
    const existe = ref && lerTabela_(ABAS.PAGAMENTOS).linhas.some(function (l) { return String(l.id) === ref; });
    if (!existe) {
        log_('aviso', 'mp_webhook', 'pagamento ' + id + ' sem ref nossa (' + (ref || 'vazia') + ')');
        return;
    }
    conciliar_(ref);
}

// ---------------------------------------------------------------- consulta pública

/** Para a página de retorno. Só o necessário, nunca contato, recado ou ids do Mercado Pago. */
function pagamentoPublico_(refBruta) {
    const ref = String(refBruta || '').trim();
    const desconhecido = { ok: true, estado: 'desconhecido' };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) return desconhecido;

    const achar = function () {
        return lerAba_(ABAS.PAGAMENTOS).filter(function (l) { return String(l.id) === ref; })[0];
    };
    let l = achar();
    if (!l) return desconhecido;

    if (String(l.status) === 'pendente' && String(l.canal) === 'mercadopago' && mpToken_()) {
        const cache = CacheService.getScriptCache();
        if (!cache.get('conc_' + ref)) {
            cache.put('conc_' + ref, '1', MP.POLL_MIN_S);
            try {
                conciliar_(ref);
                l = achar();
            } catch (err) {
                log_('erro', 'pagamento:conciliar', String(err));
            }
        }
    }

    const mapa = { confirmado: 'confirmado', recusado: 'recusado', expirado: 'expirado', cancelado: 'expirado', estornado: 'estornado' };
    const presente = lerAba_(ABAS.PRESENTES).filter(function (p) { return String(p.id).trim() === String(l.presente_id); })[0];
    return {
        ok: true,
        estado: mapa[String(l.status)] || 'pendente',
        presente: presente ? String(presente.nome) : '',
        presente_id: String(l.presente_id),
        nome: String(l.nome),
        metodo: String(l.metodo || ''),
    };
}

// ---------------------------------------------------------------- varredura

/**
 * Gatilho a cada 10 min (instalarGatilhos). Pega o que o webhook e a página de retorno
 * perderam, expira reservas vencidas e, uma vez por dia, confere estornos.
 */
function varrerPagamentos() {
    if (!mpToken_()) return;
    const inicio = Date.now();
    const noTempo = function () { return Date.now() - inicio < MP.VARREDURA_TEMPO_MS; };

    // 1. Pendentes: conciliar.
    const pend = lerAba_(ABAS.PAGAMENTOS).filter(function (l) {
        return String(l.canal) === 'mercadopago' && String(l.status) === 'pendente';
    });
    for (let i = 0; i < pend.length && noTempo(); i++) {
        try {
            conciliar_(String(pend[i].id));
        } catch (err) {
            log_('erro', 'varredura:conciliar', String(pend[i].id) + ' ' + String(err));
        }
    }

    // 2. Expirar o que passou da reserva + folga e continua sem aprovação.
    expirarVencidos_(Date.now());

    // 3. Uma vez por dia, a partir das 3h: estornos e contestações, com cursor.
    const props = propsMp_();
    const hoje = Utilities.formatDate(new Date(), FUSO_, 'yyyy-MM-dd');
    const hora = Number(Utilities.formatDate(new Date(), FUSO_, 'H'));
    if (hora >= 3 && props.getProperty('estorno_dia') !== hoje && noTempo()) {
        const limite = Date.now() - MP.ESTORNO_DIAS * 86400000;
        const conf = lerAba_(ABAS.PAGAMENTOS).filter(function (l) {
            return String(l.canal) === 'mercadopago' && String(l.status) === 'confirmado' &&
                l.confirmado_em && new Date(l.confirmado_em).getTime() > limite;
        });
        let cursor = Number(props.getProperty('estorno_cursor') || 0);
        while (cursor < conf.length && noTempo()) {
            try {
                conciliar_(String(conf[cursor].id));
            } catch (err) {
                log_('erro', 'varredura:estorno', String(err));
            }
            cursor++;
        }
        if (cursor >= conf.length) {
            props.setProperty('estorno_dia', hoje);
            props.deleteProperty('estorno_cursor');
        } else {
            props.setProperty('estorno_cursor', String(cursor));
        }
    }
}

function expirarVencidos_(agoraMs) {
    const lock = LockService.getScriptLock();
    lock.waitLock(LIMITES.LOCK_MS);
    try {
        const t = lerTabela_(ABAS.PAGAMENTOS);
        let n = 0;
        t.linhas.forEach(function (l) {
            if (String(l.canal) !== 'mercadopago' || String(l.status) !== 'pendente' || !l.expira_em) return;
            if (new Date(l.expira_em).getTime() + MP.FOLGA_EXPIRAR_MS > agoraMs) return;
            gravarLinha_(t, l, { status: 'expirado', atualizado_em: new Date(agoraMs) });
            n++;
        });
        if (n) {
            CacheService.getScriptCache().remove('status');
            log_('info', 'expirarVencidos', n + ' reserva(s) expirada(s)');
        }
    } finally {
        lock.releaseLock();
    }
}

// ---------------------------------------------------------------- avisos aos noivos

function avisarNoivos_(assunto, texto) {
    const para = config_().email_noivos;
    if (!para || para.indexOf('TODO') === 0) {
        log_('aviso', 'avisarNoivos', assunto);
        return;
    }
    enviarEmail_(para, assunto, texto, null);
}

/** Com token de teste, os e-mails do Mercado Pago avisam que são de teste. */
function prefixoTeste_() {
    return propsMp_().getProperty('mp_ambiente') === 'teste' ? '[TESTE] ' : '';
}

/** "Presente recebido": o que alimenta os cartões de agradecimento (§6.7). */
function avisarPresente_(l) {
    const p = lerAba_(ABAS.PRESENTES).filter(function (x) { return String(x.id).trim() === String(l.presente_id); })[0];
    const nomePresente = p ? String(p.nome) : String(l.presente_id);
    const metodos = { credit_card: 'cartão de crédito', debit_card: 'cartão de débito', account_money: 'saldo Mercado Pago', bank_transfer: 'Pix', pix: 'Pix' };
    const como = (metodos[String(l.metodo)] || String(l.metodo || 'Mercado Pago')) +
        (Number(l.parcelas) > 1 ? ' em ' + l.parcelas + 'x' : '');
    const texto = [
        l.nome + ' deu ' + nomePresente + ' (R$ ' + l.valor + ', ' + como + ').',
        l.recado ? 'Recado: "' + l.recado + '"' : '',
        l.contato ? 'Contato: ' + l.contato : '',
    ].filter(Boolean).join('\n');
    avisarNoivos_(prefixoTeste_() + 'Presente recebido: ' + nomePresente + ', de ' + l.nome, texto);
}

// ---------------------------------------------------------------- área dos noivos

/** Lista dos cartões de agradecimento, e os alertas no topo (task 22 §8). */
function listarRecebidos_() {
    const nomes = {};
    lerAba_(ABAS.PRESENTES).forEach(function (p) { nomes[String(p.id).trim()] = String(p.nome); });
    return lerAba_(ABAS.PAGAMENTOS)
        .filter(function (l) { return String(l.status) === 'confirmado' || String(l.alerta || '') !== '' || String(l.status) === 'estornado'; })
        .map(function (l) {
            return {
                presente: nomes[String(l.presente_id)] || String(l.presente_id),
                nome: String(l.nome),
                contato: String(l.contato || ''),
                recado: String(l.recado || ''),
                valor: Number(l.valor) || 0,
                status: String(l.status),
                canal: String(l.canal || ''),
                metodo: String(l.metodo || ''),
                parcelas: Number(l.parcelas) || null,
                quando: l.confirmado_em ? new Date(l.confirmado_em).toISOString() : (l.criado_em ? new Date(l.criado_em).toISOString() : ''),
                alerta: String(l.alerta || ''),
            };
        })
        .sort(function (a, b) { return String(b.quando).localeCompare(String(a.quando)); });
}

// ---------------------------------------------------------------- operação (editor)

/**
 * Rode UMA VEZ depois de colar esta versão. Acrescenta colunas e chaves da Config que
 * faltam, gera os segredos e IMPRIME a URL do webhook para colar no painel (§4.8) e a
 * chave do modo teste.
 */
function configurarMercadoPago() {
    CacheService.getScriptCache().remove('esquema_22');
    garantirEsquema_();

    const aba = aba_(ABAS.CONFIG);
    const existentes = lerAba_(ABAS.CONFIG).map(function (l) { return String(l.chave); });
    CONFIG_PADRAO.forEach(function (par) {
        if (existentes.indexOf(par[0]) === -1) aba.appendRow(par);
    });
    CacheService.getScriptCache().remove('config');

    const cfg = config_();
    const url = String(cfg.backend_url || BACKEND_URL_PADRAO) + '?acao=mp_webhook&chave=' + segredoWebhook_();
    const msg = [
        'Webhook (colar no painel do Mercado Pago, evento Pagamentos):',
        url,
        '',
        'Modo teste: pagamento_modo = teste na Config, e abrir o site com',
        String(cfg.site_url || '').replace(/\/+$/, '') + '/presentes/?teste=' + chaveTeste_(),
        '',
        'pagamento_modo atual: ' + modoPagamento_(cfg) + ' · token: ' + (mpToken_() ? 'gravado' : 'FALTA (definirTokenMercadoPago)'),
    ].join('\n');
    Logger.log(msg);
    log_('info', 'configurarMercadoPago', 'ok');
    return msg;
}

/** Muda `pagamento_modo` na Config e invalida os caches que dependem dele. */
function definirModoPagamento_(modo) {
    const t = lerTabela_(ABAS.CONFIG);
    const l = t.linhas.filter(function (x) { return String(x.chave) === 'pagamento_modo'; })[0];
    if (l) t.aba.getRange(l._linha, t.cab.indexOf('valor') + 1).setValue(modo);
    else t.aba.appendRow(['pagamento_modo', modo]);
    CacheService.getScriptCache().removeAll(['config', 'status']);
    log_('info', 'pagamento_modo', modo);
}

/**
 * Liga o modo teste num passo só, depois de `definirTokenMercadoPago(…, 'teste')`: chaves da
 * Config, `pagamento_modo = teste` e o gatilho da varredura. Não usa `instalarGatilhos()`,
 * que reinstalaria também a campanha de e-mail. Devolve o link do modo teste e o webhook.
 */
function ligarTesteMercadoPago() {
    if (!mpToken_()) throw new Error('Sem token: rode antes definirTokenMercadoPago(\'APP_USR-…\', \'teste\').');
    const msg = configurarMercadoPago();
    definirModoPagamento_('teste');
    ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'varrerPagamentos') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('varrerPagamentos').timeBased().everyMinutes(10).create();
    const saida = msg.replace(/pagamento_modo atual: \w+/, 'pagamento_modo atual: teste') + '\nvarredura a cada 10 min: instalada';
    Logger.log(saida);
    return saida;
}

/** Volta ao Pix estático na próxima requisição. Não apaga token, gatilho nem reservas. */
function desligarMercadoPago() {
    definirModoPagamento_('pix');
    return 'pagamento_modo = pix';
}

/**
 * Depois do modo teste e ANTES do token de produção: apaga de `Pagamentos` as linhas do
 * Mercado Pago (todas de teste até aqui), para não aparecerem como presentes recebidos. As
 * do Pix manual ficam. Com token de produção gravado, recusa.
 */
function limparTesteMercadoPago() {
    if (propsMp_().getProperty('mp_ambiente') === 'producao') {
        throw new Error('Token de produção gravado: as linhas do Mercado Pago podem ser de verdade. Nada apagado.');
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(LIMITES.LOCK_MS);
    let n = 0;
    try {
        const t = lerTabela_(ABAS.PAGAMENTOS);
        t.linhas
            .filter(function (l) { return String(l.canal) === 'mercadopago'; })
            .map(function (l) { return l._linha; })
            .sort(function (a, b) { return b - a; })
            .forEach(function (linha) { t.aba.deleteRow(linha); n++; });
        CacheService.getScriptCache().remove('status');
    } finally {
        lock.releaseLock();
    }
    const msg = n + ' linha(s) de teste do Mercado Pago apagada(s)';
    log_('info', 'limparTesteMercadoPago', msg);
    Logger.log(msg);
    return msg;
}

/**
 * Grava o Access Token. No editor não dá para passar argumento pelo botão Executar: crie
 * `function tmp() { definirTokenMercadoPago('APP_USR-…', 'teste'); }`, rode, e APAGUE a
 * função (o token não pode ficar escrito no projeto).
 */
function definirTokenMercadoPago(token, ambiente) {
    const t = String(token || '').trim();
    if (!/^(APP_USR|TEST)-/.test(t)) throw new Error('Access Token inválido: deve começar com APP_USR- ou TEST-.');
    const props = propsMp_();
    props.setProperty('mp_access_token', t);
    props.setProperty('mp_ambiente', ambiente === 'producao' ? 'producao' : 'teste');
    log_('info', 'definirTokenMercadoPago', 'ambiente ' + (ambiente === 'producao' ? 'producao' : 'teste'));
    return 'token gravado (' + (ambiente === 'producao' ? 'producao' : 'teste') + ')';
}

/** Primeiro teste depois de gravar o token. */
function testeMercadoPago() {
    const j = mpFetch_('get', '/v1/payment_methods');
    const msg = 'ok: ' + (Array.isArray(j) ? j.length : '?') + ' meios de pagamento; ambiente ' +
        (propsMp_().getProperty('mp_ambiente') || '?');
    Logger.log(msg);
    return msg;
}

/** Cria uma preferência de R$ 10 sem gravar linha, e imprime o que a API devolveu. */
function testePreferencia() {
    const cfg = config_();
    const ref = Utilities.getUuid();
    const corpo = corpoPreferencia_(ref, { id: 'teste', nome: 'Teste de preferência', imagem: '', valor: 10, nomeConvidado: 'Teste' },
        new Date(Date.now() + 30 * 60000), cfg);
    const j = mpFetch_('post', '/checkout/preferences', corpo, ref);
    const conferir = {
        init_point: j.init_point,
        binary_mode: j.binary_mode,
        expires: j.expires,
        expiration_date_to: j.expiration_date_to,
        date_of_expiration: j.date_of_expiration,
        statement_descriptor: j.statement_descriptor,
        excluded_payment_types: j.payment_methods && j.payment_methods.excluded_payment_types,
        installments: j.payment_methods && j.payment_methods.installments,
        back_urls: j.back_urls,
        auto_return: j.auto_return,
        notification_url: j.notification_url ? j.notification_url.replace(/chave=.*/, 'chave=***') : j.notification_url,
    };
    Logger.log(JSON.stringify(conferir, null, 2));
    return conferir;
}

/** Suporte: força a conciliação de uma ref. */
function conciliarAgora(ref) {
    const r = conciliar_(String(ref));
    Logger.log(JSON.stringify(r));
    return r;
}

// ============================================================ e-mail

/**
 * Envio único, com respeito ao modo de simulação e à cota.
 * Devolve true se enviou (ou simulou), false se não deu.
 */
function enviarEmail_(para, assunto, textoPuro, html) {
    const cfg = config_();

    if (ehVerdadeiro_(cfg.modo_simulacao)) {
        log_('simulacao', 'email', { para: para, assunto: assunto });
        return true;
    }

    const restante = MailApp.getRemainingDailyQuota();
    if (restante <= LIMITES.RESERVA_QUOTA) {
        log_('aviso', 'email:cota', 'restam ' + restante + ', parando');
        return false;
    }

    try {
        const opcoes = { name: 'Gisele & Victor' };
        if (html) opcoes.htmlBody = html;
        MailApp.sendEmail(para, assunto, textoPuro, opcoes);
        return true;
    } catch (err) {
        log_('erro', 'email', String(err));
        return false;
    }
}

/**
 * Sem link de descadastro, de propósito: é um casamento, não uma empresa. Quem confirmou
 * presença recebe os avisos do evento; quem não quer receber, não confirma.
 */
function moldura_(titulo, corpoHtml) {
    const cfg = config_();
    return [
        '<div style="font-family:Georgia,serif;background:#F7F1EB;color:#48492A;padding:32px">',
        '<div style="max-width:520px;margin:0 auto">',
        '<p style="font-size:28px;letter-spacing:.04em;margin:0 0 4px">GISELE <span style="color:#F0994A">&amp;</span> VICTOR</p>',
        '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#626247;margin:0 0 28px">',
        dataEvento_(cfg, true) + ' · ' + cfg.evento_local + '</p>',
        '<h1 style="font-size:22px;margin:0 0 12px">' + titulo + '</h1>',
        corpoHtml,
        '</div></div>',
    ].join('');
}

function enviarConfirmacao_(protocolo, d) {
    if (d.comparece !== 'sim') {
        const txtN = 'Recebemos seu aviso, ' + d.nome + '. Que pena que não vai dar!\n\nSua confirmação: ' + protocolo;
        enviarEmail_(d.contato, 'Recebemos seu aviso', txtN,
            moldura_('Obrigado por avisar', '<p>Que pena que não vai dar, ' + d.nome + '. Você vai fazer falta.</p>' +
                '<p style="font-size:13px;color:#626247">Sua confirmação: <strong>' + protocolo + '</strong></p>'));
        return;
    }

    const cfg = config_();
    const txt = 'Presença confirmada, ' + d.nome + '!\n\nSua confirmação: ' + protocolo +
        '\n' + cfg.evento_local + '\n' + cfg.evento_endereco;
    enviarEmail_(d.contato, 'Presença confirmada!', txt,
        moldura_('Presença confirmada!',
            '<p>A gente mal pode esperar para ver você lá, ' + d.nome + '.</p>' +
            '<p style="font-size:13px;color:#626247">Sua confirmação: <strong>' + protocolo + '</strong></p>' +
            '<p><a href="' + cfg.site_url + '/informacoes" style="color:#743D05">Ver informações do grande dia</a></p>'));
}

// ---------------------------------------------------------------- campanha

/** Gatilho diário. Decide qual campanha cabe hoje e manda um lote. */
function rodarCampanhas() {
    const cfg = config_();
    const evento = new Date(cfg.evento_quando).getTime();
    const hoje = Date.now();
    // O gatilho roda entre 9h e 10h; com o evento às 20h, a fração do dia fica entre 0,42 e
    // 0,46 e arredonda para baixo. Evento a partir das 21h passaria de 0,5 e anteciparia
    // cada e-mail em um dia (task 16 §4.3).
    const diasAte = Math.round((evento - hoje) / 86400000);

    const campanha = CAMPANHAS.filter(function (c) { return -c.dias === diasAte; })[0];
    if (!campanha) {
        log_('info', 'campanha', 'nada para hoje (faltam ' + diasAte + ' dias)');
        return;
    }
    enviarCampanha(campanha.chave);
}

/**
 * Envia uma campanha em lote.
 *
 * Idempotente: a chave entra em `emails_enviados` DEPOIS do envio bem-sucedido, e
 * cada disparo confere a lista antes. Sem isso, uma reexecução do gatilho manda tudo
 * de novo — e não dá para despublicar e-mail.
 */
function enviarCampanha(chave) {
    const campanha = CAMPANHAS.filter(function (c) { return c.chave === chave; })[0];
    if (!campanha) throw new Error('Campanha desconhecida: ' + chave);

    const cfg = config_();
    const aba = aba_(ABAS.CONVIDADOS);
    const iEnviados = COLUNAS.Convidados.indexOf('emails_enviados') + 1;
    const maxLote = Number(cfg.lote_email_max) || 80;

    let enviados = 0;
    let pulados = 0;

    const alvos = lerAba_(ABAS.CONVIDADOS).filter(function (l) {
        // Só quem vai, e todos que vão: não há descadastro (ver `moldura_`).
        if (String(l.comparece).toLowerCase() !== 'sim') return false;
        const feitas = String(l.emails_enviados || '').split(',');
        return feitas.indexOf(chave) === -1;
    });

    for (let i = 0; i < alvos.length; i++) {
        if (enviados >= maxLote) {
            log_('info', 'campanha:' + chave, 'lote cheio, ' + (alvos.length - enviados) + ' para amanhã');
            break;
        }
        const l = alvos[i];
        const contato = String(l.contato);
        if (contato.indexOf('@') === -1) { pulados++; continue; } // só celular: não dá e-mail

        const ok = enviarEmail_(
            contato,
            campanha.assunto,
            corpoTexto_(campanha.chave, l, cfg),
            moldura_(campanha.assunto, corpoHtml_(campanha.chave, l, cfg)),
        );
        if (!ok) break; // cota estourou: para e retoma amanhã

        const feitas = String(l.emails_enviados || '').split(',').filter(Boolean);
        feitas.push(chave);
        aba.getRange(l._linha, iEnviados).setValue(feitas.join(','));
        enviados++;
    }

    log_('info', 'campanha:' + chave, { enviados: enviados, pulados: pulados, restantes: alvos.length - enviados });
    return { enviados: enviados, pulados: pulados, restantes: alvos.length - enviados };
}

function corpoTexto_(chave, l, cfg) {
    const nome = String(l.nome).split(' ')[0];
    const base = {
        d30: 'Oi, ' + nome + '! Faltam 30 dias. ' + cfg.evento_local + ', ' + cfg.evento_endereco,
        d7: 'Oi, ' + nome + '! É na próxima semana, dia ' + dataEvento_(cfg) + ', às ' + horaEvento_(cfg) + '.',
        d1: 'É amanhã, ' + nome + '! ' + cfg.evento_local + ', ' + cfg.evento_endereco,
        pos: 'Obrigado por estar com a gente, ' + nome + '!',
    };
    return base[chave] + '\n\n' + cfg.site_url + '/informacoes';
}

function corpoHtml_(chave, l, cfg) {
    const nome = String(l.nome).split(' ')[0];
    const btn = function (texto, href) {
        return '<p><a href="' + href + '" style="display:inline-block;background:#F0994A;color:#1A1A1A;' +
            'padding:12px 20px;text-decoration:none;font-weight:bold;font-size:13px;' +
            'letter-spacing:.06em;text-transform:uppercase">' + texto + '</a></p>';
    };
    const info = cfg.site_url + '/informacoes';

    switch (chave) {
        case 'd30':
            return '<p>Oi, ' + nome + '! Faltam 30 dias.</p>' +
                '<p>Separamos tudo que você precisa: endereço, como chegar e traje.</p>' +
                btn('Ver informações', info);
        case 'd7':
            return '<p>Oi, ' + nome + '! É na próxima semana, <strong>' + dataEvento_(cfg) +
                ', às ' + horaEvento_(cfg) + '</strong>.</p>' +
                '<p>' + cfg.evento_local + '<br>' + cfg.evento_endereco + '</p>' +
                btn('Como chegar', info);
        case 'd1':
            return '<p><strong>É amanhã, ' + nome + '!</strong></p>' +
                '<p>' + cfg.evento_local + '<br>' + cfg.evento_endereco + '<br>Às ' + horaEvento_(cfg) + '.</p>' +
                btn('Chamar um carro', info);
        case 'pos':
            return '<p>Obrigado por estar com a gente, ' + nome + '. Foi tudo mais bonito com você lá.</p>' +
                btn('Ver as fotos', cfg.site_url + '/pre-wedding');
        default:
            return '<p>Oi, ' + nome + '!</p>';
    }
}

// ============================================================ utilitários

function json_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- datas (task 16)
//
// Nenhum texto enviado pode ter data ou hora digitada: tudo sai de `evento_quando` e
// `rsvp_ate` da Config. Mudou a data, muda a célula, e os e-mails acompanham.
//
// Array de meses porque `Utilities.formatDate` segue o locale do script, e 'MMMM' pode
// sair "January". O fuso vai explícito, e não o do projeto.

const FUSO_ = 'America/Belem';
const MESES_ = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function partesEmBelem_(iso) {
    const d = new Date(iso);
    const f = function (p) { return Utilities.formatDate(d, FUSO_, p); };
    return { dia: Number(f('d')), mes: MESES_[Number(f('M')) - 1], ano: f('yyyy'), hora: Number(f('H')) };
}

/** "16 de janeiro" ou, com `comAno`, "16 de janeiro de 2027". */
function dataEvento_(cfg, comAno) {
    const p = partesEmBelem_(cfg.evento_quando);
    return p.dia + ' de ' + p.mes + (comAno ? ' de ' + p.ano : '');
}

/** "20h". */
function horaEvento_(cfg) {
    return partesEmBelem_(cfg.evento_quando).hora + 'h';
}

/** "16 de novembro". */
function prazoRsvp_(cfg) {
    const p = partesEmBelem_(cfg.rsvp_ate);
    return p.dia + ' de ' + p.mes;
}

/**
 * O prazo do RSVP passou? Sem prazo, não. Com prazo ilegível, também não, e fica no Log:
 * recusar confirmação por erro de digitação na Config é pior do que aceitar uma a mais.
 */
function prazoEncerrado_(cfg) {
    if (!cfg.rsvp_ate) return false;
    const limite = new Date(cfg.rsvp_ate).getTime();
    if (isNaN(limite)) {
        log_('erro', 'rsvp_ate', 'valor ilegível na Config: ' + cfg.rsvp_ate);
        return false;
    }
    return Date.now() > limite;
}

// ============================================================ migrações

/**
 * 29/09/2026: as faixas por valor (lembranca, casa, grande, luademel) viraram as categorias
 * escolhidas pelos noivos, e os nomes seguiram a lista deles. Acha cada presente pelo ID,
 * que é estável (é o txid do Pix), nunca pelo nome ou pela posição da linha. O id não muda,
 * então os pagamentos continuam ligados ao presente.
 *
 * Rode no editor: escolha `migrarCategorias` → ▶ Executar. Idempotente.
 * Id que não estiver na aba é listado no retorno e no Log, sem erro.
 */
const MIGRACAO_CATEGORIAS = {
    // `nome` e `ordem` só onde mudam. A ordem segue a sequência da lista dos noivos.
    'tabua-de-servir': { faixa: 'salvador' },
    'jogo-de-cama': { faixa: 'salvador', nome: 'Sessão de massagem de casal pós-maratona de trio elétrico' },
    'micro-ondas': { faixa: 'salvador', nome: 'Camarote Brahma no Carnaval de Salvador (acabou o dinheiro mas a gente não quer deixar de ir)' },
    'aspirador': { faixa: 'salvador', nome: 'Luvas de boxe pra ir na pipoca do trio elétrico do Bell Marques' },
    'jogo-de-panelas': { faixa: 'salvador', nome: 'Jantar Romântico pra fingir que não ficamos lisos pós-festa' },
    'maquina-de-lavar': { faixa: 'salvador' },
    'mais-um-batom-identico-aos-20-que-a-noiv': { faixa: 'gisele', nome: 'Mais um batom idêntico aos outros 20 que a Gisele já tem' },
    'taxa-do-amor-so-mais-uma-comprinha-na-se': { faixa: 'gisele' },
    'upgrade-na-mala-da-gisele-porque-metade': { faixa: 'gisele', nome: 'Upgrade na mala da Gisele (porque metade é só maquiagem)' },
    'trena-rosa-brilhante-que-a-gisele-disse': { faixa: 'gisele', nome: 'Trena rosa com brilho que a Gisele disse que PRECISA' },
    'camisa-de-time-nova-que-a-gisele-vai-ach': { faixa: 'victor' },
    'fisioterapia-pro-joelho-podre-do-noivo-p': { faixa: 'victor' },
    'cota-para-o-noivo-deixar-de-ser-palestri': { faixa: 'victor', nome: 'Cota pro noivo não virar palestrinha depois que bebe' },
    'consultoria-financeira-sem-julgamentos-c': { faixa: 'victor' },
    'spa-da-ruth-para-ela-esquecer-que-viajam': { faixa: 'ruth', nome: 'Spa do salsichinha (para ela esquecer que viajamos sem ela)' },
    'pensao-alimenticia-da-ruth-para-2027': { faixa: 'ruth' },
    'coleira-chique-pra-ruth-passear-na-batis': { faixa: 'ruth' },
    'curso-de-pedreiro-para-o-noivo-atender-t': { faixa: 'resenha', nome: 'Curso de pedreiro pra que o noivo faça tudo que a noiva quer' },
    'ajuda-de-amigo-a-pra-gente-nao-se-endivi': { faixa: 'resenha' },
    'conserto-da-poltrona-que-a-ruth-comeu': { faixa: 'resenha', ordem: 375 },
    // Fora da lista dos noivos: criado para teste de pagamento. Fica visível, no fim.
    'presente-teste': { faixa: 'resenha' },
};

function migrarCategorias() {
    const t = lerPresentes_();
    const col = function (c) { return t.cab.indexOf(c) + 1; };
    const vistos = {};
    let mudou = 0;
    const gravar = function (linha, c, valor) {
        t.aba.getRange(linha, col(c)).setValue(valor);
        mudou++;
    };
    t.linhas.forEach(function (p) {
        const id = String(p.id).trim();
        const m = MIGRACAO_CATEGORIAS[id];
        if (!m) return;
        vistos[id] = true;
        if (categoriaDe_(p.faixa) !== m.faixa) gravar(p._linha, 'faixa', m.faixa);
        if (m.nome !== undefined && String(p.nome) !== m.nome) gravar(p._linha, 'nome', textoSeguro_(m.nome));
        if (m.ordem !== undefined && Number(p.ordem) !== m.ordem) gravar(p._linha, 'ordem', m.ordem);
    });
    const faltando = Object.keys(MIGRACAO_CATEGORIAS).filter(function (id) { return !vistos[id]; });
    CacheService.getScriptCache().removeAll(['catalogo', 'status']);
    const r = mudou + ' célula(s) alterada(s)' + (faltando.length ? '; não encontrados: ' + faltando.join(', ') : '');
    log_('info', 'migrarCategorias', r);
    return r;
}

// ============================================================ dados de teste

/**
 * Popula a aba `Presentes` com itens FAKE, para exercitar o site ponta a ponta.
 *
 * Rode no editor: escolha `semearPresentes` → ▶ Executar.
 *
 * Idempotente: só insere id que ainda não existe, então rodar duas vezes não duplica.
 * Para limpar depois, use `limparPresentesFake()`.
 *
 * ⚠️ São dados de teste. Substitua pela curadoria real antes de publicar — os nomes e
 * valores abaixo são plausíveis, mas não foram escolhidos por Gisele e Victor.
 */
function semearPresentes() {
    const FAKE = [
        // id, nome, valor, faixa, imagem, descricao, ativo, cotas, ordem
        ['jogo-de-tacas', 'Jogo de taças', 90, 'resenha', '', 'Seis taças de cristal', true, 1, 10],
        ['toalhas', 'Jogo de toalhas', 120, 'resenha', '', '', true, 1, 20],
        ['vela-aromatica', 'Vela aromática', 95, 'resenha', '', '', true, 3, 30],
        ['tabua-de-servir', 'Tábua de servir', 140, 'resenha', '', '', true, 1, 40],
        ['jogo-de-jantar', 'Jogo de jantar', 320, 'resenha', '', 'Para as visitas de domingo', true, 1, 50],
        ['jogo-de-cama', 'Jogo de cama', 280, 'resenha', '', '', true, 1, 60],
        ['liquidificador', 'Liquidificador', 250, 'resenha', '', '', true, 1, 70],
        ['air-fryer', 'Air fryer', 450, 'resenha', '', '', true, 1, 80],
        ['micro-ondas', 'Micro-ondas', 700, 'resenha', '', '', true, 1, 90],
        ['aspirador', 'Aspirador', 600, 'resenha', '', '', true, 1, 100],
        ['jogo-de-panelas', 'Jogo de panelas', 520, 'resenha', '', '', true, 1, 110],
        ['geladeira', 'Geladeira', 2500, 'resenha', '', 'Cota única: a maior de todas', true, 1, 120],
        ['maquina-de-lavar', 'Máquina de lavar', 2200, 'resenha', '', '', true, 1, 130],
        ['sofa', 'Sofá', 1800, 'resenha', '', '', true, 1, 140],
        ['colchao', 'Colchão', 1500, 'resenha', '', '', true, 1, 150],
        ['passagem', 'Cota da passagem', 500, 'salvador', '', '', true, '', 160],
        ['hospedagem', 'Cota da hospedagem', 800, 'salvador', '', '', true, '', 170],
        ['passeio', 'Um passeio a dois', 300, 'salvador', '', '', true, '', 180],
        ['jantar-especial', 'Um jantar especial', 400, 'salvador', '', '', true, '', 190],
        ['lua-de-mel-livre', 'Cota livre da lua de mel', 200, 'salvador', '', 'Qualquer valor ajuda', true, '', 200],
    ];

    const aba = aba_(ABAS.PRESENTES);
    const existentes = {};
    lerAba_(ABAS.PRESENTES).forEach(function (p) { existentes[String(p.id).trim()] = true; });

    const novos = FAKE.filter(function (l) { return !existentes[l[0]]; });
    if (novos.length) {
        aba.getRange(aba.getLastRow() + 1, 1, novos.length, novos[0].length).setValues(novos);
    }

    CacheService.getScriptCache().removeAll(['catalogo', 'status']);
    log_('info', 'semearPresentes', novos.length + ' inseridos, ' + (FAKE.length - novos.length) + ' já existiam');
    return novos.length + ' presentes inseridos';
}

/** Remove só as linhas semeadas por `semearPresentes()`. Não toca em nada mais. */
function limparPresentesFake() {
    const ids = [
        'jogo-de-tacas', 'toalhas', 'vela-aromatica', 'tabua-de-servir', 'jogo-de-jantar',
        'jogo-de-cama', 'liquidificador', 'air-fryer', 'micro-ondas', 'aspirador',
        'jogo-de-panelas', 'geladeira', 'maquina-de-lavar', 'sofa', 'colchao',
        'passagem', 'hospedagem', 'passeio', 'jantar-especial', 'lua-de-mel-livre',
    ];
    const aba = aba_(ABAS.PRESENTES);
    const linhas = lerAba_(ABAS.PRESENTES)
        .filter(function (p) { return ids.indexOf(String(p.id).trim()) !== -1; })
        .map(function (p) { return p._linha; })
        .sort(function (a, b) { return b - a; }); // de baixo para cima, senão os índices deslocam

    linhas.forEach(function (n) { aba.deleteRow(n); });
    CacheService.getScriptCache().removeAll(['catalogo', 'status']);
    log_('info', 'limparPresentesFake', linhas.length + ' removidos');
    return linhas.length + ' removidos';
}

// ============================================================ testes manuais

/** Rode no editor antes de publicar. Não envia e-mail se modo_simulacao=TRUE. */
function testeManual() {
    const r = doPost({
        postData: {
            contents: JSON.stringify({
                acao: 'rsvp',
                nome: 'Teste da Silva',
                contato: 'teste@exemplo.com',
                comparece: 'sim',
                recado: 'Parabéns!',
            }),
        },
    });
    Logger.log(r.getContent());
}

/** Confere o que o catálogo e o status devolvem, sem passar pela web. */
function testeLeitura() {
    Logger.log('catalogo: ' + JSON.stringify(catalogo_()).slice(0, 500));
    Logger.log('status: ' + JSON.stringify(statusPresentes_()).slice(0, 500));
}

/** Confere no Log os textos com data e hora (task 16). Não envia nada. */
function testeDatas() {
    const cfg = config_();
    const falso = { nome: 'Teste da Silva', protocolo: 'TESTE' };
    Logger.log('evento: ' + dataEvento_(cfg, true) + ', às ' + horaEvento_(cfg));
    Logger.log('prazo: ' + (cfg.rsvp_ate ? prazoRsvp_(cfg) : '(sem prazo)') +
        ' · encerrado: ' + prazoEncerrado_(cfg));
    ['d7', 'd1'].forEach(function (c) {
        Logger.log(c + ' texto: ' + corpoTexto_(c, falso, cfg));
        Logger.log(c + ' html: ' + corpoHtml_(c, falso, cfg));
    });
    Logger.log('moldura: ' + moldura_('Título', '').slice(0, 600));
}

/** Simula uma campanha inteira. Com modo_simulacao=TRUE, nada é enviado. */
function testeCampanha() {
    Logger.log(JSON.stringify(enviarCampanha('d30')));
}
