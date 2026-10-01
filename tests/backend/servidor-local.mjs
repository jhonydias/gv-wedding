/**
 * Backend local para ver as telas dos noivos no navegador sem tocar na planilha real
 * (task 24). Roda o `scripts/Code.gs` REAL sobre a planilha simulada do `gas.mjs`, com
 * convidados e pagamentos de exemplo, e responde com CORS aberto.
 *
 *   node tests/backend/servidor-local.mjs            # senha: senha-local-123
 *   PUBLIC_BACKEND_URL=http://localhost:8787/ npm run build && npm run preview
 *
 * Só para desenvolvimento. Nada aqui é publicado.
 */
import http from 'node:http';
import { criarAmbiente } from './gas.mjs';

const PORTA = Number(process.env.PORTA ?? 8787);
const SENHA = 'senha-local-123';

const a = criarAmbiente({
    config: [['rsvp_ate', '2026-11-16T23:59:59-03:00']],
    presentes: [
        ['luvas-de-boxe', 'Luvas de boxe pra ir na pipoca do trio elétrico do Bell Marques', 250, 'salvador', 'https://placehold.co/300x300/png?text=Luvas', '', true, 1, 10, false],
        ['batom', 'Mais um batom idêntico aos outros 20 que a Gisele já tem', 90, 'gisele', '', '', true, 5, 20, false],
        ['spa-ruth', 'Spa do salsichinha', 180, 'ruth', 'https://placehold.co/300x300/png?text=Spa', '', true, '', 30, false],
        ['ajuda-de-amigo', 'Ajuda de amigo', 50, 'resenha', '', '', true, '', 40, true],
    ],
});
a.x.definirSenhaNoivos(SENHA);

const DIA = 86400000;
const agora = Date.now();
const cabC = a.sheets.Convidados.dados[0];
const conv = (o) => a.sheets.Convidados.dados.push(cabC.map((c) => o[c] ?? ''));
const dt = (diasAtras, h = 0) => new Date(agora - diasAtras * DIA + h * 3600000);
conv({ protocolo: 'GV-0001', nome: 'Ana Beatriz Souza', contato: 'ana.souza@gmail.com', comparece: 'sim', total_pessoas: 1, recado: 'Mal posso esperar para ver vocês dois no altar! Contem comigo para a pista de dança.', criado_em: dt(12), atualizado_em: dt(12) });
conv({ protocolo: 'GV-0002', nome: 'Bruno Lima', contato: '(91) 98888-7777', comparece: 'nao', total_pessoas: 0, recado: 'Vou estar viajando a trabalho, mas mando um abraço enorme.', criado_em: dt(10), atualizado_em: dt(10) });
conv({ protocolo: 'GV-0003', nome: 'Carla Dias', contato: 'carla@t.com', comparece: 'nao', total_pessoas: 0, criado_em: dt(9), atualizado_em: dt(9) });
conv({ protocolo: 'GV-0004', nome: 'João Pedro Araújo', contato: '91999990000', comparece: 'sim', total_pessoas: 1, criado_em: dt(7), atualizado_em: dt(6, 5) });
conv({ protocolo: 'GV-0005', nome: 'Carla Dias', contato: 'carla@t.com', comparece: 'sim', total_pessoas: 1, recado: 'Consegui folga! Estarei lá.', criado_em: dt(3), atualizado_em: dt(3) });
conv({ protocolo: 'GV-0006', nome: 'Tia Socorro', contato: 'socorro@uol.com.br', comparece: 'Sim', total_pessoas: 3, restricao: 'sem glúten', criado_em: dt(40), atualizado_em: dt(40) });
conv({ protocolo: 'GV-0007', nome: 'Élio Matos', contato: 'elio@t.com', comparece: 'sim', total_pessoas: 1, criado_em: dt(1), atualizado_em: dt(1) });

const cabP = a.sheets.Pagamentos.dados[0];
const pg = (o) => a.sheets.Pagamentos.dados.push(cabP.map((c) => o[c] ?? ''));
pg({ id: 'r1', presente_id: 'luvas-de-boxe', nome: 'Ana Beatriz Souza', contato: 'ana.souza@gmail.com', valor: 250, status: 'confirmado', canal: 'mercadopago', metodo: 'credit_card', parcelas: 3, recado: 'Pro Bell Marques não pegar vocês desprevenidos!', criado_em: dt(8), confirmado_em: dt(8) });
pg({ id: 'r2', presente_id: 'batom', nome: 'Carla Dias', valor: 90, status: 'confirmado', canal: 'mercadopago', metodo: 'pix', recado: 'Vermelho, claro.', criado_em: dt(6), confirmado_em: dt(6) });
pg({ id: 'r3', presente_id: 'batom', nome: 'Tia Socorro', contato: 'socorro@uol.com.br', valor: 90, status: 'confirmado', canal: 'pix_manual', criado_em: dt(5), confirmado_em: dt(5) });
pg({ id: 'r4', presente_id: 'ajuda-de-amigo', nome: 'Bruno Lima', contato: '(91) 98888-7777', valor: 300, status: 'confirmado', canal: 'mercadopago', metodo: 'credit_card', parcelas: 1, criado_em: dt(4), confirmado_em: dt(4), alerta: 'excedente' });
pg({ id: 'r5', presente_id: 'spa-ruth', nome: 'Élio Matos', valor: 180, status: 'pendente', canal: 'pix_manual', criado_em: dt(1) });
pg({ id: 'r6', presente_id: 'spa-ruth', nome: 'Fulano Estornado', valor: 180, status: 'estornado', canal: 'mercadopago', metodo: 'credit_card', criado_em: dt(2), confirmado_em: dt(2) });
pg({ id: 'r7', presente_id: 'luvas-de-boxe', nome: 'Gente com checkout aberto', valor: 250, status: 'pendente', canal: 'mercadopago', expira_em: new Date(agora + 600000), criado_em: dt(0) });

http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
        try {
            const url = new URL(req.url, 'http://x');
            const saida = req.method === 'POST'
                ? a.post(corpo)
                : a.get(url.searchParams.get('acao') ?? 'ping', Object.fromEntries(url.searchParams));
            // Simula a latência do Apps Script, para ver os estados de carregamento.
            setTimeout(() => { res.writeHead(200, cors); res.end(JSON.stringify(saida)); }, 400);
        } catch (e) {
            res.writeHead(500, cors);
            res.end(JSON.stringify({ ok: false, msg: String(e) }));
        }
    });
}).listen(PORTA, () => console.log(`backend local em http://localhost:${PORTA}/ (senha: ${SENHA})`));
