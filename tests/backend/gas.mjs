/**
 * Roda o `scripts/Code.gs` REAL em Node, com os serviços do Apps Script simulados em
 * memória: planilha, cache, lock, propriedades, UrlFetchApp e um Mercado Pago falso com
 * estado. Task 17 (origem) e task 22 (Mercado Pago).
 *
 * Não é um emulador completo: simula o que o Code.gs usa, do jeito que ele usa. Onde o
 * Sheets real se comporta diferente (conversão de tipo de célula, por exemplo), o teste não
 * cobre, e a ressalva está nos CHANGELOGs.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CODIGO = fs.readFileSync(path.join(RAIZ, 'scripts/Code.gs'), 'utf8');

/** Belém é UTC-3 o ano inteiro. Formata só os padrões que o Code.gs usa. */
function formatarBelem(d, padrao) {
    const b = new Date(d.getTime() - 3 * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    const t = {
        yyyy: String(b.getUTCFullYear()),
        MM: p2(b.getUTCMonth() + 1),
        dd: p2(b.getUTCDate()),
        HH: p2(b.getUTCHours()),
        mm: p2(b.getUTCMinutes()),
        ss: p2(b.getUTCSeconds()),
        SSS: String(b.getUTCMilliseconds()).padStart(3, '0'),
    };
    if (padrao === "yyyy-MM-dd'T'HH:mm:ss.SSSXXX") return `${t.yyyy}-${t.MM}-${t.dd}T${t.HH}:${t.mm}:${t.ss}.${t.SSS}-03:00`;
    if (padrao === 'yyyy-MM-dd') return `${t.yyyy}-${t.MM}-${t.dd}`;
    if (padrao === 'H') return String(b.getUTCHours());
    if (padrao === 'd') return String(b.getUTCDate());
    if (padrao === 'M') return String(b.getUTCMonth() + 1);
    if (padrao === 'yyyy') return t.yyyy;
    return '';
}

/** Mercado Pago falso, com estado. */
export function criarMercadoPago() {
    let seq = 0;
    const mp = {
        preferencias: [],
        pagamentos: new Map(),
        chamadas: [],
        falharPreferencia: false,
        /** Cria (ou muda) um pagamento para uma ref. Id com 16 dígitos: passa de 2^53. */
        pagar(ref, { status = 'approved', valor, tipo = 'credit_card', metodo = 'master', parcelas = 1, moeda = 'BRL', id } = {}) {
            const pid = id ?? String(9007199254740993n + BigInt(++seq));
            const pref = mp.preferencias.find((p) => p.external_reference === ref);
            const pg = {
                id: pid,
                status,
                status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
                external_reference: ref,
                transaction_amount: valor ?? pref?.items[0].unit_price ?? 0,
                currency_id: moeda,
                payment_type_id: tipo,
                payment_method_id: metodo,
                installments: parcelas,
                date_created: new Date(Date.now() + seq).toISOString(),
            };
            mp.pagamentos.set(pid, pg);
            return pg;
        },
        mudar(pid, status) {
            mp.pagamentos.get(pid).status = status;
        },
        responder(url, opts = {}) {
            const u = new URL(url);
            const metodo = (opts.method || 'get').toLowerCase();
            mp.chamadas.push({ metodo, caminho: u.pathname, busca: u.search, corpo: opts.payload });
            const ok = (obj, cod = 200) => ({ getResponseCode: () => cod, getContentText: () => JSON.stringify(obj) });
            if (u.pathname === '/checkout/preferences' && metodo === 'post') {
                if (mp.falharPreferencia) return ok({ message: 'erro simulado' }, 500);
                const corpo = JSON.parse(opts.payload);
                const id = 'pref-' + (++seq);
                const pref = { id, ...corpo, init_point: 'https://mp.teste/checkout/' + id };
                mp.preferencias.push(pref);
                return ok(pref, 201);
            }
            if (u.pathname === '/v1/payments/search') {
                const ref = u.searchParams.get('external_reference');
                const results = [...mp.pagamentos.values()]
                    .filter((p) => p.external_reference === ref)
                    .sort((a, b) => b.date_created.localeCompare(a.date_created));
                return ok({ results, paging: { total: results.length } });
            }
            const m = u.pathname.match(/^\/v1\/payments\/(\d+)$/);
            if (m) {
                const pg = mp.pagamentos.get(m[1]);
                return pg ? ok(pg) : ok({ message: 'not found' }, 404);
            }
            if (u.pathname === '/v1/payment_methods') return ok([{ id: 'pix' }, { id: 'master' }]);
            return ok({ message: 'rota desconhecida no mock' }, 404);
        },
    };
    return mp;
}

export function criarAmbiente({ presentes = [], pagamentos = [], fetchImagem, config = [] } = {}) {
    const sheets = {};
    const semApostrofo = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);
    const mkSheet = (nome, linhas) => {
        const s = {
            nome,
            dados: linhas.map((l) => l.slice()),
            getDataRange: () => ({ getValues: () => s.dados.map((l) => l.slice()) }),
            // Simula o Sheets: apóstrofo inicial vira texto sem o apóstrofo.
            appendRow: (l) => { s.dados.push(l.map(semApostrofo)); },
            getRange: (r, c, nr = 1, nc = 1) => {
                const rg = {
                    getValues: () => {
                        const out = [];
                        for (let i = 0; i < nr; i++) {
                            const l = [];
                            for (let j = 0; j < nc; j++) l.push(s.dados[r - 1 + i]?.[c - 1 + j] ?? '');
                            out.push(l);
                        }
                        return out;
                    },
                    setValues: (vals) => {
                        for (let i = 0; i < nr; i++)
                            for (let j = 0; j < nc; j++) {
                                while (s.dados.length < r + i) s.dados.push([]);
                                s.dados[r - 1 + i][c - 1 + j] = semApostrofo(vals[i][j]);
                            }
                        return rg;
                    },
                    setValue: (v) => { s.dados[r - 1][c - 1] = semApostrofo(v); return rg; },
                    setFontWeight: () => rg,
                    setNumberFormat: () => rg,
                };
                return rg;
            },
            deleteRow: (n) => { s.dados.splice(n - 1, 1); },
            getLastRow: () => s.dados.length,
            getLastColumn: () => Math.max(0, ...s.dados.map((l) => l.length)),
            getMaxRows: () => Math.max(1000, s.dados.length),
            setFrozenRows: () => {},
        };
        sheets[nome] = s;
        return s;
    };

    // Relógio controlável: `amb.avancar(ms)` move o tempo do script.
    let deslocamento = 0;
    const DataReal = Date;
    class DataFalsa extends DataReal {
        constructor(...a) {
            if (a.length === 0) super(DataReal.now() + deslocamento);
            else super(...a);
        }
        static now() { return DataReal.now() + deslocamento; }
    }

    const mp = criarMercadoPago();
    // Imagens: `pagina`/`produto` na URL = link de página (HTML); `offline` = falha de rede.
    const imagens = fetchImagem ?? ((url) => {
        if (/offline/.test(url)) throw new Error('DNS');
        return {
            getResponseCode: () => 200,
            getHeaders: () => ({ 'Content-Type': /pagina|produto/.test(url) ? 'text/html' : 'image/jpeg' }),
        };
    });

    const logs = [];
    const ctx = {
        console: { log() {}, error() {}, warn() {} },
        Date: DataFalsa, JSON, Math, Number, String, Object, Array, Error, RegExp, encodeURIComponent,
        SpreadsheetApp: {
            getActiveSpreadsheet: () => ({
                getSheetByName: (n) => sheets[n] || null,
                insertSheet: (n) => mkSheet(n, []),
            }),
        },
        CacheService: (() => {
            const m = new Map();
            const c = {
                get: (k) => (m.has(k) ? m.get(k) : null),
                put: (k, v) => m.set(k, v),
                remove: (k) => m.delete(k),
                removeAll: (ks) => ks.forEach((k) => m.delete(k)),
                _m: m,
            };
            return { getScriptCache: () => c };
        })(),
        LockService: (() => {
            let preso = false;
            return {
                getScriptLock: () => ({
                    waitLock: () => { if (preso) throw new Error('lock ocupado (lock aninhado no código?)'); preso = true; },
                    releaseLock: () => { preso = false; },
                }),
                _preso: () => preso,
            };
        })(),
        PropertiesService: (() => {
            const m = new Map();
            const p = {
                getProperty: (k) => (m.has(k) ? m.get(k) : null),
                setProperty: (k, v) => m.set(k, String(v)),
                deleteProperty: (k) => m.delete(k),
                _m: m,
            };
            return { getScriptProperties: () => p };
        })(),
        Utilities: {
            DigestAlgorithm: { SHA_256: 'sha256' },
            Charset: { UTF_8: 'utf8' },
            computeDigest: (alg, txt) => Array.from(crypto.createHash('sha256').update(txt, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
            computeHmacSha256Signature: (a, b) => Array.from(crypto.createHmac('sha256', String(b)).update(String(a)).digest()),
            getUuid: () => crypto.randomUUID(),
            base64Encode: (s) => Buffer.from(s).toString('base64'),
            base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'),
            formatDate: (d, fuso, padrao) => formatarBelem(d, padrao),
        },
        UrlFetchApp: {
            fetch(url, opts) {
                if (url.includes('api.github.com')) return { getResponseCode: () => 204, getContentText: () => '' };
                if (url.startsWith('https://api.mercadopago.com')) return mp.responder(url, opts);
                return imagens(url);
            },
        },
        ContentService: {
            MimeType: { JSON: 'json' },
            createTextOutput: (t) => ({ setMimeType() { return this; }, getContent: () => t }),
        },
        MailApp: { getRemainingDailyQuota: () => 100, sendEmail: () => {} },
        ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create() {} }) }), everyMinutes: () => ({ create() {} }) }) }) },
        Logger: { log: (m) => logs.push(m) },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(
        CODIGO + '\n;globalThis.__x = { doPost, doGet, COLUNAS, txidDe_, definirSenhaNoivos, definirTokenMercadoPago,' +
            ' varrerPagamentos, conciliar_, configurarMercadoPago, testePreferencia, enviarCampanha, lerAba_ };',
        ctx,
    );

    const C = ctx.__x.COLUNAS;
    mkSheet('Presentes', [C.Presentes, ...presentes]);
    mkSheet('Pagamentos', [C.Pagamentos, ...pagamentos]);
    mkSheet('Convidados', [C.Convidados]);
    mkSheet('Config', [
        C.Config,
        ['modo_simulacao', 'TRUE'],
        ['site_url', 'https://giseleevictor.com.br'],
        ['email_noivos', 'noivos@exemplo.com'],
        ['evento_quando', '2027-01-16T20:00:00-03:00'],
        ['evento_local', 'Espaço FRA'],
        ...config,
    ]);
    mkSheet('Log', [C.Log]);

    const post = (obj, parametros = {}) =>
        JSON.parse(ctx.__x.doPost({ parameter: parametros, postData: obj === undefined ? undefined : { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).getContent());
    const get = (acao, extra = {}) => JSON.parse(ctx.__x.doGet({ parameter: { acao, ...extra } }).getContent());

    /** Linha de uma aba como objeto, pelo cabeçalho. */
    const linhas = (aba) => {
        const [cab, ...ls] = sheets[aba].dados;
        return ls.map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i] ?? ''])));
    };
    const avancar = (ms) => { deslocamento += ms; };
    const emails = () => sheets.Log.dados.filter((l) => l[1] === 'simulacao' && l[2] === 'email').map((l) => JSON.parse(l[3]));

    return { ctx, sheets, post, get, x: ctx.__x, mp, linhas, avancar, emails, logs };
}
