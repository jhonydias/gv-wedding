/**
 * Roda o `scripts/Code.gs` REAL contra a API REAL do Mercado Pago, com a planilha simulada
 * do `gas.mjs`. Não entra no `npm run test:backend` (o nome não termina em `.test.mjs`) e
 * nunca roda no CI: precisa de um Access Token de TESTE na variável de ambiente.
 *
 *   MP_TOKEN_TESTE=APP_USR-... node tests/backend/ao-vivo.mjs preferencia
 *   MP_TOKEN_TESTE=APP_USR-... node tests/backend/ao-vivo.mjs checkout      # imprime o link
 *   MP_TOKEN_TESTE=APP_USR-... node tests/backend/ao-vivo.mjs conciliar <arquivo-de-estado>
 *
 * O token não é gravado em disco. O estado (planilha simulada) do `checkout` vai para o
 * arquivo pedido em `MP_ESTADO`, para o `conciliar` retomar depois do pagamento.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { criarAmbiente } from './gas.mjs';

const TOKEN = process.env.MP_TOKEN_TESTE || '';
if (!/^(APP_USR|TEST)-/.test(TOKEN)) {
    console.error('Defina MP_TOKEN_TESTE com o Access Token de teste.');
    process.exit(2);
}

/** UrlFetchApp é síncrono; o fetch do Node não. Um processo filho faz a chamada. */
function fetchSincrono(url, opts = {}) {
    const pedido = JSON.stringify({
        url,
        method: (opts.method || 'get').toUpperCase(),
        headers: { ...(opts.headers || {}), ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}) },
        body: opts.payload,
    });
    const filho = `
        const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));
        fetch(p.url, { method: p.method, headers: p.headers, body: p.body })
            .then(async (r) => process.stdout.write(JSON.stringify({ cod: r.status, texto: await r.text() })))
            .catch((e) => process.stdout.write(JSON.stringify({ erro: String(e) })));`;
    const r = JSON.parse(execFileSync(process.execPath, ['-e', filho], { input: pedido, encoding: 'utf8' }));
    if (r.erro) throw new Error(r.erro);
    return { getResponseCode: () => r.cod, getContentText: () => r.texto };
}

const PRESENTES = [
    ['geladeira', 'Geladeira', 900, 'grande', '', '', true, 1, 10, false],
    ['vela', 'Vela aromática', 95, 'lembranca', '', '', true, 3, 20, false],
    ['livre', 'Contribuição livre', 50, 'salvador', '', '', true, '', 40, true],
];

function ambiente(pagamentos = []) {
    const a = criarAmbiente({
        presentes: PRESENTES,
        pagamentos,
        config: [['pagamento_modo', 'mercadopago'], ['backend_url', process.env.MP_BACKEND_URL || 'https://script.google.com/macros/s/TESTE/exec']],
    });
    const original = a.ctx.UrlFetchApp.fetch;
    a.ctx.UrlFetchApp.fetch = (url, opts) =>
        url.startsWith('https://api.mercadopago.com') ? fetchSincrono(url, opts) : original(url, opts);
    a.x.definirTokenMercadoPago(TOKEN, 'teste');
    if (process.env.MP_SEGREDO) a.ctx.PropertiesService.getScriptProperties().setProperty('segredo_webhook', process.env.MP_SEGREDO);
    return a;
}

const [cmd, arg] = process.argv.slice(2);
const a = ambiente(cmd === 'conciliar' ? JSON.parse(fs.readFileSync(arg, 'utf8')) : []);

if (cmd === 'metodos') {
    console.log(a.ctx.testeMercadoPago());
}

if (cmd === 'preferencia') {
    console.log(JSON.stringify(a.x.testePreferencia(), null, 2));
}

if (cmd === 'checkout') {
    const r = a.post({ acao: 'checkout', presente_id: process.env.MP_PRESENTE || 'vela', nome: 'Convidado Teste', contato: 'teste@exemplo.com', recado: 'Teste ao vivo', valor: Number(process.env.MP_VALOR || 0) || undefined });
    console.log(JSON.stringify(r, null, 2));
    const estado = process.env.MP_ESTADO;
    if (estado && r.ok) fs.writeFileSync(estado, JSON.stringify(a.sheets.Pagamentos.dados.slice(1)));
}

if (cmd === 'conciliar') {
    const refs = a.linhas('Pagamentos').map((l) => l.id);
    for (const ref of refs) console.log(ref, JSON.stringify(a.x.conciliar_(ref)));
    console.log(JSON.stringify(a.linhas('Pagamentos'), null, 2));
    console.log('status público:', JSON.stringify(a.get('status')));
    for (const ref of refs) console.log('pagamento público:', JSON.stringify(a.get('pagamento', { ref })));
    console.log('e-mails simulados:', JSON.stringify(a.emails(), null, 2));
    fs.writeFileSync(arg, JSON.stringify(a.sheets.Pagamentos.dados.slice(1)));
}
