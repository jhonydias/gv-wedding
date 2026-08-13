/**
 * RSVP — Gisele & Victor · backend em Google Apps Script.
 * Task 06. Arquitetura portada de modo-bim/script/Code.gs, já validado em produção.
 *
 * Publicar como App da Web:
 *   Executar como: eu · Quem tem acesso: QUALQUER PESSOA
 * Sem "qualquer pessoa" o front leva 403.
 *
 * CORS: o Apps Script NÃO responde ao preflight OPTIONS. Por isso o front envia
 * `Content-Type: text/plain` (content-type simples, não gera preflight) com JSON no corpo.
 */

const CONFIG = {
    ABA: 'Confirmacoes',
    PREFIXO_PROTOCOLO: 'GV-',
    EMAIL_NOIVOS: 'jhonymarlon@gmail.com', // TODO: trocar pelo e-mail de quem organiza
    RATE_MAX: 3, // envios permitidos...
    RATE_JANELA_MS: 5 * 60 * 1000, // ...nesta janela, por contato
    IDEMPOTENCIA_MS: 24 * 60 * 60 * 1000, // mesmo contato+nome em 24h ATUALIZA a linha
    LOCK_MS: 10000,
};

const COLUNAS = [
    'protocolo',
    'carimbo',
    'nome',
    'contato',
    'comparece',
    'acompanhantes',
    'total_pessoas',
    'restricao',
    'recado',
    'origem',
];

// ---------------------------------------------------------------- entrada

function doPost(e) {
    const lock = LockService.getScriptLock();
    try {
        // Serializa a escrita. Sem lock, duas confirmações simultâneas podem escrever
        // na mesma linha e uma some — o bug mais caro possível aqui.
        lock.waitLock(CONFIG.LOCK_MS);

        const bruto = JSON.parse(e.postData.contents);

        // Bot: finge sucesso e descarta em silêncio.
        if (bruto._gotcha) return json_({ ok: true });

        const dados = sanitizar_(bruto);

        const erro = validar_(dados);
        if (erro) return json_({ ok: false, msg: erro });

        if (rateLimitado_(dados.contato)) {
            return json_({
                ok: false,
                msg: 'Muitas tentativas seguidas. Tente de novo em alguns minutos.',
            });
        }

        const protocolo = gravarOuAtualizar_(dados, e);
        notificar_(dados, protocolo);

        return json_({ ok: true, protocolo: protocolo, msg: 'Presença confirmada!' });
    } catch (err) {
        // Nunca devolver stack trace ao cliente.
        console.error(err);
        return json_({ ok: false, msg: 'Não conseguimos registrar agora. Tente novamente.' });
    } finally {
        lock.releaseLock();
    }
}

/** Fallback sem JavaScript: o POST nativo cai aqui e recebe uma página simples. */
function doGet() {
    return HtmlService.createHtmlOutput(
        '<h1>Confirmação de presença</h1><p>Use o formulário do site.</p>',
    );
}

// ---------------------------------------------------------------- sanitização

function limpar_(v, max) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/<[^>]*>/g, '') // remove HTML
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function sanitizar_(d) {
    return {
        nome: limpar_(d.nome, 80),
        contato: limpar_(d.contato, 120),
        comparece: limpar_(d.comparece, 5).toLowerCase(),
        // Aqui a quebra de linha é significativa (um acompanhante por linha).
        acompanhantes: String(d.acompanhantes || '')
            .replace(/<[^>]*>/g, '')
            .split('\n')
            .map(function (s) {
                return s.trim();
            })
            .filter(Boolean)
            .slice(0, 20),
        restricao: limpar_(d.restricao, 300),
        recado: limpar_(d.recado, 500),
    };
}

// ---------------------------------------------------------------- validação

function contatoValido_(v) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return true;
    const so = v.replace(/\D/g, '');
    return so.length === 10 || so.length === 11;
}

/**
 * Revalida TUDO no servidor. O cliente não é fonte de verdade: um payload forjado
 * não pode passar.
 */
function validar_(d) {
    if (d.nome.length < 3) return 'Informe o nome completo.';
    if (!contatoValido_(d.contato)) return 'Informe um e-mail ou celular válido.';
    if (d.comparece !== 'sim' && d.comparece !== 'nao') return 'Escolha se você vai ou não.';
    return null;
}

// ---------------------------------------------------------------- rate limit

function rateLimitado_(contato) {
    const props = PropertiesService.getScriptProperties();
    const chave = 'rl_' + Utilities.base64EncodeWebSafe(contato.toLowerCase()).slice(0, 40);
    const agora = Date.now();

    const registros = JSON.parse(props.getProperty(chave) || '[]').filter(function (t) {
        return agora - t < CONFIG.RATE_JANELA_MS;
    });

    if (registros.length >= CONFIG.RATE_MAX) return true;

    registros.push(agora);
    props.setProperty(chave, JSON.stringify(registros));
    return false;
}

// ---------------------------------------------------------------- planilha

function aba_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let aba = ss.getSheetByName(CONFIG.ABA);
    if (!aba) {
        aba = ss.insertSheet(CONFIG.ABA);
        aba.appendRow(COLUNAS);
        aba.setFrozenRows(1);
    }
    return aba;
}

function gravarOuAtualizar_(d, e) {
    const aba = aba_();
    const agora = new Date();

    // total_pessoas é CALCULADO no servidor. Se viesse do cliente, um payload
    // forjado inflaria o buffet.
    const total = d.comparece === 'sim' ? 1 + d.acompanhantes.length : 0;

    const origem = e && e.parameter && e.parameter.ua ? String(e.parameter.ua).slice(0, 80) : '';

    const valores = aba.getDataRange().getValues();
    const iContato = COLUNAS.indexOf('contato');
    const iNome = COLUNAS.indexOf('nome');
    const iCarimbo = COLUNAS.indexOf('carimbo');
    const iProtocolo = COLUNAS.indexOf('protocolo');

    // Idempotência: mesmo contato + mesmo nome dentro de 24h ATUALIZA a linha.
    // Casal que confirma duas vezes é comum; duplicata na planilha, não.
    for (let i = valores.length - 1; i >= 1; i--) {
        const linha = valores[i];
        const mesmoContato =
            String(linha[iContato]).toLowerCase() === d.contato.toLowerCase();
        const mesmoNome = String(linha[iNome]).toLowerCase() === d.nome.toLowerCase();
        if (!mesmoContato || !mesmoNome) continue;

        const quando = new Date(linha[iCarimbo]).getTime();
        if (isNaN(quando) || Date.now() - quando > CONFIG.IDEMPOTENCIA_MS) break;

        const protocolo = String(linha[iProtocolo]);
        aba.getRange(i + 1, 1, 1, COLUNAS.length).setValues([
            [
                protocolo,
                agora,
                d.nome,
                d.contato,
                d.comparece,
                d.acompanhantes.join('\n'),
                total,
                d.restricao,
                d.recado,
                origem,
            ],
        ]);
        return protocolo;
    }

    const protocolo = CONFIG.PREFIXO_PROTOCOLO + String(aba.getLastRow()).padStart(4, '0');
    aba.appendRow([
        protocolo,
        agora,
        d.nome,
        d.contato,
        d.comparece,
        d.acompanhantes.join('\n'),
        total,
        d.restricao,
        d.recado,
        origem,
    ]);
    return protocolo;
}

// ---------------------------------------------------------------- notificação

function notificar_(d, protocolo) {
    if (!CONFIG.EMAIL_NOIVOS) return;
    const vai = d.comparece === 'sim';
    const total = vai ? 1 + d.acompanhantes.length : 0;

    const corpo = [
        'Protocolo: ' + protocolo,
        'Nome: ' + d.nome,
        'Contato: ' + d.contato,
        'Vai? ' + (vai ? 'SIM' : 'NÃO'),
        'Total de pessoas: ' + total,
        d.acompanhantes.length ? 'Acompanhantes:\n- ' + d.acompanhantes.join('\n- ') : '',
        d.restricao ? 'Restrição alimentar: ' + d.restricao : '',
        d.recado ? 'Recado:\n' + d.recado : '',
    ]
        .filter(Boolean)
        .join('\n');

    try {
        MailApp.sendEmail(
            CONFIG.EMAIL_NOIVOS,
            (vai ? '[RSVP] ' : '[RSVP - não vai] ') + d.nome,
            corpo,
        );
    } catch (err) {
        // E-mail falhar não pode derrubar a gravação, que é o que importa.
        console.error('falha ao notificar', err);
    }
}

// ---------------------------------------------------------------- utilitários

function json_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
        ContentService.MimeType.JSON,
    );
}

/** Rode isto no editor antes de publicar. Deve criar a aba e uma linha de teste. */
function testeManual() {
    const r = doPost({
        postData: {
            contents: JSON.stringify({
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
