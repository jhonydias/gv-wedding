/**
 * Página de retorno do Mercado Pago — task 22 §7.4.
 *
 * Lê SÓ a `ref` (da URL ou da aba). Os outros parâmetros que o Mercado Pago acrescenta
 * (`collection_status`, `payment_id`, `status`…) vêm do navegador e podem ser editados:
 * ignorados de propósito. Quem responde o estado é o servidor, que pergunta à API.
 */
import { CHAVE_ULTIMO } from './sessao-checkout';

const INTERVALO_MS = 4000;
const LIMITE_MS = 3 * 60 * 1000;
const TIMEOUT_MS = 20000;
const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Estado = 'pendente' | 'confirmado' | 'recusado' | 'expirado' | 'estornado' | 'desconhecido';

interface Resposta {
    ok?: boolean;
    estado?: Estado;
    presente?: string;
    presente_id?: string;
    nome?: string;
    metodo?: string;
}

function refDaPagina(): string {
    const daUrl = new URLSearchParams(location.search).get('ref') ?? '';
    if (REF.test(daUrl)) return daUrl;
    try {
        const salvo = JSON.parse(sessionStorage.getItem(CHAVE_ULTIMO) ?? 'null') as { ref?: string } | null;
        if (salvo?.ref && REF.test(salvo.ref)) return salvo.ref;
    } catch {
        /* sem sessão */
    }
    return '';
}

export function acompanharPagamento(): void {
    const raiz = document.querySelector<HTMLElement>('[data-obrigado]');
    if (!raiz) return;
    const endpoint = import.meta.env.PUBLIC_BACKEND_URL ?? '';
    const titulo = raiz.querySelector<HTMLElement>('[data-titulo]')!;
    const texto = raiz.querySelector<HTMLElement>('[data-texto]')!;
    const progresso = raiz.querySelector<HTMLElement>('[data-progresso]')!;
    const acoes = raiz.querySelector<HTMLElement>('[data-acoes]')!;
    const voltarPresente = raiz.querySelector<HTMLAnchorElement>('[data-voltar-presente]')!;

    const ref = refDaPagina();
    const inicio = Date.now();
    let ultimo: Estado | null = null;

    function mostrar(estado: Estado, r: Resposta, esgotouTempo = false): void {
        const presente = r.presente || 'o presente';
        const final = estado !== 'pendente' || esgotouTempo;
        progresso.hidden = final;
        acoes.hidden = !final;
        voltarPresente.hidden = !(estado === 'recusado' || estado === 'expirado');
        if (r.presente_id) voltarPresente.href = `${voltarPresente.dataset.base}#${r.presente_id}`;

        const textos: Record<Estado, [string, string]> = {
            confirmado: ['Presente confirmado!', `Obrigado${r.nome ? `, ${r.nome}` : ''}! O presente "${presente}" é seu, e Gisele e Victor já ficaram sabendo.`],
            pendente: ['Confirmando seu pagamento…', 'Se você pagou com Pix, isso leva alguns segundos. Pode deixar esta página aberta.'],
            recusado: ['O pagamento não foi aprovado', 'Nada foi cobrado. Você pode tentar de novo com outro cartão ou com Pix.'],
            expirado: ['O tempo para pagar acabou', 'Nada foi cobrado. O presente voltou para a lista.'],
            estornado: ['Este pagamento foi devolvido', 'O valor voltou para quem pagou, e o presente voltou para a lista.'],
            desconhecido: ['Não encontramos este pagamento', 'Se você acabou de pagar, volte à lista em alguns minutos: a confirmação chega sozinha.'],
        };
        let [t, d] = textos[estado];
        if (estado === 'pendente' && esgotouTempo) {
            t = 'Ainda não recebemos a confirmação';
            d = 'Se você já pagou, fique tranquilo: a confirmação chega sozinha e o presente sai da lista. Se não pagou, a reserva é liberada em meia hora.';
        }
        texto.textContent = d;
        if (titulo.textContent !== t) {
            titulo.textContent = t;
            if (final) titulo.focus();
        }
    }

    if (!ref || !endpoint) {
        mostrar('desconhecido', {});
        return;
    }

    async function consultar(): Promise<void> {
        let r: Resposta = {};
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const resp = await fetch(`${endpoint}?acao=pagamento&ref=${encodeURIComponent(ref)}`, { signal: ctrl.signal });
            r = (await resp.json()) as Resposta;
        } catch {
            r = { estado: ultimo ?? 'pendente' };
        } finally {
            window.clearTimeout(t);
        }
        const estado: Estado = r.estado ?? 'pendente';
        ultimo = estado;
        const esgotou = Date.now() - inicio > LIMITE_MS;
        mostrar(estado, r, esgotou);
        if (estado === 'pendente' && !esgotou) window.setTimeout(() => void consultar(), INTERVALO_MS);
    }

    void consultar();
}
