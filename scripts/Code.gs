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

const COLUNAS = {
    Presentes: ['id', 'nome', 'valor', 'faixa', 'imagem', 'descricao', 'ativo', 'cotas', 'ordem'],
    Pagamentos: ['id', 'presente_id', 'nome', 'contato', 'valor', 'status', 'criado_em', 'confirmado_em'],
    Convidados: [
        'protocolo', 'nome', 'contato', 'comparece', 'acompanhantes', 'total_pessoas',
        'restricao', 'recado', 'criado_em', 'atualizado_em', 'mesa',
        'emails_enviados', 'descadastrado',
    ],
    Config: ['chave', 'valor'],
    Log: ['carimbo', 'nivel', 'acao', 'detalhe'],
};

/** Padrões da aba Config. `configurarPlanilha()` grava estes valores. */
const CONFIG_PADRAO = [
    ['evento_quando', '2027-01-31T19:00:00-03:00'],
    ['evento_local', 'Espaço FRA'],
    ['evento_endereco', 'R. Cônego Jerônimo Pimentel, 124 - Umarizal, Belém - PA, 66055-000'],
    ['site_url', 'https://jhonydias.github.io/gv-wedding'],
    ['email_noivos', 'TODO@exemplo.com'],
    ['whatsapp', 'TODO'],
    ['rsvp_ate', ''],
    ['pix_chave', ''],
    // ⚠️ TRUE = nada é enviado de verdade. Só vire para FALSE com autorização dos noivos.
    ['modo_simulacao', 'TRUE'],
    ['segredo_token', ''],
    ['lote_email_max', '80'],
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

/** Lê uma aba inteira como array de objetos, usando a primeira linha como cabeçalho. */
function lerAba_(nome) {
    const valores = aba_(nome).getDataRange().getValues();
    if (valores.length < 2) return [];
    const cab = valores[0].map(String);
    return valores.slice(1)
        .filter(function (l) { return l.some(function (c) { return c !== '' && c !== null; }); })
        .map(function (linha, i) {
            const o = { _linha: i + 2 };
            cab.forEach(function (c, j) { o[c] = linha[j]; });
            return o;
        });
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
        // Segredo aleatório para os tokens de descadastro.
        const seg = Utilities.getUuid() + Utilities.getUuid();
        const linhas = cfg.getDataRange().getValues();
        for (let i = 1; i < linhas.length; i++) {
            if (linhas[i][0] === 'segredo_token') cfg.getRange(i + 1, 2).setValue(seg);
        }
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
    log_('info', 'instalarGatilhos', 'campanha diária às 9h');
    return 'gatilho instalado';
}

// ============================================================ leitura (doGet)

function doGet(e) {
    const acao = (e && e.parameter && e.parameter.acao) || 'ping';
    try {
        switch (acao) {
            case 'ping':
                return json_({ ok: true, versao: '17.0', hora: new Date().toISOString() });
            case 'catalogo':
                return json_({ ok: true, presentes: catalogo_() });
            case 'status':
                return json_({ ok: true, status: statusPresentes_() });
            case 'descadastrar':
                return descadastrar_(e.parameter.token);
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
                faixa: String(p.faixa || 'casa'),
                imagem: String(p.imagem || ''),
                descricao: String(p.descricao || ''),
                cotas: p.cotas === '' || p.cotas === null ? null : Number(p.cotas),
                ordem: Number(p.ordem) || 0,
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

    const confirmados = {};
    lerAba_(ABAS.PAGAMENTOS).forEach(function (p) {
        if (String(p.status).toLowerCase() !== 'confirmado') return;
        const id = String(p.presente_id).trim();
        if (!id) return;
        confirmados[id] = (confirmados[id] || 0) + 1;
    });

    const saida = {};
    catalogo_().forEach(function (p) {
        const usadas = confirmados[p.id] || 0;
        const ilimitado = p.cotas === null || p.cotas <= 0;
        saida[p.id] = {
            disponivel: ilimitado || usadas < p.cotas,
            cotasRestantes: ilimitado ? null : Math.max(0, p.cotas - usadas),
        };
    });

    cache.put('status', JSON.stringify(saida), LIMITES.CACHE_STATUS_S);
    return saida;
}

// ============================================================ escrita (doPost)

function doPost(e) {
    // Ações dos noivos (task 17) pegam o lock só em volta da gravação: elas fazem rede
    // (pré-voo da imagem, disparo do deploy) e não podem prender o RSVP dos convidados.
    let dadosAdmin = null;
    try {
        dadosAdmin = JSON.parse(e.postData.contents);
    } catch (err) {
        dadosAdmin = null;
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
        acompanhantes: String(bruto.acompanhantes || '')
            .replace(/<[^>]*>/g, '')
            .split('\n')
            .map(function (s) { return s.trim(); })
            .filter(Boolean)
            .slice(0, 20),
        restricao: limpar_(bruto.restricao, 300),
        recado: limpar_(bruto.recado, 500),
    };

    // Revalida TUDO no servidor: o cliente não é fonte de verdade.
    if (d.nome.length < 3) return json_({ ok: false, msg: 'Informe o nome completo.' });
    if (!contatoValido_(d.contato)) return json_({ ok: false, msg: 'Informe um e-mail ou celular válido.' });
    if (d.comparece !== 'sim' && d.comparece !== 'nao') {
        return json_({ ok: false, msg: 'Escolha se você vai ou não.' });
    }

    if (rateLimitado_(d.contato)) {
        return json_({ ok: false, msg: 'Muitas tentativas seguidas. Tente de novo em alguns minutos.' });
    }

    // total_pessoas é CALCULADO aqui. Se viesse do cliente, um payload forjado
    // inflaria o buffet.
    const total = d.comparece === 'sim' ? 1 + d.acompanhantes.length : 0;

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
            l.protocolo, d.nome, d.contato, d.comparece, d.acompanhantes.join('\n'), total,
            d.restricao, d.recado, l.criado_em, agora, l.mesa || '',
            l.emails_enviados || '', l.descadastrado || false,
        ]]);
        log_('info', 'rsvp:atualizado', l.protocolo);
        return json_({ ok: true, protocolo: String(l.protocolo), msg: 'Confirmação atualizada!' });
    }

    const protocolo = 'GV-' + String(aba.getLastRow()).padStart(4, '0');
    aba.appendRow([
        protocolo, d.nome, d.contato, d.comparece, d.acompanhantes.join('\n'), total,
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
        'Protocolo: ' + protocolo,
        'Nome: ' + d.nome,
        'Contato: ' + d.contato,
        'Vai? ' + (vai ? 'SIM' : 'NÃO'),
        'Total de pessoas: ' + (vai ? 1 + d.acompanhantes.length : 0),
        d.acompanhantes.length ? 'Acompanhantes:\n- ' + d.acompanhantes.join('\n- ') : '',
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
    aba_(ABAS.PAGAMENTOS).appendRow([
        Utilities.getUuid(), presenteId, nome, limpar_(bruto.contato, 120),
        presente.valor, 'pendente', agora, '',
    ]);

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
const ACOES_ADMIN = ['entrar', 'listarPresentes', 'criarPresente', 'editarPresente', 'apagarPresente'];

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
    // Mesmas fronteiras de FAIXAS em src/data/presentes.ts ("Até R$ 150", "De R$ 150 a
    // R$ 800", "Acima de R$ 800"). Mudou lá, muda aqui: `faixaDe()` no site espelha esta.
    TETO_LEMBRANCA: 150,
    TETO_CASA: 800,
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

/**
 * Lê `Presentes` guardando o número REAL da linha. O `lerAba_()` numera depois de filtrar
 * linhas vazias, então com uma linha em branco no meio o `_linha` dele aponta para o
 * vizinho. Para ler, tanto faz; para editar e apagar, seria mexer no presente errado.
 */
function lerPresentes_() {
    const aba = aba_(ABAS.PRESENTES);
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
        if (!c[id]) c[id] = { pendente: 0, confirmado: 0, cancelado: 0, total: 0 };
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
        faixa: String(p.faixa || ''),
        imagem: String(p.imagem || ''),
        descricao: String(p.descricao || ''),
        cotas: p.cotas === '' || p.cotas === null ? null : Number(p.cotas),
        ativo: ehVerdadeiro_(p.ativo),
        ordem: Number(p.ordem) || 0,
        pagamentos: pagamentos[id] || { pendente: 0, confirmado: 0, cancelado: 0, total: 0 },
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

function faixaDe_(valor, luademel) {
    if (luademel) return 'luademel';
    if (valor <= ADMIN.TETO_LEMBRANCA) return 'lembranca';
    if (valor <= ADMIN.TETO_CASA) return 'casa';
    return 'grande';
}

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

    if (nome.length < 2 || nome.length > 60) return erro('nome', 'Dê um nome ao presente, com até 60 letras.');
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

    const luademel = d.luademel === true;
    return {
        ok: true,
        avisos: avisos,
        campos: {
            nome: nome,
            valor: valor,
            faixa: faixaDe_(valor, luademel),
            imagem: imagemBruta,
            descricao: descricao,
            ativo: d.publicar !== false,
            cotas: cotas,
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

        const mudouFaixa = String(p.faixa) !== c.faixa;
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

function tokenDe_(protocolo) {
    const seg = config_().segredo_token || '';
    const bytes = Utilities.computeHmacSha256Signature(String(protocolo), seg);
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function moldura_(titulo, corpoHtml, protocolo) {
    const cfg = config_();
    const linkSaida = protocolo
        ? '<p style="font-size:12px;color:#626247;margin-top:32px">' +
          '<a href="' + cfg.site_url + '?descadastrar=' + encodeURIComponent(tokenDe_(protocolo)) +
          '" style="color:#743D05">Não quero mais receber estes e-mails</a></p>'
        : '';
    return [
        '<div style="font-family:Georgia,serif;background:#F7F1EB;color:#48492A;padding:32px">',
        '<div style="max-width:520px;margin:0 auto">',
        '<p style="font-size:28px;letter-spacing:.04em;margin:0 0 4px">GISELE <span style="color:#F0994A">&amp;</span> VICTOR</p>',
        '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#626247;margin:0 0 28px">',
        '31 de janeiro de 2027 · ' + cfg.evento_local + '</p>',
        '<h1 style="font-size:22px;margin:0 0 12px">' + titulo + '</h1>',
        corpoHtml,
        linkSaida,
        '</div></div>',
    ].join('');
}

function enviarConfirmacao_(protocolo, d) {
    if (d.comparece !== 'sim') {
        const txtN = 'Recebemos seu aviso, ' + d.nome + '. Que pena que não vai dar!\n\nProtocolo: ' + protocolo;
        enviarEmail_(d.contato, 'Recebemos seu aviso', txtN,
            moldura_('Obrigado por avisar', '<p>Que pena que não vai dar, ' + d.nome + '. Você vai fazer falta.</p>' +
                '<p style="font-size:13px;color:#626247">Protocolo: <strong>' + protocolo + '</strong></p>', null));
        return;
    }

    const cfg = config_();
    const txt = 'Presença confirmada, ' + d.nome + '!\n\nProtocolo: ' + protocolo +
        '\n' + cfg.evento_local + '\n' + cfg.evento_endereco;
    enviarEmail_(d.contato, 'Presença confirmada!', txt,
        moldura_('Presença confirmada!',
            '<p>A gente mal pode esperar para ver você lá, ' + d.nome + '.</p>' +
            '<p style="font-size:13px;color:#626247">Protocolo: <strong>' + protocolo + '</strong><br>' +
            'Pessoas: <strong>' + (1 + d.acompanhantes.length) + '</strong></p>' +
            '<p><a href="' + cfg.site_url + '/informacoes" style="color:#743D05">Ver informações do grande dia</a></p>',
            protocolo));
}

// ---------------------------------------------------------------- campanha

/** Gatilho diário. Decide qual campanha cabe hoje e manda um lote. */
function rodarCampanhas() {
    const cfg = config_();
    const evento = new Date(cfg.evento_quando).getTime();
    const hoje = Date.now();
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
        if (String(l.comparece).toLowerCase() !== 'sim') return false; // só quem vai
        if (ehVerdadeiro_(l.descadastrado)) return false;
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
            moldura_(campanha.assunto, corpoHtml_(campanha.chave, l, cfg), String(l.protocolo)),
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
        d7: 'Oi, ' + nome + '! É na próxima semana, dia 31 de janeiro às 19h.',
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
                '<p>Separamos tudo que você precisa: endereço, como chegar, traje e hospedagem.</p>' +
                btn('Ver informações', info);
        case 'd7':
            return '<p>Oi, ' + nome + '! É na próxima semana, <strong>31 de janeiro, às 19h</strong>.</p>' +
                '<p>' + cfg.evento_local + '<br>' + cfg.evento_endereco + '</p>' +
                btn('Como chegar', info);
        case 'd1':
            return '<p><strong>É amanhã, ' + nome + '!</strong></p>' +
                '<p>' + cfg.evento_local + '<br>' + cfg.evento_endereco + '<br>Às 19h.</p>' +
                btn('Chamar um carro', info);
        case 'pos':
            return '<p>Obrigado por estar com a gente, ' + nome + '. Foi tudo mais bonito com você lá.</p>' +
                btn('Ver as fotos', cfg.site_url + '/pre-wedding');
        default:
            return '<p>Oi, ' + nome + '!</p>';
    }
}

// ---------------------------------------------------------------- descadastro

/** Token é HMAC do protocolo. Protocolo cru na URL deixaria qualquer um descadastrar qualquer um. */
function descadastrar_(token) {
    if (!token) return json_({ ok: false, msg: 'Token ausente.' });

    const aba = aba_(ABAS.CONVIDADOS);
    const iDesc = COLUNAS.Convidados.indexOf('descadastrado') + 1;
    const linhas = lerAba_(ABAS.CONVIDADOS);

    for (let i = 0; i < linhas.length; i++) {
        if (tokenDe_(linhas[i].protocolo) !== token) continue;
        aba.getRange(linhas[i]._linha, iDesc).setValue(true);
        log_('info', 'descadastro', String(linhas[i].protocolo));
        return json_({ ok: true, msg: 'Pronto, você não recebe mais nossos e-mails.' });
    }
    return json_({ ok: false, msg: 'Token inválido.' });
}

// ============================================================ utilitários

function json_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
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
        ['jogo-de-tacas', 'Jogo de taças', 90, 'lembranca', '', 'Seis taças de cristal', true, 1, 10],
        ['toalhas', 'Jogo de toalhas', 120, 'lembranca', '', '', true, 1, 20],
        ['vela-aromatica', 'Vela aromática', 95, 'lembranca', '', '', true, 3, 30],
        ['tabua-de-servir', 'Tábua de servir', 140, 'lembranca', '', '', true, 1, 40],
        ['jogo-de-jantar', 'Jogo de jantar', 320, 'casa', '', 'Para as visitas de domingo', true, 1, 50],
        ['jogo-de-cama', 'Jogo de cama', 280, 'casa', '', '', true, 1, 60],
        ['liquidificador', 'Liquidificador', 250, 'casa', '', '', true, 1, 70],
        ['air-fryer', 'Air fryer', 450, 'casa', '', '', true, 1, 80],
        ['micro-ondas', 'Micro-ondas', 700, 'casa', '', '', true, 1, 90],
        ['aspirador', 'Aspirador', 600, 'casa', '', '', true, 1, 100],
        ['jogo-de-panelas', 'Jogo de panelas', 520, 'casa', '', '', true, 1, 110],
        ['geladeira', 'Geladeira', 2500, 'grande', '', 'Cota única: a maior de todas', true, 1, 120],
        ['maquina-de-lavar', 'Máquina de lavar', 2200, 'grande', '', '', true, 1, 130],
        ['sofa', 'Sofá', 1800, 'grande', '', '', true, 1, 140],
        ['colchao', 'Colchão', 1500, 'grande', '', '', true, 1, 150],
        ['passagem', 'Cota da passagem', 500, 'luademel', '', '', true, '', 160],
        ['hospedagem', 'Cota da hospedagem', 800, 'luademel', '', '', true, '', 170],
        ['passeio', 'Um passeio a dois', 300, 'luademel', '', '', true, '', 180],
        ['jantar-especial', 'Um jantar especial', 400, 'luademel', '', '', true, '', 190],
        ['lua-de-mel-livre', 'Cota livre da lua de mel', 200, 'luademel', '', 'Qualquer valor ajuda', true, '', 200],
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
                acompanhantes: 'Fulano\nBeltrana',
                restricao: 'Sem glúten',
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

/** Simula uma campanha inteira. Com modo_simulacao=TRUE, nada é enviado. */
function testeCampanha() {
    Logger.log(JSON.stringify(enviarCampanha('d30')));
}
